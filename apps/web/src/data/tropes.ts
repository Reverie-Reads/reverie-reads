import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  resolveTrope,
  type Book,
  type TropeEmphasis,
  type TropeFacet,
} from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { booksKey } from './books'

/**
 * The trope vocabulary + assignment data layer. Canonical rows (owner_id null) come from the
 * seed migration; personal rows are RLS-scoped to the reader, optionally alias-linked to a
 * canonical. Assignments (book_tropes) ride into Book.tropes via the useBooks join — mutations
 * here invalidate booksKey so chips/filters follow.
 */

export interface UiTrope {
  id: string
  name: string
  aliases: string[]
  facet: TropeFacet
  affinity: string[]
  personal: boolean
  canonicalId: string | null
}

interface TropeRowT {
  id: string
  owner_id: string | null
  canonical_id: string | null
  name: string
  aliases: string[]
  facet: string
  genre_affinity: string[]
}

const toUiTrope = (r: TropeRowT): UiTrope => ({
  id: r.id,
  name: r.name,
  aliases: r.aliases ?? [],
  facet: r.facet as TropeFacet,
  affinity: r.genre_affinity ?? [],
  personal: r.owner_id != null,
  canonicalId: r.canonical_id,
})

export const tropesKey = ['tropes'] as const
export const bookTropesKey = ['book-tropes', 'all'] as const
export const suggestionsKey = (bookId: string) => ['trope-suggestions', bookId] as const

/** The whole vocabulary the reader can see: canonical + their personal coinages. */
export function useTropes() {
  return useQuery({
    queryKey: tropesKey,
    queryFn: async (): Promise<UiTrope[]> => {
      const data = await pageAll<TropeRowT>('tropes', (from, to) =>
        // `name` is not unique across canonical and personal rows — `id` makes the pages disjoint.
        supabase.from('tropes').select('*', { count: 'exact' }).order('name').order('id').range(from, to),
      )
      return data.map(toUiTrope)
    },
  })
}

export interface BookTropeRow {
  book_id: string
  trope_id: string
  emphasis: TropeEmphasis
}

/** Every assignment — frequency, kin, the sweep, and the index all read from this. */
export function useAllBookTropes() {
  return useQuery({
    queryKey: bookTropesKey,
    queryFn: async (): Promise<BookTropeRow[]> => {
      // A JOIN table: several rows per book, so it crosses the cap well before `books` does.
      return await pageAll<BookTropeRow>('book_tropes', (from, to) =>
        supabase
          .from('book_tropes')
          .select('book_id, trope_id, emphasis', { count: 'exact' })
          .order('book_id')
          .order('trope_id')
          .range(from, to),
      )
    },
  })
}

function useInvalidateTropes() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: booksKey })
    void qc.invalidateQueries({ queryKey: bookTropesKey })
  }
}

/** Assign (or re-emphasize) a trope on a book. Upsert keeps the cycle gesture idempotent. */
export function useAssignTrope() {
  const invalidate = useInvalidateTropes()
  return useMutation({
    meta: { action: 'Tropes' },
    mutationFn: async (input: { bookId: string; tropeId: string; emphasis?: TropeEmphasis }) => {
      const { data: auth } = await supabase.auth.getUser()
      const ownerId = auth.user?.id
      if (!ownerId) throw new Error('Not signed in')
      const { error } = await supabase
        .from('book_tropes')
        .upsert(
          { book_id: input.bookId, trope_id: input.tropeId, owner_id: ownerId, emphasis: input.emphasis ?? 'present' },
          { onConflict: 'book_id,trope_id' },
        )
      if (error) throw error
    },
    onSuccess: () => invalidate(),
  })
}

export function useUnassignTrope() {
  const invalidate = useInvalidateTropes()
  return useMutation({
    meta: { action: 'Tropes' },
    mutationFn: async (input: { bookId: string; tropeId: string }) => {
      const { error } = await supabase.from('book_tropes').delete().eq('book_id', input.bookId).eq('trope_id', input.tropeId)
      if (error) throw error
    },
    onSuccess: () => invalidate(),
  })
}

/** Create a personal trope (facet defaults to 'vibe' — free coinages are usually a feel). The
 *  caller resolves against canon FIRST (resolveTrope) so near-matches offer the canonical. */
export function useCreatePersonalTrope() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'Tropes' },
    mutationFn: async (input: { name: string; facet?: TropeFacet; canonicalId?: string }): Promise<UiTrope> => {
      const { data: auth } = await supabase.auth.getUser()
      const ownerId = auth.user?.id
      if (!ownerId) throw new Error('Not signed in')
      const { data, error } = await supabase
        .from('tropes')
        .insert({
          owner_id: ownerId,
          // Normalize spacing while retaining the reader's spelling and acronym casing.
          name: input.name.trim().replace(/\s+/g, ' '),
          facet: input.facet ?? 'vibe',
          canonical_id: input.canonicalId ?? null,
        })
        .select()
        .single()
      if (error) throw error
      return toUiTrope(data as TropeRowT)
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: tropesKey }),
  })
}

// ── suggestions (Hardcover community descriptors → canonical tropes; never auto-applied) ──

export interface UiSuggestion {
  tropeId: string
  name: string
}

export function useSuggestions(bookId: string) {
  return useQuery({
    queryKey: suggestionsKey(bookId),
    // JustFinishedSheet renders on every route and asks for suggestions before it has a book,
    // passing ''. Without this the query ran anyway and PostgREST rejected `book_id=eq.` as an
    // invalid uuid — a 400 and a console error on every single page load. Guarded here rather than
    // at the call site so no future caller can reintroduce it.
    enabled: !!bookId,
    queryFn: async (): Promise<UiSuggestion[]> => {
      const { data, error } = await supabase
        .from('trope_suggestions')
        .select('trope_id, state, tropes(name)')
        .eq('book_id', bookId)
        .eq('state', 'open')
      if (error) throw error
      return ((data ?? []) as unknown as { trope_id: string; tropes: { name: string } | null }[])
        .filter((r) => r.tropes?.name)
        .map((r) => ({ tropeId: r.trope_id, name: r.tropes!.name }))
    },
  })
}

/**
 * One-time per book: fetch Hardcover's community descriptors (backend, cached), map through the
 * canonical resolver, store the hits as OPEN suggestions. Only trope names are kept — no counts,
 * popularity, or ranking from community data ever lands anywhere.
 */
export function useFetchSuggestions() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'Tropes' },
    mutationFn: async (input: { book: Book; tropes: { id: string; name: string; aliases: string[] }[] }): Promise<number> => {
      const { data: auth } = await supabase.auth.getUser()
      const ownerId = auth.user?.id
      if (!ownerId) throw new Error('Not signed in')
      const { book } = input
      const author = [book.first, book.last].filter(Boolean).join(' ')
      const { data, error } = await supabase.functions.invoke('series', {
        body: { mode: 'book-tags', title: book.title, author },
      })
      // bookkeeping first — one lookup per book even when the catalog has nothing
      await supabase.from('books').update({ tropes_suggested_at: new Date().toISOString() }).eq('id', book.id)
      if (error) return 0
      const raw = ((data as { tags?: string[] })?.tags ?? []).slice(0, 40)
      const onBook = new Set(book.tropes.map((t) => t.id))
      const rows = []
      const seen = new Set<string>()
      for (const tag of raw) {
        const hit = resolveTrope(tag, input.tropes)
        if (!hit || onBook.has(hit.id) || seen.has(hit.id)) continue
        seen.add(hit.id)
        rows.push({ book_id: book.id, trope_id: hit.id, owner_id: ownerId, source: 'hardcover' })
      }
      if (rows.length) {
        const { error: iErr } = await supabase.from('trope_suggestions').upsert(rows, { onConflict: 'book_id,trope_id', ignoreDuplicates: true })
        if (iErr) throw iErr
      }
      return rows.length
    },
    onSuccess: (_n, input) => {
      void qc.invalidateQueries({ queryKey: suggestionsKey(input.book.id) })
      void qc.invalidateQueries({ queryKey: booksKey })
    },
  })
}

/** Confirm applies (present) and clears; dismiss hides forever. Never auto-applied. */
export function useResolveSuggestion() {
  const qc = useQueryClient()
  const invalidate = useInvalidateTropes()
  return useMutation({
    meta: { action: 'Tropes' },
    mutationFn: async (input: { bookId: string; tropeId: string; accept: boolean }) => {
      if (input.accept) {
        const { data: auth } = await supabase.auth.getUser()
        const ownerId = auth.user?.id
        if (!ownerId) throw new Error('Not signed in')
        const { error } = await supabase
          .from('book_tropes')
          .upsert({ book_id: input.bookId, trope_id: input.tropeId, owner_id: ownerId, emphasis: 'present' }, { onConflict: 'book_id,trope_id' })
        if (error) throw error
        const { error: dErr } = await supabase.from('trope_suggestions').delete().eq('book_id', input.bookId).eq('trope_id', input.tropeId)
        if (dErr) throw dErr
      } else {
        const { error } = await supabase
          .from('trope_suggestions')
          .update({ state: 'dismissed' })
          .eq('book_id', input.bookId)
          .eq('trope_id', input.tropeId)
        if (error) throw error
      }
    },
    onSuccess: (_d, input) => {
      void qc.invalidateQueries({ queryKey: suggestionsKey(input.bookId) })
      if (input.accept) invalidate()
    },
  })
}

/**
 * Rename a personal trope.
 *
 * ── ONE ROW, SO EVERY BOOK FOLLOWS ──────────────────────────────────────────────────────────────
 * `book_tropes` joins to `tropes` by id, so a rename is a single UPDATE and every book carrying the
 * trope shows the new name immediately. There is no per-book copy to migrate, and no window where
 * some books say one thing and some another.
 *
 * Personal spelling and capitalization belong to the reader, including acronyms.
 *
 * CANONICAL TROPES ARE NOT RENAMEABLE, and that is enforced at the query rather than only in the UI:
 * `.not('owner_id', 'is', null)` means a canonical row cannot be renamed even if a caller passes its
 * id. Canonical names are shared vocabulary — the seed migration is generated from `SEED_TROPES`,
 * and a parity test pins the two together, so a local rename would put the reader's library out of
 * step with the source of truth.
 */
export function useRenamePersonalTrope() {
  const invalidate = useInvalidateTropes()
  return useMutation({
    meta: { action: 'Tropes' },
    mutationFn: async (input: { id: string; name: string }): Promise<void> => {
      const name = input.name.trim().replace(/\s+/g, ' ')
      if (!name) throw new Error('A trope needs a name')
      const { error } = await supabase
        .from('tropes')
        .update({ name })
        .eq('id', input.id)
        .not('owner_id', 'is', null) // personal rows only — canonical vocabulary is shared
      if (error) throw error
    },
    onSuccess: () => invalidate(),
  })
}

/**
 * Delete a personal trope.
 *
 * ── WHAT GOES WITH IT ───────────────────────────────────────────────────────────────────────────
 * `book_tropes.trope_id` is `references public.tropes (id) on delete cascade`
 * (20260717010000_trope_system.sql), so deleting the trope removes it from every book carrying it in
 * one statement. That is the intended behaviour and not a side effect to be worked around — but it
 * is also why the caller is expected to have shown the carrier count first. A tag that vanishes from
 * eleven books deserves to say "eleven" before it happens, not after.
 *
 * Same `owner_id` guard as rename, same reason: the query itself refuses canonical rows rather than
 * trusting the UI to have hidden the control.
 */
export function useDeletePersonalTrope() {
  const invalidate = useInvalidateTropes()
  return useMutation({
    meta: { action: 'Tropes' },
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase
        .from('tropes')
        .delete()
        .eq('id', id)
        .not('owner_id', 'is', null) // personal rows only
      if (error) throw error
    },
    // useInvalidateTropes already clears booksKey alongside bookTropesKey, which is what the books
    // that carried this trope need — no separate books invalidation.
    onSuccess: () => invalidate(),
  })
}
