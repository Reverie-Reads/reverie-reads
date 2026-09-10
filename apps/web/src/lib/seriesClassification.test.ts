import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) } },
}))

const { classifyEnrichedSeries, fetchCatalogSeriesSnapshot } =
  await import('./seriesClassification')

beforeEach(() => mocks.invoke.mockReset())

describe('series provider relationship boundary', () => {
  it('normalizes membership observations without trusting provider cardinality or shelf slots', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        name: 'The Sequence',
        sourceRef: 'hc-series-1',
        memberCount: 3,
        entries: [],
        membershipEntries: [
          { title: 'First Book', author: 'Ada Reader', position: 1 },
          { title: '', author: 'Ada Reader', position: 2 },
        ],
      },
      error: null,
    })

    await expect(fetchCatalogSeriesSnapshot('The Sequence', 'Ada Reader')).resolves.toEqual({
      source: 'hardcover',
      series: 'The Sequence',
      sourceRef: 'hc-series-1',
      memberCount: null,
      entries: [{ title: 'First Book', author: 'Ada Reader', position: 1 }],
      unavailable: false,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('series', {
      body: { name: 'The Sequence', author: 'Ada Reader' },
    })
  })

  it('fails closed when the relationship provider is unavailable', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('offline') })

    const result = await classifyEnrichedSeries({
      title: 'First Book',
      author: 'Ada Reader',
      result: {
        title: 'First Book',
        authors: ['Ada Reader'],
        author: 'Ada Reader',
        series: 'The Sequence',
        seriesPosition: 1,
        publisher: '',
        pubY: null,
        pubM: null,
        pubD: null,
        pageCount: null,
        isbn10: '',
        isbn13: '',
        isbn: '',
        language: '',
        genres: [],
        description: '',
        cover: '',
        source: 'hardcover',
        confidence: 'high',
      },
    })

    expect(result.outcome).toBe('unresolved')
    expect(result.series).toBeNull()
    expect(result.reason).toMatch(/unavailable/i)
  })
})
