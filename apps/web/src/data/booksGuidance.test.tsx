import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
const state = vi.hoisted(() => ({ select: vi.fn(), response: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => {
  const chain = { select: (fields: string) => { state.select(fields); return chain }, is: () => chain,
    order: () => chain, range: () => chain, returns: () => state.response() }
  return chain
} } }))
const { useBooks } = await import('./books')
function load() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderHook(() => useBooks(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> })
}
beforeEach(() => { vi.clearAllMocks() })
it('falls back only when new shared guidance columns are not yet deployed', async () => {
  state.response.mockResolvedValueOnce({ data: null, error: { code: '42703', message: 'column works.shared_spice does not exist' }, count: null })
    .mockResolvedValueOnce({ data: [], error: null, count: 0 })
  const { result } = load()
  await waitFor(() => expect(result.current.isSuccess).toBe(true))
  expect(state.select.mock.calls[0]?.[0]).toContain('corpus_guidance:works!corpus_work_id')
  expect(state.select.mock.calls[1]?.[0]).not.toContain('shared_spice')
  expect(result.current.data).toEqual([])
})
it.each(['42501', 'PGRST000'])('never disguises %s as an absent guidance field', async (code) => {
  state.response.mockResolvedValue({ data: null, error: { code, message: 'Query failed for shared_spice' }, count: null })
  const { result } = load()
  await waitFor(() => expect(result.current.isError).toBe(true))
  expect(state.select).toHaveBeenCalledTimes(1)
  expect(result.current.data).toBeUndefined()
})
