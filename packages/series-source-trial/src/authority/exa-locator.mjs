import { rankedAuthorityDomains } from './focused-search.mjs'

const EXA_SEARCH_ENDPOINT = 'https://api.exa.ai/search'

export const EXA_AUTHORITY_LOCATOR_VERSION = 'exa-authority-locator-v1'
export const EXA_SEARCH_REQUEST_USD = 0.007
export const EXA_SEARCHES_PER_CASE = 3
export const EXA_AUTHORITY_CANDIDATE_DOMAIN_LIMIT = 8

const asArray = (value) => (Array.isArray(value) ? value : [])
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const cleanSearchTerm = (value) =>
  String(value ?? '')
    .replace(/["\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const quoted = (value) => `"${cleanSearchTerm(value)}"`

export function buildExaAuthorityQueries(authorityTarget) {
  const target = authorityTarget?.target ?? authorityTarget
  const title = cleanSearchTerm(target?.title)
  const author = cleanSearchTerm(asArray(target?.authors)[0])
  if (!title || !author) throw new Error('Exa authority locator requires a title and author')

  const year = Number.isInteger(target?.publicationYear) ? ` ${target.publicationYear}` : ''
  return [
    `${quoted(title)} ${quoted(author)} official${year}`,
    `${quoted(author)} official author books`,
    `${quoted(title)} ${quoted(author)} publisher`,
  ]
}

export const normalizeExaResultUrl = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    url.hash = ''
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '')
    return url.toString()
  } catch {
    return null
  }
}

const retryDelayMs = (response) => {
  const retryAfter = Number(response?.headers?.get?.('retry-after'))
  if (!Number.isFinite(retryAfter) || retryAfter < 0) return 500
  return Math.min(Math.max(retryAfter * 1_000, 250), 5_000)
}

export async function searchExa(query, options = {}) {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) throw new Error('EXA_API_KEY is required')
  const fetchImpl = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? wait
  const maxAttempts = options.maxAttempts ?? 2
  const timeoutMs = options.timeoutMs ?? 10_000
  const startedAt = Date.now()

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      response = await fetchImpl(EXA_SEARCH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify({
          query,
          type: 'auto',
          numResults: 10,
          moderation: true,
          userLocation: 'US',
        }),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      const errorCode = error?.name === 'AbortError' ? 'timeout' : 'network_error'
      if (attempt < maxAttempts) {
        await sleep(500)
        continue
      }
      return {
        status: 'error',
        errorCode,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        urls: [],
      }
    }
    clearTimeout(timeout)

    if (!response.ok) {
      const retriable = response.status === 429 || response.status >= 500
      if (retriable && attempt < maxAttempts) {
        await sleep(retryDelayMs(response))
        continue
      }
      return {
        status: 'error',
        errorCode: `http_${response.status}`,
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        urls: [],
      }
    }

    let payload
    try {
      payload = await response.json()
    } catch {
      return {
        status: 'error',
        errorCode: 'invalid_json',
        attempts: attempt,
        latencyMs: Date.now() - startedAt,
        urls: [],
      }
    }
    const urls = [
      ...new Set(
        asArray(payload?.results)
          .map((result) => normalizeExaResultUrl(result?.url))
          .filter(Boolean),
      ),
    ]
    return {
      status: 'completed',
      errorCode: null,
      attempts: attempt,
      latencyMs: Date.now() - startedAt,
      urls,
    }
  }

  throw new Error('Exa authority locator exhausted an invalid attempt budget')
}

export async function runExaAuthorityLocator(authorityTarget, options = {}) {
  const queries = buildExaAuthorityQueries(authorityTarget)
  const search = options.search ?? searchExa
  const results = []

  for (const query of queries) {
    results.push(
      await search(query, {
        apiKey: options.apiKey,
        fetchImpl: options.fetchImpl,
        maxAttempts: options.maxAttempts,
        sleep: options.sleep,
        timeoutMs: options.timeoutMs,
      }),
    )
  }

  const completed = results.filter((result) => result.status === 'completed').length
  const urls = [...new Set(results.flatMap((result) => result.urls ?? []))]
  return {
    caseId: authorityTarget.caseId,
    status: completed === results.length ? 'completed' : completed > 0 ? 'partial' : 'error',
    urls,
    candidateDomains: rankedAuthorityDomains(results, EXA_AUTHORITY_CANDIDATE_DOMAIN_LIMIT),
    errorCodes: results.map((result) => result.errorCode).filter(Boolean),
    operations: {
      queriesPlanned: queries.length,
      queriesCompleted: completed,
      requests: results.reduce((total, result) => total + Number(result.attempts ?? 0), 0),
      urlsInspected: urls.length,
      latencyMs: results.reduce((total, result) => total + Number(result.latencyMs ?? 0), 0),
    },
  }
}
