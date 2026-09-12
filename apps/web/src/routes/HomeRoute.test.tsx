import { type ComponentType } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { HomeModuleId } from '../design/arrangements'

const state = vi.hoisted(() => ({
  books: [] as Book[] | undefined,
  isPending: false,
  isError: false,
  listeners: new Set<() => void>(),
  navigate: vi.fn(),
  refetch: vi.fn(),
  update: vi.fn(),
  goalTarget: 0,
  homeModules: ['next-read', 'reading', 'priority'] as HomeModuleId[],
}))
vi.mock('@tanstack/react-router', () => ({
  createRoute: (options: unknown) => ({ options }),
  useNavigate: () => state.navigate,
}))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../data/readerBooks', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useReaderBooks: () => ({
      data: useSyncExternalStore(
        (listener) => {
          state.listeners.add(listener)
          return () => state.listeners.delete(listener)
        },
        () => state.books,
      ),
      isPending: state.isPending,
      isError: state.isError,
      refetch: state.refetch,
    }),
  }
})
vi.mock('../data/books', () => ({
  useUpdateBook: () => ({ mutate: state.update, isPending: false, isError: false, reset: vi.fn() }),
}))
vi.mock('../data/reads', () => ({ useAllReads: () => ({ data: [] }) }))
vi.mock('../data/lists', () => ({ useLists: () => ({ data: [] }) }))
vi.mock('../data/listItems', () => ({
  useAllListItems: () => ({ data: [] }),
  useAddListItem: () => ({ mutate: vi.fn() }),
}))
vi.mock('../data/profile', () => ({
  useProfile: () => ({
    data: {
      displayName: 'private-email-prefix',
      goalYear: new Date().getFullYear(),
      goalTarget: state.goalTarget,
      arrangement: {
        destinations: ['home', 'match', 'library'],
        homeModules: state.homeModules,
      },
    },
  }),
  useUpdateProfile: () => ({ mutate: vi.fn() }),
}))
vi.mock('../skin/labels', () => ({
  useVoice: () => ({ milestone: 'Goal reached.', season: 'Your year.' }),
  useEffectiveSkin: () => 'folio',
}))
vi.mock('../components/CoverImage', () => ({ CoverImage: () => null }))
vi.mock('../components/LibraryPicker', () => ({
  LibraryPicker: ({
    books,
    excludeIds,
    onPick,
  }: {
    books: Book[]
    excludeIds: Set<string>
    onPick: (book: Book) => void
  }) => (
    <div role="dialog" aria-label="Choose a current read">
      {books
        .filter((book) => !excludeIds.has(book.id))
        .map((book) => (
          <button key={book.id} onClick={() => onPick(book)}>
            Read {book.title}
          </button>
        ))}
    </div>
  ),
}))
vi.mock('../components/ExternalSearchSheet', () => ({ ExternalSearchSheet: () => null }))
vi.mock('../components/SpineShelf', () => ({ SpineShelf: () => null }))
vi.mock('../book/dialogs', () => ({
  LogReadForm: ({ book, onClose }: { book: Book; onClose: () => void }) => (
    <button
      onClick={() => {
        state.update({ id: book.id, patch: { readStatus: 'Read', progress: 100 } })
        onClose()
      }}
    >
      Save completed read
    </button>
  ),
}))

const { homeRoute } = await import('./HomeRoute')
const Home = homeRoute.options.component as ComponentType

beforeEach(() => {
  vi.clearAllMocks()
  state.books = []
  state.goalTarget = 0
  state.homeModules = ['next-read', 'reading', 'priority']
  state.isPending = false
  state.isError = false
  state.update.mockImplementation(
    ({ id, patch }: { id: string; patch: Partial<Book> }, options?: { onSuccess?: () => void }) => {
      state.books = state.books?.map((book) => (book.id === id ? { ...book, ...patch } : book))
      state.listeners.forEach((listener) => listener())
      options?.onSuccess?.()
    },
  )
})

describe('Home reading flow', () => {
  it('renders modules in the saved order', () => {
    state.books = [
      makeBook({ id: 'current', title: 'Current Book', readStatus: 'Reading', progress: 20 }),
    ]
    state.goalTarget = 20
    state.homeModules = ['reading', 'next-read', 'year']
    render(<Home />)
    const reading = screen.getByText('Reading now')
    const next = screen.getByRole('heading', { name: 'Choose a next read' })
    const goal = screen.getByRole('heading', { name: 'Your reading year' })
    expect(reading.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(next.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome back.')
    expect(screen.queryByText(/private-email-prefix/)).not.toBeInTheDocument()
  })

  it('omits hidden Home modules without changing their underlying books', () => {
    state.books = [
      makeBook({ id: 'current', title: 'Current Book', readStatus: 'Reading', progress: 20 }),
    ]
    state.goalTarget = 20
    state.homeModules = ['year']

    render(<Home />)

    expect(screen.getByRole('heading', { name: 'Your reading year' })).toBeInTheDocument()
    expect(screen.queryByText('Reading now')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Choose a next read' })).not.toBeInTheDocument()
    expect(state.books[0]).toMatchObject({ id: 'current', readStatus: 'Reading', progress: 20 })
  })

  it('updates visible progress and removes a finished book from Reading now', async () => {
    state.books = [
      makeBook({ id: 'current', title: 'Current Book', readStatus: 'Reading', progress: 20 }),
    ]
    render(<Home />)
    fireEvent.click(screen.getByRole('button', { name: 'Update progress for Current Book' }))
    const progressDialog = screen.getByRole('dialog', { name: 'Update progress' })
    fireEvent.change(progressDialog.querySelector('input[type="number"]')!, {
      target: { value: '25' },
    })
    expect(state.update).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save progress' }))
    expect(await screen.findByText('Progress saved at 25%.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish this read' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save completed read' }))
    await waitFor(() => expect(screen.getByText(/Nothing is underway/)).toBeInTheDocument())
    expect(screen.getByRole('heading', { name: 'Choose a next read' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Surprise me' })).not.toBeInTheDocument()
  })

  it('starts a finished book from the Reading now picker at zero without losing its past reads', async () => {
    const history = [{ date: '2026-01-02', format: 'Paperback', rating: 4, notes: 'Earlier read' }]
    state.books = [
      makeBook({ id: 'current', title: 'Current Book', readStatus: 'Reading', progress: 30 }),
      makeBook({
        id: 'finished',
        title: 'Finished Book',
        readStatus: 'Read',
        progress: 100,
        reads: history,
      }),
    ]
    render(<Home />)
    fireEvent.click(screen.getByRole('button', { name: '＋ Add' }))
    fireEvent.click(screen.getByRole('button', { name: 'Read Finished Book' }))
    expect(
      await screen.findByRole('button', { name: 'Update progress for Finished Book' }),
    ).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(state.books?.find((book) => book.id === 'finished')).toMatchObject({
      readStatus: 'Reading',
      progress: 0,
      reads: history,
      readingNowHidden: false,
    })
  })

  it('uses the same available candidates for Surprise as Next read', () => {
    state.books = [
      makeBook({ id: 'wish', title: 'Wishlist', ownership: 'unowned', wishlist: true }),
      makeBook({
        id: 'latent',
        title: 'Latent format',
        ownership: 'unowned',
        owned: { physical: false, ebook: true, audiobook: false },
      }),
      makeBook({ id: 'dnf', title: 'Abandoned', readStatus: 'DNF' }),
      makeBook({ id: 'read', title: 'Finished', readStatus: 'Read' }),
      makeBook({
        id: 'borrowed',
        title: 'Available Book',
        ownership: 'unowned',
        borrowed: true,
        readStatus: 'unset',
      }),
    ]
    render(<Home />)
    expect(screen.getByText(/1 unread book is marked owned or borrowed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Surprise me' }))
    expect(state.navigate).toHaveBeenCalledWith({
      to: '/book/$bookId',
      params: { bookId: 'borrowed' },
    })
    expect(screen.queryByRole('heading', { name: 'Your reading year' })).not.toBeInTheDocument()
  })

  it('replaces an impossible surprise with library review', () => {
    state.books = [
      makeBook({ id: 'wish', title: 'Wishlist', ownership: 'unowned', wishlist: true }),
    ]
    render(<Home />)
    expect(screen.getByText(/No new unread books are marked owned or borrowed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Surprise me' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review your library' }))
    expect(state.navigate).toHaveBeenCalledWith({ to: '/library' })
  })

  it('does not describe a pending or failed query as an empty library', () => {
    state.books = undefined
    state.isPending = true
    const { rerender } = render(<Home />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading your library')
    expect(
      screen.queryByRole('heading', { name: 'Start with a book you want to read.' }),
    ).not.toBeInTheDocument()
    state.isPending = false
    state.isError = true
    rerender(<Home />)
    expect(screen.getByRole('alert')).toHaveTextContent('Your library could not be loaded.')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.refetch).toHaveBeenCalledOnce()
  })
})
