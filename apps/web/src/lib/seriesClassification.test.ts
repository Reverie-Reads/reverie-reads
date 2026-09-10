import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('./supabase', () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => mocks.invoke(...args) } },
}))

const { classifyEnrichedSeries, fetchCatalogSeriesSnapshot } =
  await import('./seriesClassification')

beforeEach(() => mocks.invoke.mockReset())

describe('series provider relationship boundary', () => {
  it('passes the exact book locator and retains both old candidate and verified canonical relationship', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        name: 'The Sequence',
        sourceRef: '7',
        memberCount: 99,
        entries: [],
        membershipEntries: [{ title: 'Fourth Book', author: 'Ada Reader', position: 4 }],
      },
      error: null,
    })
    const result = await classifyEnrichedSeries({
      title: 'Fourth Book',
      author: 'Ada Reader',
      result: {
        title: 'Fourth Book',
        authors: ['Ada Reader'],
        author: 'Ada Reader',
        series: 'The Sequence (Reader)',
        seriesPosition: 4,
        workId: 'hardcover:42',
        source: 'hardcover',
        confidence: 'high',
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
      },
    })
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('series', {
      body: {
        name: 'The Sequence (Reader)',
        author: 'Ada Reader',
        title: 'Fourth Book',
        hardcoverBookId: 42,
      },
    })
    expect(result).toMatchObject({
      outcome: 'found',
      series: 'The Sequence',
      sourceRef: '7',
      position: 4,
      count: null,
    })
    // The existing database save still places a conflicting stored name into administrator review.
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'candidate_label',
          series: 'The Sequence (Reader)',
          sourceRef: 'hardcover:42',
        }),
        expect.objectContaining({
          kind: 'relational_membership',
          series: 'The Sequence',
          sourceRef: '7',
          position: 4,
        }),
      ]),
    )
  })

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
