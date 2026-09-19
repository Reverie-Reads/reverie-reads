import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const worker = readFileSync('public/sw.js', 'utf8')

function harness() {
  const handlers = new Map<string, (event: unknown) => void>()
  const match = vi.fn()
  const put = vi.fn()
  const fetch = vi.fn()
  runInNewContext(worker, {
    URL,
    self: {
      location: { origin: 'https://midniht.app' },
      addEventListener: (name: string, handler: (event: unknown) => void) =>
        handlers.set(name, handler),
    },
    caches: { match, open: vi.fn().mockResolvedValue({ put }) },
    fetch,
  })
  function request(path: string) {
    const respondWith = vi.fn()
    handlers.get('fetch')!({
      request: { method: 'GET', url: new URL(path, 'https://midniht.app').href },
      respondWith,
    })
    return respondWith
  }
  return { match, fetch, request }
}

describe('offline Midniht mark', () => {
  it('serves the approved precached mark without requiring a network connection', async () => {
    const { match, fetch, request } = harness()
    const cached = { body: 'approved mark' }
    match.mockResolvedValue(cached)
    fetch.mockRejectedValue(new Error('offline'))
    const response = request('/midniht/midniht-mark.svg')
    expect(response).toHaveBeenCalledOnce()
    await expect(response.mock.calls[0][0]).resolves.toBe(cached)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('fetches a missing mark while online', async () => {
    const { match, fetch, request } = harness()
    match.mockResolvedValue(undefined)
    const fresh = { ok: true, clone: () => ({ body: 'approved mark' }) }
    fetch.mockResolvedValue(fresh)
    const response = request('/midniht/midniht-mark.svg')
    await expect(response.mock.calls[0][0]).resolves.toBe(fresh)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not intercept API traffic or unrelated images', () => {
    const { request } = harness()
    expect(request('/api/books')).not.toHaveBeenCalled()
    expect(request('/private-cover.png')).not.toHaveBeenCalled()
    expect(request('https://example.com/midniht/midniht-mark.svg')).not.toHaveBeenCalled()
  })
})
