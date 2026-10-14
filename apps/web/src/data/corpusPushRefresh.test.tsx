import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'
import { seriesListKey } from './series'
import { usePushCorpusRecord, type CorpusRecord } from './corpusEditions'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('../auth/AuthProvider', () => ({ useAuth: () => ({ session: null }) }))

it('refreshes an already mounted personal series browser after a successful corpus push', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  const read = vi.fn().mockResolvedValueOnce('old relationship').mockResolvedValue('published relationship')
  rpc.mockResolvedValue({ data: 'work', error: null })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  const { result, unmount } = renderHook(() => ({
    series: useQuery({ queryKey: seriesListKey, queryFn: read }),
    push: usePushCorpusRecord(),
  }), { wrapper })
  await waitFor(() => expect(result.current.series.data).toBe('old relationship'))
  const record: CorpusRecord = { id: 'work', title: 'Book', author: 'Author', description: null,
    genre: null, genres: [], subgenre: null, subgenres: [], spice: null, darkness: null,
    guidanceSource: null, isbns: [], fingerprint: 'frozen', editions: [], reports: [], history: [] }
  await act(async () => {
    await result.current.push.mutateAsync({ record, reviewMode: 'direct', sourceUrl: '', note: '',
      changes: [{ action: 'series', value: { bookId: 'book', name: 'Saga', position: 1, count: 3, status: 'ongoing' } }] })
  })
  await waitFor(() => expect(result.current.series.data).toBe('published relationship'))
  expect(read).toHaveBeenCalledTimes(2)
  unmount()
  client.clear()
})
