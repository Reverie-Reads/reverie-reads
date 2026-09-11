import { afterEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: mocks.rpc,
    from: (table: string) => {
      const data =
        table === 'corpus_sweep_run_items'
          ? { status: 'running' }
          : {
              id: 'work-1',
              title: 'First Book',
              author_text: 'Ada Reader',
              position: null,
              pages: null,
              pub_y: null,
              series_check_state: 'unresolved',
              series_checked_at: null,
              enriched_at: null,
            }
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data, error: null }),
        maybeSingle: async () => ({ data, error: null }),
      }
      return chain
    },
  }),
}))
const { processCorpusSweepWork } = await import('../../server/corpusSweep')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

it('the durable step keeps corpus authorization IDs separate from the book locator and preserves canonical evidence', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service')
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/enrich'))
      return Response.json({
        title: 'First Book',
        authors: ['Ada Reader'],
        series: 'The Sequence (Reader)',
        seriesPosition: 1,
        workId: 'hardcover:42',
        source: 'hardcover',
        confidence: 'high',
        pageCount: null,
        pubY: null,
        pubM: null,
        pubD: null,
      })
    expect(url).toBe('https://example.invalid/functions/v1/series')
    expect(JSON.parse(String(init?.body))).toEqual({
      sweepRunId: 'run-1',
      workId: 'work-1',
      name: 'The Sequence (Reader)',
      author: 'Ada Reader',
      title: 'First Book',
      hardcoverBookId: 42,
    })
    return Response.json({
      name: 'The Sequence',
      sourceRef: '7',
      memberCount: 99,
      entries: [],
      membershipEntries: [
        { title: 'First Book', author: 'Ada Reader', position: 1 },
        { title: 'Second Book', author: 'Ada Reader', position: 2 },
      ],
    })
  })
  vi.stubGlobal('fetch', fetch)
  await processCorpusSweepWork('run-1', 'work-1')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'service_complete_corpus_sweep_item',
    expect.objectContaining({
      p_series_result: expect.objectContaining({
        outcome: 'found',
        series: 'The Sequence',
        sourceRef: '7',
        position: 1,
        count: null,
        evidence: expect.arrayContaining([
          expect.objectContaining({
            kind: 'candidate_label',
            series: 'The Sequence (Reader)',
            sourceRef: 'hardcover:42',
          }),
          expect.objectContaining({
            kind: 'relational_membership',
            series: 'The Sequence',
            sourceRef: '7',
          }),
        ]),
      }),
    }),
  )
})

it('the actual durable step records exact membership observations with unknown length, not shelf rows or provider count', async () => {
  vi.stubEnv('SUPABASE_URL', 'https://example.invalid')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'synthetic-service')
  mocks.rpc.mockResolvedValue({ data: null, error: null })
  const fetch = vi.fn(async (url: string) => {
    if (url.endsWith('/enrich'))
      return Response.json({
        title: 'First Book',
        authors: ['Ada Reader'],
        series: 'The Sequence',
        source: 'hardcover',
        confidence: 'high',
        pageCount: null,
        pubY: null,
        pubM: null,
        pubD: null,
      })
    expect(url).toBe('https://example.invalid/functions/v1/series')
    return Response.json({
      name: 'The Sequence',
      sourceRef: '7',
      memberCount: 99,
      entries: [],
      membershipEntries: [
        { title: 'First Book', author: 'Ada Reader', position: 1 },
        { title: 'Translated First', author: 'Ada Reader', position: 1 },
        { title: 'Second Book', author: 'Ada Reader', position: 2 },
      ],
    })
  })
  vi.stubGlobal('fetch', fetch)
  await processCorpusSweepWork('run-1', 'work-1')
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith(
    'service_complete_corpus_sweep_item',
    expect.objectContaining({
      p_run: 'run-1',
      p_work: 'work-1',
      p_series_result: expect.objectContaining({
        outcome: 'found',
        series: 'The Sequence',
        position: 1,
        count: null,
      }),
    }),
  )
})
