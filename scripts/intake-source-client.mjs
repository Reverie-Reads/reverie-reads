import { setTimeout as delay } from 'node:timers/promises'
import { normalizeIsbn } from '../packages/core/src/match.ts'
import {
  adaptOpenLibraryIntake,
  adaptHardcoverIntake,
  intakeSourceObservation,
} from '../packages/core/src/intakeSourceAdapters.ts'
import { approvedEditionRedirect } from '../packages/series-source-trial/src/metadata/baseline-client.mjs'
import { equivalentIsbn10 } from '../supabase/functions/enrich/hardcoverEditions.ts'
import { olHeaders } from '../supabase/functions/_shared/olIdentity.ts'

// Same bounded exact-ISBN relationship as the shipped adapter, requesting only pilot fields.
export const intakeEditionQuery = `query IntakeShadow($isbn: String!, $isbn10: String!) {
  editions(where: { _or: [{ isbn_13: { _eq: $isbn } }, { isbn_10: { _eq: $isbn10 } }] }, limit: 2) {
    id title subtitle isbn_13 isbn_10 pages compilation physical_format edition_format
    release_date release_year publisher { name } language { code2 } reading_format { format }
    book { id title contributions(order_by: [{ id: asc }], limit: 33) { contribution author { name } } }
  }
}`

/** Operator-only, serial, bounded exact-edition acquisition. No DB credentials or writer.
 * Cache lives only for this client/run; failed attempts are not silently repeated. */
export function createIntakeSourceClient({
  hardcoverToken,
  fetcher = fetch,
  sleeper = delay,
  now = Date.now,
  limits = { openlibrary: 80, hardcover: 20 },
} = {}) {
  if (
    Object.keys(limits).sort().join(',') !== 'hardcover,openlibrary' ||
    !Object.entries(limits).every(
      ([p, n]) => Number.isInteger(n) && n > 0 && n <= (p === 'openlibrary' ? 80 : 20),
    )
  )
    throw new Error('Invalid source limits')
  const stats = Object.fromEntries(
    ['openlibrary', 'hardcover'].map((p) => [p, { requests: 0, stopped: null, statuses: {} }]),
  )
  const timing = { openlibrary: { next: 0, failures: 0 }, hardcover: { next: 0, failures: 0 } }
  const cache = new Map(),
    authors = new Map()
  let queue = Promise.resolve()
  async function request(provider, url, init = {}, allowRedirect = false) {
    const s = stats[provider],
      t = timing[provider]
    if (s.stopped) return { status: 'stopped' }
    if (s.requests >= limits[provider]) {
      s.stopped = 'budget'
      return { status: 'budget' }
    }
    await sleeper(Math.max(0, t.next - now()))
    t.next = now() + 1100
    s.requests++
    let result, redirect
    try {
      const response = await fetcher(url, {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) {
        const status = response.status
        result = {
          status:
            status === 404
              ? 'not_found'
              : status === 429
                ? 'rate_limited'
                : [401, 403].includes(status)
                  ? 'access_refused'
                  : status >= 500
                    ? 'server_error'
                    : status >= 300 && status < 400
                      ? 'redirect_refused'
                      : 'http_error',
        }
        if (allowRedirect && provider === 'openlibrary' && status >= 300 && status < 400)
          redirect = approvedEditionRedirect(response.headers.get('location'))
        await response.body?.cancel().catch(() => {})
      } else {
        const chunks = []
        let size = 0
        if (!response.body) throw new Error('invalid_json')
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > 524288) throw new Error('response_too_large')
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
        status: ['AbortError', 'TimeoutError'].includes(error?.name)
          ? 'timeout'
          : error?.message === 'response_too_large'
            ? 'response_too_large'
            : 'network_error',
      }
    }
    const code = redirect ? 'edition_redirect' : result.status
    s.statuses[code] = (s.statuses[code] ?? 0) + 1
    if (['access_refused', 'rate_limited'].includes(code)) s.stopped = code
    t.failures = ['timeout', 'network_error', 'server_error'].includes(code) ? t.failures + 1 : 0
    if (t.failures >= 2) s.stopped = 'infrastructure_failures'
    return redirect ? request(provider, redirect, init, false) : result
  }
  const observationFailure = (provider, c, status, emptyAllowed = false) => ({
    observations: [
      intakeSourceObservation(
        provider,
        c,
        emptyAllowed && status === 'not_found'
          ? 'empty'
          : ['budget', 'stopped'].includes(status)
            ? 'capped'
            : 'failed',
      ),
    ],
    issues: [status],
  })
  async function ol(isbn, c) {
    const init = { headers: olHeaders({ Accept: 'application/json' }) }
    const r = await request('openlibrary', `https://openlibrary.org/isbn/${isbn}.json`, init, true)
    if (r.status !== 'ok') return observationFailure('openlibrary', c, r.status, true)
    const refs = r.body?.authors
    if (Array.isArray(refs) && refs.length <= 8) {
      for (const ref of refs) {
        if (typeof ref?.key !== 'string' || !/^\/authors\/OL\d+A$/.test(ref.key)) continue
        if (!authors.has(ref.key))
          authors.set(
            ref.key,
            await request('openlibrary', `https://openlibrary.org${ref.key}.json`, init),
          )
        if (authors.get(ref.key).status !== 'ok')
          return observationFailure('openlibrary', c, 'author_lookup_failed')
      }
    }
    return adaptOpenLibraryIntake(
      r.body,
      Object.fromEntries(
        [...authors].filter(([, r]) => r.status === 'ok').map(([key, r]) => [key, r.body]),
      ),
      c,
    )
  }
  async function hc(isbn, c) {
    if (typeof hardcoverToken !== 'string' || !hardcoverToken.trim()) {
      stats.hardcover.stopped = 'missing_credential'
      return observationFailure('hardcover', c, 'missing_credential')
    }
    const r = await request('hardcover', 'https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hardcoverToken.replace(/^Bearer\s+/i, '').trim()}`,
      },
      body: JSON.stringify({
        query: intakeEditionQuery,
        variables: { isbn, isbn10: equivalentIsbn10(isbn) },
      }),
    })
    // A GraphQL endpoint 404 is infrastructure failure, never successful book absence.
    return r.status === 'ok'
      ? adaptHardcoverIntake(r.body, c)
      : observationFailure('hardcover', c, r.status)
  }
  return {
    stats,
    acquire(isbnInput, targetFingerprint) {
      const isbn = normalizeIsbn(isbnInput)
      if (!isbn || !/^[a-f0-9]{64}$/.test(targetFingerprint))
        throw new Error('Invalid acquisition target')
      const pending = queue.then(async () => {
        if (!cache.has(isbn)) {
          const c = { targetFingerprint, retrievedAt: new Date(now()).toISOString() }
          cache.set(isbn, { openlibrary: await ol(isbn, c), hardcover: await hc(isbn, c) })
        }
        // Shared captured response is rebound only for the same ISBN, with its original time.
        const result = structuredClone(cache.get(isbn))
        for (const a of Object.values(result))
          for (const o of a.observations) o.targetFingerprint = targetFingerprint
        return result
      })
      queue = pending.catch(() => {})
      return pending
    },
  }
}
