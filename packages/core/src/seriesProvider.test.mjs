import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Execute the actual handler, with every outbound request intercepted. Not a hosted Deno test.
let handler, env, cache, upstream, requests, logs
const success = {
  data: {
    series: [
      {
        id: 7,
        name: 'The Sequence',
        books_count: 2,
        book_series: [
          {
            position: 1,
            book: { title: 'First Book', contributions: [{ author: { name: 'Ada Reader' } }] },
          },
        ],
      },
    ],
  },
}

beforeEach(() => {
  vi.resetModules()
  env = {
    SUPABASE_URL: 'https://database.invalid',
    SUPABASE_ANON_KEY: 'synthetic-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    HARDCOVER_TOKEN: 'synthetic-token',
  }
  cache = new Map()
  requests = []
  upstream = async () => Response.json(success)
  logs = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('Deno', {
    env: { get: (key) => env[key] },
    serve: (fn) => {
      handler = fn
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const u = new URL(url)
      if (u.hostname === 'api.hardcover.app') {
        requests.push(init)
        return upstream(url, init)
      }
      if (u.hostname !== 'database.invalid') throw new Error('Unexpected outbound request')
      if (u.pathname === '/auth/v1/user') return Response.json({ id: 'synthetic-reader' })
      if (u.pathname === '/rest/v1/releases_cache') {
        if (init.method === 'POST') {
          const row = JSON.parse(init.body)
          cache.set(row.cache_key, row)
          return Response.json(null)
        }
        const key = u.searchParams.get('cache_key').replace(/^eq\./, '')
        return Response.json(cache.has(key) ? [cache.get(key)] : [])
      }
      throw new Error('Unexpected database request')
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function boot() {
  await import('../../../supabase/functions/series/index.ts')
}
async function request() {
  const response = await handler(
    new Request('https://function.invalid/series', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-reader' },
      body: JSON.stringify({ name: 'The Sequence', author: 'Ada Reader' }),
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

describe('series relationship handler diagnostics and retry cache', () => {
  it.each(['synthetic-token', ' Bearer synthetic-token ', 'bearer synthetic-token'])(
    'accepts bare and dashboard-prefixed credentials (%s)',
    async (token) => {
      env.HARDCOVER_TOKEN = token
      await boot()
      const result = await request()
      expect(result.entries).toEqual([{ title: 'First Book', author: 'Ada Reader', position: 1 }])
      expect(requests[0].headers.Authorization).toBe('Bearer synthetic-token')
      expect(result.unavailable).toBeUndefined()
      expect(logs).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['http_error', () => new Response('private upstream text', { status: 401 }), 401],
    ['http_error', () => new Response('not json', { status: 429 }), 429],
    ['http_error', () => new Response('gateway', { status: 503 }), 503],
    [
      'graphql_error',
      () => Response.json({ errors: [{ message: 'private upstream text' }], ...success }),
      200,
    ],
    ['invalid_response', () => new Response('not json'), 200],
    ['invalid_response', () => Response.json({ data: {} }), 200],
    ['not_found', () => Response.json({ data: { series: [] } }), 200],
    ['empty_relationship', () => Response.json({ data: { series: [{ book_series: [] }] } }), 200],
    [
      'network_error',
      () => {
        throw new Error('private upstream text')
      },
      undefined,
    ],
  ])(
    'returns a bounded %s diagnostic, not a no-series assertion',
    async (failureCode, response, status) => {
      upstream = response
      await boot()
      const result = await request()
      expect(result).toMatchObject({ unavailable: true, entries: [], sourceRef: null, failureCode })
      expect(result.httpStatus).toBe(status)
      expect(logs).toHaveBeenCalledTimes(1)
      const log = JSON.parse(logs.mock.calls[0][0])
      expect(log).toMatchObject({ fn: 'series', event: 'relationship_unavailable', failureCode })
      const persisted = JSON.stringify([...cache.values()]) + JSON.stringify(logs.mock.calls)
      expect(persisted).not.toMatch(/private upstream text|synthetic-token|Authorization/)
    },
  )

  it('identifies missing configuration without calling Hardcover', async () => {
    delete env.HARDCOVER_TOKEN
    await boot()
    expect(await request()).toMatchObject({ unavailable: true, failureCode: 'not_configured' })
    expect(requests).toHaveLength(0)
  })

  it('distinguishes a deadline from a network failure', async () => {
    vi.useFakeTimers()
    upstream = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('private timeout detail'))),
      )
    await boot()
    const pending = request()
    await vi.advanceTimersByTimeAsync(5001)
    expect(await pending).toMatchObject({ unavailable: true, failureCode: 'timeout' })
  })

  it.each([true, false])(
    'retries an unavailable cache after five minutes (new diagnostic=%s)',
    async (diagnostic) => {
      cache.set('series:the sequence|ada reader', {
        cache_key: 'series:the sequence|ada reader',
        fetched_at: new Date(Date.now() - 6 * 60_000).toISOString(),
        payload: {
          name: 'The Sequence',
          entries: [],
          unavailable: true,
          ...(diagnostic ? { failureCode: 'http_error', httpStatus: 503 } : {}),
        },
      })
      await boot()
      expect((await request()).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)
    },
  )

  it('uses a recent failure cache to avoid immediate retry storms', async () => {
    upstream = () => new Response('', { status: 503 })
    await boot()
    const first = await request()
    expect(await request()).toEqual(first)
    expect(requests).toHaveLength(1)
  })

  it('continues to share successful relationships for 24 hours', async () => {
    await boot()
    const first = await request()
    const row = [...cache.values()][0]
    row.fetched_at = new Date(Date.now() - 60 * 60_000).toISOString()
    expect(await request()).toEqual(first)
    expect(requests).toHaveLength(1)
  })
})
