import type { HouseholdBook, HouseholdBookOwner } from '../data/household'
import type { SeriesLenBucket, SeriesStatus } from '@reverie/core'

/** Only the household's shared projection is searchable; never query personal book records. */
export interface HouseholdFilters {
  q: string
  genre: string
  sub: string
  tags: string[]
  status: 'All' | SeriesStatus
  len: SeriesLenBucket
  member: string
  format: string
  possession: 'All' | 'owned' | 'borrowed'
  sort: 'az' | 'author' | 'series' | 'recent'
}
export const defaultHouseholdFilters = (): HouseholdFilters => ({
  q: '',
  genre: 'All',
  sub: 'All',
  tags: [],
  status: 'All',
  len: 'Any',
  member: 'All',
  format: 'All',
  possession: 'All',
  sort: 'az',
})
const normalized = (value: string) => value.trim().toLocaleLowerCase()
export const householdGenres = (book: HouseholdBook) => [
  ...new Set([book.primaryGenre, ...book.genres].filter(Boolean)),
]
export const householdSubgenres = (book: HouseholdBook) => [
  ...new Set([book.subgenre, ...book.subgenres].filter(Boolean)),
]
export const householdTags = (book: HouseholdBook) => [
  ...new Set([...book.householdTags, ...book.householdTropes.map((t) => t.name)]),
]
export function householdCopyFormats(owner: HouseholdBookOwner): string[] {
  if (owner.ownership !== 'owned' && !owner.borrowed) return []
  return [
    ...new Set(
      [
        owner.ownedPhysical === 'yes'
          ? 'Physical'
          : owner.ownedPhysical
            ? owner.ownedPhysical[0]!.toUpperCase() + owner.ownedPhysical.slice(1)
            : '',
        owner.ownedEbook ? 'eBook' : '',
        owner.ownedAudiobook ? 'Audiobook' : '',
      ].filter(Boolean),
    ),
  ]
}
export function matchesHouseholdQuery(book: HouseholdBook, query: string): boolean {
  const needle = normalized(query)
  if (!needle) return true
  const text = [
    book.title,
    book.author,
    book.series,
    ...householdGenres(book),
    ...householdSubgenres(book),
    ...householdTags(book),
    ...book.isbns,
  ]
    .join(' ')
    .toLocaleLowerCase()
  return (
    text.includes(needle) ||
    (/^[\dXx\s-]+$/.test(needle) &&
      book.isbns.some((isbn) =>
        isbn.replace(/[\s-]/g, '').toLowerCase().includes(needle.replace(/[\s-]/g, '')),
      ))
  )
}
export function matchesHouseholdFilters(book: HouseholdBook, f: HouseholdFilters): boolean {
  if (!matchesHouseholdQuery(book, f.q)) return false
  if (f.genre !== 'All' && !householdGenres(book).includes(f.genre)) return false
  if (f.sub !== 'All' && !householdSubgenres(book).includes(f.sub)) return false
  if (!f.tags.every((tag) => householdTags(book).includes(tag))) return false
  if (f.status !== 'All' && book.seriesStatus !== f.status) return false
  const length =
    book.seriesCount == null ? 'Unknown' : book.seriesCount >= 5 ? '5+' : String(book.seriesCount)
  if (f.len !== 'Any' && f.len !== length) return false
  // Combined member/format/possession filters must describe the SAME copy owner.
  if (f.member !== 'All' || f.format !== 'All' || f.possession !== 'All') {
    if (
      !book.owners.some(
        (owner) =>
          (f.member === 'All' || owner.userId === f.member) &&
          (f.format === 'All' || householdCopyFormats(owner).includes(f.format)) &&
          (f.possession === 'All' ||
            (f.possession === 'owned' ? owner.ownership === 'owned' : owner.borrowed)),
      )
    )
      return false
  }
  return true
}
export function sortHouseholdBooks(
  books: readonly HouseholdBook[],
  sort: HouseholdFilters['sort'],
): HouseholdBook[] {
  const title = (a: HouseholdBook, b: HouseholdBook) =>
    a.title.localeCompare(b.title) || a.id.localeCompare(b.id)
  return [...books].sort((a, b) => {
    if (sort === 'recent') return b.addedAt.localeCompare(a.addedAt) || title(a, b)
    if (sort === 'author') return a.author.localeCompare(b.author) || title(a, b)
    if (sort === 'series')
      return (
        a.series.localeCompare(b.series) ||
        (a.position ?? Infinity) - (b.position ?? Infinity) ||
        title(a, b)
      )
    return title(a, b)
  })
}
export function householdFilterCount(f: HouseholdFilters): number {
  return (
    [
      f.genre !== 'All',
      f.sub !== 'All',
      f.status !== 'All',
      f.len !== 'Any',
      f.member !== 'All',
      f.format !== 'All',
      f.possession !== 'All',
    ].filter(Boolean).length + f.tags.length
  )
}
