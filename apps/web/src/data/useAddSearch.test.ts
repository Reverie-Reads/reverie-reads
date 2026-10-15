import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchEverywhere, type SearchResult } from '../lib/search'
import { searchAddCatalog, useAddSearch } from './useAddSearch'
import { enrichBookOutcome } from '../lib/enrich'
vi.mock('../lib/enrich', () => ({ enrichBookOutcome: vi.fn() }))

vi.mock('../lib/search', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/search')>()),
  searchEverywhere: vi.fn(),
}))
const lookup = vi.mocked(searchEverywhere)
const hit = (title: string): SearchResult => ({
  title, authors: ['Avery Reader'], source: 'hardcover', isbn: '', year: '', cover: '',
})
function deferred() {
  let resolve!: (value: SearchResult[]) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<SearchResult[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
beforeEach(() => vi.resetAllMocks())

describe('submitted Add searches', () => {
  it('distinguishes unavailable from a successful empty search and can retry', async () => {
    lookup.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([])
    const { result } = renderHook(() => useAddSearch())
    await act(() => result.current.search('  A quiet book  '))
    expect(result.current).toMatchObject({ issue: 'unavailable', results: null, busy: false, searched: 'A quiet book' })
    await act(() => result.current.search('A quiet book'))
    expect(result.current).toMatchObject({ issue: null, results: [], busy: false })
  })

  for (const outcome of ['success', 'failure'] as const) {
    it(`ignores a superseded ${outcome} even when the transport does not honor abort`, async () => {
      const old = deferred()
      const current = deferred()
      lookup.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
      const { result } = renderHook(() => useAddSearch())
      let first!: Promise<void>
      let second!: Promise<void>
      act(() => { first = result.current.search('Earlier'); second = result.current.search('Current') })
      expect(lookup.mock.calls[0]![1]!.aborted).toBe(true)
      await act(async () => {
        if (outcome === 'success') old.resolve([hit('Earlier')])
        else old.reject(new Error('offline'))
        await first
      })
      expect(result.current).toMatchObject({ results: null, busy: true, issue: null, searched: 'Current' })
      await act(async () => { current.resolve([hit('Current')]); await second })
      expect(result.current.results?.map((book) => book.title)).toEqual(['Current'])
    })
  }

  it('does not overwrite a newer completed result with an older response', async () => {
    const old = deferred()
    lookup.mockReturnValueOnce(old.promise).mockResolvedValueOnce([hit('Current')])
    const { result } = renderHook(() => useAddSearch())
    let first!: Promise<void>
    act(() => { first = result.current.search('Earlier') })
    await act(() => result.current.search('Current'))
    await act(async () => { old.resolve([hit('Earlier')]); await first })
    expect(result.current.results?.map((book) => book.title)).toEqual(['Current'])
  })

  it('cancels pending work when the reader chooses manual entry', async () => {
    const pending = deferred()
    lookup.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useAddSearch())
    let task!: Promise<void>
    act(() => { task = result.current.search('My book'); result.current.cancel() })
    expect(lookup.mock.calls[0]![1]!.aborted).toBe(true)
    await act(async () => { pending.reject(new Error('cancelled')); await task })
    expect(result.current).toMatchObject({ results: null, busy: false, issue: null })
  })

  it('explains a short submission without a provider request or stale results', async () => {
    lookup.mockResolvedValueOnce([hit('Earlier')])
    const { result } = renderHook(() => useAddSearch())
    await act(() => result.current.search('Earlier'))
    await act(() => result.current.search('It'))
    expect(lookup).toHaveBeenCalledTimes(1)
    expect(result.current).toMatchObject({ results: null, searched: '', issue: 'short', busy: false })
  })

  it('aborts the request on leaving Add', () => {
    lookup.mockReturnValue(new Promise(() => {}))
    const { result, unmount } = renderHook(() => useAddSearch())
    act(() => { void result.current.search('My book') })
    unmount()
    expect(lookup.mock.calls[0]![1]!.aborted).toBe(true)
  })

  it('limits catalog matches while retaining all attributed Google results in order', async () => {
    const catalog = Array.from({ length: 10 }, (_, i) => hit(`Catalog ${i}`))
    const google: SearchResult[] = Array.from({ length: 12 }, (_, i) => ({
      ...hit(`Google ${i}`), source: 'google', sourceUrl: `https://books.google.com/books?id=${i}`,
    }))
    lookup.mockResolvedValue([...catalog, ...google])
    const { result } = renderHook(() => useAddSearch())
    await act(() => result.current.search('Books'))
    expect(result.current.results).toEqual([...catalog.slice(0, 8), ...google])
  })
})

describe('ISBN intake', () => {
  it('offers an admitted exact edition without selecting a work search ISBN', async () => {
    vi.mocked(enrichBookOutcome).mockResolvedValue({ status: 'ok', data: {
      title: 'A Quiet Atlas', authors: ['Avery Reader'], isbn13: '9780306406157',
      cover: '', pubY: 2024, provenance: { isbn13: { source: 'hardcover', at: '2026-10-14' } },
    } } as Awaited<ReturnType<typeof enrichBookOutcome>>)
    const results = await searchAddCatalog('9780306406157')
    expect(results).toEqual([expect.objectContaining({ editionIsbn: '9780306406157', source: 'hardcover' })])
    expect(lookup).not.toHaveBeenCalled()
  })
  it('does not label an unavailable edition lookup as no matches after an empty fallback', async () => {
    vi.mocked(enrichBookOutcome).mockResolvedValue({ status: 'failed', reason: 'offline' })
    lookup.mockResolvedValue([])
    await expect(searchAddCatalog('9780306406157')).rejects.toThrow('unavailable')
  })
  it('retains successful empty fallback after a genuine edition absence', async () => {
    vi.mocked(enrichBookOutcome).mockResolvedValue({ status: 'empty' })
    lookup.mockResolvedValue([])
    await expect(searchAddCatalog('9780306406157')).resolves.toEqual([])
  })
})
