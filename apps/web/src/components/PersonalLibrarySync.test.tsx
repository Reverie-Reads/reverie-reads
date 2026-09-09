import { act, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type BroadcastCallback = (message: { payload?: unknown }) => void
type StatusCallback = (status: string) => void

const mocks = vi.hoisted(() => {
  const connections: {
    topic: string
    options: unknown
    broadcast?: BroadcastCallback
    status?: StatusCallback
    channel: object
  }[] = []
  const setAuth = vi.fn(async () => {})
  const removeChannel = vi.fn(async () => 'ok')
  const channel = vi.fn((topic: string, options: unknown) => {
    const connection: (typeof connections)[number] = { topic, options, channel: {} }
    const value = {
      on: vi.fn((_kind: string, _filter: unknown, callback: BroadcastCallback) => {
        connection.broadcast = callback
        return value
      }),
      subscribe: vi.fn((callback: StatusCallback) => {
        connection.status = callback
        return value
      }),
    }
    connection.channel = value
    connections.push(connection)
    return value
  })
  return { connections, setAuth, removeChannel, channel }
})

vi.mock('../lib/supabase', () => ({
  supabase: {
    realtime: { setAuth: mocks.setAuth },
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}))

const { PersonalLibrarySync } = await import('./PersonalLibrarySync')
const { libraryKeysForTable } = await import('./librarySyncQueries')

const settleConnection = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function Harness({ readerId, client }: { readerId: string; client: QueryClient }) {
  return (
    <QueryClientProvider client={client}>
      <PersonalLibrarySync readerId={readerId} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  mocks.connections.length = 0
  mocks.setAuth.mockReset().mockResolvedValue(undefined)
  mocks.removeChannel.mockClear()
  mocks.channel.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('personal library realtime sync', () => {
  it('maps each signal to its dependent cache families', () => {
    expect(libraryKeysForTable('reads')).toEqual([['reads']])
    expect(libraryKeysForTable('lists')).toEqual([['lists'], ['list-items', 'all'], ['book-lists']])
    expect(libraryKeysForTable('list_items')).toEqual([['list-items', 'all'], ['book-lists']])
    expect(libraryKeysForTable('unknown')).toEqual([])

    const bookKeys = libraryKeysForTable('books').map((key) => JSON.stringify(key))
    expect(bookKeys).toContain('["books"]')
    expect(bookKeys).toContain('["reads"]')
    expect(bookKeys).toContain('["list-items","all"]')
    expect(bookKeys).toContain('["seriesList"]')
    expect(bookKeys).toContain('["series-strip"]')
    expect(bookKeys).toContain('["book-series-memberships"]')
  })

  it('joins only the reader private topic and refreshes once after a burst', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    render(<Harness readerId="reader-a" client={client} />)
    await settleConnection()

    expect(mocks.setAuth).toHaveBeenCalledOnce()
    expect(mocks.connections).toHaveLength(1)
    const connection = mocks.connections[0]!
    expect(connection.topic).toBe('library:reader-a')
    expect(connection.options).toEqual({ config: { private: true } })

    act(() => {
      connection.broadcast?.({ payload: { table: 'books', operation: 'UPDATE' } })
      connection.broadcast?.({ payload: { table: 'books', operation: 'UPDATE' } })
      connection.broadcast?.({ payload: { table: 'reads', operation: 'INSERT' } })
      vi.advanceTimersByTime(159)
    })
    expect(invalidate).not.toHaveBeenCalled()

    act(() => {
      connection.broadcast?.({ payload: { table: 'unrecognized' } })
      vi.advanceTimersByTime(1)
    })
    const keys = invalidate.mock.calls.map(([options]) => JSON.stringify(options?.queryKey))
    expect(keys.filter((key) => key === '["books"]')).toHaveLength(1)
    expect(keys.filter((key) => key === '["reads"]')).toHaveLength(1)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('refreshes once on subscription to close the initial fetch gap', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    render(<Harness readerId="reader-a" client={client} />)
    await settleConnection()

    act(() => {
      mocks.connections[0]?.status?.('SUBSCRIBED')
      vi.advanceTimersByTime(160)
    })

    const keys = invalidate.mock.calls.map(([options]) => JSON.stringify(options?.queryKey))
    expect(keys).toContain('["books"]')
    expect(keys).toContain('["reads"]')
    expect(keys).toContain('["lists"]')
    expect(keys).toContain('["list-items","all"]')
  })

  it('removes the old channel and drops its queued refresh when the reader changes', async () => {
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    const view = render(<Harness readerId="reader-a" client={client} />)
    await settleConnection()
    const old = mocks.connections[0]!

    act(() => old.broadcast?.({ payload: { table: 'books', operation: 'DELETE' } }))
    view.rerender(<Harness readerId="reader-b" client={client} />)
    await settleConnection()

    expect(mocks.removeChannel).toHaveBeenCalledWith(old.channel)
    expect(mocks.connections[1]?.topic).toBe('library:reader-b')
    act(() => vi.advanceTimersByTime(200))
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('never creates a channel if sign-out wins the authentication race', async () => {
    let release!: () => void
    mocks.setAuth.mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
    const client = new QueryClient()
    const view = render(<Harness readerId="reader-a" client={client} />)
    view.unmount()

    await act(async () => release())
    expect(mocks.channel).not.toHaveBeenCalled()
    expect(mocks.removeChannel).not.toHaveBeenCalled()
  })
})
