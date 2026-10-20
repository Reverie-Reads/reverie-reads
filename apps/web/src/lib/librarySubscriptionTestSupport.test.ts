import { EventEmitter } from 'node:events'
import { afterEach, expect, test, vi } from 'vitest'
import { observeLibrarySubscription } from '../../e2e/support/librarySubscription'

afterEach(() => vi.useRealTimers())

test('slow navigation creates no premature rejection and retains an early exact acknowledgement', async () => {
  vi.useFakeTimers()
  const page = new EventEmitter()
  const socket = new EventEmitter()
  const wait = observeLibrarySubscription(page, 'reader-a')
  page.emit('websocket', socket)
  await vi.advanceTimersByTimeAsync(60_000)
  socket.emit('framereceived', { payload: 'realtime:library:reader-a phx_reply "status":"ok"' })
  await wait()
  expect(page.listenerCount('websocket')).toBe(0)
  expect(socket.listenerCount('framereceived')).toBe(0)
})

test('a missing acknowledgement still fails within twenty seconds after readiness', async () => {
  vi.useFakeTimers()
  const page = new EventEmitter()
  const socket = new EventEmitter()
  const wait = observeLibrarySubscription(page, 'reader-a')
  page.emit('websocket', socket)
  await vi.advanceTimersByTimeAsync(60_000)
  socket.emit('framereceived', { payload: 'realtime:library:reader-b phx_reply "status":"ok"' })
  const result = expect(wait()).rejects.toThrow('did not join')
  await vi.advanceTimersByTimeAsync(20_000)
  await result
  expect(page.listenerCount('websocket')).toBe(0)
  expect(socket.listenerCount('framereceived')).toBe(0)
})

test('an exact acknowledgement during the bounded wait succeeds without a remaining timer', async () => {
  vi.useFakeTimers()
  const page = new EventEmitter()
  const socket = new EventEmitter()
  const wait = observeLibrarySubscription(page, 'reader-a')
  page.emit('websocket', socket)
  const result = wait()
  await vi.advanceTimersByTimeAsync(19_999)
  socket.emit('framereceived', { payload: 'realtime:library:reader-a phx_reply "status":"ok"' })
  await result
  expect(vi.getTimerCount()).toBe(0)
})
