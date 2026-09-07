import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { googleBooks } from '../src/providers/google-books.mjs'

const originalFetch = globalThis.fetch
const originalKey = process.env.GOOGLE_BOOKS_KEY
const originalApiKey = process.env.GOOGLE_BOOKS_API_KEY
const originalViteKey = process.env.VITE_GOOGLE_BOOKS_KEY
const originalReferrer = process.env.GOOGLE_BOOKS_REFERRER
const originalDelayMs = process.env.GOOGLE_BOOKS_DELAY_MS
const originalConcurrency = process.env.GOOGLE_BOOKS_CONCURRENCY
const originalCooldownMs = process.env.GOOGLE_BOOKS_429_COOLDOWN_MS

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [name, value] of [
    ['GOOGLE_BOOKS_KEY', originalKey],
    ['GOOGLE_BOOKS_API_KEY', originalApiKey],
    ['VITE_GOOGLE_BOOKS_KEY', originalViteKey],
    ['GOOGLE_BOOKS_REFERRER', originalReferrer],
    ['GOOGLE_BOOKS_DELAY_MS', originalDelayMs],
    ['GOOGLE_BOOKS_CONCURRENCY', originalConcurrency],
    ['GOOGLE_BOOKS_429_COOLDOWN_MS', originalCooldownMs],
  ]) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('accepts the production Supabase key name and sends the configured origin', async () => {
  process.env.GOOGLE_BOOKS_KEY = 'production-key-name'
  delete process.env.GOOGLE_BOOKS_API_KEY
  delete process.env.VITE_GOOGLE_BOOKS_KEY
  process.env.GOOGLE_BOOKS_REFERRER = 'https://reveriereads.app/'
  process.env.GOOGLE_BOOKS_DELAY_MS = '0'

  let requestedUrl = ''
  let requestedHeaders
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url)
    requestedHeaders = options?.headers
    return new Response(
      JSON.stringify({
        items: [
          {
            id: 'google-work-1',
            volumeInfo: {
              title: 'The Way of Kings',
              authors: ['Brandon Sanderson'],
              publishedDate: '2010-08-31',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const [result] = await googleBooks.run([
    {
      id: 'way-of-kings',
      title: 'The Way of Kings',
      authors: ['Brandon Sanderson'],
    },
  ])

  assert.equal(new URL(requestedUrl).searchParams.get('key'), 'production-key-name')
  assert.deepEqual(requestedHeaders, {
    Referer: 'https://reveriereads.app/',
    Origin: 'https://reveriereads.app/',
  })
  assert.equal(result.workMatch.matched, true)
  assert.equal(result.workMatch.providerWorkId, 'google-work-1')
  assert.deepEqual(result.seriesClaims, [])
})

test('paces concurrent workers through one shared request-start schedule', async () => {
  process.env.GOOGLE_BOOKS_DELAY_MS = '25'
  process.env.GOOGLE_BOOKS_CONCURRENCY = '4'

  const requestStarts = []
  let scheduledStall = false
  globalThis.fetch = async () => {
    requestStarts.push(Date.now())
    if (!scheduledStall) {
      scheduledStall = true
      setTimeout(() => {
        const stalledUntil = Date.now() + 75
        while (Date.now() < stalledUntil) {
          // Simulate a busy event loop after multiple workers have queued their request slots.
        }
      }, 5)
    }
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  await googleBooks.run(
    Array.from({ length: 4 }, (_, index) => ({
      id: `case-${index}`,
      title: `Book ${index}`,
      authors: ['Example Author'],
    })),
  )

  assert.equal(requestStarts.length, 4)
  for (let index = 1; index < requestStarts.length; index += 1) {
    assert.ok(requestStarts[index] - requestStarts[index - 1] >= 20)
  }
})

test('pauses the shared schedule and retries after a quota response', async () => {
  process.env.GOOGLE_BOOKS_DELAY_MS = '0'
  process.env.GOOGLE_BOOKS_CONCURRENCY = '2'
  process.env.GOOGLE_BOOKS_429_COOLDOWN_MS = '30'

  const requestStarts = []
  let rateLimited = false
  globalThis.fetch = async () => {
    requestStarts.push(Date.now())
    if (!rateLimited) {
      rateLimited = true
      return new Response(JSON.stringify({ error: { status: 'rateLimitExceeded' } }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const results = await googleBooks.run([
    { id: 'case-1', title: 'Book One', authors: ['Example Author'] },
    { id: 'case-2', title: 'Book Two', authors: ['Example Author'] },
  ])

  assert.equal(
    results.some((result) => result.error),
    false,
  )
  assert.equal(requestStarts.length, 3)
  assert.ok(requestStarts.at(-1) - requestStarts[0] >= 25)
})
