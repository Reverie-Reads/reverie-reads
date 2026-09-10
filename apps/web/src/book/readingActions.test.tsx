import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'

const mutate = vi.fn()
vi.mock('../data/books', () => ({ useUpdateBook: () => ({ mutate, isPending: false }) }))
const { BookReadingActions } = await import('./BookDetailRoute')

beforeEach(() => mutate.mockClear())

const callbacks = () => ({ onUpdateProgress: vi.fn(), onLogPastRead: vi.fn() })

describe('book reading actions', () => {
  it('starts an unowned book without acquiring a copy or logging a completed read', () => {
    const book = makeBook({
      id: 'unowned',
      title: 'An unread book',
      ownership: 'unowned',
      readStatus: 'Unread',
    })
    render(<BookReadingActions book={book} {...callbacks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Start reading' }))
    expect(mutate).toHaveBeenCalledExactlyOnceWith({
      id: book.id,
      patch: { readStatus: 'Reading', readingNowHidden: false, progress: 0 },
    })
    expect(book.ownership).toBe('unowned')
    expect(book.reads).toEqual([])
  })

  it('starts a reread at zero without replacing history, rating, or independent possession flags', () => {
    const book = makeBook({
      id: 'reread',
      title: 'An old favorite',
      readStatus: 'Read',
      progress: 100,
      rating: 4.5,
      ownership: 'owned',
      borrowed: true,
      wishlist: true,
      reads: [{ date: '2025-02-14', format: 'Ebook', rating: 4, notes: 'Remember this.' }],
    })
    const original = structuredClone(book)
    render(<BookReadingActions book={book} {...callbacks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }))
    expect(mutate).toHaveBeenCalledExactlyOnceWith({
      id: book.id,
      patch: { readStatus: 'Reading', readingNowHidden: false, progress: 0 },
    })
    expect(book).toEqual(original)
  })

  it('uses recorded history for Read again even when the current status is unset', () => {
    const book = makeBook({
      id: 'history',
      title: 'A remembered book',
      readStatus: 'unset',
      progress: 100,
      reads: [{ date: '2024-04-01', format: 'Paperback', rating: 0, notes: '' }],
    })
    render(<BookReadingActions book={book} {...callbacks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }))
    expect(mutate).toHaveBeenCalledWith({
      id: book.id,
      patch: { readStatus: 'Reading', readingNowHidden: false, progress: 0 },
    })
  })

  it('names and preserves the retained place when resuming a set-aside reread', () => {
    const book = makeBook({
      id: 'paused',
      title: 'A paused reread',
      readStatus: 'Unread',
      progress: 37,
      reads: [{ date: '2024-04-01', format: 'Paperback', rating: 4, notes: '' }],
    })
    render(<BookReadingActions book={book} {...callbacks()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Resume reading' }))
    expect(mutate).toHaveBeenCalledWith({
      id: book.id,
      patch: { readStatus: 'Reading', readingNowHidden: false, progress: 37 },
    })
  })

  it('takes an active reread to progress without restarting or writing a completion', () => {
    const handlers = callbacks()
    const book = makeBook({
      id: 'active',
      title: 'In progress',
      readStatus: 'Reading',
      progress: 45,
      reads: [{ date: '2024-04-01', format: 'Paperback', rating: 0, notes: '' }],
    })
    render(<BookReadingActions book={book} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Update progress' }))
    expect(handlers.onUpdateProgress).toHaveBeenCalledOnce()
    expect(mutate).not.toHaveBeenCalled()
    expect(book.progress).toBe(45)
  })

  it('keeps logging a past read separate from starting or updating the current read', () => {
    const handlers = callbacks()
    render(<BookReadingActions book={makeBook({ id: 'b', title: 'A book' })} {...handlers} />)
    fireEvent.click(screen.getByRole('button', { name: 'Log a past read' }))
    expect(handlers.onLogPastRead).toHaveBeenCalledOnce()
    expect(handlers.onUpdateProgress).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })
})
