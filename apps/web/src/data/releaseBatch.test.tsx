import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useAuthorReleases } from './releases'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('../lib/supabase', () => ({ supabase: { functions: { invoke } } }))
beforeEach(() => invoke.mockReset())
const reply = (authors: Record<string, unknown[]>, pending: string[] = []) => ({ data: { authors, pending }, error: null })

it('publishes the complete bounded author batch together and ignores an older search response', async () => {
  let finishOld!: (value: ReturnType<typeof reply>) => void
  let finishNew!: (value: ReturnType<typeof reply>) => void
  invoke.mockResolvedValueOnce(reply({ Ada: [] }, ['Bea']))
    .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve }))
  const { result, rerender } = renderHook(({ names }) => useAuthorReleases(names), { initialProps: { names: ['Ada', 'Bea'] } })
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
  expect(result.current).toEqual({ shelves: {}, status: 'loading' })
  rerender({ names: ['Cora'] })
  await waitFor(() => expect(invoke).toHaveBeenCalledTimes(3))
  await act(async () => finishOld(reply({ Bea: [] })))
  expect(result.current).toEqual({ shelves: {}, status: 'loading' })
  await act(async () => finishNew(reply({ Cora: [] })))
  expect(result.current).toEqual({ shelves: { Cora: [] }, status: 'ready' })
})

it('reports unfinished provider coverage after its request cap instead of claiming successful emptiness', async () => {
  invoke.mockResolvedValue(reply({}, ['Ada']))
  const { result } = renderHook(() => useAuthorReleases(['Ada']))
  await waitFor(() => expect(result.current.status).toBe('unavailable'))
  expect(invoke).toHaveBeenCalledTimes(10)
})
