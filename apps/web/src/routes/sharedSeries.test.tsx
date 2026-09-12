import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CorpusSeriesCatalogRow } from '../data/corpusSeriesCatalog'

const state = vi.hoisted(() => ({
  data: [] as CorpusSeriesCatalogRow[],
  isLoading: false,
  isError: false,
  refetch: vi.fn(),
}))
vi.mock('../data/corpusSeriesCatalog', () => ({ useCorpusSeriesCatalog: () => state }))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('@tanstack/react-router', () => ({
  createRoute: (options: unknown) => options,
  Link: ({
    to,
    search,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; search: { scope: string } }) => (
    <a href={`${to}?scope=${search.scope}`} {...props}>
      {children}
    </a>
  ),
}))

const { SharedSeriesScreen } = await import('./SharedSeriesRoute')

const makeSeries = (id: string): CorpusSeriesCatalogRow => ({
  id,
  name: 'Shared Lanterns',
  creatorKey: id,
  status: null,
  declaredCount: null,
  state: 'confirmed',
  revision: 1,
  aliases: ['Lantern books'],
  sources: [],
  entries: Array.from({ length: 8 }, (_, i) => ({
    id: `${id}-${i}`,
    workId: null,
    position: i === 7 ? null : i + 1,
    label: i === 6 ? 'Companion' : '',
    title: `${id} book ${i + 1}`,
    author: 'Inez North',
    primary: true,
    source: 'manual',
    evidence: [],
    work: null,
  })),
})

describe('read-only shared series opening', () => {
  beforeEach(() => {
    state.data = [makeSeries('first'), makeSeries('second')]
    state.isLoading = false
    state.isError = false
    state.refetch.mockReset()
  })

  it('selects the exact shared ID and opens all entries, including beyond the six-book preview', () => {
    render(<SharedSeriesScreen seriesId="second" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Shared Lanterns' })).toBeInTheDocument()
    const books = screen.getByRole('list', { name: 'Shared series books' })
    expect(within(books).getAllByRole('listitem')).toHaveLength(8)
    expect(screen.getByRole('heading', { name: 'second book 8' })).toBeInTheDocument()
    expect(screen.queryByText('first book 1')).not.toBeInTheDocument()
    expect(screen.getByText('Position not confirmed')).toBeInTheDocument()
    expect(screen.getByText(/Series length not confirmed/)).toBeInTheDocument()
    expect(screen.getByText('Companion')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to shared catalog' })).toHaveAttribute(
      'href',
      '/series?scope=shared',
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(
      screen.queryByText(/Fetch series data|Rename series|Merge series|Arrange/),
    ).not.toBeInTheDocument()
  })

  it('preserves the explicit declared total and review status', () => {
    state.data[0] = { ...makeSeries('first'), declaredCount: 12, state: 'review' }
    render(<SharedSeriesScreen seriesId="first" />)
    expect(screen.getByText(/12 confirmed in series/)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('awaiting review')
  })

  it('does not fall back to a same-name series when an ID is unavailable', () => {
    render(<SharedSeriesScreen seriesId="missing" />)
    expect(screen.getByRole('heading', { name: 'Shared series unavailable' })).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('waits for data before declaring a missing series', () => {
    state.isLoading = true
    state.data = []
    render(<SharedSeriesScreen seriesId="first" />)
    expect(screen.getByText('Opening the shared series…')).toBeInTheDocument()
    expect(screen.queryByText('Shared series unavailable')).not.toBeInTheDocument()
  })

  it('offers retry on a failed read instead of showing stale catalog details', () => {
    state.isError = true
    render(<SharedSeriesScreen seriesId="first" />)
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(state.refetch).toHaveBeenCalledOnce()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('shows an empty series without inventing slots or a one-book length', () => {
    state.data = [{ ...makeSeries('first'), entries: [] }]
    render(<SharedSeriesScreen seriesId="first" />)
    expect(
      screen.getByText('No books have been linked to this shared series yet.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.getByText(/Series length not confirmed/)).toBeInTheDocument()
  })
})
