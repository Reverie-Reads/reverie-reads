import { setTimeout as delay } from 'node:timers/promises'
import {
  canonicalIsbn,
  identityReviewReason,
  binding,
  language,
  validateInput,
} from './supplement.mjs'

const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const list = (v) => (Array.isArray(v) ? v : [])
const pages = (v) => (Number.isInteger(v) && v > 0 && v <= 20000 ? v : null)
const fullTitle = (b) =>
  typeof b.title !== 'string'
    ? undefined
    : typeof b.subtitle === 'string' && b.subtitle.trim()
      ? `${b.title}: ${b.subtitle}`
      : b.title
const isbnFields = (b) =>
  list(b.industryIdentifiers)
    .filter((v) => ['ISBN_10', 'ISBN_13'].includes(v?.type))
    .map((v) => v.identifier)

/** Same-origin edition redirects only. No provider-supplied URL can choose a host or query. */
export function approvedEditionRedirect(location) {
  try {
    if (typeof location !== 'string') return null
    const url = new URL(location, 'https://openlibrary.org')
    return url.origin === 'https://openlibrary.org' &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/books\/OL\d+M\.json$/.test(url.pathname)
      ? url.href
      : null
  } catch {
    return null
  }
}

function admit(record, identity, observedLanguage = null, rawSubtitle = null) {
  try {
    if (rawSubtitle != null && typeof rawSubtitle !== 'string')
      return { status: 'identity_review', reason: 'malformed_subtitle' }
    if (record.isbns.some((i) => !canonicalIsbn(i)))
      return { status: 'identity_review', reason: 'invalid_isbn' }
    validateInput({
      version: 1,
      purpose: 'development',
      cases: [{ identity, current: {}, baseline: [record] }],
    })
    const reason = identityReviewReason(record, identity)
    if (reason) return { status: 'identity_review', reason }
    if (identity.language && observedLanguage && language(observedLanguage) !== identity.language)
      return { status: 'identity_review', reason: 'language_mismatch' }
    return { status: 'matched', record }
  } catch {
    return { status: 'identity_review', reason: 'malformed_record' }
  }
}

export function selectGoogleBaseline(body, identity) {
  if (
    !object(body) ||
    body.error ||
    (body.items != null && !Array.isArray(body.items)) ||
    (!body.items && body.totalItems !== 0)
  )
    return { status: 'invalid_shape' }
  if (list(body.items).length > 10) return { status: 'invalid_shape' }
  const matches = list(body.items)
    .map((v) => v?.volumeInfo)
    .filter(
      (v) =>
        object(v) && isbnFields(v).some((i) => canonicalIsbn(i) === canonicalIsbn(identity.isbn)),
    )
  if (matches.length > 1) return { status: 'identity_review', reason: 'ambiguous_records' }
  if (!matches.length) return { status: body.totalItems === 0 ? 'not_found' : 'no_exact_isbn' }
  const b = matches[0]
  // BOOK means publication type, not binding. Digital availability does not certify this ISBN's format.
  return admit(
    {
      source: 'google',
      isbns: isbnFields(b),
      title: fullTitle(b),
      authors: b.authors,
      pages: pages(b.pageCount),
      editionFormat: null,
    },
    identity,
    b.language,
    b.subtitle,
  )
}

export function createBaselineClient({
  googleKey,
  googleReferrer = '',
  maxGoogleRequests = 20,
  maxOpenLibraryRequests = 80,
  fetcher = fetch,
  sleeper = delay,
  now = Date.now,
} = {}) {
  if (
    !Number.isInteger(maxGoogleRequests) ||
    maxGoogleRequests < 1 ||
    maxGoogleRequests > 20 ||
    !Number.isInteger(maxOpenLibraryRequests) ||
    maxOpenLibraryRequests < 1 ||
    maxOpenLibraryRequests > 200
  )
    throw new Error('invalid_baseline_budget')
  const stats = Object.fromEntries(
    ['google', 'openlibrary'].map((p) => [
      p,
      { requests: 0, stopped: null, elapsedMs: 0, statuses: {} },
    ]),
  )
  const state = Object.fromEntries(
    ['google', 'openlibrary'].map((p) => [p, { next: 0, failures: 0 }]),
  )
  const authorCache = new Map()
  let queue = Promise.resolve()
  const bump = (s, code) => {
    s.statuses[code] = (s.statuses[code] ?? 0) + 1
  }

  // This function is private: callers can only choose a validated identity, never a URL or headers.
  async function request(provider, url, headers, redirectAllowed = false) {
    const s = stats[provider],
      timing = state[provider]
    if (s.stopped) return { status: 'not_attempted' }
    if (s.requests >= (provider === 'google' ? maxGoogleRequests : maxOpenLibraryRequests)) {
      s.stopped = 'budget'
      return { status: 'not_attempted' }
    }
    await sleeper(Math.max(0, timing.next - now()))
    timing.next = now() + 1100
    s.requests++
    const start = now()
    let result, redirect
    try {
      const response = await fetcher(url, {
        headers: { Accept: 'application/json', ...headers },
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
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
        if (
          provider === 'openlibrary' &&
          redirectAllowed &&
          response.status >= 300 &&
          response.status < 400
        )
          redirect = approvedEditionRedirect(response.headers.get('location'))
        await response.body?.cancel().catch(() => {})
      } else {
        const chunks = []
        let size = 0
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
    s.elapsedMs += Math.max(0, now() - start)
    bump(s, redirect ? 'edition_redirect' : result.status)
    if (['authentication_or_access', 'rate_limited'].includes(result.status))
      s.stopped = result.status
    timing.failures = ['timeout', 'network_error', 'server_error'].includes(result.status)
      ? timing.failures + 1
      : 0
    if (timing.failures >= 2) s.stopped = 'infrastructure_failures'
    return redirect ? request(provider, redirect, headers, false) : result
  }

  async function google(identity) {
    if (typeof googleKey !== 'string' || !googleKey.trim()) {
      stats.google.stopped = 'missing_key'
      return { status: 'missing_key' }
    }
    const query = new URLSearchParams({
      q: `isbn:${canonicalIsbn(identity.isbn)}`,
      maxResults: '10',
      projection: 'full',
      key: googleKey,
    })
    const result = await request(
      'google',
      `https://www.googleapis.com/books/v1/volumes?${query}`,
      googleReferrer ? { Referer: googleReferrer, Origin: googleReferrer } : {},
    )
    return result.status === 'ok' ? selectGoogleBaseline(result.body, identity) : result
  }

  async function openlibrary(identity) {
    const headers = { 'User-Agent': 'ReverieEditionBaselineTrial/1.0 (https://reveriereads.app)' }
    const result = await request(
      'openlibrary',
      `https://openlibrary.org/isbn/${canonicalIsbn(identity.isbn)}.json`,
      headers,
      true,
    )
    if (result.status !== 'ok') return result
    const b = result.body
    if (!object(b)) return { status: 'invalid_shape' }
    const isbns = [...list(b.isbn_13), ...list(b.isbn_10)]
    if (!isbns.some((i) => canonicalIsbn(i) === canonicalIsbn(identity.isbn)))
      return { status: 'no_exact_isbn' }
    // Identity contradictions are reviews, not missing observations. Resolve every author; no work-level fallback.
    if (isbns.some((i) => !canonicalIsbn(i)))
      return { status: 'identity_review', reason: 'invalid_isbn' }
    if (isbns.some((i) => canonicalIsbn(i) !== canonicalIsbn(identity.isbn)))
      return { status: 'identity_review', reason: 'isbn_mismatch' }
    if (!Array.isArray(b.authors) || !b.authors.length)
      return { status: 'identity_review', reason: 'missing_contributors' }
    if (b.authors.length > 8) return { status: 'identity_review', reason: 'too_many_contributors' }
    const authors = []
    for (const author of b.authors) {
      if (!/^\/authors\/OL\d+A$/.test(author?.key ?? ''))
        return { status: 'identity_review', reason: 'invalid_author_reference' }
      let record = authorCache.get(author.key)
      if (!record) {
        const authorResult = await request(
          'openlibrary',
          `https://openlibrary.org${author.key}.json`,
          headers,
        )
        if (authorResult.status !== 'ok')
          return { status: 'incomplete_authors', reason: 'author_lookup_unavailable' }
        if (
          !object(authorResult.body) ||
          typeof authorResult.body.name !== 'string' ||
          !authorResult.body.name.trim() ||
          authorResult.body.name.length > 500 ||
          (authorResult.body.key != null && authorResult.body.key !== author.key)
        )
          return { status: 'identity_review', reason: 'author_record_mismatch' }
        record = authorResult.body.name
        authorCache.set(author.key, record)
      }
      authors.push(record)
    }
    const format = binding(b.physical_format)
    if (b.physical_format != null && b.physical_format !== '' && !format)
      return { status: 'edition_review', reason: 'unknown_binding' }
    if (
      b.languages != null &&
      (!Array.isArray(b.languages) ||
        b.languages.some(
          (v) => typeof v?.key !== 'string' || !/^\/languages\/[a-z]{3}$/.test(v.key),
        ))
    )
      return { status: 'identity_review', reason: 'malformed_language' }
    const languages = list(b.languages).map((v) => v.key.split('/').at(-1))
    const observedLanguage = languages.length > 1 ? 'multiple_languages' : languages[0]
    return admit(
      {
        source: 'openlibrary',
        isbns,
        title: fullTitle(b),
        authors,
        pages: format === 'audiobook' ? null : pages(b.number_of_pages),
        editionFormat: format,
      },
      identity,
      observedLanguage,
      b.subtitle,
    )
  }

  async function acquire(identity) {
    // Reuse the established schema before performing any request.
    validateInput({
      version: 1,
      purpose: 'development',
      cases: [{ identity, current: {}, baseline: [] }],
    })
    return { google: await google(identity), openlibrary: await openlibrary(identity) }
  }
  return {
    stats,
    acquire(identity) {
      const pending = queue.then(() => acquire(identity))
      queue = pending.catch(() => {})
      return pending
    },
  }
}
