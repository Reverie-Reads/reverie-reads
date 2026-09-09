import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { STATE_PILL_TOKENS, type Book } from '@reverie/core'
import { BookStateMarks } from './BookStateMarks'

const book = (over: Partial<Book> = {}): Book => ({
  id: 'state-mark',
  title: 'State Mark',
  first: '',
  last: '',
  contributors: [],
  series: '',
  position: '',
  seriesCount: null,
  status: 'standalone',
  genre: '',
  subgenre: '',
  subgenres: [],
  genres: [],
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
  owned: { physical: false, ebook: false, audiobook: false },
  format: '',
  rating: 0,
  readStatus: 'unset',
  source: '',
  pub: { y: null, m: null, d: null },
  reads: [],
  plan: { y: null, m: null, d: null },
  progress: 0,
  addedTs: 0,
  ...over,
})

describe('cover-sized book state marks', () => {
  it('reuses the solid DNF and borrowed pills together', () => {
    render(
      <BookStateMarks
        book={book({ readStatus: 'DNF', ownership: 'unowned', borrowed: true })}
        showRead
      />,
    )
    for (const word of ['DNF', 'Borrowed']) {
      const mark = screen.getByText(word).closest('span')
      expect(mark?.style.background).toBe(STATE_PILL_TOKENS.surface)
      expect(mark?.style.color).toBe(STATE_PILL_TOKENS.label)
    }
  })

  it('shows Read when requested and lets DNF replace it', () => {
    const { rerender } = render(<BookStateMarks book={book({ readStatus: 'Read' })} showRead />)
    expect(screen.getByText('Read')).toBeTruthy()
    rerender(
      <BookStateMarks
        book={book({
          readStatus: 'DNF',
          reads: [{ date: '2026-01-01', format: '', rating: 0, notes: '' }],
        })}
        showRead
      />,
    )
    expect(screen.getByText('DNF')).toBeTruthy()
    expect(screen.queryByText('Read')).toBeNull()
  })
})

describe('true-thumbnail book state marks', () => {
  it('uses compact SVG shapes rather than cover-obscuring text', () => {
    const { container } = render(
      <BookStateMarks
        density="thumb"
        book={book({ readStatus: 'DNF', ownership: 'unowned', borrowed: true })}
      />,
    )
    const marks = container.querySelectorAll('[data-state-marker]')
    expect([...marks].map((mark) => mark.getAttribute('data-state-marker'))).toEqual([
      'dnf',
      'borrowed',
    ])
    for (const mark of marks) {
      expect(mark.querySelector('svg')).toBeTruthy()
      expect(mark.textContent).toBe('')
      expect((mark as HTMLElement).style.background).toBe(STATE_PILL_TOKENS.surface)
      expect(mark.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('does not mark an ordinary completed book at thumbnail density', () => {
    const { container } = render(
      <BookStateMarks density="thumb" book={book({ readStatus: 'Read' })} />,
    )
    expect(container.querySelectorAll('[data-state-marker]')).toHaveLength(0)
  })
})
