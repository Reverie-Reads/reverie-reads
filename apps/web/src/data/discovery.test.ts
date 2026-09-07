import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discoveryKey } from '@reverie/core'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import { createDiscoverySession, rankDiscoveryIntent } from './discovery'
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  external: vi.fn(),
  details: vi.fn(),
  rows: [] as Record<string, unknown>[],
  filters: [] as unknown[][],
  error: null as unknown,
}))
vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: () => {
      const builder = {
        select: () => builder,
        order: () => builder,
        limit: () => builder,
        abortSignal: () => builder,
        contains: (...args: unknown[]) => {
          mocks.filters.push(args)
          return builder
        },
        eq: (...args: unknown[]) => {
          mocks.filters.push(args)
          return builder
        },
        or: (value: string) => {
          mocks.filters.push(['or', value])
          return builder
        },
        then: (resolve: (result: unknown) => unknown) =>
          Promise.resolve({ data: mocks.rows, error: mocks.error }).then(resolve),
      }
      return builder
    },
  },
}))
vi.mock('../lib/discover', () => ({ fetchDiscover: mocks.external, DISCOVER_BATCH: 20 }))
vi.mock('../lib/discoveryDetails', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/discoveryDetails')>()),
  fetchDiscoveryDetails: mocks.details,
}))
const id = 'f9300000-0000-4000-8000-000000000001'
const row = (title: string, description: string, extra = {}) => ({
  id,
  title,
  contributors: [{ name: 'Nell Stone', role: 'author' }],
  isbns: [],
  genre: 'fantasy',
  tags: [],
  description,
  ...extra,
})
beforeEach(() => {
  mocks.filters = []
  mocks.error = null
  mocks.rows = []
  mocks.external.mockReset().mockResolvedValue([])
  mocks.details.mockReset().mockResolvedValue({})
  mocks.invoke.mockReset().mockResolvedValue({ error: null, data: { scores: [] } })
})
describe('catalog to a stable discovery decision', () => {
  it('requires both moods, strips hidden markup, and keeps only source-supported picks', async () => {
    mocks.rows = [
      row('A welcome', 'An introspective story of hope.'),
      row('A shadow', '<script>introspective hope</script>A haunted house.', {
        id: id.replace(/1$/, '2'),
      }),
    ]
    const result = await createDiscoverySession(
      { kind: 'mood', moods: ['Reflective', 'Hopeful'] },
      [],
      new AbortController().signal,
    )
    expect(result.picks.map((p) => p.book.title)).toEqual(['A welcome'])
    expect(mocks.filters.filter((f) => f[0] === 'or')).toHaveLength(2)
    expect(result.picks[0]?.reason).toContain('“introspective” and “hope”')
  })
  it('excludes a possessed copy even before it has a corpus link, and preserves a wanted copy', async () => {
    mocks.rows = [
      row('A welcome', 'A hopeful adventure.'),
      row('A journey', 'Hopeful adventures.', { id: id.replace(/1$/, '2') }),
    ]
    const books = [
      makeBook({ id: 'own', title: 'A welcome', first: 'Nell', last: 'Stone', ownership: 'owned' }),
      makeBook({
        id: 'want',
        title: 'A journey',
        first: 'Nell',
        last: 'Stone',
        ownership: 'unowned',
        wishlist: true,
      }),
    ]
    const result = await createDiscoverySession(
      { kind: 'genre', genre: 'fantasy' },
      books,
      new AbortController().signal,
    )
    expect(result.picks.map((p) => p.book.title)).toEqual(['A journey'])
  })
  it('reports a catalog failure instead of claiming there are no matches', async () => {
    mocks.error = new Error('Catalog unavailable')
    await expect(
      createDiscoverySession({ kind: 'genre', genre: 'fantasy' }, [], new AbortController().signal),
    ).rejects.toThrow('Catalog unavailable')
  })
  it('survives ranking failure using actual author and genre facts', async () => {
    mocks.rows = [row('A welcome', 'A journey.')]
    mocks.invoke.mockRejectedValue(new Error('Model offline'))
    const result = await createDiscoverySession(
      {
        kind: 'anchor',
        anchor: {
          title: 'A beginning',
          authors: ['Nell Stone'],
          cover: '',
          isbn: '',
          pub: '',
          genre: 'fantasy',
        },
      },
      [],
      new AbortController().signal,
    )
    expect(result.picks[0]?.reason).toContain('Another book by Nell Stone')
    expect(result.id).toMatch(/^[a-f\d-]{36}$/)
  })
  it('ignores invented score keys and invalid values; stops when no progress is possible', async () => {
    const book = { title: 'A welcome', authors: ['Nell Stone'], cover: '', isbn: '', pub: '' }
    mocks.invoke.mockResolvedValue({
      data: {
        scores: [
          { key: 'unknown', score: 1 },
          { key: discoveryKey(book), score: 2 },
        ],
      },
      error: null,
    })
    expect(
      await rankDiscoveryIntent(
        [book],
        { kind: 'mood', moods: ['Hopeful'] },
        new AbortController().signal,
      ),
    ).toEqual({})
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
  })
  it('does not let a canceled search publish a new session', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      createDiscoverySession({ kind: 'mood', moods: ['Hopeful'] }, [], controller.signal),
    ).rejects.toThrow()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

it('does not choose the first of several catalog ISBNs as the reader edition', async () => {
  mocks.rows=[row('Several editions','A complete description.',{isbns:['9780306406157','9780140328721']}),
    row('One edition','A complete description.',{id:id.replace(/1$/,'2'),isbns:['9780306406157']})]
  const result=await createDiscoverySession({kind:'genre',genre:'fantasy'},[],new AbortController().signal)
  expect(result.picks.find(p=>p.book.title==='Several editions')?.book.isbn).toBe('')
  expect(result.picks.find(p=>p.book.title==='One edition')?.book.isbn).toBe('9780306406157')
})
