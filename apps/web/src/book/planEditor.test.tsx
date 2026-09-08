import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Book } from '@reverie/core'

// How MANY writes one plan edit produces, which is the half of the race the scope cannot fix.
//
// Serializing same-book writes (see data/bookWriteRace.test.tsx) makes the last one win. This asserts
// there is only ever ONE — because the original defect was not merely ordering: per-field blur sent
// three patches for a single edit, and the first carried a year with an empty month and day. Under
// serialization that first write is harmless; unserialized it could land last and blank the rest.
// Removing it removes the thing that had to be ordered.
//
// Deterministic by construction: it counts calls to a mocked mutation, so nothing depends on request
// timing. The e2e that originally caught this needed two real round trips to resolve out of order,
// which is why it only failed at position 27 of 80 under load.

const mutate = vi.fn()
vi.mock('../data/books', () => ({
  useUpdateBook: () => ({ mutate }),
  useBooks: () => ({ data: [] }),
}))

const { PlanEditor } = await import('./PlanEditor')

beforeEach(() => mutate.mockClear())

// PlanEditor declares `Pick<Book, 'id' | 'plan'>`, so the fixture is exactly what it reads —
// no 40-field Book literal standing in for two used properties.
const book = (
  plan: Book['plan'],
  planPosition: number | null = null,
): Pick<Book, 'id' | 'title' | 'plan' | 'planPosition' | 'planIntention' | 'addedTs'> => ({
  id: 'b1',
  title: 'A Book',
  plan,
  planPosition,
  planIntention: '',
  addedTs: 1,
})

const empty = { y: null, m: null, d: null }

describe('PlanEditor writes once per edit, not once per field', () => {
  it('tabbing Year → Month → Day → out produces exactly ONE write, carrying the whole trio', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book(empty)} />)

    await user.click(screen.getByLabelText('Planned read year'))
    await user.keyboard('2026')
    await user.tab() // → month. Under per-field blur this alone wrote {2026, null, null}.
    await user.keyboard('3')
    await user.tab() // → day
    await user.keyboard('14')
    await user.tab() // → out of the group; the one and only commit

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate).toHaveBeenCalledWith({
      id: 'b1',
      patch: { plan: { y: 2026, m: 3, d: 14 }, planPosition: 1000 },
    })
  })

  it('moving between the fields commits nothing until focus leaves the group', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book(empty)} />)

    await user.click(screen.getByLabelText('Planned read year'))
    await user.keyboard('2026')
    await user.tab()
    await user.keyboard('3')

    // Still inside the editor — an incomplete plan must not have reached the database yet.
    expect(mutate).not.toHaveBeenCalled()
  })

  it('a month-only plan still writes, with the day left null', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book(empty)} />)

    await user.click(screen.getByLabelText('Planned read year'))
    await user.keyboard('2026')
    await user.tab()
    await user.keyboard('3')
    await user.tab()
    await user.tab() // past the day field, out of the group

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate).toHaveBeenCalledWith({
      id: 'b1',
      patch: { plan: { y: 2026, m: 3, d: null }, planPosition: 1000 },
    })
  })

  it('leaving an unchanged plan alone writes nothing at all', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book({ y: 2026, m: 3, d: 14 })} />)

    await user.click(screen.getByLabelText('Planned read year'))
    await user.tab()
    await user.tab()
    await user.tab()

    expect(mutate).not.toHaveBeenCalled()
  })

  it('a month with no year is refused, and nothing is written', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book(empty)} />)

    await user.click(screen.getByLabelText('Planned read month'))
    await user.keyboard('3')
    await user.tab()
    await user.tab()

    expect(await screen.findByText('A plan needs a year.')).toBeInTheDocument()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('clearing a dated plan removes queue membership and its intention', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book({ y: 2026, m: 3, d: 14 }, 2000)} />)

    const year = screen.getByLabelText('Planned read year')
    await user.clear(year)
    await user.tab()
    const month = screen.getByLabelText('Planned read month')
    await user.clear(month)
    await user.tab()
    const day = screen.getByLabelText('Planned read day')
    await user.clear(day)
    await user.tab()

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(mutate).toHaveBeenCalledWith({
      id: 'b1',
      patch: { plan: empty, planPosition: null, planIntention: '' },
    })
  })

  it('creates an open-ended Soon plan without inventing a date', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book(empty)} />)

    await user.click(screen.getByRole('button', { name: 'Soon' }))

    expect(mutate).toHaveBeenCalledWith({
      id: 'b1',
      patch: { plan: empty, planPosition: 1000 },
    })
  })

  it('removes a Soon plan without touching reading history', async () => {
    const user = userEvent.setup()
    render(<PlanEditor book={book(empty, 2000)} />)

    await user.click(screen.getByRole('button', { name: 'Remove plan' }))

    expect(mutate).toHaveBeenCalledWith({
      id: 'b1',
      patch: { plan: empty, planPosition: null, planIntention: '' },
    })
  })
})
