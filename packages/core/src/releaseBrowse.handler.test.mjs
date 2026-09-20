import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Execute the real request handler with a stubbed Deno host and intercepted HTTP.
// This verifies wiring and cache/error boundaries, not live provider availability.
let handler, env, cache, calls, hardcoverFailure, publisherFailure, budgetAllowed
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-20T12:00:00Z'))
  cache = new Map()
  calls = []
  hardcoverFailure = publisherFailure = false
  budgetAllowed = true
  env = {
    SUPABASE_URL: 'https://database.invalid',
    SUPABASE_ANON_KEY: 'synthetic-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    HARDCOVER_TOKEN: 'synthetic-hardcover',
    PRH_API_KEY: 'synthetic-publisher',
  }
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
      calls.push({ u, init })
      if (u.hostname === 'database.invalid') {
        if (u.pathname === '/auth/v1/user') return Response.json({ id: 'reader' })
        if (u.pathname === '/rest/v1/rpc/rate_limit_consume')
          return Response.json({ allowed: budgetAllowed })
        if (u.pathname === '/rest/v1/releases_cache') {
          if (init.method === 'POST') {
            const row = JSON.parse(init.body)
            cache.set(row.cache_key, row)
            return Response.json(null)
          }
          const row = cache.get(u.searchParams.get('cache_key').replace(/^eq\./, ''))
          return Response.json(row ? [row] : [])
        }
      }
      if (u.hostname === 'api.hardcover.app') {
        if (hardcoverFailure) return Response.json({ errors: [{ message: 'unavailable' }] })
        const { variables } = JSON.parse(init.body)
        const pub = variables.to === '2026-09-20' ? '2026-09-18' : '2026-10-20'
        return Response.json({
          data: {
            editions: [
              {
                release_date: pub,
                isbn_13: '9780141441146',
                country: { code2: 'GB' },
                book: {
                  title: `Publication ${pub}`,
                  release_date: pub,
                  contributions: [{ author: { name: 'Fixture Author' } }],
                },
              },
            ],
          },
        })
      }
      if (u.hostname === 'api.penguinrandomhouse.com') {
        if (publisherFailure) return new Response('down', { status: 503 })
        return Response.json({ data: { titles: [] } })
      }
      throw new Error(`Unexpected HTTP destination: ${u.hostname}${u.pathname}`)
    }),
  )
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
const request = (token = true) =>
  new Request('https://edge.invalid/releases', {
    method: 'POST',
    headers: token ? { Authorization: 'Bearer synthetic-reader' } : {},
    body: JSON.stringify({ mode: 'browse' }),
  })
async function boot() {
  await import('../../../supabase/functions/releases/index.ts')
}

it('requires authentication, queries both date windows, then shares only the provider payload cache', async () => {
  await boot()
  expect((await handler(request(false))).status).toBe(401)
  expect(calls).toHaveLength(0)
  const response = await handler(request())
  expect(response.status).toBe(200)
  const body = await response.json()
  expect(body.providers).toEqual({ hardcover: 'ready', prh: 'ready' })
  expect(body.hits.map((h) => [h.pub, h.release.kind])).toEqual([
    ['2026-09-18', 'new_work'],
    ['2026-10-20', 'new_work'],
  ])
  const hc = calls.filter(({ u }) => u.hostname === 'api.hardcover.app')
  expect(hc.map(({ init }) => JSON.parse(init.body).variables)).toEqual([
    { from: '2026-06-22', to: '2026-09-20' },
    { from: '2026-09-21', to: '2027-03-22' },
  ])
  const prh = calls.filter(({ u }) => u.hostname === 'api.penguinrandomhouse.com')
  expect(
    prh.map(({ u }) => [u.searchParams.get('onSaleFrom'), u.searchParams.get('onSaleTo')]),
  ).toEqual([
    ['06/22/2026', '09/20/2026'],
    ['09/21/2026', '03/22/2027'],
  ])
  expect(cache.size).toBe(1)
  expect(await (await handler(request())).json()).toEqual(body)
  expect(calls.filter(({ u }) => u.hostname === 'api.hardcover.app')).toHaveLength(2)
  expect(calls.filter(({ u }) => u.hostname === 'api.penguinrandomhouse.com')).toHaveLength(2)
  expect(calls.every(({ u }) => !u.pathname.includes('/books'))).toBe(true)
})

it('does not cache a partial outage, and retry can recover the missing source', async () => {
  publisherFailure = true
  await boot()
  const body = await (await handler(request())).json()
  expect(body.hits).toHaveLength(2)
  expect(body.providers).toEqual({ hardcover: 'ready', prh: 'unavailable' })
  expect(cache.size).toBe(0)
  publisherFailure = false
  expect((await (await handler(request())).json()).providers.prh).toBe('ready')
  expect(cache.size).toBe(1)
})

it('returns unavailable when configured providers fail or their budgets are exhausted', async () => {
  hardcoverFailure = publisherFailure = true
  await boot()
  expect((await handler(request())).status).toBe(503)
  expect(cache.size).toBe(0)
  hardcoverFailure = publisherFailure = false
  budgetAllowed = false
  calls.length = 0
  expect((await handler(request())).status).toBe(503)
  expect(calls.some(({ u }) => u.hostname !== 'database.invalid')).toBe(false)
  expect(cache.size).toBe(0)
})
