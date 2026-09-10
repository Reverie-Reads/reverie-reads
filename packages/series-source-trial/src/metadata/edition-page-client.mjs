import { setTimeout as delay } from 'node:timers/promises'
import { createBaselineClient } from './baseline-client.mjs'
import { canonicalIsbn, validateInput } from './supplement.mjs'
import { admitGoogleVolume, selectGoogleEdition } from './edition-pages.mjs'

/** Separate from the frozen study runtime. Fixed origins, no retry, finite requests and serial acquisition. */
export function createEditionPageClient({
  googleKey,
  googleReferrer = '',
  maxGoogleRequests = 40,
  maxOpenLibraryRequests = 80,
  fetcher = fetch,
  sleeper = delay,
  now = Date.now,
} = {}) {
  if (!Number.isInteger(maxGoogleRequests) || maxGoogleRequests < 1 || maxGoogleRequests > 40)
    throw new Error('invalid_google_budget')
  // The existing exact-edition OL path validates every author and every returned ISBN.
  // Omit its Google key deliberately: it makes zero Google requests; this client owns that path.
  const baseline = createBaselineClient({
    maxGoogleRequests: 1,
    maxOpenLibraryRequests,
    fetcher,
    sleeper,
    now,
  })
  const googleStats = { requests: 0, stopped: null, elapsedMs: 0, statuses: {} }
  let next = 0,
    failures = 0,
    queue = Promise.resolve()
  const stats = { google: googleStats, openlibrary: baseline.stats.openlibrary }

  async function request(path, params) {
    if (googleStats.stopped) return { status: 'not_attempted' }
    if (googleStats.requests >= maxGoogleRequests) {
      googleStats.stopped = 'budget'
      return { status: 'not_attempted' }
    }
    await sleeper(Math.max(0, next - now()))
    next = now() + 1100
    googleStats.requests++
    const start = now()
    let result
    try {
      const url = new URL(`https://www.googleapis.com/books/v1/volumes${path}`)
      url.search = new URLSearchParams({ ...params, key: googleKey }).toString()
      const response = await fetcher(url.href, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: {
          Accept: 'application/json',
          ...(googleReferrer ? { Referer: googleReferrer, Origin: googleReferrer } : {}),
        },
      })
      if (!response.ok) {
        result = {
          status:
            response.status === 401 || response.status === 403
              ? 'authentication_or_access'
              : response.status === 429
                ? 'rate_limited'
                : response.status === 404
                  ? 'not_found'
                  : response.status >= 500
                    ? 'server_error'
                    : response.status >= 300 && response.status < 400
                      ? 'redirect_refused'
                      : 'http_error',
        }
        await response.body?.cancel().catch(() => {})
      } else {
        let size = 0
        const chunks = []
        for await (const chunk of response.body) {
          size += chunk.length
          if (size > 524288) throw new Error('oversize')
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
        status: ['TimeoutError', 'AbortError'].includes(error?.name)
          ? 'timeout'
          : error?.message === 'oversize'
            ? 'response_too_large'
            : 'network_error',
      }
    }
    googleStats.elapsedMs += Math.max(0, now() - start)
    googleStats.statuses[result.status] = (googleStats.statuses[result.status] ?? 0) + 1
    if (['authentication_or_access', 'rate_limited'].includes(result.status))
      googleStats.stopped = result.status
    failures = ['network_error', 'timeout', 'server_error'].includes(result.status)
      ? failures + 1
      : 0
    if (failures >= 2) googleStats.stopped = 'infrastructure_failures'
    return result
  }

  async function google(identity) {
    const finish = (stage, result) => ({ ...result, stage })
    if (typeof googleKey !== 'string' || !googleKey.trim()) {
      googleStats.stopped = 'missing_key'
      return finish('preflight', { status: 'missing_key' })
    }
    const search = await request('', {
      q: `isbn:${canonicalIsbn(identity.isbn)}`,
      maxResults: '10',
      projection: 'full',
    })
    if (search.status !== 'ok') return finish('search', search)
    const selected = selectGoogleEdition(search.body, identity)
    if (selected.status !== 'matched') return finish('search', selected)
    const detail = await request(`/${selected.volumeId}`, { projection: 'full' })
    if (detail.status !== 'ok') return finish('detail', detail)
    const admitted = admitGoogleVolume(detail.body, identity)
    if (admitted.status !== 'matched') return finish('detail', admitted)
    if (admitted.volumeId !== selected.volumeId || admitted.language !== selected.language)
      return finish('detail', { status: 'identity_review', reason: 'detail_identity_changed' })
    // Only detail pages are emitted. Search pages/printedPageCount cannot be a fallback or second vote.
    return {
      status: 'matched',
      stage: 'detail',
      record: admitted.record,
      endpoint: 'volume_detail',
      sourceId: admitted.volumeId,
      targetIsbn: canonicalIsbn(identity.isbn),
      observedAt: new Date(now()).toISOString(),
    }
  }
  async function acquire(identity) {
    const googleResult = await google(identity)
    const { openlibrary } = await baseline.acquire(identity)
    return {
      google: googleResult,
      openlibrary:
        openlibrary.status === 'matched'
          ? {
              ...openlibrary,
              endpoint: 'isbn_edition',
              sourceId: canonicalIsbn(identity.isbn),
              targetIsbn: canonicalIsbn(identity.isbn),
              observedAt: new Date(now()).toISOString(),
            }
          : openlibrary,
    }
  }
  return {
    stats,
    acquire(identity) {
      validateInput({
        version: 1,
        purpose: 'development',
        cases: [{ identity, current: {}, baseline: [] }],
      })
      const snapshot = structuredClone(identity)
      const pending = queue.then(() => acquire(snapshot))
      queue = pending.catch(() => {})
      return pending
    },
  }
}
