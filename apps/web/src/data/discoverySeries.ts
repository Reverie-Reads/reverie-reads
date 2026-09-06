import { useQuery } from '@tanstack/react-query'
import {
  isBookRead,
  discoveryBookFromReader,
  discoveryLibraryMatch,
  type Book,
  type DiscoveryBook,
} from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { useReaderBooks } from './readerBooks'
import { useSeriesList, type SeriesListRow } from './series'
import { workToHit, type WorkRow } from './works'

interface Relation {
  series_id: string
  work_id: string
  position: number
  membership_claim?: { origin?: string }
  position_claim?: { origin?: string }
}
const hasReviewedClaims = (row: Pick<Relation, 'membership_claim' | 'position_claim'>) =>
  ['reader', 'corpus'].includes(row.membership_claim?.origin ?? '') &&
  ['reader', 'corpus'].includes(row.position_claim?.origin ?? '')
export interface SeriesInvitation {
  name: string
  after: string
  book: DiscoveryBook
}
/** A removed category is absent from the active list. Any removed slot or reader order change
 * suppresses the invitation until we can honor it exactly; neither a scalar label nor length is evidence. */
export function discoverySeriesAnchors(series: readonly SeriesListRow[], books: readonly Book[]) {
  return series
    .filter((row) => row.removed === 0 && row.unreviewed === 0)
    .flatMap((row) =>
      row.entries.flatMap((entry) => {
        const book = books.find((b) => b.id === entry.bookId)
        return book?.corpusWorkId &&
          isBookRead(book) &&
          !entry.sortUserEdited &&
          entry.position > 0 &&
          entry.positionClaim?.origin &&
          entry.positionClaim.origin !== 'unknown' &&
          entry.membershipClaim?.origin &&
          entry.membershipClaim.origin !== 'unknown'
          ? [
              {
                workId: book.corpusWorkId,
                position: entry.position,
                book: discoveryBookFromReader(book),
                name: row.series.name,
              },
            ]
          : []
      }),
    )
    .slice(0, 12)
}

async function fetchInvitation(
  series: readonly SeriesListRow[],
  books: readonly Book[],
  signal: AbortSignal,
): Promise<SeriesInvitation | null> {
  const anchors = discoverySeriesAnchors(series, books)
  if (!anchors.length) return null
  const { data: related, error } = await supabase
    .from('corpus_series_entries')
    .select('series_id,work_id,position,membership_claim,position_claim')
    .in(
      'work_id',
      anchors.map((a) => a.workId),
    )
    .is('removed_at', null)
    .order('id')
    .limit(48)
    .abortSignal(signal)
  if (error) throw error
  const relations = ((related ?? []) as Relation[]).filter(hasReviewedClaims)
  if (!relations.length) return null
  const { data: shared, error: sharedError } = await supabase
    .from('corpus_series')
    .select('id,name')
    .in('id', [...new Set(relations.map((r) => r.series_id))])
    .eq('catalog_state', 'confirmed')
    .is('archived_at', null)
    .order('id')
    .limit(48)
    .abortSignal(signal)
  if (sharedError) throw sharedError
  // Inspect at most three exact, confirmed relationships. Never scan the entire global catalog.
  const candidates = relations
    .filter((r) =>
      shared?.some(
        (s) =>
          s.id === r.series_id &&
          anchors.some(
            (a) => a.workId === r.work_id && a.position === Number(r.position) && a.name === s.name,
          ),
      ),
    )
    .slice(0, 3)
  for (const relation of candidates) {
    const { data: following, error: nextError } = await supabase
      .from('corpus_series_entries')
      .select('work_id,position,membership_claim,position_claim')
      .eq('series_id', relation.series_id)
      .is('removed_at', null)
      .gt('position', relation.position)
      .order('position')
      .order('id')
      .limit(2)
      .abortSignal(signal)
    if (nextError) throw nextError
    const next = following?.[0]
    if (
      !next?.work_id ||
      !hasReviewedClaims(next) ||
      !Number.isFinite(Number(next.position)) ||
      Number(next.position) === Number(following?.[1]?.position)
    )
      continue
    // A personal later installment means this is not the next book for this reader.
    if (books.some((book) => book.corpusWorkId === next.work_id)) continue
    const { data: work, error: workError } = await supabase
      .from('works')
      .select(
        'id,work_key,title,contributors,isbns,series,position,cover_url,genre,tags,pub_y,pub_m,pub_d,description',
      )
      .eq('id', next.work_id)
      .abortSignal(signal)
      .maybeSingle()
    if (workError) throw workError
    if (!work) continue
    const book = workToHit(work as unknown as WorkRow)
    if (discoveryLibraryMatch(book, books)) continue
    const anchor = anchors.find((a) => a.workId === relation.work_id)!
    return {
      name: shared!.find((s) => s.id === relation.series_id)!.name,
      after: anchor.book.title,
      book,
    }
  }
  return null
}
export function useDiscoverySeries() {
  const { session } = useAuth()
  const reader = useReaderBooks()
  const series = useSeriesList()
  return useQuery({
    queryKey: [
      'discovery-series',
      session?.user.id,
      discoverySeriesAnchors([...(series.data?.values() ?? [])], reader.data ?? []),
      (reader.data ?? []).map((book) => [book.id, book.corpusWorkId]),
    ],
    queryFn: ({ signal }) =>
      fetchInvitation([...(series.data?.values() ?? [])], reader.data ?? [], signal),
    enabled: !!session?.user.id && !!reader.data && !!series.data,
    staleTime: 10 * 60 * 1000,
    retry: false,
  })
}
