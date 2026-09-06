import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SKIN_VOICE, type SkinId } from '@reverie/core'

const state = vi.hoisted(() => ({
  search: {} as { genre?: string; query?: string; browse?: boolean },
  skin: 'tryst' as SkinId,
  browse: vi.fn(),
  fetchDiscover: vi.fn(async () => []),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  createRoute: (options: object) => ({ ...options, useSearch: () => state.search }),
  useNavigate: () => state.navigate,
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../skin/labels', () => ({
  useEffectiveSkin: () => state.skin,
  useVoice: () => SKIN_VOICE[state.skin],
}))
vi.mock('../data/books', () => ({ useBooks: () => ({ data: [] }) }))
vi.mock('../data/works', () => ({
  useWorksBrowse: (filters: unknown) => {
    state.browse(filters)
    return { data: { pages: [] }, isSuccess: true }
  },
  workToHit: (work: unknown) => work,
}))
vi.mock('../data/taste', () => ({ useTasteCalibration: () => ({ data: null }) }))
vi.mock('../lib/discover', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/discover')>()),
  fetchDiscover: state.fetchDiscover,
}))

const { DiscoverScreen } = await import('./DiscoverRoute')

beforeEach(() => {
  vi.clearAllMocks()
  state.search = { browse: true }
  state.skin = 'tryst'
  state.navigate.mockImplementation(({ search }: { search: typeof state.search }) => {
    state.search = search
  })
})

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={client}>
      <DiscoverScreen />
    </QueryClientProvider>
  )
  const view = render(tree())
  return { rerender: () => view.rerender(tree()), client }
}

describe('Discover content is independent of appearance', () => {
  it('catalog browse opens the full corpus without fetching a skin-selected genre and stays neutral after a room change', async () => {
    const view = mount()
    expect(screen.getByRole('button', { name: 'All genres' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(state.browse).toHaveBeenLastCalledWith({ genre: '', tag: '', q: '' })
    expect(screen.getByText(/Choose a genre to see new and notable books/)).toBeInTheDocument()
    state.skin = 'grimoire'
    view.rerender()
    await waitFor(() =>
      expect(state.browse).toHaveBeenLastCalledWith({ genre: '', tag: '', q: '' }),
    )
    expect(screen.getByRole('button', { name: 'All genres' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(state.fetchDiscover).not.toHaveBeenCalled()
  })

  it('records an explicit genre even when it matches the room and retains it after changing rooms', async () => {
    const view = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Romance' }))
    view.rerender()
    await waitFor(() =>
      expect(state.fetchDiscover).toHaveBeenCalledWith('romance', expect.any(AbortSignal)),
    )
    expect(state.search.genre).toBe('romance')
    state.skin = 'aphelion'
    view.rerender()
    expect(screen.getByRole('button', { name: 'Romance' })).toHaveAttribute('aria-pressed', 'true')
    expect(state.browse).toHaveBeenLastCalledWith({ genre: 'romance', tag: '', q: '' })
    expect(state.fetchDiscover).toHaveBeenCalledOnce()
  })

  it('honors a deep-linked genre and lets the reader deliberately return to All genres', async () => {
    state.search = { genre: 'mystery' }
    const view = mount()
    await waitFor(() =>
      expect(state.fetchDiscover).toHaveBeenCalledWith('mystery', expect.any(AbortSignal)),
    )
    expect(screen.getByRole('button', { name: 'Mystery' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'All genres' }))
    view.rerender()
    expect(state.browse).toHaveBeenLastCalledWith({ genre: '', tag: '', q: '' })
    expect(screen.getByRole('button', { name: 'All genres' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(state.fetchDiscover).toHaveBeenCalledOnce()
  })
})
