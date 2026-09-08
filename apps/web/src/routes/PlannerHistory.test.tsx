import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../components/CoverImage', () => ({ CoverImage: () => <span /> }))
vi.mock('../data/books', () => ({ useUpdateBook: () => ({ mutate: vi.fn() }) }))
import { PlannerCalendar } from './PlannerRoute'

const now = new Date()
const planned = makeBook({
  id: 'plan',
  title: 'A saved plan',
  plan: { y: now.getFullYear(), m: now.getMonth() + 1, d: 14 },
  planPosition: 1000,
})
describe('Planner calendar', () => {
  it('keeps cached plans accessible without requiring reading history', () => {
    const openBook = vi.fn()
    render(<PlannerCalendar books={[planned]} openBook={openBook} />)
    fireEvent.click(screen.getByRole('button', { name: /A saved plan/ }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /A saved plan/ })).toBeTruthy()
  })
})
