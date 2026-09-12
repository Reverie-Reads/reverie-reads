import type { ComponentType } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { ImportExportResult } from '../data/importLibrary'

const state = vi.hoisted(() => ({
  books: [] as Book[] | undefined,
  isPending: false,
  isFetching: false,
  isError: false,
  navigate: vi.fn(),
  importFile: vi.fn(),
  convert: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  setSkin: vi.fn(),
  setMode: vi.fn(),
  guestImport: vi.fn(),
  updateProfile: vi.fn(),
  authorized: false,
}))
vi.mock('@tanstack/react-router', () => ({
  createRoute: (options: unknown) => ({ options }),
  useNavigate: () => state.navigate,
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate, getQueryData: () => undefined }),
}))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../data/readerBooks', () => ({
  useReaderBooks: () => ({
    data: state.books,
    isPending: state.isPending,
    isFetching: state.isFetching,
    isError: state.isError,
    refetch: state.refetch,
  }),
}))
vi.mock('../data/importLibrary', () => ({ importDetectedExport: state.importFile }))
vi.mock('../data/guestHandoff', () => ({ importGuestHandoff: state.guestImport }))
vi.mock('../data/profile', () => ({
  profileKey: ['profile'],
  useProfile: () => ({ data: { guidance: { mode: 'full', setupComplete: true } } }),
  useUpdateProfile: () => ({ mutateAsync: state.updateProfile }),
}))
vi.mock('../guidance/data', () => ({
  useUpdateGuidance: () => ({
    mutate: (_patch: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.(),
  }),
}))
vi.mock('../data/importEnrich', () => ({ enrichImported: vi.fn() }))
vi.mock('../data/xlsxAdapter', () => ({ fileToCsvText: state.convert }))
vi.mock('../skin/controls', () => ({
  useSkinControls: () => ({ setSkin: state.setSkin, setMode: state.setMode }),
}))
vi.mock('../skin/labels', () => ({
  useEffectiveSkin: () => 'folio',
  useVoice: () => ({ loading: 'Bringing in your books.' }),
}))
vi.mock('../skin/useSkin', () => ({ useSkin: () => 'folio' }))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: { user: { id: 'reader' } } }),
}))
vi.mock('../data/household', () => ({
  useHouseholdLibraryAuthorization: () => ({
    authorized: state.authorized,
    members: state.authorized ? [{ userId: 'reader', displayName: 'Reader' }] : [],
  }),
}))
vi.mock('../components/AddDestinationPicker', () => ({
  AddDestinationPicker: ({
    value,
    onChange,
  }: {
    value: string
    onChange: (value: string) => void
  }) => (
    <label>
      Import destination
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="mine">My library</option>
        <option value="both">My library + Household</option>
      </select>
    </label>
  ),
}))
vi.mock('../components/DuplicateReview', () => ({
  DuplicateReview: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>Resolve duplicate review</button>
  ),
}))

const { onboardingRoute } = await import('./OnboardingRoute')
const Onboarding = onboardingRoute.options.component as ComponentType
const result = (overrides: Partial<ImportExportResult> = {}): ImportExportResult => ({
  profile: 'generic',
  added: 1,
  merged: 0,
  review: [],
  ingested: [],
  ignoredGlobalOrder: 0,
  outcomes: [],
  truncatedIsbns: 0,
  bookIds: ['new'],
  extras: {
    tbrPlaced: 0,
    shelvesCreated: [],
    shelved: 0,
    noCover: 0,
    noIsbn: 0,
    unplacedNotes: 0,
    tropeLikeShelves: [],
  },
  ...overrides,
})
function upload() {
  fireEvent.change(screen.getByLabelText('Import library file'), {
    target: { files: [new File(['Title\nNew'], 'books.csv', { type: 'text/csv' })] },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  state.books = []
  state.isPending = false
  state.isFetching = false
  state.isError = false
  state.authorized = false
  state.convert.mockResolvedValue('Title\nNew')
  state.invalidate.mockResolvedValue(undefined)
  state.importFile.mockResolvedValue(result())
  state.guestImport.mockResolvedValue({
    added: 2,
    merged: 0,
    unchanged: 0,
    review: [],
    bookIds: ['guest-a', 'guest-b'],
    draftNotes: 0,
  })
})

describe('book-first onboarding', () => {
  it('reviews an explicit guest handoff before importing and applies its room', async () => {
    localStorage.setItem(
      'reverie.guest-handoff.v1',
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        skin: 'aphelion',
        mode: 'dark',
        dock: ['library', 'next'],
        books: [
          { incoming: { title: 'Jane Eyre', first: 'Charlotte', last: 'Brontë', reads: [] } },
          {
            incoming: {
              title: 'The Left Hand of Darkness',
              first: 'Ursula',
              last: 'Le Guin',
              reads: [],
            },
          },
        ],
      }),
    )
    render(<Onboarding />)
    expect(
      screen.getByRole('heading', { name: 'Bring this little library home.' }),
    ).toBeInTheDocument()
    expect(state.guestImport).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add books and this arrangement' }))
    expect(await screen.findByRole('heading', { name: 'Your books are here.' })).toBeInTheDocument()
    expect(state.guestImport).toHaveBeenCalledWith(expect.any(Object), [], { autoMerge: true })
    expect(state.setSkin).toHaveBeenCalledWith('aphelion')
    expect(state.setMode).toHaveBeenCalledWith('dark')
    expect(state.updateProfile).toHaveBeenCalledWith({
      arrangement: {
        destinations: ['library', 'match', 'home'],
        homeModules: ['priority', 'next-read'],
      },
    })
    expect(localStorage.getItem('reverie.guest-handoff.v1')).toBeNull()
  })

  it('lets the reader cancel a pending guest handoff without writing', () => {
    localStorage.setItem(
      'reverie.guest-handoff.v1',
      JSON.stringify({
        version: 1,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        skin: 'folio',
        mode: 'light',
        dock: ['library'],
        books: [{ incoming: { title: 'Jane Eyre', reads: [] } }],
      }),
    )
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Start without them' }))
    expect(screen.getByRole('heading', { name: 'Start with some books.' })).toBeInTheDocument()
    expect(state.guestImport).not.toHaveBeenCalled()
    expect(localStorage.getItem('reverie.guest-handoff.v1')).toBeNull()
  })

  it('acknowledges a saved import while refresh is pending and waits for actual reading choices', async () => {
    state.invalidate.mockReturnValue(new Promise(() => {}))
    const view = render(<Onboarding />)
    upload()
    expect(await screen.findByRole('heading', { name: 'Your books are here.' })).toBeInTheDocument()
    state.isFetching = true
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }))
    expect(screen.getByRole('heading', { name: 'Checking your library…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a book' })).not.toBeInTheDocument()
    state.isFetching = false
    state.isError = true
    view.rerender(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.refetch).toHaveBeenCalledOnce()
    expect(state.importFile).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Open my library' })).toBeEnabled()
  })

  it('offers import and Add immediately, and room preview is optional without resetting the skin', () => {
    render(<Onboarding />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Start with some books.')
    expect(screen.getByRole('button', { name: 'Import a file' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Add a book' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Preview a room' }))
    expect(screen.getByText(/not your reading preferences/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to your books' }))
    expect(state.setSkin).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add a book' }))
    expect(state.navigate).toHaveBeenCalledWith({ to: '/add', replace: true })
    expect(localStorage.getItem('reverie.onboarded')).toBe('1')
    expect(state.importFile).not.toHaveBeenCalled()
  })

  it('uses actual imported candidates for completion and preserves the selected personal destination', async () => {
    state.authorized = true
    state.importFile.mockImplementation(async () => {
      state.books = [
        makeBook({ id: 'new', title: 'New Book', borrowed: true, ownership: 'unowned' }),
      ]
      return result({ added: 1, merged: 2 })
    })
    render(<Onboarding />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Import destination' }), {
      target: { value: 'mine' },
    })
    upload()
    expect(await screen.findByRole('heading', { name: 'Your books are here.' })).toBeInTheDocument()
    expect(screen.getByText(/brought in 1 new, and folded 2 into what you had/)).toBeInTheDocument()
    expect(state.importFile).toHaveBeenCalledWith([], 'Title\nNew', {
      autoMerge: true,
      addToHousehold: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue →' }))
    expect(screen.getByText(/1 unread book is marked owned or borrowed/)).toBeInTheDocument()
    expect(screen.queryByText(/Add your first book/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Choose a next read' }))
    expect(state.navigate).toHaveBeenCalledWith({ to: '/match', replace: true })
  })

  it('keeps post-write duplicate review before completion', async () => {
    state.importFile.mockResolvedValue(
      result({
        review: [
          {
            incoming: { title: 'New Book' },
            existingId: 'existing',
            existingTitle: 'Near Book',
            existingAuthor: 'Author',
            strength: 'fuzzy',
          },
        ],
      }),
    )
    render(<Onboarding />)
    upload()
    expect(
      await screen.findByRole('button', { name: 'Resolve duplicate review' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Continue →' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Resolve duplicate review' }))
    expect(
      screen.getByRole('heading', { name: 'Start with a book you want to read.' }),
    ).toBeInTheDocument()
  })

  it('continues an actual current read even when it is not owned', () => {
    state.books = [
      makeBook({
        id: 'reading',
        title: 'Current Read',
        ownership: 'unowned',
        readStatus: 'Reading',
      }),
    ]
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue without importing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue reading' }))
    expect(state.navigate).toHaveBeenCalledWith({
      to: '/book/$bookId',
      params: { bookId: 'reading' },
      replace: true,
    })
  })

  it('offers possession review when imported personal records are not available', () => {
    state.books = [makeBook({ id: 'wish', title: 'Wish', ownership: 'unowned', wishlist: true })]
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue without importing' }))
    expect(screen.getByText(/Check which books you own or have borrowed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose a next read' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review your library' }))
    expect(state.navigate).toHaveBeenCalledWith({ to: '/library', replace: true })
  })

  it('reports conversion failure as unchanged, but a stopped importer as possibly partially saved', async () => {
    state.convert.mockRejectedValueOnce(new Error('Unsupported file'))
    render(<Onboarding />)
    upload()
    expect(await screen.findByRole('alert')).toHaveTextContent('Your library has not changed.')
    expect(state.importFile).not.toHaveBeenCalled()
    state.importFile.mockRejectedValueOnce(new Error('Connection interrupted'))
    upload()
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Some books may already have been saved.',
      ),
    )
    expect(screen.getByRole('button', { name: 'Check your library' })).toBeEnabled()
    expect(state.invalidate).toHaveBeenCalled()
  })

  it('waits for the existing library before importing so duplicate matching has its real context', async () => {
    state.books = undefined
    state.isPending = true
    const { rerender } = render(<Onboarding />)
    expect(screen.getByRole('button', { name: 'Import a file' })).toBeDisabled()
    upload()
    expect(state.convert).not.toHaveBeenCalled()
    const existing = makeBook({ id: 'existing', title: 'Existing Book' })
    state.books = [existing]
    state.isPending = false
    rerender(<Onboarding />)
    expect(screen.getByRole('button', { name: 'Import a file' })).toBeEnabled()
    upload()
    await screen.findByRole('heading', { name: 'Your books are here.' })
    expect(state.importFile).toHaveBeenCalledWith([existing], 'Title\nNew', {
      autoMerge: true,
      addToHousehold: false,
    })
  })

  it('does not claim an empty library while completion is still loading', () => {
    state.books = undefined
    state.isPending = true
    render(<Onboarding />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue without importing' }))
    expect(screen.getByRole('heading', { name: 'Checking your library…' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add a book' })).not.toBeInTheDocument()
  })
})
