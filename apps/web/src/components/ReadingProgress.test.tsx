import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@reverie/core'

const state = vi.hoisted(() => ({
  isPending: false,
  isError: false,
  mutate: vi.fn(),
  reset: vi.fn(),
}))

vi.mock('../data/books', () => ({
  useUpdateBook: () => state,
}))

const { ReadingProgressDialog } = await import('./ReadingProgress')
const { parseProgress } = await import('./readingProgressValue')

const book = (progress: number): Pick<Book, 'id' | 'title' | 'progress'> => ({
  id: 'b1',
  title: 'The Quiet Book',
  progress,
})

beforeEach(() => {
  vi.clearAllMocks()
  state.isPending = false
  state.isError = false
})

describe('reading progress input', () => {
  it('accepts only whole percentages from 0 through 100', () => {
    expect(parseProgress('0')).toBe(0)
    expect(parseProgress(' 37 ')).toBe(37)
    expect(parseProgress('100')).toBe(100)
    for (const value of ['', '4.5', '-1', '101', 'thirty']) expect(parseProgress(value)).toBeNull()
  })

  it('keeps slider, step controls, and number entry in one draft until Save', () => {
    state.mutate.mockImplementation((_variables, options) => options?.onSuccess?.())
    render(<ReadingProgressDialog book={book(20)} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Update progress' })
    expect(within(dialog).getByRole('spinbutton', { name: 'Progress (%)' })).toHaveFocus()

    fireEvent.change(within(dialog).getByRole('slider', { name: /Reading progress slider/ }), {
      target: { value: '32' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Increase progress by 5 percent' }))

    expect(within(dialog).getByRole('spinbutton', { name: 'Progress (%)' })).toHaveValue(37)
    expect(state.mutate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }))
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith(
      { id: 'b1', patch: { progress: 37 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('shows validation instead of silently clamping an invalid entry', () => {
    render(<ReadingProgressDialog book={book(20)} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'Update progress' })
    const input = within(dialog).getByRole('spinbutton', { name: 'Progress (%)' })

    fireEvent.change(input, { target: { value: '20.5' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter a whole number from 0 to 100.',
    )
    expect(input).toHaveValue(20.5)
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it('discards a draft without writing when the reader cancels', () => {
    const close = vi.fn()
    render(<ReadingProgressDialog book={book(20)} onClose={close} />)
    const dialog = screen.getByRole('dialog', { name: 'Update progress' })

    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Progress (%)' }), {
      target: { value: '61' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(state.mutate).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
  })

  it('retains a failed draft and permits retrying the same value', () => {
    state.isError = true
    const view = render(<ReadingProgressDialog book={book(20)} onClose={vi.fn()} />)
    const input = screen.getByRole('spinbutton', { name: 'Progress (%)' })

    fireEvent.change(input, { target: { value: '43' } })
    expect(state.reset).toHaveBeenCalledOnce()
    state.isError = true
    view.rerender(<ReadingProgressDialog book={book(20)} onClose={vi.fn()} />)

    expect(input).toHaveValue(43)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Progress wasn’t saved. Your entry is still here.',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.mutate).toHaveBeenCalledWith(
      { id: 'b1', patch: { progress: 43 } },
      expect.any(Object),
    )
  })

  it('adopts an external value while idle and preserves an active draft', () => {
    const view = render(<ReadingProgressDialog book={book(20)} onClose={vi.fn()} />)
    const input = screen.getByRole('spinbutton', { name: 'Progress (%)' })

    view.rerender(<ReadingProgressDialog book={book(24)} onClose={vi.fn()} />)
    expect(input).toHaveValue(24)
    fireEvent.change(input, { target: { value: '45' } })
    view.rerender(<ReadingProgressDialog book={book(30)} onClose={vi.fn()} />)
    expect(input).toHaveValue(45)
  })
})
