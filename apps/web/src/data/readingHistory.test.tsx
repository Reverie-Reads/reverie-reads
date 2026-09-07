import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { AllReadRow } from './reads'

const state = vi.hoisted(() => ({ reads: [] as AllReadRow[], hold: undefined as Promise<void> | undefined, error: null as Error | null }))
vi.mock('./books', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useBooks: () => useQuery({ queryKey: ['books'], queryFn: async () => [makeBook({ id: 'book', title: 'A book' })] }) }
})
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const query = {
    select: () => query,
    order: () => query,
    range: async (from: number, to: number) => { await state.hold; return { data: state.reads.slice(from, to + 1), count: state.reads.length, error: state.error } },
  }
  return query
} } }))
const { useReadingHistory } = await import('./readingHistory')
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}
beforeEach(() => { state.reads = []; state.hold = undefined; state.error = null })

it('does not turn pending or failed logs into zero reads, and recovers after refetch', async () => {
  let release!: () => void
  state.hold = new Promise<void>((resolve) => { release = resolve })
  const { client, wrapper } = harness()
  const { result } = renderHook(() => useReadingHistory(), { wrapper })
  await waitFor(() => expect(client.getQueryState(['books'])?.status).toBe('success'))
  expect(result.current.data).toBeUndefined()
  state.error = new Error('Unavailable')
  await act(async () => { release() })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.data).toBeUndefined()
  state.error = null
  state.reads = [{ id: 'read', book_id: 'book', read_on: null, format: 'Audiobook', rating: null, notes: 'A saved note' }]
  await act(async () => { await result.current.refetch() })
  await waitFor(() => expect(result.current.data?.records).toHaveLength(1))
  expect(result.current.data?.records[0]).toMatchObject({ bookId: 'book', format: 'Audiobook', finished: { y: null, m: null, d: null } })
  expect(result.current.isError).toBe(false)
})

it('keeps last loaded history visible with an error when a refresh fails', async () => {
  state.reads = [{ id: 'read', book_id: 'book', read_on: '2026-01-01', format: null, rating: null, notes: null }]
  const { wrapper } = harness()
  const { result } = renderHook(() => useReadingHistory(), { wrapper })
  await waitFor(() => expect(result.current.data?.records).toHaveLength(1))
  state.error = new Error('Offline')
  await act(async () => { await result.current.refetch() })
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.data?.records).toHaveLength(1)
})


it('reports an offline first load as paused rather than an empty history', async () => {
  onlineManager.setOnline(false)
  const { wrapper, client } = harness()
  const { result, unmount } = renderHook(() => useReadingHistory(), { wrapper })
  try {
    await waitFor(() => expect(result.current.isPaused).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(result.current.isError).toBe(false)
  } finally {
    unmount()
    client.clear()
    onlineManager.setOnline(true)
  }
})
