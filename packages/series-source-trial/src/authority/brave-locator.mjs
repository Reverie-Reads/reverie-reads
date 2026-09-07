const BRAVE_SEARCH_ENDPOINT = 'https://api.search.brave.com/res/v1/web/search'

export const BRAVE_AUTHORITY_LOCATOR_VERSION = 'brave-authority-locator-v1'
export const BRAVE_SEARCH_REQUEST_USD = 0.005
export const BRAVE_SEARCHES_PER_CASE = 3

const asArray = (value) => (Array.isArray(value) ? value : [])
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const cleanSearchTerm = (value) =>
  String(value ?? '')
    .replace(/["\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const quoted = (value) => `"${cleanSearchTerm(value)}"`

export function buildBraveAuthorityQueries(authorityTarget) {
  const target = authorityTarget?.target ?? authorityTarget
  const title = cleanSearchTerm(target?.title)
  const author = cleanSearchTerm(asArray(target?.authors)[0])
  if (!title || !author) throw new Error('Brave authority locator requires a title and author')

  const year = Number.isInteger(target?.publicationYear) ? ` ${target.publicationYear}` : ''
  return [
    `${quoted(title)} ${quoted(author)} official${year}`,
    `${quoted(author)} official author books`,
    `${quoted(title)} ${quoted(author)} publisher`,
  ]
}

export const normalizeBraveResultUrl = (value) => {
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

const requestUrl = (query) => {
  const url = new URL(BRAVE_SEARCH_ENDPOINT)
  url.searchParams.set('q', query)
  url.searchParams.set('count', '20')
  url.searchParams.set('country', 'US')
  url.searchParams.set('search_lang', 'en')
  url.searchParams.set('safesearch', 'moderate')
  url.searchParams.set('spellcheck', 'false')
  return url
}

export async function searchBrave(query, options = {}) {
  const apiKey = options.apiKey?.trim()
  if (!apiKey) throw new Error('BRAVE_SEARCH_API_KEY is required')
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
      response = await fetchImpl(requestUrl(query), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
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
        asArray(payload?.web?.results)
          .map((result) => normalizeBraveResultUrl(result?.url))
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

  throw new Error('Brave authority locator exhausted an invalid attempt budget')
}

export async function runBraveAuthorityLocator(authorityTarget, options = {}) {
  const queries = buildBraveAuthorityQueries(authorityTarget)
  const search = options.search ?? searchBrave
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
