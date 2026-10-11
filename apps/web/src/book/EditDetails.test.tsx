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
  useSeriesList: () => ({ data: new Map([['saga', { series: { name: 'Existing saga' } }]]) }),
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
  Element.prototype.scrollIntoView = vi.fn()
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
  expect(screen.getByRole('textbox', { name: /^Pages$/ })).toBe(pages)
  expect(pages).toHaveAccessibleDescription('Pages must be a number.')
  fireEvent.change(pages, { target: { value: '3' } })
  expect(pages).toHaveFocus()
  expect(pages).toHaveValue('3')
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(month).toHaveFocus())
  expect(state.update).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
})

it('quick series editing saves without requiring repairs to unrelated legacy publication data', async () => {
  const close = vi.fn()
  const book = makeBook({
    id: 'quick',
    title: 'My book',
    series: '',
    position: '',
    pub: { y: null, m: 2, d: null },
  })
  render(<EditDetails book={book} initialSection="series" onClose={close} />)
  fireEvent.change(screen.getByRole('combobox', { name: 'Series' }), {
    target: { value: 'Existing saga' },
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Position' }), {
    target: { value: '2' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save series' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(state.series).toHaveBeenCalledWith({
    book,
    newSeries: 'Existing saga',
    newPosition: 2,
    newSeriesCount: null,
  })
  expect(state.update).not.toHaveBeenCalled()
})

it('keeps the series draft when expanding into the full editor and offers existing names', () => {
  render(
    <EditDetails
      book={makeBook({ id: 'expanded', title: 'My book', series: '' })}
      initialSection="series"
      onClose={vi.fn()}
    />,
  )
  const series = screen.getByRole('combobox', { name: 'Series' })
  expect(document.querySelector('datalist option')?.getAttribute('value')).toBe('Existing saga')
  fireEvent.change(series, { target: { value: 'New draft saga' } })
  fireEvent.click(screen.getByRole('button', { name: 'Full book details…' }))
  expect(screen.getByRole('combobox', { name: 'Series' })).toHaveValue('New draft saga')
  expect(screen.getByRole('button', { name: 'Save details' })).toBeInTheDocument()
})

it('requires review of a changed ISBN and rejects a checksum error before saving', async () => {
  const close = vi.fn()
  render(
    <EditDetails
      book={makeBook({ id: 'isbn', title: 'My edition', isbn: '9780306406157' })}
      onClose={close}
    />,
  )
  const field = screen.getByRole('textbox', { name: 'ISBN' })
  fireEvent.change(field, { target: { value: '9780306406158' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(field).toHaveFocus())
  expect(state.update).not.toHaveBeenCalled()
  fireEvent.change(field, { target: { value: '9780140449136' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  expect(state.update).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: /I reviewed this edition/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(state.update).toHaveBeenCalledWith({ id: 'isbn', patch: { isbn: '9780140449136' } })
})

it('does not convert shared defaults into personal levels during an unrelated edit', async () => {
  const close = vi.fn()
  render(
    <EditDetails
      book={makeBook({
        id: 'shared',
        title: 'Original',
        intensity: null,
        darkness: null,
        sharedGuidance: { spice: 4, darkness: 2 },
      })}
      onClose={close}
    />,
  )
  expect(screen.getByText('Using shared guidance: 4/5.')).toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: 'Title' }), {
    target: { value: 'Corrected' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(state.update).toHaveBeenCalledWith({ id: 'shared', patch: { title: 'Corrected' } })
})

it('clears only the selected personal assessment when returning to shared guidance', async () => {
  const close = vi.fn()
  render(
    <EditDetails
      book={makeBook({
        id: 'override',
        title: 'Original',
        intensity: 0,
        darkness: 2,
        sharedGuidance: { spice: 4, darkness: 5 },
      })}
      onClose={close}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Use shared spice guidance' }))
  expect(screen.getByText('Using shared guidance: 4/5.')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Save details' }))
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(state.update).toHaveBeenCalledWith({ id: 'override', patch: { intensity: null } })
})
