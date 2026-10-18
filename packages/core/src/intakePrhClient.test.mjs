import { describe, expect, it, vi } from 'vitest'
import { createIntakeSourceClient } from '../../../scripts/intake-source-client.mjs'

const isbn = '9780306406157',
  fp = 'a'.repeat(64),
  provider = 'penguin_random_house'
const title = {
  status: 'ok',
  data: {
    isbn: Number(isbn),
    title: 'A Quiet Library',
    format: { description: 'Paperback' },
    pages: 240,
  },
}
const credits = {
  status: 'ok',
  recordCount: 1,
  data: [{ authorId: 1, display: 'Jane Smith', contribRoleCode: 'A', contribRoleDesc: 'Author' }],
}
const json = (v, status = 200) => new Response(JSON.stringify(v), { status })
const setup = (opts = {}) =>
  createIntakeSourceClient({
    providers: [provider],
    prhApiKey: 'private-api-key',
    sleeper: async () => {},
    ...opts,
  })
describe('bounded PRH title transport', () => {
  it('binds two exact fixed-host endpoints, caches paired controls and returns no key or raw response', async () => {
    const fetcher = vi.fn(async (url) =>
      json(new URL(url).pathname.endsWith('/authors') ? credits : title),
    )
    const providers = [provider],
      c = setup({ fetcher, providers })
    providers.push('hardcover')
    expect(Object.isFrozen(c.providers)).toBe(true)
    const first = await c.acquire(isbn, fp),
      second = await c.acquire(isbn, 'b'.repeat(64))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map(([u]) => new URL(u).pathname)).toEqual([
      `/resources/v2/title/domains/PRH.US/titles/${isbn}`,
      `/resources/v2/title/domains/PRH.US/titles/${isbn}/authors`,
    ])
    for (const [url, init] of fetcher.mock.calls) {
      expect(new URL(url).origin).toBe('https://api.penguinrandomhouse.com')
      expect(new URL(url).searchParams.get('api_key')).toBe('private-api-key')
      expect(init.redirect).toBe('manual')
    }
    expect(first[provider].observations[0].targetFingerprint).toBe(fp)
    expect(second[provider].observations[0].targetFingerprint).toBe('b'.repeat(64))
    expect(JSON.stringify({ first, second, stats: c.stats })).not.toContain('private-api-key')
  })
  it('does not add PRH to existing clients or acquire missing credentials', async () => {
    const fetcher = vi.fn()
    const c = setup({ fetcher, prhApiKey: undefined })
    expect((await c.acquire(isbn, fp))[provider].issues).toContain('missing_credential')
    expect(fetcher).not.toHaveBeenCalled()
    expect(createIntakeSourceClient().providers).toEqual(['openlibrary', 'hardcover'])
  })
  it('refuses returned ISBN mismatch before author lookup', async () => {
    const fetcher = vi.fn(async () =>
      json({ ...title, data: { ...title.data, isbn: 9781649374042 } }),
    )
    expect((await setup({ fetcher }).acquire(isbn, fp))[provider].issues).toContain(
      'prh_edition_identity_mismatch',
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([401, 403, 429, 302])('does not retry or follow HTTP %i responses', async (status) => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, { status, headers: { location: 'https://example.org/secret' } }),
    )
    const c = setup({ fetcher })
    const r = await c.acquire(isbn, fp)
    expect(r[provider].observations[0].status).toBe('failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(r)).not.toContain('secret')
    if (status !== 302) {
      await c.acquire('9781649374042', fp)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  it('distinguishes title absence from failed title-scoped contributors', async () => {
    expect(
      (await setup({ fetcher: async () => new Response(null, { status: 404 }) }).acquire(isbn, fp))[
        provider
      ].observations[0].status,
    ).toBe('empty')
    const fetcher = vi
      .fn(async () => json(title))
      .mockImplementationOnce(async () => json(title))
      .mockImplementationOnce(async () => new Response(null, { status: 404 }))
    expect((await setup({ fetcher }).acquire(isbn, fp))[provider].observations[0].status).toBe(
      'failed',
    )
  })
  it('caps requests and response bytes, stopping repeated failures without leaking exception URLs', async () => {
    const fetcher = vi.fn(async () => json(title)),
      c = setup({ fetcher, limits: { [provider]: 1 } })
    expect((await c.acquire(isbn, fp))[provider].observations[0].status).toBe('capped')
    expect(fetcher).toHaveBeenCalledTimes(1)
    const oversized = setup({ fetcher: async () => new Response('x'.repeat(524289)) })
    expect((await oversized.acquire(isbn, fp))[provider].issues).toContain('response_too_large')
    const fails = vi.fn(async () => {
        throw new Error('https://api.penguinrandomhouse.com?api_key=private-api-key')
      }),
      broken = setup({ fetcher: fails })
    const r = await broken.acquire(isbn, fp)
    await broken.acquire('9781649374042', fp)
    await broken.acquire('9780525558989', fp)
    expect(fails).toHaveBeenCalledTimes(2)
    expect(broken.stats[provider].stopped).toBe('infrastructure_failures')
    expect(JSON.stringify(r)).not.toContain('private-api-key')
  })
  it('validates market, providers and limits before any acquisition', () => {
    for (const options of [
      { prhDomain: 'PRH.CA' },
      { providers: ['evil'] },
      { providers: [provider, provider] },
      { limits: { [provider]: 41 } },
      { limits: { [provider]: 0 } },
    ])
      expect(() => setup(options)).toThrow()
  })
})
