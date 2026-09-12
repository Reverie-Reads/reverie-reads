import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildReadingHistory } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import { ReflectView } from './ReflectScreen'
import { ReadingTipsProvider } from '../components/ReadingTips'

vi.mock('../components/CoverImage', () => ({
  CoverImage: ({ book }: { book: { title: string } }) => <img alt={book.title} />,
}))

const books = [
  makeBook({
    id: 'a',
    title: 'A familiar book',
    first: 'Nell',
    last: 'Stone',
    contributors: [{ name: 'Nell Stone', role: 'author', position: 0 }],
    genre: 'literary',
    genres: ['literary'],
    tropes: [{ id: 'found', name: 'Found family', emphasis: 'pinned' }],
    moods: [{ id: 'hopeful', name: 'Hopeful' }],
    readStatus: 'DNF',
    format: 'Hardcover',
  }),
  makeBook({ id: 'b', title: 'An undated book', genre: 'fantasy', genres: ['fantasy'] }),
  makeBook({ id: 'c', title: 'Marked read', readStatus: 'Read' }),
]
const history = buildReadingHistory(books, [
  {
    id: 'first',
    bookId: 'a',
    date: '2025-06-10',
    format: 'Paperback',
    notes: 'An earlier thought',
    rating: 3,
  },
  {
    id: 'again',
    bookId: 'a',
    date: '2026-03-04',
    format: 'Audiobook',
    notes: 'A note that stayed with me',
    rating: 4,
  },
  { id: 'unknown', bookId: 'b', date: null, format: null, notes: null, rating: null },
])

describe('Reflect uses the real reading record', () => {
  it('quiets introductions without hiding records, qualifications, private notes or drilldowns', () => {
    const openBook = vi.fn()
    render(
      <ReadingTipsProvider show={false}>
        <ReflectView history={history} openBook={openBook} openPlan={() => {}} currentYear={2026} />
      </ReadingTipsProvider>,
    )
    expect(
      screen.queryByText(
        'The stories you finished, the ones you returned to, and a little of what stayed.',
      ),
    ).toBeNull()
    expect(
      screen.queryByText('Open a book to revisit its notes or add an earlier read.'),
    ).toBeNull()
    expect(screen.getByText('Reflect · your reading life is private')).toBeTruthy()
    expect(
      screen.getByText(
        'Genres on books finished in this period. A read may belong to more than one.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('blockquote').textContent).toBe('A note that stayed with me')
    expect(screen.getByRole('button', { name: /1 undated read/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Mar: 1 logged reads' }))
    const dialog = screen.getByRole('dialog', { name: 'Mar · 2026' })
    expect(within(dialog).getByText('Mar 4, 2026 · Audiobook')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /A familiar book.*Open book/ }))
    expect(openBook).toHaveBeenCalledWith('a')
  })

  it('changes charts, highlights and drilldowns together and opens the actual book', () => {
    const openBook = vi.fn()
    render(
      <ReflectView history={history} openBook={openBook} openPlan={() => {}} currentYear={2026} />,
    )
    expect(screen.getByRole('blockquote').textContent).toBe('A note that stayed with me')
    expect(screen.queryByText('Avg rating')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Mar: 1 logged reads' }))
    const dialog = screen.getByRole('dialog', { name: 'Mar · 2026' })
    expect(within(dialog).getByText('Mar 4, 2026 · Audiobook')).toBeTruthy()
    expect(within(dialog).queryByText('An earlier thought')).toBeNull()
    fireEvent.click(within(dialog).getByRole('button', { name: /A familiar book.*Open book/ }))
    expect(openBook).toHaveBeenCalledWith('a')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Stats year' }), {
      target: { value: '2025' },
    })
    expect(screen.getByRole('blockquote').textContent).toBe('An earlier thought')
    expect(screen.getByRole('button', { name: 'Mar: 0 logged reads' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Paperback 1 read' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Audiobook 1 read' })).toBeNull()
  })

  it('keeps unknown dates and current DNF outside yearly metrics', () => {
    render(
      <ReflectView history={history} openBook={() => {}} openPlan={() => {}} currentYear={2026} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /1 undated read/ }))
    expect(within(screen.getByRole('dialog')).getByText('An undated book')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Stats year' }), {
      target: { value: 'all' },
    })
    fireEvent.click(screen.getByRole('button', { name: /3 Logged reads/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Finish date not recorded · Format not recorded')).toBeTruthy()
    expect(within(dialog).queryByText('Marked read')).toBeNull()
  })

  it('invites a first read without fabricating a note', () => {
    render(
      <ReflectView
        history={buildReadingHistory([], [])}
        openBook={() => {}}
        openPlan={() => {}}
        currentYear={2026}
      />,
    )
    expect(screen.getByText('Your reading life begins with a book.')).toBeTruthy()
    expect(screen.queryByRole('blockquote')).toBeNull()
    expect(screen.getByRole('button', { name: /0 Logged reads/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Open your retrospective/ })).toBeNull()
  })

  it('opens a private period story from the same summary and turns toward Plan', () => {
    const openBook = vi.fn()
    const openPlan = vi.fn()
    render(
      <ReflectView history={history} openBook={openBook} openPlan={openPlan} currentYear={2026} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Open your retrospective/ }))
    const story = screen.getByRole('dialog', { name: 'Your 2026 in books' })
    expect(within(story).getByText(/1 logged read across 1 book/)).toBeTruthy()
    expect(within(story).getByText(/One was a return to familiar company/)).toBeTruthy()
    expect(within(story).getByRole('blockquote').textContent).toContain(
      'A note that stayed with me',
    )
    expect(within(story).getByText(/does not create a public score or share card/)).toBeTruthy()
    fireEvent.click(within(story).getByRole('button', { name: 'Open A familiar book' }))
    expect(openBook).toHaveBeenCalledWith('a')
    fireEvent.click(within(story).getByRole('button', { name: /Turn toward what’s next/ }))
    expect(openPlan).toHaveBeenCalledTimes(1)
  })

  it('opens private taste details and composes a factual retrospective', () => {
    const openBook = vi.fn()
    const openPlan = vi.fn()
    render(
      <ReflectView
        history={history}
        openBook={openBook}
        openPlan={openPlan}
        goalYear={2026}
        goalTarget={12}
        currentYear={2026}
      />,
    )
    expect(
      screen.getByText(
        '1 of 12 books in 2026. Every finished book still belongs here if the goal changes.',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Nell Stone 1 read' }))
    expect(within(screen.getByRole('dialog')).getByText('A familiar book')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Found family 1 read' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Hopeful 1 read' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open your retrospective' }))
    const retrospective = screen.getByRole('dialog', {
      name: 'Your 2026 in books',
    })
    expect(within(retrospective).getByText('Most-read voice')).toBeTruthy()
    expect(within(retrospective).getByText('A private retrospective · 2026')).toBeTruthy()
    expect(
      within(retrospective).getByText(/does not create a public score or share card/),
    ).toBeTruthy()
    fireEvent.click(within(retrospective).getByRole('button', { name: 'Turn toward what’s next' }))
    expect(openPlan).toHaveBeenCalledOnce()
  })
})
