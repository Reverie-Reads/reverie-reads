import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { Book } from '@reverie/core'

// WHO PLACED THIS ROW — the provenance `user_edited` is supposed to record.
//
// `mergeSourceEntries` moves a row only when `!userEdited`, so `user_edited` decides whether
// "Fetch series data" can ever correct a position. Reconciliation seeds an entry for every library
// book naming the series and, from ab9e1fe (#77) until this branch, stamped every one of them
// `user_edited: true` — machine output wearing a reader's signature. The effect was total: opening
// a series page once made that whole series permanently uncorrectable, and the series backfill
// (#130) turned 3 series into 252, so every page opened from here on minted a fresh batch.
//
// THE CORE TEST CANNOT CATCH A REGRESSION HERE. `packages/core` sees a `SeriesEntry` that already
// has its flag; what that flag was set to at INSERT time is decided in this file's subject,
// `useSeriesDetail`, and is invisible from core. So this drives the real hook and reads the row it
// actually sends to Supabase, rather than asserting against a re-stated payload.

interface Captured {
  table: string
  rows: Record<string, unknown>[]
}
interface Patch {
  table: string
  patch: Record<string, unknown>
}

const inserted: Captured[] = []
const patched: Patch[] = []
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
let libraryBooks: Record<string, unknown>[] = []
let entryRows: Record<string, unknown>[] = []
let sourcePayload: Record<string, unknown> | null = null

const SERIES_ROW = {
  id: 'ser-1',
  owner_id: 'owner-1',
  name: 'The Empyrean',
  status: null,
  source: 'manual',
  source_ref: null,
  refreshed_at: null,
}

/** A thenable that answers every builder method with itself — enough for the chains under test. */
function chain(result: () => unknown): Record<string, unknown> {
  const c: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'limit', 'order', 'is', 'not', 'single', 'maybeSingle'])
    c[m] = () => c
  c.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject)
  return c
}

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: 'owner-1' } } }) },
    from: (table: string) => ({
      select: () =>
        chain(() => {
          if (table === 'series') return { data: [SERIES_ROW], error: null }
          if (table === 'series_entries') return { data: entryRows, error: null }
          if (table === 'books') return { data: libraryBooks, error: null }
          return { data: [], error: null }
        }),
      insert: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const list = Array.isArray(rows) ? rows : [rows]
        inserted.push({ table, rows: list })
        // `.select()` after insert returns the stored rows; ids are all `useSeriesDetail` reads.
        const stored = list.map((r, i) => ({ ...r, id: `new-${i}`, removed_at: null, label: null }))
        const res = { data: stored, error: null }
        return { ...chain(() => res), then: (f: (v: unknown) => unknown) => Promise.resolve(res).then(f) }
      },
      update: (patch: Record<string, unknown>) => {
        patched.push({ table, patch })
        return chain(() => ({ data: [], error: null }))
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return { data: { moved: 0, skipped_user_edited: 0, books_synced: 0, length_set: false, length_books_synced: 0 }, error: null }
    },
    functions: { invoke: async () => ({ data: sourcePayload, error: null }) },
  },
}))

const { useSeriesDetail, useMoveEntry, useAddGhostEntry, useAddSeriesEntries, useUpdateEntry, useApplySeriesSource } =
  await import('./series')

function wrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

/** The row `useSeriesDetail` sends for a library book joining the series. */
const seededRow = () =>
  inserted.find((c) => c.table === 'series_entries')?.rows[0] as Record<string, unknown> | undefined

beforeEach(() => {
  inserted.length = 0
  patched.length = 0
  rpcCalls.length = 0
  entryRows = []
  sourcePayload = null
  libraryBooks = [
    {
      id: 'book-1',
      title: 'Fourth Wing',
      author_first: 'Rebecca',
      author_last: 'Yarros',
      position: 1,
      status: null,
    },
  ]
})

describe('opening a series cannot seed membership', () => {
  it('source refresh never materializes raw membership observations as translated or boxed-set ghosts', async () => {
    sourcePayload = {
      sourceRef: 'hc-7', memberCount: null, entries: [],
      membershipEntries: [
        { title: 'Fourth Wing', author: 'Rebecca Yarros', position: 1 },
        { title: 'Translated Fourth Wing', author: 'Rebecca Yarros', position: 1 },
        { title: 'The Empyrean Box Set', author: 'Rebecca Yarros', position: 1 },
      ],
    }
    const { result } = renderHook(() => useApplySeriesSource('The Empyrean'), { wrapper: wrapper() })
    await act(async () => {
      await result.current.mutateAsync({ author: 'Rebecca Yarros', detail: {
        series: { id: 'ser-1', name: 'The Empyrean', status: null, source: 'manual', sourceRef: null, refreshedAt: null },
        entries: [], unreviewed: [], removed: [],
      } })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.added).toBe(0)
    expect(inserted).toEqual([])
    expect(rpcCalls).toEqual([])
  })

  it('performs no series-entry insert for a legacy library string', async () => {
    const { result } = renderHook(() => useSeriesDetail('The Empyrean'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(seededRow()).toBeUndefined()
  })

  it('does not link a book as a side effect of the read', async () => {
    const { result } = renderHook(() => useSeriesDetail('The Empyrean'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(inserted.filter((capture) => capture.table === 'series_entries')).toEqual([])
  })

  it('keeps zero as a valid private key for an item moved before the first volume', async () => {
    entryRows = [
      {
        id: 'entry-zero',
        series_id: 'ser-1',
        position: 3,
        sort_order: 0,
        sort_user_edited: true,
        label: null,
        title: 'Third, read first',
        author: '',
        book_id: null,
        source: 'manual',
        user_edited: false,
        removed_at: null,
        membership_claim: { origin: 'reader' },
        position_claim: { origin: 'corpus' },
      },
    ]
    const { result } = renderHook(() => useSeriesDetail('The Empyrean'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.entries[0]?.sortOrder).toBe(0)
  })
})

describe('adding a library book to another series', () => {
  it('creates a secondary membership without replacing its existing primary', async () => {
    const book = { id: 'book-1', title: 'Fourth Wing', series: 'The Empyrean' } as Book
    const { result } = renderHook(() => useAddSeriesEntries('Fly or Die'), {
      wrapper: wrapper(),
    })
    await act(async () => {
      await result.current.mutateAsync({ seriesId: 'ser-2', books: [book], after: 0 })
    })
    expect(rpcCalls.at(-1)).toMatchObject({
      fn: 'set_book_series_membership',
      args: { p_series: 'ser-2', p_make_primary: false },
    })
  })
})

describe('every reader gesture still claims the row', () => {
  it('a drag changes only the private reading-order key', async () => {
    const { result } = renderHook(() => useMoveEntry('The Empyrean'), { wrapper: wrapper() })
    result.current.mutate({ seriesId: 'ser-1', slots: [{ entryId: 'e1', sortOrder: 2 }] })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const call = rpcCalls.find((c) => c.fn === 'set_series_reading_order')
    expect(call).toBeDefined()
    expect(call?.args.p_slots).toEqual([{ entry_id: 'e1', sort_order: 2 }])
    expect(patched.filter((p) => p.table === 'series_entries')).toHaveLength(0)
  })

  it('a volume and label edit goes through the canonical position writer', async () => {
    const { result } = renderHook(() => useUpdateEntry('The Empyrean'), { wrapper: wrapper() })
    result.current.mutate({
      seriesId: 'ser-1',
      entryId: 'e1',
      position: 3.5,
      label: 'novella',
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const call = rpcCalls.find((c) => c.fn === 'set_series_order_claimed')
    expect(call?.args).toMatchObject({
      p_series: 'ser-1',
      p_origin: 'reader',
      p_slots: [{ entry_id: 'e1', position: 3.5, label: 'novella' }],
    })
  })

  it('a manually added ghost slot is user_edited from birth', async () => {
    const { result } = renderHook(() => useAddGhostEntry('The Empyrean'), { wrapper: wrapper() })
    result.current.mutate({ seriesId: 'ser-1', title: 'Onyx Storm', author: 'R Yarros', position: 3 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const ghost = inserted.find((c) => c.table === 'series_entries')?.rows[0]
    expect(ghost).toBeDefined()
    expect(ghost?.user_edited).toBe(true)
    expect(ghost?.sort_order).toBe(3)
    expect(ghost?.sort_user_edited).toBe(true)
  })
})
