import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const worker = readFileSync('public/sw.js', 'utf8')

function harness() {
  const handlers = new Map<string, (event: unknown) => void>()
  const match = vi.fn()
  const put = vi.fn()
  const remove = vi.fn().mockResolvedValue(true)
  const fetch = vi.fn()
  const deleteCache = vi.fn().mockResolvedValue(true)
  const cacheKeys = vi.fn().mockResolvedValue([])
  runInNewContext(worker, {
    URL,
    self: {
      location: { origin: 'https://midniht.app' },
      clients: { claim: vi.fn() },
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
    },
    caches: {
      match,
      open: vi.fn().mockResolvedValue({ put, match, delete: remove }),
      keys: cacheKeys,
      delete: deleteCache,
    },
    fetch,
  })
  function request(path: string, mode?: string) {
    const respondWith = vi.fn()
    handlers.get('fetch')!({
      request: { method: 'GET', url: new URL(path, 'https://midniht.app').href, mode },
      respondWith,
      waitUntil: vi.fn(),
    })
    return respondWith
  }
  function activate() {
    const waitUntil = vi.fn()
    handlers.get('activate')!({ waitUntil })
    return waitUntil.mock.calls[0]![0]
  }
  return { match, fetch, request, put, remove, cacheKeys, deleteCache, activate }
}

describe('offline Midniht mark', () => {
  it('serves the approved precached mark without requiring a network connection', async () => {
    const { match, fetch, request } = harness()
    const cached = new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
    match.mockResolvedValue(cached)
    fetch.mockRejectedValue(new Error('offline'))
    const response = request('/midniht/midniht-mark.svg')
    expect(response).toHaveBeenCalledOnce()
    await expect(response.mock.calls[0]![0]).resolves.toBe(cached)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches a missing mark while online', async () => {
    const { match, fetch, request } = harness()
    match.mockResolvedValue(undefined)
    const fresh = new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })
    fetch.mockResolvedValue(fresh)
    const response = request('/midniht/midniht-mark.svg')
    await expect(response.mock.calls[0]![0]).resolves.toBe(fresh)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not intercept API traffic or unrelated images', () => {
    const { request } = harness()
    expect(request('/api/books')).not.toHaveBeenCalled()
    expect(request('/private-cover.png')).not.toHaveBeenCalled()
    expect(request('https://example.com/midniht/midniht-mark.svg')).not.toHaveBeenCalled()
  })
})

describe('offline asset integrity', () => {
  it('does not replace the offline shell with a failed navigation response', async () => {
    const { fetch, request, put } = harness()
    const failed = new Response('Unavailable', {
      status: 503,
      headers: { 'content-type': 'text/html' },
    })
    fetch.mockResolvedValue(failed)
    await expect(request('/library', 'navigate').mock.calls[0]![0]).resolves.toBe(failed)
    expect(put).not.toHaveBeenCalled()
  })
  it('retires only earlier app-shell caches when the worker activates', async () => {
    const { cacheKeys, deleteCache, activate } = harness()
    cacheKeys.mockResolvedValue([
      'reverie-shell-v2',
      'midniht-shell-v3',
      'midniht-shell-v4',
      'reader-uploads',
    ])
    await activate()
    expect(deleteCache.mock.calls).toEqual([['reverie-shell-v2'], ['midniht-shell-v3']])
  })
  it.each([
    ['/assets/app.js', 'application/javascript'],
    ['/assets/app.mjs', 'text/javascript; charset=utf-8'],
    ['/assets/app.css', 'text/css'],
  ])('repairs cached HTML at %s without using the HTTP cache', async (path, type) => {
    const { match, fetch, request, put, remove } = harness()
    match.mockResolvedValue(
      new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } }),
    )
    const fresh = new Response('valid asset', { headers: { 'content-type': type } })
    fetch.mockResolvedValue(fresh)
    await expect(request(path).mock.calls[0]![0]).resolves.toBe(fresh)
    expect(remove).toHaveBeenCalledOnce()
    expect(fetch).toHaveBeenCalledWith(
      expect.objectContaining({ url: `https://midniht.app${path}` }),
      { cache: 'no-cache' },
    )
    expect(put).toHaveBeenCalledOnce()
  })

  it('never caches a successful HTML fallback as JavaScript', async () => {
    const { match, fetch, request, put } = harness()
    match.mockResolvedValue(undefined)
    const html = new Response('<html>fallback</html>', { headers: { 'content-type': 'text/html' } })
    fetch.mockResolvedValue(html)
    await expect(request('/assets/retired.js').mock.calls[0]![0]).resolves.toBe(html)
    expect(put).not.toHaveBeenCalled()
  })

  it('keeps valid cached JavaScript available offline', async () => {
    const { match, fetch, request } = harness()
    const cached = new Response('app()', { headers: { 'content-type': 'application/javascript' } })
    match.mockResolvedValue(cached)
    fetch.mockRejectedValue(new Error('offline'))
    await expect(request('/assets/app.js').mock.calls[0]![0]).resolves.toBe(cached)
    expect(fetch).not.toHaveBeenCalled()
  })
})
