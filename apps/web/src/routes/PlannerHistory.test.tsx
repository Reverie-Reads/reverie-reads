import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { buildReadingHistory, type ReadingHistory } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
const query = vi.hoisted(() => ({
  data: undefined as ReadingHistory | undefined,
  isPaused: true,
  isError: false,
  refetch: vi.fn(),
}))
vi.mock('../data/readingHistory', () => ({ useReadingHistory: () => query }))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../components/CoverImage', () => ({ CoverImage: () => <span /> }))
import { PlannerCalendar } from './PlannerRoute'

const now = new Date()
const planned = makeBook({
  id: 'plan',
  title: 'A saved plan',
  plan: { y: now.getFullYear(), m: now.getMonth() + 1, d: 14 },
})
describe('Planner when reading history is unavailable', () => {
  it('keeps cached plans accessible and shows unknown read totals until logs arrive', () => {
    query.data = undefined
    query.isPaused = true
    query.isError = false
    const openBook = vi.fn()
    const view = render(<PlannerCalendar books={[planned]} openBook={openBook} />)
    expect(
      screen.getByText('Your saved plans are available. Connect to load reading history.'),
    ).toBeTruthy()
    expect(screen.getAllByText('—')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: /A saved plan/ }))
    expect(openBook).toHaveBeenCalledWith('plan')
    query.isPaused = false
    query.data = buildReadingHistory([planned], [])
    view.rerender(<PlannerCalendar books={[planned]} openBook={openBook} />)
    expect(screen.queryAllByText('—')).toHaveLength(0)
    expect(screen.getAllByText('0')).toHaveLength(3)
    expect(screen.getByRole('button', { name: /A saved plan/ })).toBeTruthy()
  })
})
