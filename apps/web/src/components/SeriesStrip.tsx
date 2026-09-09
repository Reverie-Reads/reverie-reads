import { useMemo } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  claimedSeriesLength,
  displayTotal,
  isPossessed,
  sortEntries,
  stateSuffix,
  type Book,
  type SeriesEntry,
} from '@reverie/core'
import { CoverImage } from './CoverImage'
import { BookStateMarks } from './BookStateMarks'
import { fetchBookSeriesMemberships, fetchSeriesEntries } from '../data/series'
import { useBooks } from '../data/books'

/**
 * The book page's series strip (docs/archive/task-series-experience.md §4): "#3 of 7 · SeriesName" with
 * the prev/next neighbours in READING order — ghosts included, rendered as dashed slots — and
 * the whole thing a door into the series page. Read-only: never creates series rows; before a
 * series page has ever been opened it falls back to the library's own books in that series.
 */
export function SeriesStrip({ book }: { book: Book }) {
  const { data: books } = useBooks()
  const { data: fetched } = useQuery({
    queryKey: ['series-strip', book.series.toLowerCase()],
    enabled: !!book.series,
    queryFn: () => fetchSeriesEntries(book.series),
  })
  const { data: memberships } = useQuery({
    queryKey: ['book-series-memberships', book.id],
    queryFn: () => fetchBookSeriesMemberships(book.id),
  })

  const libraryMembers = useMemo(
    () => (books ?? []).filter((candidate) => candidate.series === book.series),
    [books, book.series],
  )

  const entries: SeriesEntry[] = useMemo(() => {
    if (fetched?.length) return fetched
    // no series row yet — the library's own copies stand in
    return sortEntries(
      libraryMembers.map((b) => ({
        id: b.id,
        position: typeof b.position === 'number' ? b.position : 0,
        label: null,
        title: b.title,
        author: '',
        bookId: b.id,
        source: 'manual' as const,
        userEdited: true,
      })),
    )
  }, [fetched, libraryMembers])

  const byId = new Map((books ?? []).map((b) => [b.id, b]))
  // One structured row means one slot is known; it does not mean the catalog is complete. Before
  // this guard, one owned book from an otherwise-unseeded series rendered “#3 of 1”.
  const total = displayTotal(
    claimedSeriesLength(libraryMembers),
    fetched?.length ? fetched.length : null,
    libraryMembers.length,
  )
  const idx = entries.findIndex((e) => e.bookId === book.id)
  const prev = idx > 0 ? entries[idx - 1] : undefined
  const next = idx >= 0 && idx < entries.length - 1 ? entries[idx + 1] : undefined
  const posText =
    book.position !== '' ? `#${book.position}` : idx >= 0 ? `#${entries[idx]!.position}` : ''

  const neighbour = (e: SeriesEntry | undefined, dir: 'prev' | 'next') => {
    if (!e) return <span className="h-[54px] w-9 flex-none" aria-hidden />
    const b = e.bookId ? byId.get(e.bookId) : undefined
    return (
      <span
        className="relative h-[54px] w-9 flex-none overflow-hidden rounded-md border border-line"
        style={!b ? { borderStyle: 'dashed', background: 'var(--chip)' } : undefined}
        title={`${dir === 'prev' ? 'Before' : 'After'} this one: ${b?.title ?? e.title}${
          b ? stateSuffix(b) : ''
        }`}
      >
        {b ? (
          <>
            <CoverImage book={b} thumb ghost={!isPossessed(b)} />
            <BookStateMarks book={b} density="thumb" />
          </>
        ) : (
          <span className="flex h-full items-center justify-center text-[13px] text-muted">⊹</span>
        )}
      </span>
    )
  }

  const secondary = (memberships ?? []).filter((membership) => !membership.entry.isPrimary)

  if (!book.series) {
    if (!secondary.length) return null
    return (
      <div className="mt-2 space-y-1.5">
        {secondary.map((membership) => (
          <Link
            key={membership.entry.id}
            to="/series/$seriesName"
            params={{ seriesName: encodeURIComponent(membership.series.name) }}
            className="flex min-h-11 items-center justify-between gap-3 skin-tile border border-line px-3 py-2 text-[12.5px]"
            style={{ background: 'var(--chip)' }}
            aria-label={`Open the ${membership.series.name} series page`}
          >
            <span className="min-w-0 break-words font-semibold text-ink">
              Also in {membership.series.name}
            </span>
            <span className="flex-none text-muted">#{membership.entry.position} →</span>
          </Link>
        ))}
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-1.5">
      <Link
        to="/series/$seriesName"
        params={{ seriesName: encodeURIComponent(book.series) }}
        className="flex items-center gap-2.5 skin-tile border border-line p-2 pr-3"
        style={{ background: 'var(--card)' }}
        aria-label={`Open the ${book.series} series page`}
      >
        {neighbour(prev, 'prev')}
        <span className="min-w-0 flex-1">
          <span
            className="block break-words text-[13.5px] font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {book.series}
          </span>
          <span className="block text-[12px] text-muted">
            {posText}
            {total ? `${posText ? ' of ' : ''}${total}` : ''} · primary series →
          </span>
        </span>
        {neighbour(next, 'next')}
      </Link>
      {secondary.map((membership) => (
        <Link
          key={membership.entry.id}
          to="/series/$seriesName"
          params={{ seriesName: encodeURIComponent(membership.series.name) }}
          className="flex min-h-11 items-center justify-between gap-3 skin-tile border border-line px-3 py-2 text-[12.5px]"
          style={{ background: 'var(--chip)' }}
          aria-label={`Open the ${membership.series.name} series page`}
        >
          <span className="min-w-0 break-words font-semibold text-ink">
            Also in {membership.series.name}
          </span>
          <span className="flex-none text-muted">#{membership.entry.position} →</span>
        </Link>
      ))}
    </div>
  )
}
