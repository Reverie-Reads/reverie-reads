import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isOrderSourceUrl,
  useSaveCorpusSeriesEntry,
  useSeriesOrderReview,
} from './corpusSeriesCatalog'
import { isOfflinePersistableQueryKey } from '../lib/offlineCache'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}))
beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockResolvedValue({ data: {}, error: null })
})

describe('order citation link hygiene', () => {
  it.each([
    'https://publisher.example/title',
    'https://author.example',
    'https://sub.author.example/books/',
  ])('accepts %s', (url) => {
    expect(isOrderSourceUrl(url)).toBe(true)
  })
  it.each([
    'javascript:alert(1)',
    'http://author.example/book',
    'https://user:password@author.example/book',
    'https://author.example/book?api_key=secret',
    'https://author.example/book#section',
    'https://localhost/book',
    'https://author.example/\nbook',
    'https://author.example/\\book',
    'https://author.example/' + 'a'.repeat(2000),
  ])('refuses %s', (url) => {
    expect(isOrderSourceUrl(url)).toBe(false)
  })
})

type Mutation = { mutationFn: (input: object) => Promise<unknown>; onSuccess: () => Promise<void> }
const existing = {
  seriesId: 'series',
  revision: 4,
  entryId: 'entry',
  title: 'Slot title',
  author: 'Writer',
  position: 5,
  label: '',
}
it('uses the cited-order RPC for existing slots, including unbound identity edits', async () => {
  const mutation = useSaveCorpusSeriesEntry() as unknown as Mutation
  await mutation.mutationFn({
    ...existing,
    sourceUrl: ' https://publisher.example/book ',
    reviewNote: ' Checked exact order. ',
  })
  expect(mocks.rpc).toHaveBeenCalledWith('review_corpus_series_entry_order', {
    p_series: 'series',
    p_expected_revision: 4,
    p_entry: 'entry',
    p_title: 'Slot title',
    p_author: 'Writer',
    p_position: 5,
    p_label: '',
    p_source_url: 'https://publisher.example/book',
    p_note: 'Checked exact order.',
  })
  await mutation.onSuccess()
  expect(mocks.invalidate).toHaveBeenCalledWith({
    queryKey: ['catalog-metadata-review', 'series-order'],
  })
})
it('keeps new-slot creation on the existing RPC', async () => {
  await (useSaveCorpusSeriesEntry() as unknown as Mutation).mutationFn({
    ...existing,
    entryId: null,
  })
  expect(mocks.rpc).toHaveBeenCalledWith(
    'save_corpus_series_entry',
    expect.objectContaining({ p_entry: null, p_title: 'Slot title' }),
  )
})
it('does not fall back to the old writer when review fails', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: new Error('stale revision') })
  await expect(
    (useSaveCorpusSeriesEntry() as unknown as Mutation).mutationFn(existing),
  ).rejects.toThrow('stale revision')
  expect(mocks.rpc).toHaveBeenCalledOnce()
})

type ReviewQuery = {
  queryKey: unknown[]
  enabled: boolean
  gcTime: number
  queryFn: () => Promise<unknown>
}
const useHistoryQuery = () => useSeriesOrderReview('series', 'entry') as unknown as ReviewQuery
function historyResponse(data: unknown, error: Error | null = null) {
  const query = { select: vi.fn(), eq: vi.fn(), not: vi.fn(), order: vi.fn(), limit: vi.fn() }
  for (const method of ['select', 'eq', 'not', 'order'] as const)
    query[method].mockReturnValue(query)
  query.limit.mockResolvedValue({ data, error })
  mocks.from.mockReturnValue(query)
  return query
}
it('reads only the last cited entry review and keeps it out of the offline cache', async () => {
  const review = {
    sourceUrl: 'https://publisher.example/book',
    note: 'Exact work checked.',
    position: 5,
  }
  const chain = historyResponse([
    { next_value: { orderReview: { ...review, privateExtra: 'not exposed' } } },
  ])
  const query = useHistoryQuery()
  expect(await query.queryFn()).toEqual(review)
  expect(chain.eq).toHaveBeenCalledWith('next_value->>id', 'entry')
  expect(chain.not).toHaveBeenCalledWith('next_value->orderReview', 'is', null)
  expect(chain.limit).toHaveBeenCalledWith(1)
  expect(isOfflinePersistableQueryKey(query.queryKey)).toBe(false)
  expect(query.gcTime).toBe(0)
  expect((useSeriesOrderReview('series') as unknown as ReviewQuery).enabled).toBe(false)
})
it('does not render malformed stored links or hide an unavailable history as an empty result', async () => {
  historyResponse([
    {
      next_value: {
        orderReview: { sourceUrl: 'javascript:alert(1)', note: 'Unsafe', position: 5 },
      },
    },
  ])
  expect(await useHistoryQuery().queryFn()).toBeNull()
  historyResponse(null, new Error('history unavailable'))
  await expect(useHistoryQuery().queryFn()).rejects.toThrow('history unavailable')
})
