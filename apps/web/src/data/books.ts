import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Book } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { toBook, toBookRow } from './mappers'
import type { BookRow } from './types'

export const booksKey = ['books'] as const

/** All of the signed-in user's books (RLS scopes this to them). */
export function useBooks() {
  return useQuery({
    queryKey: booksKey,
    queryFn: async (): Promise<Book[]> => {
      // PAGED. An un-ranged select stops at 1,000 rows without saying so, and this query feeds
      // the whole app — Library, Match, Stats, and Discover's "hide what I have". A short answer
      // there does not look like an error, it looks like a smaller library, and the specific
      // damage is that `isOwned` classifies owned books as new: the reader re-adds by hand the
      // duplicates the corpus import exists to remove.
      //
      // `added_at` is not unique, so it cannot page on its own — two rows sharing a timestamp can
      // land in both windows or neither. `id` breaks the tie and makes the pages disjoint.
      const baseFields = '*, book_authors(position, role, authors(id, name)), book_tropes(emphasis, tropes(id, name)), book_moods(moods(id, name))'
      const read = (withGuidance: boolean) => pageAll<BookRow>('books', (from, to) =>
        supabase.from('books').select(
          baseFields + (withGuidance ? ', corpus_guidance:works!corpus_work_id(shared_spice, shared_darkness)' : ''),
          { count: 'exact' },
        ).is('removed_at', null).order('added_at', { ascending: true }).order('id').range(from, to).returns<BookRow[]>(),
      )
      let rows: BookRow[]
      try { rows = await read(true) } catch (error) {
        const e = error as { code?: string; message?: string; details?: string }
        const message = `${e.message || ''} ${e.details || ''}`
        // Rolling deployment: only a missing new guidance column permits the legacy read.
        // Network, permission, and ordinary query failures still surface with the library retry.
        if ((e.code === '42703' || e.code === 'PGRST200' || e.code === 'PGRST204') &&
          /shared_spice|shared_darkness/.test(message)) rows = await read(false)
        else throw error
      }
      return rows.map(toBook)
    },
  })
}

/** Optimistic update: patch the cache immediately, roll back on error, reconcile on settle. */
/**
 * Patch one book.
 *
 * `scopeBookId` SERIALIZES successive writes to that book, and exists because unserialized ones
 * corrupt data rather than merely arriving out of order. Every patch here is a whole-field write —
 * `{ plan }` sends all three plan columns, `{ owned }` sends all three format flags — so if two
 * in-flight writes for the same book land in the wrong order, the earlier, less complete one wins
 * and silently overwrites the later one. That is not hypothetical: `PlanEditor` produced exactly
 * this, and a reader tabbing Year → Month → Day could lose their month and day (#116, caught by the
 * plan-precision e2e at position 27 of 80 — load-sensitive, which is why it passed the run before).
 *
 * Scope lives on the mutation's OPTIONS, not on the variables — verified against query-core 5.101's
 * `scopeFor`/`canRun`, which read `mutation.options.scope.id` and let a scoped mutation start only
 * when no other mutation sharing that id is pending. So it cannot be derived per `mutate()` call
 * from the book id; the caller has to declare it, which is why this is a parameter rather than
 * something the hook works out for itself.
 *
 * Deliberately OPT-IN. A blanket scope would serialize genuinely independent writes: `moveReading`
 * (HomeRoute) renumbers N books in one gesture, one write each, and those must stay parallel. Pass
 * the id from any component that writes ONE book repeatedly; leave it off for fan-out across books.
 * Bulk import is unaffected either way — it never uses this hook, writing through
 * `supabase.from('books').update()` directly (`intake.ts`, `importExport.ts`).
 */
export function useUpdateBook(scopeBookId?: string) {
  const qc = useQueryClient()
  return useMutation({
    ...(scopeBookId ? { scope: { id: `book:${scopeBookId}` } } : {}),
    meta: { action: 'Book details' },
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<Book> }): Promise<Book> => {
      const { data, error } = await supabase
        .from('books')
        .update(toBookRow(patch))
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return toBook(data as BookRow)
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: booksKey })
      const previous = qc.getQueryData<Book[]>(booksKey)
      qc.setQueryData<Book[]>(booksKey, (old) =>
        old?.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      )
      return { previous }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(booksKey, ctx.previous)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: booksKey }),
  })
}

export function useDeleteBook() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'Deleting the book' },
    mutationFn: async (id: string): Promise<void> => {
      const { error } = await supabase.rpc('remove_personal_book', { p_book: id })
      if (error) throw error
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: booksKey })
      const previous = qc.getQueryData<Book[]>(booksKey)
      qc.setQueryData<Book[]>(booksKey, (old) => old?.filter((b) => b.id !== id))
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(booksKey, ctx.previous)
    },
    onSettled: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: booksKey }),
        qc.invalidateQueries({ queryKey: ['household'] }),
      ])
    },
  })
}
