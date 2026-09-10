import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'

const { addRead, updateBook, chainPrompt } = vi.hoisted(() => ({
  addRead: vi.fn(),
  updateBook: vi.fn(),
  chainPrompt: vi.fn(),
}))
vi.mock('../data/reads', () => ({ useAddRead: () => ({ mutateAsync: addRead }) }))
vi.mock('../data/books', () => ({
  useBooks: () => ({ data: [] }),
  useUpdateBook: () => ({ mutateAsync: updateBook }),
}))
vi.mock('../lib/chainPrompt', () => ({ maybeChainPrompt: chainPrompt }))
const { LogReadForm } = await import('./dialogs')

beforeEach(() => {
  vi.clearAllMocks()
  addRead.mockResolvedValue(undefined)
  updateBook.mockResolvedValue(undefined)
})

const readingBook = () =>
  makeBook({ id: 'b', title: 'Current reread', readStatus: 'Reading', progress: 45 })

describe('logging past and current reads', () => {
  it('records a past completion without ending an active reread or requiring a rating', async () => {
    const close = vi.fn()
    render(<LogReadForm book={readingBook()} mode="past" onClose={close} />)
    fireEvent.change(screen.getByLabelText('Date finished'), { target: { value: '2025-01-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save to read log' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(addRead).toHaveBeenCalledExactlyOnceWith({
      date: '2025-01-01',
      format: 'Paperback',
      rating: 0,
      notes: '',
    })
    expect(updateBook).not.toHaveBeenCalled()
    expect(chainPrompt).not.toHaveBeenCalled()
  })

  it('keeps an unknown format unrecorded instead of inventing Paperback', async () => {
    const close = vi.fn()
    render(<LogReadForm book={makeBook({ ...readingBook(), format: '' })} onClose={close} />)
    expect(screen.getByLabelText('Format')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Save finished read' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(addRead).toHaveBeenCalledWith(expect.objectContaining({ format: '' }))
  })

  it('waits for the completion to save before finishing status and showing next-in-series', async () => {
    let completeRead!: () => void
    addRead.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          completeRead = resolve
        }),
    )
    const close = vi.fn()
    const book = readingBook()
    render(<LogReadForm book={book} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save finished read' }))
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(updateBook).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    completeRead()
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(updateBook).toHaveBeenCalledExactlyOnceWith({
      id: 'b',
      patch: { readStatus: 'Read', progress: 100 },
    })
    expect(chainPrompt).toHaveBeenCalledWith(book, [])
  })

  it.each(['past', 'finish'] as const)(
    'keeps a failed %s save open with the entered data and no status change',
    async (mode) => {
      addRead.mockRejectedValueOnce(new Error('Network unavailable'))
      const close = vi.fn()
      render(<LogReadForm book={readingBook()} mode={mode} onClose={close} />)
      fireEvent.change(screen.getByLabelText('Your thoughts on this read'), {
        target: { value: 'Keep my note' },
      })
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'finish' ? 'Save finished read' : 'Save to read log',
        }),
      )
      expect(await screen.findByRole('alert')).toHaveTextContent('The read could not be saved')
      expect(screen.getByLabelText('Your thoughts on this read')).toHaveValue('Keep my note')
      expect(close).not.toHaveBeenCalled()
      expect(updateBook).not.toHaveBeenCalled()
      expect(chainPrompt).not.toHaveBeenCalled()
      fireEvent.click(
        screen.getByRole('button', {
          name: mode === 'finish' ? 'Save finished read' : 'Save to read log',
        }),
      )
      await waitFor(() => expect(close).toHaveBeenCalledOnce())
      expect(addRead).toHaveBeenCalledTimes(2)
    },
  )

  it('retries only status after the read was saved, without appending a duplicate completion', async () => {
    updateBook.mockRejectedValueOnce(new Error('Status update failed'))
    const close = vi.fn()
    render(<LogReadForm book={readingBook()} onClose={close} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save finished read' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Your read is saved')
    expect(addRead).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    expect(chainPrompt).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Date finished')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry status update' }))
    await waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(addRead).toHaveBeenCalledOnce()
    expect(updateBook).toHaveBeenCalledTimes(2)
    expect(updateBook).toHaveBeenLastCalledWith({
      id: 'b',
      patch: { readStatus: 'Read', progress: 100 },
    })
    expect(chainPrompt).toHaveBeenCalledOnce()
  })
})
