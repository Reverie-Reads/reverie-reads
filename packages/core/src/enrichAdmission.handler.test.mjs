import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Execute the actual Edge request handler under Vitest's TS transform. Only Deno hosting/env,
// pacing and rate-limit I/O are substituted; routing, normalization, merge and cache I/O run.
// This is not a hosted Deno deployment test. Every HTTP request is intercepted (no live providers).
vi.mock('../../../supabase/functions/_shared/sourcePace.ts', () => ({
  paceSource: vi.fn(async () => true),
}))
vi.mock('../../../supabase/functions/_shared/ratelimit.ts', () => ({
  envInt: (_name, fallback) => fallback,
  rateLimit: vi.fn(async () => ({ allowed: true })),
  tooMany: vi.fn(),
}))

const ISBN = '9780000000002'
const TITLE = 'Fictional Exit Fixture'
const AUTHOR = 'Test Author'
let handler
let calls
let cache
let env
let envReads
let override

beforeEach(() => {
  vi.resetModules()
  handler = undefined
  calls = []
  cache = new Map()
  envReads = []
  override = null
  env = {
    SUPABASE_URL: 'https://database.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-value',
    ENRICH_SOURCES: 'openlibrary,google,isbndb',
    ISBNDB_ENABLED: 'true',
    ISBNDB_KEY: 'synthetic-retired-key',
  }
  vi.stubGlobal('Deno', {
    env: {
      get: (name) => {
        envReads.push(name)
        return env[name]
      },
    },
    serve: (fn) => {
      handler = fn
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const u = new URL(url)
      calls.push({ url: u, init })
      if (u.hostname === 'database.invalid' && u.pathname === '/rest/v1/enrichment_cache') {
        if (init.method === 'POST') {
          const row = JSON.parse(init.body)
          cache.set(row.key, row)
          return Response.json(null)
        }
        const key = u.searchParams.get('key').replace(/^eq\./, '')
        return Response.json(cache.has(key) ? [cache.get(key)] : [])
      }
      if (override) {
        const result = await override(u, init)
        if (result) return result
      }
      if (u.hostname === 'www.googleapis.com') {
        return Response.json({
          items: [
            {
              id: 'synthetic-volume',
              volumeInfo: {
                title: TITLE,
                authors: [AUTHOR],
                pageCount: 123,
                industryIdentifiers: [{ type: 'ISBN_13', identifier: ISBN }],
                imageLinks: { thumbnail: 'https://books.google.com/synthetic.jpg' },
              },
            },
          ],
        })
      }
      if (u.hostname === 'openlibrary.org' && u.pathname.startsWith('/isbn/'))
        return Response.json({
          key: '/books/OL1M',
          title: TITLE,
          authors: [{ key: '/authors/OL1A' }],
          isbn_13: [ISBN],
          number_of_pages: 123,
          covers: [321],
        })
      if (u.hostname === 'openlibrary.org' && u.pathname === '/authors/OL1A.json')
        return Response.json({ key: '/authors/OL1A', name: AUTHOR })
      if (u.hostname === 'openlibrary.org')
        return Response.json({
          docs: [
            {
              title: TITLE,
              author_name: [AUTHOR],
              number_of_pages_median: 123,
              isbn: [ISBN],
              cover_i: 321,
            },
          ],
        })
      if (u.hostname === 'api.hardcover.app') {
        return Response.json({ data: { search: { results: { hits: [] } } } })
      }
      throw new Error(`Unexpected outbound host: ${u.hostname}`)
    }),
  )
})

afterEach(() => vi.unstubAllGlobals())

async function boot() {
  await import('../../../supabase/functions/enrich/index.ts')
  expect(handler).toBeTypeOf('function')
}

async function request(body) {
  const response = await handler(
    new Request('https://function.invalid/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

const identity = { isbn: ISBN, title: TITLE, author: AUTHOR }
const edition = (extra = {}) =>
  Response.json({
    key: '/books/OL1M',
    title: TITLE,
    authors: [{ key: '/authors/OL1A' }],
    isbn_13: [ISBN],
    number_of_pages: 123,
    ...extra,
  })
const hc = (documents) =>
  Response.json({
    data: { search: { results: { hits: documents.map((document) => ({ document })) } } },
  })

it.each(['fast', 'full'])(
  'rejects a wrong returned ISBN before reading authors in %s',
  async (mode) => {
    override = (u) =>
      u.pathname.startsWith('/isbn/') ? edition({ isbn_13: ['9780306406157'] }) : null
    await boot()
    const result = await request({ ...identity, mode })
    expect(result.source).toBeNull()
    expect(result.pageCount).toBeNull()
    expect(result.identityUnresolved).toBe(true)
    expect(calls.some((c) => c.url.pathname.startsWith('/authors/'))).toBe(false)
    expect(cache.size).toBe(0)
  },
)
it.each([[], ['not-an-isbn']])(
  'rejects missing or malformed returned ISBNs: %j',
  async (isbn_13) => {
    override = (u) => (u.pathname.startsWith('/isbn/') ? edition({ isbn_13 }) : null)
    await boot()
    expect((await request(identity)).identityUnresolved).toBe(true)
  },
)
it('uses declared subtitles but rejects an invented title suffix', async () => {
  override = (u) =>
    u.pathname.startsWith('/isbn/') ? edition({ subtitle: 'Collected Stories' }) : null
  await boot()
  expect((await request({ ...identity, title: `${TITLE}: Collected Stories` })).pageCount).toBe(123)
  expect((await request({ ...identity, title: `${TITLE}: Another Collection` })).source).toBeNull()
})
it('does not mistake a matching surname for the same contributor', async () => {
  override = (u) =>
    u.pathname.startsWith('/authors/')
      ? Response.json({ key: '/authors/OL1A', name: 'Another Author' })
      : null
  await boot()
  expect((await request(identity)).source).toBeNull()
  expect(cache.size).toBe(0)
})
it('requires the complete edition contributor lookup', async () => {
  override = (u) =>
    u.pathname.startsWith('/isbn/')
      ? edition({ authors: [{ key: '/authors/OL1A' }, { key: '/authors/OL2A' }] })
      : u.pathname === '/authors/OL2A.json'
        ? new Response('unavailable', { status: 503 })
        : null
  await boot()
  const result = await request(identity)
  expect(result.source).toBeNull()
  expect(result.sourcesFailed).toBe(true)
  expect(result.authors).toEqual([])
})
it('keeps work search medians, arbitrary ISBNs and series labels out of selected edition fields', async () => {
  await boot()
  const result = await request({ title: TITLE, author: AUTHOR })
  expect(result.title).toBe(TITLE)
  expect(result.confidence).toBe('high')
  expect(result.pageCount).toBeNull()
  expect(result.isbn).toBe('')
  expect(result.editionId).toBe('')
  expect(result.pubY).toBeNull()
})
it('checks every source, admits a later exact hit and rejects an unrelated first hit', async () => {
  env.HARDCOVER_TOKEN = 'synthetic-token'
  override = (u) =>
    u.hostname === 'api.hardcover.app'
      ? hc([
          {
            title: 'Unrelated',
            author_names: ['Someone Else'],
            isbns: [ISBN],
            description: 'WRONG DESCRIPTION',
          },
          {
            title: TITLE,
            author_names: [AUTHOR],
            isbns: [ISBN],
            description: 'Matching work description',
            pages: 999,
          },
        ])
      : null
  await boot()
  const result = await request(identity)
  expect(result.description).toBe('Matching work description')
  expect(result.pageCount).toBe(123)
  expect(result.authors).toEqual([AUTHOR])
  expect(result.admissionVersion).toBe(2)
})
it('does not cache a partial response when HTTP-200 GraphQL errors accompany an otherwise valid edition', async () => {
  env.HARDCOVER_TOKEN = 'synthetic-token'
  override = (u) =>
    u.hostname === 'api.hardcover.app'
      ? Response.json({ errors: [{ message: 'rate limit' }] })
      : null
  await boot()
  const result = await request(identity)
  expect(result.pageCount).toBe(123)
  expect(result.source).toBe('openlibrary')
  expect(cache.size).toBe(0)
})
it.each(['fast', 'full'])(
  'reports provider outages instead of an empty successful answer in %s',
  async (mode) => {
    override = (u) =>
      u.hostname === 'openlibrary.org' ? new Response('server error', { status: 503 }) : null
    await boot()
    const result = await request({ ...identity, mode })
    expect(result.sourcesFailed).toBe(true)
    expect(cache.size).toBe(0)
  },
)
it('quarantines competing exact work hits', async () => {
  override = (u) =>
    u.pathname === '/search.json'
      ? Response.json({
          docs: [
            { key: '/works/OL1W', title: TITLE, author_name: [AUTHOR] },
            { key: '/works/OL2W', title: TITLE, author_name: [AUTHOR] },
          ],
        })
      : null
  await boot()
  const result = await request({ title: TITLE, author: AUTHOR })
  expect(result.source).toBeNull()
  expect(result.identityUnresolved).toBe(true)
})
it('does not reuse a cached ISBN response for a conflicting requested title or author', async () => {
  await boot()
  expect((await request(identity)).pageCount).toBe(123)
  const result = await request({ ...identity, title: 'A different book' })
  expect(result.source).toBeNull()
  expect(result.pageCount).toBeNull()
})
it('dates and pages retain actual edition precision and range', async () => {
  override = (u) =>
    u.pathname.startsWith('/isbn/')
      ? edition({ publish_date: 'September 28, 2010', number_of_pages: 576 })
      : null
  await boot()
  expect(await request(identity)).toMatchObject({ pubY: 2010, pubM: 9, pubD: 28, pageCount: 576 })
})

it('sends the identified Open Library headers on edition and each contributor fetch', async () => {
  await boot()
  await request(identity)
  const requests = calls.filter((c) => c.url.hostname === 'openlibrary.org')
  expect(requests.map((c) => c.url.pathname)).toEqual([`/isbn/${ISBN}.json`, '/authors/OL1A.json'])
  for (const c of requests)
    expect(new Headers(c.init.headers).get('user-agent')).toMatch(/Reverie.*@/)
})
