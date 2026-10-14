import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAuthorRole, renumber, toFirstLast, type Contributor } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { booksKey } from './books'

/** The denormalized byline cache stored on books.authors_display: author/co-author names, ordered. */
function displayString(contributors: Contributor[]): string {
  return renumber(contributors)
    .filter((c) => isAuthorRole(c.role))
    .map((c) => c.name)
    .join(', ')
}

/**
 * Persist a book's full ordered contributor list via the set_book_contributors RPC (upserts authors,
 * replaces the book_authors rows, refreshes the denormalized primary first/last + byline). Atomic +
 * owner-checked server-side. No-op for an empty list on a book that already has none.
 */
export async function persistContributors(bookId: string, contributors: Contributor[]): Promise<void> {
  const ordered = renumber(contributors)
    .filter((c) => c.name.trim())
    .map((c) => ({ name: c.name.trim(), role: c.role, position: c.position }))
  const { first, last } = toFirstLast(contributors)
  const { error } = await supabase.rpc('set_book_contributors', {
    p_book: bookId,
    p_contributors: ordered,
    p_first: first,
    p_last: last,
    p_display: displayString(contributors),
  })
  if (error) throw error
}

/** Mutation wrapper that persists contributors and refreshes the library. */
export function useSetContributors() {
  const qc = useQueryClient()
  return useMutation({
    meta: { action: 'Contributors' },
    mutationFn: ({ bookId, contributors }: { bookId: string; contributors: Contributor[] }) =>
      persistContributors(bookId, contributors),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: booksKey }), qc.invalidateQueries({ queryKey: ['household'] })]),
  })
}
