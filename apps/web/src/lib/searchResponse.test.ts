import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from './supabase'
import { searchEverywhere } from './search'
import { searchAddCatalog, useAddSearch } from '../data/useAddSearch'
import { act, renderHook } from '@testing-library/react'

vi.mock('./supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
const invoke = vi.mocked(supabase.functions.invoke)
const hit = {
  source: 'hardcover',
  title: 'A quiet atlas',
  authors: ['Avery Reader'],
  cover: '',
  isbn: '',
  year: '',
}
beforeEach(() => vi.resetAllMocks())

describe('successful search response boundary', () => {
  it.each([
    null,
    {},
    { results: null },
    { results: {} },
    { results: [null] },
    { results: [{ ...hit, title: '' }] },
    { results: [{ ...hit, authors: 'Avery Reader' }] },
    { results: [{ ...hit, authors: [null] }] },
    { results: [{ ...hit, isbn13: 123 }] },
    { results: [{ ...hit, series: {} }] },
    { results: [{ ...hit, seriesPosition: '2' }] },
    { results: [{ ...hit, source: 'unknown' }] },
    { results: [hit, {}] },
    { results: [{ ...hit, source: 'google' }] },
    { results: [{ ...hit, source: 'google', sourceUrl: 'https://evil.example/books' }] },
    { results: [], degraded: true },
    { results: [], degraded: 'false' },
    { results: [], error: 'upstream failed' },
  ])('rejects an invalid or incomplete response without claiming emptiness: %j', async (data) => {
    invoke.mockResolvedValue({ data, error: null })
    await expect(searchEverywhere('A quiet atlas')).rejects.toThrow('search unavailable')
  })

  it('accepts genuine emptiness and useful partial results in their original sections', async () => {
    invoke.mockResolvedValueOnce({ data: { results: [] }, error: null })
    await expect(searchAddCatalog('A quiet atlas')).resolves.toEqual([])
    const google = { ...hit, source: 'google', sourceUrl: 'https://books.google.com/books?id=one' }
    invoke.mockResolvedValueOnce({ data: { results: [hit, google], degraded: true }, error: null })
    await expect(searchAddCatalog('A quiet atlas')).resolves.toEqual([hit, google])
  })

  it('keeps a missing author as an unresolved candidate rather than inventing a contributor', async () => {
    invoke.mockResolvedValue({ data: { results: [{ ...hit, authors: [] }] }, error: null })
    await expect(searchAddCatalog('A quiet atlas')).resolves.toEqual([{ ...hit, authors: [] }])
  })

  it('reaches Add recovery through the real client and can retry without losing the query', async () => {
    invoke
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: { results: [] }, error: null })
    const { result } = renderHook(() => useAddSearch())
    await act(() => result.current.search('A quiet atlas'))
    expect(result.current).toMatchObject({
      issue: 'unavailable',
      results: null,
      searched: 'A quiet atlas',
    })
    await act(() => result.current.search('A quiet atlas'))
    expect(result.current).toMatchObject({ issue: null, results: [], busy: false })
  })

  it('does not make a request for a short query', async () => {
    await expect(searchEverywhere('It')).resolves.toEqual([])
    expect(invoke).not.toHaveBeenCalled()
  })
})
