import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { newCopy, newEdition } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import { CopyEditor } from './EditionCopies'

const state = vi.hoisted(() => ({ ingest: vi.fn(), save: vi.fn() }))
vi.mock('../lib/covers', () => ({ ingestCover: state.ingest }))
vi.mock('../data/copyInventory', () => ({
  useSaveCopyInventory: () => ({ mutateAsync: state.save, isPending: false }),
}))
beforeEach(() => vi.clearAllMocks())

const fixture = () => {
  const edition = newEdition('hardcover')
  return makeBook({
    id: 'book',
    title: 'Edition cover fixture',
    cover: 'https://covers.example/original.webp',
    copyInventoryRevision: 2,
    copyInventory: { version: 1, editions: [edition], copies: [newCopy(edition.id, 'owned')] },
  })
}
const upload = () => {
  fireEvent.click(screen.getByText('Edition details', { exact: true }))
  fireEvent.change(screen.getByLabelText('Upload an edition cover'), {
    target: { files: [new File(['fixture'], 'edition.png', { type: 'image/png' })] },
  })
}

it('uploads into the edition draft and cancelling does not save inventory or change the parent cover', async () => {
  const book = fixture(),
    close = vi.fn()
  state.ingest.mockResolvedValue({
    status: 'ok',
    data: { cover: 'https://covers.example/edition.webp' },
  })
  render(<CopyEditor book={book} onClose={close} />)
  upload()
  await waitFor(() =>
    expect(screen.getByLabelText('Cover image link (HTTPS)')).toHaveValue(
      'https://covers.example/edition.webp',
    ),
  )
  expect(state.save).not.toHaveBeenCalled()
  expect(book.cover).toBe('https://covers.example/original.webp')
  expect(book.copyInventory!.editions[0]!.cover).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
  expect(close).toHaveBeenCalledOnce()
  expect(state.save).not.toHaveBeenCalled()
})

it('an upload failure preserves the edition draft and an explicit retry/save uses its revision', async () => {
  const book = fixture()
  state.ingest
    .mockResolvedValueOnce({ status: 'error' })
    .mockResolvedValueOnce({ status: 'ok', data: { cover: 'https://covers.example/retry.webp' } })
  state.save.mockResolvedValue(book)
  render(<CopyEditor book={book} onClose={vi.fn()} />)
  upload()
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('The cover could not be uploaded.'),
  )
  expect(screen.getByLabelText('Format')).toHaveValue('hardcover')
  expect(state.save).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Upload an edition cover'), {
    target: { files: [new File(['retry'], 'retry.png', { type: 'image/png' })] },
  })
  await waitFor(() =>
    expect(screen.getByLabelText('Cover image link (HTTPS)')).toHaveValue(
      'https://covers.example/retry.webp',
    ),
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save editions & copies' }))
  await waitFor(() =>
    expect(state.save).toHaveBeenCalledWith({
      revision: 2,
      inventory: {
        ...book.copyInventory,
        editions: [
          { ...book.copyInventory!.editions[0], cover: 'https://covers.example/retry.webp' },
        ],
      },
    }),
  )
})
