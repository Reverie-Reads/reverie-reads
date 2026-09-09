import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { Book } from '@reverie/core'
import type { ReadRecord } from '../data/mappers'

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  addRead: vi.fn(),
  chainPrompt: vi.fn(),
  scroll: vi.fn(),
  book: {} as Partial<Book>,
  reads: [] as ReadRecord[] | undefined,
  readsError: false,
  retryReads: vi.fn(),
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createRoute: (options: object) => ({ ...options, useParams: () => ({ bookId: 'active' }) }),
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('../routes/RootRoute', () => ({ rootRoute: {} }))
vi.mock('../components/BackLink', () => ({
  BackLink: ({ children }: { children: React.ReactNode }) => <a href="/library">{children}</a>,
}))
vi.mock('../components/SeriesStrip', () => ({ SeriesStrip: () => null }))
vi.mock('../data/books', () => ({
  useBooks: () => ({
    data: [
      makeBook({
        id: 'active',
        title: 'A current book',
        readStatus: 'Reading',
        progress: 40,
        ...state.book,
      }),
    ],
  }),
  useUpdateBook: () => ({ mutate: state.mutate, mutateAsync: state.mutate, isPending: false }),
  useDeleteBook: () => ({ mutate: vi.fn() }),
}))
vi.mock('../data/reads', () => ({
  useReads: () => ({ data: state.reads, isError: state.readsError, refetch: state.retryReads }),
  useDeleteRead: () => ({ mutate: vi.fn() }),
  useAddRead: () => ({ mutateAsync: state.addRead }),
}))
vi.mock('../data/household', () => ({
  useHouseholdLibraryAuthorization: () => ({ books: [], members: [], authorized: false }),
  useAdoptCorpusWorkMetadata: () => ({ mutate: vi.fn() }),
  useAddPersonalBookToHousehold: () => ({ mutate: vi.fn() }),
  useRemovePersonalBookFromHousehold: () => ({ mutate: vi.fn() }),
}))
vi.mock('../data/listItems', () => ({
  useBookListIds: () => ({ data: [] }),
  useToggleListItem: () => ({ mutate: vi.fn() }),
}))
vi.mock('../data/lists', () => ({
  useLists: () => ({ data: [] }),
  useCreateList: () => ({ mutate: vi.fn() }),
}))
vi.mock('../data/profile', () => ({ useProfile: () => ({ data: null }) }))
vi.mock('../data/coverBackfill', () => ({ useCoverBackfill: () => {} }))
vi.mock('../data/enrichCorpus', () => ({
  useCorpusAdminStatus: () => ({ data: false }),
  usePersonalCoverCorpusReview: () => ({
    data: false,
    isFetching: false,
    isError: false,
    fetchStatus: 'idle',
  }),
  useAdminReviewPersonalCoverForCorpus: () => ({ mutate: vi.fn() }),
}))
vi.mock('./ReviewsPanel', () => ({ ReviewsPanel: () => null }))
vi.mock('./MoreLikeThis', () => ({ MoreLikeThis: () => null }))
vi.mock('./PlanEditor', () => ({ PlanEditor: () => <div>Plan editor</div> }))
vi.mock('../lib/chainPrompt', () => ({ maybeChainPrompt: state.chainPrompt }))
const { BookDetailScreen } = await import('./BookDetailRoute')

beforeEach(() => {
  vi.clearAllMocks()
  Element.prototype.scrollIntoView = state.scroll
  state.book = {}
  state.reads = []
  state.readsError = false
})

describe('book detail reading journey', () => {
  it('brings an actual journal entry ahead of copy management without inventing missing details', () => {
    const view = render(<BookDetailScreen />)
    expect(screen.queryByRole('region', { name: 'From your reading journal' })).toBeNull()
    state.reads = [{ id: 'undated', date: '', format: '', rating: 0, notes: 'A thought I kept.' }]
    view.rerender(<BookDetailScreen />)
    const memory = screen.getByRole('region', { name: 'From your reading journal' })
    expect(within(memory).getByText('Date not set')).toBeInTheDocument()
    expect(within(memory).getByText('A thought I kept.')).toBeInTheDocument()
    expect(within(memory).queryByRole('img')).toBeNull()
    expect(
      within(memory).getByRole('link', { name: 'View your full reading history' }),
    ).toHaveAttribute('href', '#personal-read-log')
    expect(
      memory.compareDocumentPosition(screen.getByRole('region', { name: 'Your copy' })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it('waits for an unknown read log, offers retry on failure, and starts the recovered history as a reread', () => {
    state.book = { readStatus: 'unset', progress: 100 }
    state.reads = undefined
    const view = render(<BookDetailScreen />)
    expect(screen.getByRole('button', { name: 'Loading reading history…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reading' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Start reading' })).not.toBeInTheDocument()
    state.readsError = true
    view.rerender(<BookDetailScreen />)
    expect(screen.getByRole('button', { name: 'Reading history unavailable' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retry reading history' }))
    expect(state.retryReads).toHaveBeenCalledOnce()
    expect(state.mutate).not.toHaveBeenCalled()
    state.readsError = false
    state.reads = [
      { id: 'old', date: '2025-01-02', format: 'Ebook', rating: 4, notes: 'A past read' },
    ]
    view.rerender(<BookDetailScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Read again' }))
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith({
      id: 'active',
      patch: { readStatus: 'Reading', readingNowHidden: false, progress: 0 },
    })
  })

  it('keeps an active read and its progress available while the old read log is unavailable', () => {
    state.reads = undefined
    state.readsError = true
    render(<BookDetailScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Update progress' }))
    expect(screen.getByRole('dialog', { name: 'Update progress' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Progress (%)' })).toHaveValue(40)
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it('groups the preserved controls and saves progress only after confirmation', () => {
    render(<BookDetailScreen />)
    for (const name of ['Your copy', 'Your reading', 'Series and plans', 'More about this book']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
    expect(
      within(screen.getByRole('region', { name: 'Your copy' })).getByRole('radiogroup', {
        name: 'Ownership',
      }),
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'More about this book' })).getByRole('button', {
        name: 'Edit details',
      }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Update progress' }))
    const dialog = screen.getByRole('dialog', { name: 'Update progress' })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Progress (%)' }), {
      target: { value: '55' },
    })
    expect(state.mutate).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save progress' }))
    expect(state.mutate).toHaveBeenCalledExactlyOnceWith(
      { id: 'active', patch: { progress: 55 } },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    )
  })

  it('keeps completing the current read reachable with an optional rating and a dated log', async () => {
    render(<BookDetailScreen />)
    fireEvent.click(screen.getByRole('button', { name: 'Finish this read' }))
    const dialog = screen.getByRole('dialog', { name: 'Finish this read' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save finished read' }))
    expect(state.addRead).toHaveBeenCalledOnce()
    expect(state.addRead.mock.calls[0]?.[0]).toMatchObject({ rating: 0, notes: '' })
    await waitFor(() =>
      expect(state.mutate).toHaveBeenCalledExactlyOnceWith({
        id: 'active',
        patch: { readStatus: 'Read', progress: 100 },
      }),
    )
    expect(state.chainPrompt).toHaveBeenCalledOnce()
  })
})
