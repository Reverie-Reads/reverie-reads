import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { Book } from '@reverie/core'

const mocked = vi.hoisted(() => ({ getUser: vi.fn(), from: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getUser: mocked.getUser }, from: mocked.from, rpc: mocked.rpc },
}))

import { booksKey } from './books'
import { incomingToBook, useIntake, type IntakeResult } from './intake'
import { profileKey } from './profile'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

const incoming = { title: 'A reviewed book', first: 'Nell', last: 'Writer', isbn: '9780141439518' }
function existingBook(): Book {
  return {
    ...incomingToBook(incoming), id: 'existing-book', rating: 5,
    reads: [{ date: '2026-09-12', format: 'physical', rating: 5, notes: 'Private reading note' }],
  }
}
function harness(books: Book[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  client.setQueryData(booksKey, books)
  client.setQueryData(profileKey, { autoMergeDuplicates: true })
  const booksRefresh = deferred()
  const readsRefresh = deferred()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
    .mockImplementation(({ queryKey } = {}) => queryKey?.[0] === 'books' ? booksRefresh.promise : readsRefresh.promise)
  const hook = renderHook(() => useIntake(), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
  return { ...hook, client, invalidate, booksRefresh, readsRefresh }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocked.getUser.mockResolvedValue({ data: { user: { id: 'reader' } } })
  mocked.rpc.mockResolvedValue({ error: null })
})

it('returns the exact duplicate for reader review without waiting for a refresh that follows no write', async () => {
  const existing = existingBook()
  const before = structuredClone(existing)
  const h = harness([existing])
  let outcome: IntakeResult | undefined
  // The reader confirmed Add's review, but has not chosen merge or keep both. A slow
  // post-write refresh must not hide the duplicate choice when nothing was written.
  await act(async () => {
    void h.result.current(incoming, 'review', 'new-book', true, 'reader').then((value) => { outcome = value })
  })
  expect(outcome).toMatchObject({ outcome: 'review', review: { existingId: existing.id, incoming } })
  expect(h.invalidate).not.toHaveBeenCalled()
  expect(mocked.from).not.toHaveBeenCalled()
  expect(mocked.rpc).not.toHaveBeenCalled()
  expect(h.client.getQueryData(booksKey)).toEqual([before])
  h.unmount()
  h.client.clear()
})

it.each(['add', 'merge'] as const)('still waits for books and reading-history refresh after a real %s', async (action) => {
  const existing = existingBook()
  const before = structuredClone(existing)
  const h = harness(action === 'merge' ? [existing] : [])
  const insert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { id: 'new-book' }, error: null }) }) }))
  const update = vi.fn(() => ({ eq: async () => ({ error: null }) }))
  mocked.from.mockReturnValue({ insert, update })
  let outcome: IntakeResult | undefined
  let pending!: Promise<IntakeResult>
  await act(async () => {
    pending = h.result.current({ ...incoming, pages: 321 }, 'review', 'new-book', false, 'reader')
    void pending.then((value) => { outcome = value })
  })
  expect(action === 'add' ? insert : update).toHaveBeenCalledTimes(1)
  expect(h.invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: booksKey })
  expect(outcome).toBeUndefined()
  await act(async () => { h.booksRefresh.resolve() })
  expect(h.invalidate).toHaveBeenNthCalledWith(2, { queryKey: ['reads', 'all'] })
  expect(outcome).toBeUndefined()
  await act(async () => { h.readsRefresh.resolve(); await pending })
  expect(outcome).toMatchObject({ outcome: action === 'add' ? 'added' : 'merged', bookId: action === 'add' ? 'new-book' : existing.id })
  // Neither matching nor a metadata-only merge mutates the cached personal reading history.
  expect(h.client.getQueryData(booksKey)).toEqual(action === 'merge' ? [before] : [])
  expect(mocked.from.mock.calls.every(([table]) => table === 'books')).toBe(true)
  h.unmount()
  h.client.clear()
})

it('still rejects an account change before duplicate review or any refresh', async () => {
  const h = harness([existingBook()])
  await expect(h.result.current(incoming, 'review', 'new-book', true, 'another-reader'))
    .rejects.toThrow('The account changed. Nothing was added.')
  expect(h.invalidate).not.toHaveBeenCalled()
  expect(mocked.from).not.toHaveBeenCalled()
  expect(mocked.rpc).not.toHaveBeenCalled()
  h.unmount()
  h.client.clear()
})
