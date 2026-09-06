import type { Book } from '@reverie/core'
import type { GuestHandoff } from '../auth/landing/guest/handoff'
import { supabase } from '../lib/supabase'
import { loadVerdicts } from './duplicates'
import { applyIncoming, type ReviewCandidate } from './intake'

export interface GuestHandoffResult {
  added: number
  merged: number
  unchanged: number
  review: ReviewCandidate[]
  bookIds: string[]
  draftNotes: number
}

/** Import an explicitly saved guest library through Reverie's ordinary intake boundary. The
 * mutable snapshot makes repeated guest rows dedupe within the same pass; refreshed reader books
 * make a retry after a partial network failure converge instead of creating a second copy. */
export async function importGuestHandoff(
  handoff: GuestHandoff,
  currentBooks: Book[],
  opts: { autoMerge: boolean },
): Promise<GuestHandoffResult> {
  const { data: auth } = await supabase.auth.getUser()
  const ownerId = auth.user?.id
  if (!ownerId) throw new Error('Sign in before adding your guest library.')

  const verdicts = await loadVerdicts()
  const library = currentBooks.map((book) => ({ ...book, reads: [...book.reads] }))
  const result: GuestHandoffResult = {
    added: 0,
    merged: 0,
    unchanged: 0,
    review: [],
    bookIds: [],
    draftNotes: handoff.books.filter((book) => !!book.draftNote).length,
  }

  for (const item of handoff.books) {
    const outcome = await applyIncoming(item.incoming, library, ownerId, {
      fuzzy: 'review',
      autoMergeStrong: opts.autoMerge,
      verdicts,
    })
    if (outcome.outcome === 'added') result.added++
    else if (outcome.outcome === 'merged') result.merged++
    else if (outcome.outcome === 'unchanged') result.unchanged++
    if (outcome.review) result.review.push(outcome.review)
    if (outcome.bookId) result.bookIds.push(outcome.bookId)
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update({ skin: handoff.skin, mode: handoff.mode })
    .eq('id', ownerId)
  if (profileError) throw profileError

  return result
}
