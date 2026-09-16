import { act, renderHook } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useAddSave } from './useAddSave'

const db = vi.hoisted(() => ({ lookup: vi.fn(), eq: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: () => {
  const query = { eq: (key: string, value: string) => { db.eq(key, value); return query }, maybeSingle: db.lookup }
  return query
} }) } }))
beforeEach(() => {
  vi.clearAllMocks()
  db.lookup.mockResolvedValue({ data: null, error: null })
})
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((yes) => { resolve = yes })
  return { promise, resolve }
}
it('allows only one pending submit even before React renders disabled controls', async () => {
  const pending = deferred()
  const save = vi.fn(() => pending.promise)
  const { result } = renderHook(() => useAddSave('reader'))
  let task!: Promise<void>
  act(() => { task = result.current.run('save', save); void result.current.run('save', save) })
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.current.busy).toBe(true)
  await act(async () => { pending.resolve(); await task })
  expect(result.current.busy).toBe(false)
})
it('retries with the same insertion identity only after a successful absence check', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(undefined)
  const { result } = renderHook(() => useAddSave('reader'))
  await act(() => result.current.run('save', save))
  expect(result.current.error).toContain('couldn’t confirm')
  await act(() => result.current.run('save', save))
  expect(save.mock.calls[0]![0]).toBe(save.mock.calls[1]![0])
  expect(save.mock.calls[1]![1]).toBe(true)
  expect(db.eq).toHaveBeenCalledWith('id', save.mock.calls[0]![0])
  expect(db.eq).toHaveBeenCalledWith('owner_id', 'reader')
  expect(result.current.error).toBeNull()
})
it('finding the saved attempt never repeats contributors, verdicts, or insertion', async () => {
  const save = vi.fn().mockRejectedValue(new Error('lost response'))
  const { result } = renderHook(() => useAddSave('reader'))
  await act(() => result.current.run('keep_both', save))
  const id = save.mock.calls[0]![0]
  db.lookup.mockResolvedValue({ data: { id, removed_at: null }, error: null })
  await act(() => result.current.run('keep_both', save))
  await act(() => result.current.run('keep_both', save))
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.current.recoveredBookId).toBe(id)
  expect(result.current.error).toContain('not every detail was confirmed')
})
it('a failed recovery lookup cannot authorize another write', async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline'))
  const { result } = renderHook(() => useAddSave('reader'))
  await act(() => result.current.run('save', save))
  db.lookup.mockResolvedValue({ data: null, error: new Error('offline') })
  await act(() => result.current.run('save', save))
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.current.error).not.toBeNull()
})
it('does not revive a removed saved attempt', async () => {
  const save = vi.fn().mockRejectedValue(new Error('offline'))
  const { result } = renderHook(() => useAddSave('reader'))
  await act(() => result.current.run('save', save))
  db.lookup.mockResolvedValue({ data: { id: save.mock.calls[0]![0], removed_at: '2026-09-15' }, error: null })
  await act(() => result.current.run('save', save))
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.current.error).toContain('saved and then removed')
})
it('cannot change a duplicate decision while its failed attempt is unresolved', async () => {
  const save = vi.fn().mockRejectedValue(new Error('lost response'))
  const { result } = renderHook(() => useAddSave('reader'))
  await act(() => result.current.run('keep_both', save))
  await act(() => result.current.run('merge', save))
  await act(() => result.current.run('save', save))
  expect(save).toHaveBeenCalledTimes(1)
  expect(result.current.failedAction).toBe('keep_both')
})
it('leaving during a recovery lookup prevents a new write', async () => {
  const gate = deferred()
  const save = vi.fn().mockRejectedValue(new Error('offline'))
  const { result, unmount } = renderHook(() => useAddSave('reader'))
  await act(() => result.current.run('save', save))
  db.lookup.mockImplementation(async () => { await gate.promise; return { data: null, error: null } })
  let retry!: Promise<void>
  act(() => { retry = result.current.run('save', save) })
  unmount()
  await act(async () => { gate.resolve(); await retry })
  expect(save).toHaveBeenCalledTimes(1)
})
it('has no write path without the current reader', async () => {
  const save = vi.fn()
  const { result } = renderHook(() => useAddSave(undefined))
  await act(() => result.current.run('save', save))
  expect(save).not.toHaveBeenCalled()
  expect(result.current.error).not.toBeNull()
})
