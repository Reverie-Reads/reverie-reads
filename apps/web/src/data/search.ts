import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  contributorsFromAuthors,
  possessionPatch,
  splitName,
  type Incoming,
  type PossessionState,
} from '@reverie/core'
import { supabase } from '../lib/supabase'
import { searchEverywhere, type SearchResult } from '../lib/search'
import { enrichBook } from '../lib/enrich'
import { useIntake, type IntakeResult } from './intake'
import { booksKey } from './books'
import { allListItemsKey, bookListsKey, nextItemPositionFor } from './listItems'
import { listsKey } from './lists'

// Data layer for Discover search — the query hook (shared by Discover + the shelf picker seam) and
// the add mutation (owned or unowned-to-a-shelf), both pulling FULL metadata from the source at add
// time (task §2 — no thin stubs).

/** Search the wider catalog. Pass the DEBOUNCED query; runs only at ≥3 chars (task §1). */
export function useSearchEverywhere(query: string) {
  const q = query.trim()
  return useQuery<SearchResult[]>({
    queryKey: ['search', q.toLowerCase()],
    queryFn: ({ signal }) => searchEverywhere(q, signal),
    enabled: q.length >= 3,
    // Matches the server's short TTL — reopening the same query in a session is free, and the
    // debounce's trailing duplicate never spawns a second upstream call.
    staleTime: 1000 * 60 * 5,
    retry: 1,
  })
}

/** Merge the source's full record into an add-ready Incoming (enrichment leads; the search hit fills
 *  gaps). Absent data stays absent — no fabricated genre/format (import-quality policy). */
async function buildIncoming(result: SearchResult, possession: PossessionState): Promise<Incoming> {
  const enr = await enrichBook({
    title: result.title,
    author: result.authors[0],
    isbn: result.isbn13 ?? result.isbn,
  })
  const authors = enr?.authors?.length ? enr.authors : result.authors
  const primary = authors[0] ?? ''
  const { first, last } = splitName(primary)
  const series = enr?.series || result.series || ''
  const position = enr?.seriesPosition ?? result.seriesPosition ?? ''
  const yearFromResult = /^\d{4}$/.test(result.year) ? Number(result.year) : null
  return {
    title: enr?.title || result.title,
    first,
    last,
    contributors: contributorsFromAuthors(authors),
    series,
    position,
    // A book that arrives with a series is at least 'ongoing'; standalone otherwise (series-experience
    // reconciles the real status on the series page). Never fabricate a series the source didn't give.
    status: series ? 'ongoing' : 'standalone',
    genre: enr?.genre || '',
    genres: enr?.genres ?? [],
    // Google art belongs to the attributed search result. Enrichment may supply a durable
    // Hardcover/Open Library cover; otherwise the room placeholder remains until refinement.
    cover: (result.source === 'google' ? '' : result.cover) || enr?.cover || '',
    isbn: enr?.isbn13 || enr?.isbn || result.isbn13 || result.isbn || '',
    pub: { y: enr?.pubY ?? yearFromResult, m: enr?.pubM ?? null, d: enr?.pubD ?? null },
    ...possessionPatch(possession),
    owned: { physical: false, ebook: false, audiobook: false },
    source: 'Discover',
  }
}

export interface AddFromSearchInput {
  result: SearchResult
  /** the one possession word the add surface offers; expands to the model's flags */
  possession: PossessionState
  /** when set, the new book is placed on this shelf/TBR after adding (not-in-hand add-to-shelf) */
  listId?: string
  /** Retry only placement of a book that intake already saved. Never repeat enrichment/intake. */
  savedBookId?: string
}

export interface AddFromSearchResult {
  bookId: string | undefined
  outcome: IntakeResult['outcome']
}

/** A saved personal book survives a failed shelf write; retry only that membership. */
export class ShelfPlacementError extends Error {
  constructor(readonly bookId: string) {
    super('Your book is in your library, but we couldn’t confirm it was added to this shelf.')
    this.name = 'ShelfPlacementError'
  }
}

/** Add a search result to the library (owned) or to a shelf/TBR (unowned + placed). Pulls full
 *  metadata at add time; de-dupes via the intake matcher (a book already shelved folds in rather
 *  than duplicating). Series data rides along on the book and links on the series page. */
export function useAddFromSearch() {
  const qc = useQueryClient()
  const intake = useIntake()
  return useMutation<AddFromSearchResult, Error, AddFromSearchInput>({
    meta: { errorPresentation: 'inline' },
    mutationFn: async ({ result, possession, listId, savedBookId }) => {
      const res = savedBookId && listId
        ? { bookId: savedBookId, outcome: 'unchanged' as const }
        : await intake(await buildIncoming(result, possession), 'add')
      if (listId && res.bookId) {
        try {
          const { data: auth, error: authError } = await supabase.auth.getUser()
          const ownerId = auth.user?.id
          if (authError || !ownerId) throw new Error('Not signed in')
          const after = await nextItemPositionFor(listId)
          const { error } = await supabase
            .from('list_items')
            .upsert([{ list_id: listId, book_id: res.bookId, owner_id: ownerId, position: after }], {
              onConflict: 'list_id,book_id',
              ignoreDuplicates: true,
            })
          if (error) throw error
        } catch {
          throw new ShelfPlacementError(res.bookId)
        }
      }
      return { bookId: res.bookId, outcome: res.outcome }
    },
    onSettled: (data, error, { listId }) => {
      void qc.invalidateQueries({ queryKey: booksKey })
      if (listId) {
        void qc.invalidateQueries({ queryKey: allListItemsKey })
        void qc.invalidateQueries({ queryKey: listsKey })
        const bookId = data?.bookId ?? (error instanceof ShelfPlacementError ? error.bookId : undefined)
        if (bookId) void qc.invalidateQueries({ queryKey: bookListsKey(bookId) })
      }
    },
  })
}
