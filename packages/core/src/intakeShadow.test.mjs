import { describe, expect, it, vi } from 'vitest'
import { createIntakeSourceClient } from '../../../scripts/intake-source-client.mjs'
import {
  validateShadowFrame,
  resolveShadowTarget,
  scoreShadowCase,
  evaluateShadow,
  shadowCommand,
  claimShadowAttempt,
} from '../../../scripts/intake-shadow.mjs'
import { adaptOpenLibraryIntake } from './intakeSourceAdapters'
import { mkdtemp, writeFile, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const isbn = '9780306406157',
  fp = 'a'.repeat(64)
const target = { isbn, title: 'A Quiet Library', contributors: ['Jane Smith'] }
const edition = {
  key: '/books/OL1M',
  title: target.title,
  isbn_13: [isbn],
  authors: [{ key: '/authors/OL1A' }],
  number_of_pages: 240,
  physical_format: 'paperback',
}
const author = { key: '/authors/OL1A', name: 'Jane Smith' }
const frame = () => ({
  version: 1,
  purpose: 'independent_shadow_pilot',
  selection: 'Synthetic test only',
  cases: [
    {
      id: 'case-01',
      target,
      expectedIdentity: true,
      reference: {
        url: 'https://publisher.example/book',
        checkedAt: '2026-10-16',
        identity: target,
        facts: { pages: 240, format: 'paperback' },
      },
    },
  ],
})
const json = (v, status = 200) => new Response(JSON.stringify(v), { status })
const sleeper = async () => {}
const fetcher = () =>
  vi.fn(async (url) =>
    String(url).includes('/isbn/')
      ? json(edition)
      : String(url).includes('/authors/')
        ? json(author)
        : json({ data: { editions: [] } }),
  )

describe('bounded intake acquisition', () => {
  it('queries only fixed origins with exact ISBN and caches same-ISBN controls without donating a fingerprint', async () => {
    const fetch = fetcher(),
      sleep = vi.fn(sleeper)
    const c = createIntakeSourceClient({
      hardcoverToken: 'secret',
      fetcher: fetch,
      sleeper: sleep,
      now: () => Date.parse('2026-10-16T12:00:00Z'),
    })
    const first = await c.acquire(isbn, fp),
      second = await c.acquire(isbn, 'b'.repeat(64))
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(first.openlibrary.observations[0].targetFingerprint).toBe(fp)
    expect(second.openlibrary.observations[0].targetFingerprint).toBe('b'.repeat(64))
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toContain('contact@reveriereads.app')
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined()
    expect(fetch.mock.calls[2][1].headers.Authorization).toBe('Bearer secret')
    expect(JSON.parse(fetch.mock.calls[2][1].body).variables).toEqual({
      isbn,
      isbn10: '0306406152',
    })
    expect(sleep.mock.calls.some(([n]) => n >= 1100)).toBe(true)
    expect(JSON.stringify(second)).not.toContain('secret')
  })
  it.each([
    'https://evil.example/steal',
    'http://127.0.0.1/books/OL1M.json',
    'https://openlibrary.org/books/OL1M.json?x=1',
  ])('refuses an unapproved redirect: %s', async (location) => {
    const fetch = vi.fn(async () => new Response(null, { status: 302, headers: { location } }))
    const c = createIntakeSourceClient({ fetcher: fetch, sleeper })
    expect((await c.acquire(isbn, fp)).openlibrary.issues).toContain('redirect_refused')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it('allows just one same-origin edition redirect and key-bound author lookup', async () => {
    const fetch = vi.fn(async (url) =>
      String(url).includes('/isbn/')
        ? new Response(null, { status: 302, headers: { location: '/books/OL1M.json' } })
        : String(url).includes('/books/')
          ? json(edition)
          : json(author),
    )
    const c = createIntakeSourceClient({ fetcher: fetch, sleeper })
    expect((await c.acquire(isbn, fp)).openlibrary.observations[0].status).toBe('ok')
    expect(fetch).toHaveBeenCalledTimes(3)
  })
  it.each([401, 403, 429, 500])(
    'preserves HTTP %i failures without parsing an HTML error or retrying',
    async (status) => {
      const fetch = vi.fn(async () => new Response('<html>not JSON</html>', { status }))
      const c = createIntakeSourceClient({ fetcher: fetch, sleeper })
      expect((await c.acquire(isbn, fp)).openlibrary.observations[0].status).toBe('failed')
      expect(fetch).toHaveBeenCalledTimes(1)
    },
  )
  it('stops the source after rate limiting and never treats a GraphQL endpoint 404 as book absence', async () => {
    const fetch = vi.fn(
      async (url) => new Response(null, { status: String(url).includes('hardcover') ? 404 : 429 }),
    )
    const c = createIntakeSourceClient({ hardcoverToken: 'secret', fetcher: fetch, sleeper })
    const a = await c.acquire(isbn, fp)
    expect(a.hardcover.observations[0].status).toBe('failed')
    await c.acquire('9781649374042', fp)
    expect(c.stats.openlibrary.requests).toBe(1)
  })
  it('reports successful OL absence separately from missing credentials', async () => {
    const c = createIntakeSourceClient({
      fetcher: async () => new Response(null, { status: 404 }),
      sleeper,
    })
    const a = await c.acquire(isbn, fp)
    expect(a.openlibrary.observations[0].status).toBe('empty')
    expect(a.hardcover.issues).toContain('missing_credential')
  })
  it('bounds response bytes and author requests, with no identity completion from partial data', async () => {
    const oversized = createIntakeSourceClient({
      fetcher: async () => new Response('x'.repeat(524289)),
      sleeper,
    })
    expect((await oversized.acquire(isbn, fp)).openlibrary.issues).toContain('response_too_large')
    const c = createIntakeSourceClient({
      fetcher: fetcher(),
      sleeper,
      limits: { openlibrary: 1, hardcover: 1 },
    })
    expect((await c.acquire(isbn, fp)).openlibrary.issues).toContain('author_lookup_failed')
    expect(c.stats.openlibrary.requests).toBe(1)
  })
  it('rejects invalid target or unsupported limits before networking', () => {
    const fetch = fetcher(),
      c = createIntakeSourceClient({ fetcher: fetch, sleeper })
    expect(() => c.acquire('bad', fp)).toThrow()
    expect(() =>
      createIntakeSourceClient({ limits: { openlibrary: 1000, hardcover: 1 } }),
    ).toThrow()
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('truth-blind independent shadow scoring', () => {
  it('scores edition credit evidence only after acquisition and never gives references to review views', async () => {
    const f = frame()
    f.cases[0].reference.credits = [
      { name: 'Jane Smith', role: 'author', scope: 'whole' },
      { name: 'Reference Only Person', role: 'translator', scope: 'whole' },
    ]
    expect(() => validateShadowFrame(f)).not.toThrow()
    const fetch = fetcher(),
      views = []
    const report = await evaluateShadow(
      f,
      createIntakeSourceClient({ fetcher: fetch, sleeper }),
      (v) => views.push(v),
    )
    expect(report.cases[0].sources[0].creditChecks).toEqual(['edition_observed', 'missing'])
    expect(report.cases[0].sources[1].creditChecks).toEqual([
      'identity_withheld',
      'identity_withheld',
    ])
    expect(report.summary.sources[0].credits).toMatchObject({ edition_observed: 1, missing: 1 })
    for (const value of [views, fetch.mock.calls, report])
      expect(JSON.stringify(value)).not.toContain('Reference Only Person')
    expect(JSON.stringify(report)).not.toContain('Jane Smith')
    expect(views[0].review.sources[0].identity.contributors[0].name).toBe('Jane Smith')
  })
  it('does not confuse all scan-only targets with one development identity', () => {
    const f = frame()
    f.cases[0].target = { isbn }
    expect(() => validateShadowFrame(f, [{ isbn: '9781861972712' }])).not.toThrow()
    expect(() => validateShadowFrame(f, [{ isbn }])).toThrow()
  })
  it('consumes one shared attempt even if a second caller changes the system or output path', async () => {
    const common = await mkdtemp(join(tmpdir(), 'intake-attempt-'))
    const lock = { frameHash: 'a'.repeat(64), systemHash: 'b'.repeat(64) }
    try {
      const attempts = await Promise.allSettled([
        claimShadowAttempt(common, lock),
        claimShadowAttempt(common, { ...lock, systemHash: 'c'.repeat(64) }),
      ])
      expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1)
      expect(attempts.filter((a) => a.status === 'rejected')).toHaveLength(1)
      await expect(claimShadowAttempt(common, lock)).rejects.toThrow()
    } finally {
      await rm(common, { recursive: true, force: true })
    }
  })
  it('rejects private inputs, overlapping development identities and provider-as-reference gold', () => {
    const f = frame()
    expect(() => validateShadowFrame(f, [target])).toThrow()
    expect(() => validateShadowFrame({ ...f, ownerId: 'private' })).toThrow()
    f.cases[0].reference.url = 'https://openlibrary.org/books/OL1M'
    expect(() => validateShadowFrame(f)).toThrow()
  })
  it('keeps gold out of provider requests and retains no provider content in the report', async () => {
    const fetch = fetcher(),
      client = createIntakeSourceClient({ fetcher: fetch, sleeper })
    const f = frame(),
      before = JSON.stringify(f)
    const r = await evaluateShadow(f, client)
    expect(JSON.stringify(f)).toBe(before)
    expect(r.summary.sources[0]).toMatchObject({
      matchedPositive: 1,
      falseIdentityMatches: 0,
      fields: { agrees: 2, disagrees: 0, missing: 0 },
    })
    expect(r.summary.proposedFields).toBe(0)
    expect(r.summary.cutoverReady).toBe(false)
    for (const s of ['Jane Smith', 'A Quiet Library', 'publisher.example', 'secret', '240'])
      expect(JSON.stringify(r)).not.toContain(s)
    expect(JSON.stringify(fetch.mock.calls)).not.toContain('publisher.example')
  })
  it('detects incorrect scan-only identity against independent reference, not the ISBN query echo', async () => {
    const c = frame().cases[0]
    c.target = { isbn }
    const client = {
      acquire: async (_isbn, fingerprint) => ({
        openlibrary: adaptOpenLibraryIntake(
          { ...edition, title: 'Wrong Book' },
          { '/authors/OL1A': author },
          { targetFingerprint: fingerprint, retrievedAt: new Date().toISOString() },
        ),
      }),
    }
    const r = scoreShadowCase(c, await resolveShadowTarget(c.target, client))
    expect(r.sources[0].falseIdentityMatch).toBe(true)
  })
  it('detects a deliberately wrong reference and does not count absence as a safe rejection', async () => {
    const f = frame()
    f.cases[0].reference.facts.pages = 999
    const r = await evaluateShadow(f, createIntakeSourceClient({ fetcher: fetcher(), sleeper }))
    expect(r.summary.sources[0].fields.disagrees).toBe(1)
    expect(r.summary.sources[1]).toMatchObject({ unobserved: 1, heldNegative: 0 })
  })
  // Integration I/O: hashes the imported source tree three times; allow bounded disk contention.
  it('freezes private hashes, refuses overwrite and detects code/frame drift before acquisition', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'intake-shadow-'))
    try {
      const input = join(dir, 'frame.json'),
        prior = join(dir, 'prior.json'),
        lock = join(dir, 'lock.json'),
        out = join(dir, 'out.json')
      const fresh = frame()
      fresh.cases[0].target = {
        isbn: '9781861972712',
        title: 'Fresh Evaluation',
        contributors: ['Sally Green'],
      }
      fresh.cases[0].reference.identity = fresh.cases[0].target
      await writeFile(input, JSON.stringify(fresh))
      await writeFile(
        prior,
        JSON.stringify({
          cases: [
            {
              request: {
                target: {
                  isbn: '9781649374042',
                  title: 'Different Book',
                  contributors: ['Anne Brown'],
                },
              },
            },
          ],
        }),
      )
      const sealed = await shadowCommand(['freeze', input, lock, prior])
      expect(sealed.frameHash).toMatch(/^[a-f0-9]{64}$/)
      expect((await stat(lock)).mode & 0o777).toBe(0o600)
      await expect(shadowCommand(['freeze', input, lock, prior])).rejects.toThrow()
      const f = structuredClone(fresh)
      f.cases[0].reference.facts.pages = 999
      await writeFile(input, JSON.stringify(f))
      await expect(shadowCommand(['run', input, lock, out])).rejects.toThrow('Shadow lock changed')
      expect(JSON.parse(await readFile(lock, 'utf8'))).toEqual(sealed)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 30000)
})
