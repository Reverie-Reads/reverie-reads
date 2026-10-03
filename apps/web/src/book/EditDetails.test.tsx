import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'

const state = vi.hoisted(() => ({ update: vi.fn(), series: vi.fn(), contributors: vi.fn() }))
vi.mock('../data/books', () => ({
  useBooks: () => ({ data: [] }),
  useUpdateBook: () => ({ mutateAsync: state.update }),
}))
vi.mock('../data/contributors', () => ({
  useSetContributors: () => ({ mutateAsync: state.contributors }),
}))
vi.mock('../data/series', () => ({
  useSyncBookSeries: () => ({ mutateAsync: state.series }),
}))
vi.mock('../data/reads', () => ({ useAddRead: vi.fn() }))
vi.mock('../data/mergeBooks', () => ({ usePerformMerge: vi.fn() }))
vi.mock('../skin/labels', () => ({ useLabels: () => ({}) }))
vi.mock('../components/CoverSheet', () => ({ CoverSheet: () => null }))
vi.mock('../components/LevelPicker', () => ({ LevelPicker: () => null }))
vi.mock('../components/MoodPicker', () => ({ MoodPicker: () => null }))
vi.mock('./ContributorEditor', () => ({ ContributorEditor: () => null }))
vi.mock('./OwnedCopies', () => ({ OwnedCopies: () => null }))
vi.mock('./EditionCopies', () => ({ EditionCopies: () => null }))

const { EditDetails } = await import('./dialogs')

beforeEach(() => {
  vi.clearAllMocks()
  state.update.mockResolvedValue(undefined)
  state.series.mockResolvedValue(undefined)
  state.contributors.mockResolvedValue(undefined)
})

it('preserves a background series reconciliation when only the title draft changed', async () => {
  const book = makeBook({ id: 'book', title: 'An unclassified title', genre: '', subgenre: '' })
  const close = vi.fn()
  const view = render(<EditDetails book={book} onClose={close} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'A corrected title' },
  })
  view.rerender(
    <EditDetails
      book={{ ...book, series: 'Shared series', position: 2, seriesCount: 4 }}
      onClose={close}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(state.update).toHaveBeenCalledWith({
    id: book.id,
    patch: expect.objectContaining({ title: 'A corrected title' }),
  })
  expect(state.series).not.toHaveBeenCalled()
})

it('does not replay untouched metadata or contributors when another session refreshes the book', async () => {
  const book = makeBook({
    id: 'book',
    title: 'Original',
    intensity: null,
    darkness: null,
    pages: 200,
  })
  const close = vi.fn()
  const view = render(<EditDetails book={book} onClose={close} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Corrected' },
  })
  view.rerender(
    <EditDetails
      book={{
        ...book,
        pages: 300,
        genre: 'mystery',
        subgenres: ['Cozy Mystery'],
        subgenre: 'Cozy Mystery',
      }}
      onClose={close}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    id: book.id,
    patch: { title: 'Corrected' },
  })
  expect(state.contributors).not.toHaveBeenCalled()
  expect(state.series).not.toHaveBeenCalled()
})

it('focuses a failed field on Save without moving focus away while the reader corrects it', async () => {
  const close = vi.fn()
  render(
    <EditDetails book={makeBook({ id: 'validation', title: 'A clear draft' })} onClose={close} />,
  )
  const pages = screen.getByRole('textbox', { name: 'Pages' })
  const month = screen.getByRole('textbox', { name: 'Month' })
  fireEvent.change(pages, { target: { value: 'not a number' } })
  fireEvent.change(month, { target: { value: '99' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(pages).toHaveFocus())
  fireEvent.change(pages, { target: { value: '3' } })
  expect(pages).toHaveFocus()
  expect(pages).toHaveValue('3')
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(month).toHaveFocus())
  expect(state.update).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})
