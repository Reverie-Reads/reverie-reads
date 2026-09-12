import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Book, SeriesEntry } from '@reverie/core'
import type { SeriesListRow } from '../data/series'
import type { SeriesManagementRow } from '../series/SeriesManagement'

vi.mock('@tanstack/react-router', () => ({
  createRoute: (options: unknown) => options,
  Link: ({ children }: { children?: React.ReactNode }) => <a href="#mock">{children}</a>,
}))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../series/SeriesArranger', () => ({ SeriesArranger: () => null }))
vi.mock('../series/ConsolidationQueue', () => ({ ConsolidationQueue: () => null }))
vi.mock('../series/SeriesManagement', () => ({
  ArchivedSeriesPanel: () => null,
  DeleteSeriesDialog: () => null,
  MergeSeriesDialog: () => null,
  RenameSeriesDialog: () => null,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

const { SeriesCard, buildStructuredSeriesSections, validateSeriesIndexSearch } =
  await import('./SeriesIndexRoute')

const member = (id: string, seriesCount: number, ownership: Book['ownership'] = 'owned'): Book => ({
  id,
  title: id,
  first: 'Ada',
  last: 'Reader',
  contributors: [{ name: 'Ada Reader', role: 'author', position: 0 }],
  series: 'A Court of Thorns and Roses',
  position: '',
  seriesCount,
  status: 'ongoing',
  genre: 'fantasy',
  subgenre: 'Fantasy',
  subgenres: ['Fantasy'],
  genres: [],
  tags: [],
  tropes: [],
  moods: [],
  intensity: 0,
  darkness: null,
  cover: '',
  pages: null,
  isbn: '',
  fave: false,
  ownership,
  borrowed: false,
  wishlist: ownership === 'unowned',
  owned: { physical: false, ebook: false, audiobook: false },
  format: 'Paperback',
  rating: 0,
  readStatus: 'Unread',
  source: 'Owned',
  pub: { y: null, m: null, d: null },
  reads: [],
  plan: { y: null, m: null, d: null },
  progress: 0,
  addedTs: 0,
})

const entry = (id: string, bookId: string | null, position: number): SeriesEntry => ({
  id,
  position,
  label: null,
  title: id,
  author: 'Ada Reader',
  bookId,
  source: 'manual',
  userEdited: false,
  isPrimary: true,
  membershipClaim: { origin: 'reader' },
})

const seriesRow = (
  id: string,
  name: string,
  entries: SeriesEntry[],
  unreviewed = 0,
  length: number | null = null,
): SeriesListRow => ({
  series: {
    id,
    name,
    status: 'ongoing',
    length,
    source: 'manual',
    sourceRef: null,
    refreshedAt: null,
  },
  total: entries.length,
  ghosts: entries.filter((item) => !item.bookId).length,
  removed: 0,
  unreviewed,
  entries,
})

const management = (row: SeriesListRow, possessedBooks: number): SeriesManagementRow => ({
  id: row.series.id,
  name: row.series.name,
  liveEntries: row.total,
  memberBooks: row.entries.filter((item) => item.bookId).length,
  series: row.series,
  entries: row.entries,
  possessedBooks,
  ghostEntries: row.ghosts,
  unreviewedEntries: row.unreviewed,
  removedEntries: row.removed,
})

function renderedMeta(books: Book[], entries: SeriesEntry[], length: number | null = null): string {
  const row = seriesRow('series-1', 'A Court of Thorns and Roses', entries, 0, length)
  const { unmount } = render(
    <ul>
      <SeriesCard
        row={row}
        management={management(row, books.filter((book) => book.ownership === 'owned').length)}
        byId={new Map(books.map((book) => [book.id, book]))}
        tbrBookIds={new Set()}
        expanded={false}
        onToggle={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        panelId="series-order"
      />
    </ul>,
  )
  const text = screen.getByText(/in hand/).textContent ?? ''
  unmount()
  return text
}

describe('the canonical series browser', () => {
  it('accepts only the shared scope and defaults every other URL value to personal', () => {
    expect(validateSeriesIndexSearch({ scope: 'shared' })).toEqual({ scope: 'shared' })
    for (const scope of [undefined, null, 'personal', 'admin', ['shared'], true]) {
      expect(validateSeriesIndexSearch({ scope })).toEqual({ scope: undefined })
    }
  })

  it('uses the maximum explicit series length and actual possession, regardless of fetch order', () => {
    const books = [member('b1', 6), member('b2', 7, 'unowned'), member('b3', 6)]
    const entries = [entry('e1', 'b1', 1), entry('e2', 'b2', 2), entry('e3', 'b3', 3)]

    const forward = renderedMeta(books, entries)
    const reversed = renderedMeta([...books].reverse(), [...entries].reverse())

    expect(forward).toContain('2 in hand')
    expect(forward).toContain('7 in series')
    expect(reversed).toEqual(forward)
  })

  it('keeps a canonical length when linked books have no usable projection', () => {
    const books = [member('b1', 0)]
    const entries = [entry('e1', 'b1', 1), entry('ghost-2', null, 2)]

    expect(renderedMeta(books, entries, 8)).toContain('8 in series')
  })

  it('keeps unreviewed legacy labels out of browse cards', () => {
    const confirmedBook = member('confirmed-book', 4)
    const confirmed = seriesRow('confirmed-series', 'Confirmed Cycle', [
      entry('confirmed-entry', confirmedBook.id, 1),
    ])
    const unreviewed = seriesRow('legacy-series', 'Legacy Guess', [], 2)
    const sections = buildStructuredSeriesSections(
      new Map([
        ['confirmed cycle', confirmed],
        ['legacy guess', unreviewed],
      ]),
      new Map([[confirmedBook.id, confirmedBook]]),
    )

    expect(sections.flatMap((section) => section.rows.map((row) => row.series.name))).toEqual([
      'Confirmed Cycle',
    ])
  })

  it('includes a confirmed secondary membership even when the book projects another primary name', () => {
    const book = { ...member('shared-book', 5), series: 'Primary Saga' }
    const secondary = seriesRow('secondary-series', 'Secondary Saga', [
      entry('secondary-entry', book.id, 2),
    ])
    const sections = buildStructuredSeriesSections(
      new Map([['secondary saga', secondary]]),
      new Map([[book.id, book]]),
    )

    expect(sections[0]?.rows[0]?.series.name).toBe('Secondary Saga')
  })
})
