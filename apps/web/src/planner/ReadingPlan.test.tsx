import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { Book, ReadingHistory } from '@reverie/core'

const mutate = vi.fn((_variables: unknown, options?: { onSuccess?: () => void }) =>
  options?.onSuccess?.(),
)
vi.mock('../data/books', () => ({
  useUpdateBook: () => ({ mutate, isPending: false, isError: false, reset: vi.fn() }),
}))
vi.mock('../components/CoverImage', () => ({ CoverImage: () => <span /> }))

const { ReadingPlan } = await import('./ReadingPlan')

const planned = (
  id: string,
  title: string,
  position: number,
  date: Book['plan'] = { y: null, m: null, d: null },
) =>
  makeBook({
    id,
    title,
    plan: date,
    planPosition: position,
    planIntention: '',
  })

beforeEach(() => mutate.mockClear())

describe('ReadingPlan', () => {
  it('renders Soon as a deliberate queue entry and reorders with one book patch', () => {
    const books = [planned('a', 'First Book', 1000), planned('b', 'Second Book', 2000)]
    render(<ReadingPlan books={books} view="queue" openBook={vi.fn()} />)

    expect(screen.getAllByText('Soon')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Move Second Book earlier' }))
    expect(mutate).toHaveBeenCalledWith(
      { id: 'b', patch: { planPosition: 0 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('keeps Home-hidden current reads in Planner and updates progress explicitly', () => {
    const current = makeBook({
      id: 'current',
      title: 'Current Book',
      readStatus: 'Reading',
      readingNowHidden: true,
      progress: 31,
    })
    render(<ReadingPlan books={[current]} view="queue" openBook={vi.fn()} />)

    expect(screen.getByRole('heading', { name: 'Current Book' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update progress' }))
    const dialog = screen.getByRole('dialog', { name: 'Update progress' })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Progress (%)' }), {
      target: { value: '44' },
    })
    expect(mutate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }))

    expect(mutate).toHaveBeenCalledWith(
      { id: 'current', patch: { progress: 44 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Progress saved at 44% for Current Book.')
  })

  it('edits precision and keeps the future-self note separate from reading history', () => {
    const book = planned('a', 'First Book', 1000, { y: 2027, m: 4, d: 12 })
    render(<ReadingPlan books={[book]} view="queue" openBook={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit plan' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByLabelText('Soon'))
    fireEvent.change(within(dialog).getByPlaceholderText('What draws you to this book?'), {
      target: { value: '  For a quiet weekend.  ' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save plan' }))

    expect(mutate).toHaveBeenCalledWith(
      {
        id: 'a',
        patch: {
          plan: { y: null, m: null, d: null },
          planPosition: 1000,
          planIntention: 'For a quiet weekend.',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('removes only plan fields and can restore the exact plan with Undo', () => {
    const book = planned('a', 'First Book', 1000, { y: 2027, m: null, d: null })
    book.planIntention = 'When the mood comes.'
    render(<ReadingPlan books={[book]} view="queue" openBook={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove First Book' }))
    expect(mutate).toHaveBeenNthCalledWith(
      1,
      {
        id: 'a',
        patch: {
          plan: { y: null, m: null, d: null },
          planPosition: null,
          planIntention: '',
        },
      },
      expect.objectContaining({ onError: expect.any(Function) }),
    )

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(mutate).toHaveBeenNthCalledWith(
      2,
      {
        id: 'a',
        patch: {
          plan: { y: 2027, m: null, d: null },
          planPosition: 1000,
          planIntention: 'When the mood comes.',
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('keeps completed reads distinct from plans in the calendar detail', () => {
    const now = new Date()
    const book = makeBook({ id: 'finished', title: 'Finished Book' })
    const history: ReadingHistory = {
      records: [
        {
          id: 'read-1',
          bookId: book.id,
          book,
          date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-14`,
          format: 'Hardcover',
          rating: null,
          notes: null,
          finished: { y: now.getFullYear(), m: now.getMonth() + 1, d: 14 },
        },
      ],
      years: [now.getFullYear()],
      markedRead: [],
      stopped: [],
      knownReadBooks: [book],
    }
    const openBook = vi.fn()
    render(<ReadingPlan books={[]} view="calendar" openBook={openBook} history={history} />)

    fireEvent.click(screen.getByRole('button', { name: /0 planned, 1 finished — Finished Book/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Finished')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: /Finished Book/ }))
    expect(openBook).toHaveBeenCalledWith('finished')
  })

  it('marks today and keeps each flexible plan in its honest precision group', () => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth() + 1
    const books = [
      planned('month', 'Month Book', 1000, { y: year, m: month, d: null }),
      planned('year', 'Year Book', 2000, { y: year, m: null, d: null }),
      planned('soon', 'Soon Book', 3000),
    ]
    render(<ReadingPlan books={books} view="calendar" openBook={vi.fn()} />)

    const today = document.querySelector('button[aria-current="date"]')
    expect(today?.getAttribute('aria-label')).toContain(
      `${now.getDate()}, ${year}: 0 planned, 0 finished`,
    )
    expect(screen.getByRole('heading', { name: 'This month', level: 4 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'This year', level: 4 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Soon', level: 4 })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Month Book/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Year Book/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Soon Book/ })).toBeTruthy()
  })

  it('shows a private year rhythm without placing an imprecise finish into a month', () => {
    const year = new Date().getFullYear()
    const finished = makeBook({ id: 'finished', title: 'Finished Book' })
    const yearOnly = makeBook({ id: 'year-only', title: 'Year-only Finish' })
    const history: ReadingHistory = {
      records: [
        {
          id: 'february-read',
          bookId: finished.id,
          book: finished,
          date: `${year}-02-14`,
          format: 'Hardcover',
          rating: null,
          notes: null,
          finished: { y: year, m: 2, d: 14 },
        },
        {
          id: 'year-read',
          bookId: yearOnly.id,
          book: yearOnly,
          date: String(year),
          format: null,
          rating: null,
          notes: null,
          finished: { y: year, m: null, d: null },
        },
      ],
      years: [year],
      markedRead: [],
      stopped: [],
      knownReadBooks: [finished, yearOnly],
    }
    const books = [
      planned('february-plan', 'February Plan', 1000, { y: year, m: 2, d: null }),
      planned('year-plan', 'Year Plan', 2000, { y: year, m: null, d: null }),
    ]

    render(<ReadingPlan books={books} view="calendar" openBook={vi.fn()} history={history} />)

    expect(screen.getByLabelText(`${year} reading summary`)).toHaveTextContent('2 finishes logged')
    expect(screen.getByLabelText(`${year} reading summary`)).toHaveTextContent(
      '1 planned to a month',
    )
    expect(
      screen.getByRole('button', {
        name: `Feb ${year}: 1 finished, 1 planned. Show Feb.`,
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: `Jan ${year}: 0 finished, 0 planned. Show Jan.`,
      }),
    ).toBeTruthy()
    expect(screen.getByText(/1 finish is known only to .*it is not placed in a month/)).toBeTruthy()

    fireEvent.click(
      screen.getByRole('button', {
        name: `Feb ${year}: 1 finished, 1 planned. Show Feb.`,
      }),
    )
    expect(screen.getByRole('heading', { name: `Feb ${year}` })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Previous year' }))
    expect(screen.getByRole('group', { name: `Choose a month in ${year - 1}` })).toBeTruthy()
    expect(screen.getByRole('heading', { name: `Feb ${year - 1}` })).toBeTruthy()
  })
})
