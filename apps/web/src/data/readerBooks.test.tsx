import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextReadCandidates, type Book } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { AllReadRow } from './reads'

const state = vi.hoisted(() => ({
  books: [] as Book[],
  reads: [] as AllReadRow[],
  hold: undefined as Promise<void> | undefined,
  readError: null as Error | null,
  nextId: 1,
}))
vi.mock('./books', async () => {
  const { useQuery } = await import('@tanstack/react-query')
  return { useBooks: () => useQuery({ queryKey: ['books'], queryFn: async () => state.books }) }
})
vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'reader' } } }) },
    from: (table: string) => {
      if (table !== 'reads') throw new Error(`Unexpected table ${table}`)
      const query = {
        select: () => query,
        order: () => query,
        range: async (from: number, to: number) => {
          await state.hold
          return { data: state.reads.slice(from, to + 1), count: state.reads.length, error: state.readError }
        },
        insert: async (row: Omit<AllReadRow, 'id'>) => {
          state.reads = [...state.reads, { ...row, id: `read-${state.nextId++}` }]
          return { error: null }
        },
        delete: () => ({
          eq: async (_column: string, id: string) => {
            state.reads = state.reads.filter((row) => row.id !== id)
            return { error: null }
          },
        }),
      }
      return query
    },
  },
}))

const { useReaderBooks } = await import('./readerBooks')
const { useSaveReadEntry, useDeleteRead } = await import('./reads')
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

beforeEach(() => {
  state.books = [makeBook({ id: 'book', title: 'A Book', readStatus: 'Unread', reads: [] })]
  state.reads = []
  state.hold = undefined
  state.readError = null
  state.nextId = 1
})

describe('reading history used by next-read decisions', () => {
  it('hydrates dated and undated read rows without changing stored status or the base books query', async () => {
    state.reads = [
      { id: 'read-a', book_id: 'book', read_on: '2026-01-02', format: 'Ebook', rating: 4, notes: 'Earlier read' },
      { id: 'read-b', book_id: 'book', read_on: null, format: null, rating: null, notes: null },
      { id: 'removed-book-read', book_id: 'removed', read_on: '2026-01-01', format: null, rating: null, notes: null },
    ]
    const { wrapper, client } = harness()
    const { result } = renderHook(() => useReaderBooks(), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toHaveLength(1)
    expect(result.current.data?.[0]).toMatchObject({
      readStatus: 'Unread', ownership: 'owned',
      reads: [
        { date: '2026-01-02', format: 'Ebook', rating: 4, notes: 'Earlier read' },
        { date: '', format: '', rating: 0, notes: '' },
      ],
    })
    expect(nextReadCandidates(result.current.data ?? [])).toEqual([])
    expect(nextReadCandidates(result.current.data ?? [], { includeRereads: true })).toHaveLength(1)
    expect(client.getQueryData<Book[]>(['books'])?.[0]?.reads).toEqual([])
  })

  it('does not treat an unfinished or failed history request as no reading history', async () => {
    let release!: () => void
    state.hold = new Promise<void>((resolve) => { release = resolve })
    const { wrapper, client } = harness()
    const { result } = renderHook(() => useReaderBooks(), { wrapper })
    await waitFor(() => expect(client.getQueryState(['books'])?.status).toBe('success'))
    expect(result.current.isPending).toBe(true)
    expect(result.current.data).toBeUndefined()
    state.readError = new Error('History unavailable')
    await act(async () => release())
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    expect(result.current.error).toEqual(new Error('History unavailable'))
    state.readError = null
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.[0]?.reads).toEqual([])
  })

  it('refreshes new-read eligibility after adding or deleting a past read without a status write', async () => {
    const { wrapper } = harness()
    const { result } = renderHook(() => ({
      library: useReaderBooks(),
      add: useSaveReadEntry('book'),
      remove: useDeleteRead('book'),
    }), { wrapper })
    await waitFor(() => expect(result.current.library.isSuccess).toBe(true))
    expect(nextReadCandidates(result.current.library.data ?? [])).toHaveLength(1)
    await act(async () => {
      await result.current.add.mutateAsync({ date: '2026-01-02', format: 'Ebook', rating: 0, notes: '' })
    })
    await waitFor(() => expect(result.current.library.data?.[0]?.reads).toHaveLength(1))
    expect(nextReadCandidates(result.current.library.data ?? [])).toEqual([])
    expect(result.current.library.data?.[0]?.readStatus).toBe('Unread')
    await act(async () => { await result.current.remove.mutateAsync('read-1') })
    await waitFor(() => expect(result.current.library.data?.[0]?.reads).toHaveLength(0))
    expect(nextReadCandidates(result.current.library.data ?? [])).toHaveLength(1)
  })
})
