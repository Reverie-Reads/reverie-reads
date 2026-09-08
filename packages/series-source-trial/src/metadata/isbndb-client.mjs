import { setTimeout as delay } from 'node:timers/promises'
import { canonicalIsbn } from './supplement.mjs'

export function createIsbndbClient({
  key,
  maxRequests = 10,
  fetcher = fetch,
  sleeper = delay,
  now = Date.now,
} = {}) {
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 20)
    throw new Error('invalid_budget')
  const stats = { requests: 0, stopped: null }
  let next = 0,
    failures = 0,
    queue = Promise.resolve()
  async function request(isbn) {
    if (!canonicalIsbn(isbn)) return { status: 'invalid_isbn' }
    if (stats.stopped) return { status: 'not_attempted' }
    if (typeof key !== 'string' || !key.trim()) {
      stats.stopped = 'missing_key'
      return { status: 'missing_key' }
    }
    if (stats.requests >= maxRequests) {
      stats.stopped = 'budget'
      return { status: 'not_attempted' }
    }
    await sleeper(Math.max(0, next - now()))
    next = now() + 1100
    stats.requests++
    let result
    try {
      const r = await fetcher(`https://api2.isbndb.com/book/${canonicalIsbn(isbn)}`, {
        headers: { Authorization: key, Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
      if (!r.ok) {
        // Status survives even an HTML/empty failure response. Never retain the failure body.
        result = {
          status:
            r.status === 401 || r.status === 403
              ? 'authentication'
              : r.status === 429
                ? 'rate_limited'
                : r.status === 404
                  ? 'not_found'
                  : r.status >= 500
                    ? 'server_error'
                    : r.status >= 300 && r.status < 400
                      ? 'redirect_refused'
                      : 'http_error',
        }
        await r.body?.cancel().catch(() => {})
      } else {
        let size = 0
        const chunks = []
        for await (const chunk of r.body) {
          size += chunk.length
          if (size > 262144) throw new Error('oversize')
          chunks.push(chunk)
        }
        try {
          result = { status: 'ok', body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
        } catch {
          result = { status: 'invalid_json' }
        }
      }
    } catch (error) {
      result = {
        status:
          error?.name === 'TimeoutError' || error?.name === 'AbortError'
            ? 'timeout'
            : error?.message === 'oversize'
              ? 'response_too_large'
              : 'network_error',
      }
    }
    if (['authentication', 'rate_limited'].includes(result.status)) stats.stopped = result.status
    failures = ['server_error', 'timeout', 'network_error'].includes(result.status)
      ? failures + 1
      : 0
    if (failures >= 2) stats.stopped = 'infrastructure_failures'
    return result
  }
  return {
    stats,
    lookup(isbn) {
      const pending = queue.then(() => request(isbn))
      queue = pending.catch(() => {})
      return pending
    },
  }
}
