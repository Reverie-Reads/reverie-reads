import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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

beforeEach(() => {
  vi.resetModules()
  handler = undefined
  calls = []
  cache = new Map()
  envReads = []
  env = {
    SUPABASE_URL: 'https://database.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-value',
    ENRICH_SOURCES: 'google,isbndb',
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
      if (u.hostname === 'openlibrary.org') return Response.json({ docs: [] })
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

function assertNoPaidCalls() {
  expect(calls.some(({ url }) => url.hostname.includes('isbndb'))).toBe(false)
  expect(envReads).not.toContain('ISBNDB_KEY')
  expect(envReads).not.toContain('ISBNDB_ENABLED')
}

describe('ISBNdb retirement at the actual enrichment handler', () => {
  it.each(['fast', 'full'])(
    'does not activate ISBNdb via CSV, flag or key in %s mode',
    async (mode) => {
      await boot()
      const body = await request({ isbn: ISBN, mode })
      expect(body.title).toBe(TITLE)
      expect(body.pageCount).toBe(123)
      expect(body.provenance.pageCount.source).toBe('google')
      expect(calls.some(({ url }) => url.hostname === 'www.googleapis.com')).toBe(true)
      assertNoPaidCalls()
    },
  )

  it.each(['fast', 'full'])(
    'refuses a retired-only or inherited-property roster in %s mode',
    async (mode) => {
      env.ENRICH_SOURCES = 'ISBNDB,manual,__proto__,constructor,toString,unknown'
      await boot()
      const body = await request({ isbn: ISBN, mode })
      expect(body.title).toBe('')
      expect(body.pageCount).toBeNull()
      expect(calls.every(({ url }) => url.hostname === 'database.invalid')).toBe(true)
      assertNoPaidCalls()
    },
  )

  it('keeps free defaults and token-enabled Hardcover available', async () => {
    delete env.ENRICH_SOURCES
    env.HARDCOVER_TOKEN = 'synthetic-hardcover-token'
    await boot()
    const body = await request({ title: TITLE, author: AUTHOR, isbn: ISBN })
    expect(body.title).toBe(TITLE)
    expect(new Set(calls.map(({ url }) => url.hostname))).toEqual(
      new Set(['database.invalid', 'openlibrary.org', 'www.googleapis.com', 'api.hardcover.app']),
    )
    assertNoPaidCalls()
  })

  it('honors an Open-Library-only roster in fast mode', async () => {
    env.ENRICH_SOURCES = 'openlibrary,isbndb'
    await boot()
    await request({ title: TITLE, mode: 'fast' })
    expect(calls.some(({ url }) => url.hostname === 'openlibrary.org')).toBe(true)
    expect(calls.some(({ url }) => url.hostname === 'www.googleapis.com')).toBe(false)
    assertNoPaidCalls()
  })

  it.each([
    [{ isbn: ISBN }, `isbn:${ISBN}`],
    [{ title: TITLE, author: AUTHOR }, 'ta:fictionalexitfixture|testauthor'],
  ])('never reads or overwrites a legacy mixed-source cache entry (%j)', async (input, oldKey) => {
    // Scalar provenance alone would miss ISBNdb's contribution to these unioned authors/genres.
    const oldRow = {
      key: oldKey,
      complete: true,
      fetched_at: new Date().toISOString(),
      record: {
        title: 'Retired payload',
        authors: ['Retired contribution'],
        genres: ['fantasy'],
        provenance: { title: { source: 'google', at: new Date().toISOString() } },
      },
    }
    cache.set(oldKey, oldRow)
    await boot()
    const first = await request(input)
    expect(first.title).toBe(TITLE)
    expect(first.authors).toEqual([AUTHOR])
    expect(first.source).not.toBe('cache')
    const writes = calls.filter(({ init }) => init.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0].init.body).key).toBe(`no-isbndb-v1:${oldKey}`)
    expect(cache.get(oldKey)).toBe(oldRow)
    const reads = calls.filter(
      ({ url, init }) => url.hostname === 'database.invalid' && !init.method,
    )
    expect(reads[0].url.searchParams.get('key')).toBe(`eq.no-isbndb-v1:${oldKey}`)

    calls.length = 0
    const second = await request(input)
    expect(second.source).toBe('cache')
    expect(second.title).toBe(TITLE)
    expect(calls).toHaveLength(1)
    expect(calls[0].url.hostname).toBe('database.invalid')
    assertNoPaidCalls()
  })

  it('refresh skips the new cache without resurrecting the retired provider', async () => {
    await boot()
    await request({ isbn: ISBN, refresh: true })
    expect(calls.some(({ url, init }) => url.hostname === 'database.invalid' && !init.method)).toBe(
      false,
    )
    expect(calls.some(({ url }) => url.hostname === 'www.googleapis.com')).toBe(true)
    assertNoPaidCalls()
  })
})
