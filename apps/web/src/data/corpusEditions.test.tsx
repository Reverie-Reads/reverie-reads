import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { useReportCorpusIsbn } from './corpusEditions'
const state = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: state.rpc } }))
afterEach(() => { onlineManager.setOnline(true); vi.clearAllMocks() })
it('reports an offline write failure immediately instead of queuing a catalog report for later', async () => {
  onlineManager.setOnline(false)
  state.rpc.mockResolvedValue({ data: null, error: { message: 'Network unavailable' } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { result } = renderHook(() => useReportCorpusIsbn(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
  await act(async () => {
    await expect(result.current.mutateAsync({ workId: 'work', isbn: '9780306406157', proposedIsbn: '', note: 'Check the binding' })).rejects.toEqual({ message: 'Network unavailable' })
  })
  expect(state.rpc).toHaveBeenCalledOnce()
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(result.current.isPaused).toBe(false)
  onlineManager.setOnline(true)
  await act(async () => { await client.resumePausedMutations() })
  expect(state.rpc).toHaveBeenCalledOnce()
})
