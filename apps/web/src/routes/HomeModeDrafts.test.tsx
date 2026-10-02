import type { ComponentType, ReactNode } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import { ReadingModeProvider } from '../design/ReadingMode'
import { keyFor, useReadingMode, type ReadingMode } from '../design/useReadingMode'

const state = vi.hoisted(() => ({
  books: [] as Book[],
  update: vi.fn(),
  addRead: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  createRoute: (options: unknown) => ({ options }),
  useNavigate: () => state.navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../data/readerBooks', () => ({
  useReaderBooks: () => ({ data: state.books, isPending: false, isError: false }),
}))
vi.mock('../data/books', () => ({
  useBooks: () => ({ data: state.books }),
  useUpdateBook: () => ({ mutate: state.update, mutateAsync: state.update, reset: vi.fn() }),
}))
vi.mock('../data/reads', () => ({
  useAllReads: () => ({ data: [] }),
  useAddRead: () => ({ mutateAsync: state.addRead }),
}))
vi.mock('../data/lists', () => ({ useLists: () => ({ data: [] }) }))
vi.mock('../data/listItems', () => ({
  useAllListItems: () => ({ data: [] }),
  useAddListItem: () => ({ mutate: vi.fn() }),
}))
vi.mock('../data/profile', () => ({
  useProfile: () => ({
    data: {
      guidance: { mode: 'full', setupComplete: true },
      arrangement: { destinations: ['home', 'library', 'match'], homeModules: ['reading'] },
    },
  }),
  useUpdateProfile: () => ({ mutate: vi.fn() }),
}))
vi.mock('../data/contributors', () => ({ useSetContributors: vi.fn() }))
vi.mock('../data/series', () => ({ useSyncBookSeries: vi.fn() }))
vi.mock('../data/mergeBooks', () => ({ usePerformMerge: vi.fn() }))
vi.mock('../skin/labels', () => ({
  useVoice: () => ({}),
  useLabels: () => ({}),
  useEffectiveSkin: () => 'folio',
}))
vi.mock('../components/CoverImage', () => ({ CoverImage: () => null }))
vi.mock('../components/SpineShelf', () => ({ SpineShelf: () => null }))
vi.mock('../components/LibraryPicker', () => ({ LibraryPicker: () => null }))
vi.mock('../components/ExternalSearchSheet', () => ({ ExternalSearchSheet: () => null }))
vi.mock('../book/ContributorEditor', () => ({ ContributorEditor: () => null }))
vi.mock('../book/OwnedCopies', () => ({ OwnedCopies: () => null }))
vi.mock('../book/EditionCopies', () => ({ EditionCopies: () => null }))
vi.mock('../components/MoodPicker', () => ({ MoodPicker: () => null }))
vi.mock('../guidance/BookTour', () => ({ StartBookTour: () => null }))

const { homeRoute } = await import('./HomeRoute')
const Home = homeRoute.options.component as ComponentType

function ModeProbe() {
  return <output aria-label="Interface mode">{useReadingMode().mode}</output>
}
function renderHome() {
  render(
    <ReadingModeProvider key="reader" accountId="reader">
      <ModeProbe />
      <Home />
    </ReadingModeProvider>,
  )
}
function otherTabMode(account: string, mode: ReadingMode) {
  const key = keyFor(account)
  const value = JSON.stringify({ version: 1, mode })
  act(() => {
    localStorage.setItem(key, value)
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: value }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  state.books = [
    makeBook({ id: 'current', title: 'The Quiet Book', readStatus: 'Reading', progress: 20 }),
  ]
})

describe('Home tasks across interface changes', () => {
  it('keeps the actual progress form and its unsaved entry until explicitly closed', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Update progress for The Quiet Book' }))
    const dialog = screen.getByRole('dialog', { name: 'Update progress' })
    const entry = within(dialog).getByRole('spinbutton', { name: 'Progress (%)' })
    fireEvent.change(entry, { target: { value: '47' } })

    otherTabMode('another-reader', 'bearded')
    expect(screen.getByLabelText('Interface mode')).toHaveTextContent('standard')
    otherTabMode('reader', 'bearded')
    expect(screen.getByLabelText('Interface mode')).toHaveTextContent('bearded')
    expect(screen.getByRole('dialog', { name: 'Update progress' })).toBe(dialog)
    expect(entry).toHaveValue(47)
    expect(entry).toBeVisible()
    otherTabMode('reader', 'standard')
    otherTabMode('reader', 'bearded')
    expect(within(dialog).getByRole('spinbutton', { name: 'Progress (%)' })).toBe(entry)
    expect(entry).toHaveValue(47)
    expect(state.update).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your library.' })).toBeVisible()
  })

  it('keeps the actual finish note, date and format through an account-matched mode change', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: 'Finish this read' }))
    const dialog = screen.getByRole('dialog', { name: 'Finish this read' })
    const notes = within(dialog).getByLabelText('Your thoughts on this read')
    fireEvent.change(notes, { target: { value: 'A thought I have not saved.' } })
    fireEvent.change(within(dialog).getByLabelText('Date finished'), {
      target: { value: '2026-09-25' },
    })
    fireEvent.change(within(dialog).getByLabelText('Format'), { target: { value: 'eBook' } })

    otherTabMode('reader', 'bearded')
    expect(screen.getByRole('dialog', { name: 'Finish this read' })).toBe(dialog)
    expect(within(dialog).getByLabelText('Your thoughts on this read')).toBe(notes)
    expect(notes).toHaveValue('A thought I have not saved.')
    expect(notes).toBeVisible()
    expect(within(dialog).getByLabelText('Date finished')).toHaveValue('2026-09-25')
    expect(within(dialog).getByLabelText('Format')).toHaveValue('eBook')
    expect(state.addRead).not.toHaveBeenCalled()
    expect(state.update).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Your library.' })).toBeVisible()
  })
})
