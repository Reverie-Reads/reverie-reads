import { beforeEach, expect, it, vi } from 'vitest'
import {
  saveCatalogCoverReview,
  fetchCatalogCoverQueue,
  type CatalogCoverWork,
  type CoverReviewInput,
} from './corpusCoverReview'
import { supabase } from '../lib/supabase'
import { ingestCorpusCover, fetchEditions } from '../lib/covers'
import { isOfflinePersistableQueryKey } from '../lib/offlineCache'

vi.mock('../lib/supabase', () => ({ supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } } }))
vi.mock('../lib/covers', async (original) => ({
  ...(await original<typeof import('../lib/covers')>()),
  ingestCorpusCover: vi.fn(),
}))
const work: CatalogCoverWork = {
  id: 'work-1',
  title: 'A book',
  author: 'An author',
  isbns: [],
  cover: null,
  source: null,
  sourceUrl: null,
  confidence: null,
  fingerprint: 'exact-state',
  revision: 3,
  state: 'flagged',
  reason: 'identity',
  note: '',
  measurement: null,
  reviewedAt: null,
}
const input: CoverReviewInput = {
  work,
  action: 'replace',
  note: 'Checked the title',
  reason: null,
  identityConfirmed: true,
  measurement: {
    url: 'https://books.google.com/books/content?id=right&zoom=1',
    width: 800,
    height: 1200,
  },
  candidate: { source: 'google', cover: 'https://books.google.com/books/content?id=right&zoom=1' },
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.rpc).mockResolvedValue({ data: work.id, error: null } as never)
})
it('keeps a working Google fallback linked and submits the exact reviewed snapshot', async () => {
  await saveCatalogCoverReview(input)
  expect(ingestCorpusCover).not.toHaveBeenCalled()
  expect(supabase.rpc).toHaveBeenCalledWith(
    'admin_review_corpus_cover',
    expect.objectContaining({
      p_work: 'work-1',
      p_expected_fingerprint: 'exact-state',
      p_expected_revision: 3,
      p_candidate: expect.objectContaining({ url: input.measurement!.url, source: 'google' }),
    }),
  )
})
it('stages permitted artwork under the work before selecting it, with no personal write', async () => {
  vi.mocked(ingestCorpusCover).mockResolvedValue({
    status: 'ok',
    data: {
      cover: 'https://project.test/storage/cover.webp',
      thumb: '',
      sourceUrl: null,
      color: null,
    },
  })
  await saveCatalogCoverReview({
    ...input,
    candidate: { source: 'hardcover', cover: 'https://assets.hardcover.app/new.jpg' },
    measurement: { url: 'https://assets.hardcover.app/new.jpg', width: 900, height: 1400 },
  })
  expect(ingestCorpusCover).toHaveBeenCalledWith(
    expect.objectContaining({ workId: 'work-1', source: 'hardcover' }),
  )
  expect(supabase.rpc).toHaveBeenCalledOnce()
  expect(supabase.rpc).toHaveBeenCalledWith(
    'admin_review_corpus_cover',
    expect.objectContaining({
      p_candidate: expect.objectContaining({ url: 'https://project.test/storage/cover.webp' }),
    }),
  )
})
it('does not approve when ingestion fails and preserves stale-state errors for the reviewer', async () => {
  vi.mocked(ingestCorpusCover).mockResolvedValue({ status: 'error', code: 'fetch_failed' })
  await expect(
    saveCatalogCoverReview({
      ...input,
      candidate: { source: 'hardcover', cover: 'https://assets.hardcover.app/new.jpg' },
      measurement: { url: 'https://assets.hardcover.app/new.jpg', width: 800, height: 1200 },
    }),
  ).rejects.toThrow('fetch_failed')
  expect(supabase.rpc).not.toHaveBeenCalled()
  vi.mocked(supabase.rpc).mockResolvedValue({
    data: null,
    error: new Error('This catalog record changed'),
  } as never)
  await expect(saveCatalogCoverReview(input)).rejects.toThrow('record changed')
})
it('retains server totals and bounded paging instead of loading the full corpus', async () => {
  vi.mocked(supabase.rpc).mockResolvedValue({
    data: { items: [work], total: 200 },
    error: null,
  } as never)
  expect(await fetchCatalogCoverQueue({ state: 'attention', query: 'Title', offset: 20 })).toEqual({
    items: [work],
    total: 200,
  })
  expect(supabase.rpc).toHaveBeenCalledWith(
    'admin_list_corpus_cover_reviews',
    expect.objectContaining({ p_limit: 20, p_offset: 20, p_query: 'Title' }),
  )
})
it('distinguishes failed lookup from an empty response in the review workspace', async () => {
  vi.mocked(supabase.functions.invoke).mockResolvedValue({
    data: null,
    error: new Error('Unavailable'),
  })
  await expect(fetchEditions({ title: 'A book' }, { throwOnError: true })).rejects.toThrow(
    'Unavailable',
  )
  expect(await fetchEditions({ title: 'A book' })).toEqual([])
})
it('keeps administrator reviews out of the offline mirror', () => {
  expect(isOfflinePersistableQueryKey(['catalog-cover-review', 'admin', 'queue'])).toBe(false)
  expect(isOfflinePersistableQueryKey(['books'])).toBe(true)
})
