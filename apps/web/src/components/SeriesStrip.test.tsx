import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book, SeriesEntry } from '@reverie/core'

const state = vi.hoisted(() => ({ books: [] as Book[], entries: [] as SeriesEntry[] }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#series">{children}</a>,
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: readonly string[] }) =>
    queryKey[0] === 'series-strip' ? { data: state.entries } : { data: [] },
}))

vi.mock('../data/books', () => ({ useBooks: () => ({ data: state.books }) }))
vi.mock('../data/series', () => ({
  fetchBookSeriesMemberships: vi.fn(),
  fetchSeriesEntries: vi.fn(),
}))

const { SeriesStrip } = await import('./SeriesStrip')

const book = (seriesCount: number | null, over: Partial<Book> = {}): Book => ({
  id: 'book-1',
  title: 'Fourth Wing',
  first: 'Rebecca',
  last: 'Yarros',
  contributors: [],
  series: 'The Empyrean',
  position: 3,
  seriesCount,
  status: 'ongoing',
  genre: 'fantasy',
  subgenre: '',
  subgenres: [],
  genres: ['fantasy'],
  tags: [],
  tropes: [],
  moods: [],
  intensity: null,
  darkness: null,
  cover: '',
  pages: null,
  isbn: '',
  fave: false,
  ownership: 'owned',
  borrowed: false,
  wishlist: false,
  owned: { physical: 'paperback', ebook: false, audiobook: false },
  format: 'Paperback',
  rating: 0,
  readStatus: 'Unread',
  source: 'Owned',
  pub: { y: null, m: null, d: null },
  reads: [],
  plan: { y: null, m: null, d: null },
  progress: 0,
  addedTs: 0,
  ...over,
})

const entry: SeriesEntry = {
  id: 'entry-1',
  position: 3,
  label: null,
  title: 'Fourth Wing',
  author: 'Rebecca Yarros',
  bookId: 'book-1',
  source: 'manual',
  userEdited: false,
  isPrimary: true,
}

describe('SeriesStrip total truth', () => {
  beforeEach(() => {
    state.entries = [entry]
  })

  it('does not call one known entry a one-book series', () => {
    state.books = [book(null)]
    render(<SeriesStrip book={state.books[0]!} />)

    expect(screen.getByText('#3 · primary series →')).toBeInTheDocument()
    expect(screen.queryByText(/#3 of 1/)).toBeNull()
  })

  it('shows an explicit series-length claim when one is known', () => {
    state.books = [book(7)]
    render(<SeriesStrip book={state.books[0]!} />)

    expect(screen.getByText('#3 of 7 · primary series →')).toBeInTheDocument()
  })

  it('marks DNF and borrowed neighbours without placing text over their tiny covers', () => {
    state.books = [
      book(null, { id: 'before', title: 'Before', readStatus: 'DNF' }),
      book(null),
      book(null, {
        id: 'after',
        title: 'After',
        ownership: 'unowned',
        borrowed: true,
      }),
    ]
    state.entries = [
      { ...entry, id: 'before-entry', bookId: 'before', title: 'Before', position: 2 },
      entry,
      { ...entry, id: 'after-entry', bookId: 'after', title: 'After', position: 4 },
    ]

    const { container } = render(<SeriesStrip book={state.books[1]!} />)

    expect(container.querySelector('[data-state-marker="dnf"] svg')).toBeTruthy()
    expect(container.querySelector('[data-state-marker="borrowed"] svg')).toBeTruthy()
    expect(container.querySelector('[data-state-marker]')?.textContent).toBe('')
  })
})
