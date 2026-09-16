import { importKey, type Book, type DuplicateVerdict, type Incoming, type MergeFieldPicks } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { foldIn, insertNewBook, verdictLookupKey, type ReviewCandidate, type VerdictLookup } from './intake'

interface VerdictRow {
  book_id: string
  incoming_key: string
  verdict: DuplicateVerdict
}

/** Load the user's remembered duplicate verdicts into a lookup keyed by (book, incoming key). */
export async function loadVerdicts(): Promise<VerdictLookup> {
  // One row per remembered duplicate decision — this grows fastest during exactly the bulk import
  // whose de-duplication it is meant to inform.
  const data = await pageAll<VerdictRow>('merge_verdicts', (from, to) =>
    supabase
      .from('merge_verdicts')
      .select('book_id, incoming_key, verdict', { count: 'exact' })
      .order('book_id')
      .order('incoming_key')
      .range(from, to),
  )
  const lookup: VerdictLookup = new Map()
  for (const r of data) lookup.set(`${r.book_id}|${r.incoming_key}`, r.verdict)
  return lookup
}

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser()
  const id = data.user?.id
  if (!id) throw new Error('Not signed in')
  return id
}

// The books cache holds reads: [] (reads are loaded separately), but a fold dedupes incoming
// reads against the existing ones — so load the real reads before merging, or we'd re-add them.
async function hydrateReads(book: Book): Promise<Book> {
  if (book.reads.length) return book
  const { data, error } = await supabase
    .from('reads')
    .select('read_on, format, rating, notes')
    .eq('book_id', book.id)
  if (error) throw error
  const reads = ((data as { read_on: string | null; format: string | null; rating: number | null; notes: string | null }[]) ?? []).map(
    (r) => ({ date: r.read_on ?? '', format: r.format ?? '', rating: r.rating ?? 0, notes: r.notes ?? '' }),
  )
  return { ...book, reads }
}

async function rememberVerdict(bookId: string, inc: Incoming, verdict: DuplicateVerdict): Promise<void> {
  const ownerId = await currentUserId()
  const { error } = await supabase
    .from('merge_verdicts')
    .upsert(
      { owner_id: ownerId, book_id: bookId, incoming_key: importKey(inc), verdict },
      { onConflict: 'owner_id,book_id,incoming_key' },
    )
  if (error) throw error
}

export type ReviewAction = 'merge' | 'keep_both' | 'always_merge' | 'dismiss'

/**
 * Resolve one review candidate. `existing` is the surviving library row the candidate matched.
 * - merge:        fold the incoming record into the existing one (this time only).
 * - always_merge: fold in now AND remember to auto-merge this pair on future imports.
 * - keep_both:    add the incoming record as a separate book; remember it's not a duplicate.
 * - dismiss:      discard the incoming record; remember it's not a duplicate (stop re-flagging).
 * keep_both / dismiss / always_merge persist a verdict (so the pair isn't re-surfaced); plain
 * merge doesn't need one (the folded row will strong-match itself on re-import).
 */
export async function resolveCandidate(
  candidate: ReviewCandidate,
  existing: Book,
  action: ReviewAction,
  /** Per-field overrides from DuplicateReview's picker; absent = the engine's own answer. */
  picks?: MergeFieldPicks,
  /** Single-Add keeps one insertion identity across uncertain responses. */
  newBookId?: string,
): Promise<string | null> {
  const ownerId = await currentUserId()
  const inc = candidate.incoming
  switch (action) {
    case 'merge':
      await foldIn(await hydrateReads(existing), inc, ownerId, picks)
      return existing.id
    case 'always_merge':
      await foldIn(await hydrateReads(existing), inc, ownerId, picks)
      await rememberVerdict(existing.id, inc, 'always_merge')
      return existing.id
    case 'keep_both': {
      const created = await insertNewBook(inc, ownerId, newBookId)
      await rememberVerdict(existing.id, inc, 'keep_separate')
      return created.id
    }
    case 'dismiss':
      await rememberVerdict(existing.id, inc, 'keep_separate')
      return null
  }
}

export { verdictLookupKey }
