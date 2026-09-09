import type { QueryKey } from '@tanstack/react-query'

const readsFamily = ['reads'] as const
const booksKey = ['books'] as const
const listsKey = ['lists'] as const
const allListItemsKey = ['list-items', 'all'] as const
const bookListsFamily = ['book-lists'] as const
const seriesFamily = ['series'] as const
const seriesListKey = ['seriesList'] as const
const archivedSeriesListKey = ['archivedSeriesList'] as const
const seriesStripFamily = ['series-strip'] as const
const bookSeriesMembershipsFamily = ['book-series-memberships'] as const

export const ALL_LIBRARY_KEYS: readonly QueryKey[] = [
  booksKey,
  readsFamily,
  listsKey,
  allListItemsKey,
  bookListsFamily,
  seriesFamily,
  seriesListKey,
  archivedSeriesListKey,
  seriesStripFamily,
  bookSeriesMembershipsFamily,
]

/**
 * Map one content-free signal to the smallest cache families that can have changed.
 *
 * Deletes cascade: removing a book can also remove reads, shelf placements, and structured series
 * entries; removing a shelf removes placements. Those parent events therefore invalidate their
 * dependent families too. Prefix keys intentionally refresh every open per-book/per-series query.
 */
export function libraryKeysForTable(table: unknown): readonly QueryKey[] {
  if (table === 'books')
    return [
      booksKey,
      readsFamily,
      allListItemsKey,
      bookListsFamily,
      seriesFamily,
      seriesListKey,
      archivedSeriesListKey,
      seriesStripFamily,
      bookSeriesMembershipsFamily,
    ]
  if (table === 'reads') return [readsFamily]
  if (table === 'lists') return [listsKey, allListItemsKey, bookListsFamily]
  if (table === 'list_items') return [allListItemsKey, bookListsFamily]
  return []
}
