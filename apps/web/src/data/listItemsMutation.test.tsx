import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { type ReactNode } from 'react'
import { useAddBooksToList } from './listItems'

const client = vi.hoisted(() => ({
  auth: { getUser: vi.fn(async () => ({ data: { user: null }, error: null })) },
  from: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({ supabase: client }))

it('cannot report a successful TBR save when the reader identity is unavailable', async () => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const onSuccess = vi.fn()
  const { result } = renderHook(() => useAddBooksToList(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  })
  await act(async () => {
    await expect(
      result.current.mutateAsync({ listId: 'shelf', bookIds: ['book'] }, { onSuccess }),
    ).rejects.toThrow('Sign in again')
  })
  expect(onSuccess).not.toHaveBeenCalled()
  expect(client.from).not.toHaveBeenCalled()
  queryClient.clear()
})
