import { extractEvidenceText, selectNavigationCandidate } from './html.mjs'
import { parseRetrievalUrl, RetrievalError, safeRequest, sha256 } from './network.mjs'
import { profileForConsultedUrl } from './profile.mjs'
import { parseRobots, robotsAccess } from './robots.mjs'

export const RETRIEVAL_GATEWAY_VERSION = 'authority-retrieval-gateway-v1'
export const RETRIEVAL_POLICY_VERSION = 'authority-retrieval-policy-v1'
export const RETRIEVAL_EXTRACTOR_VERSION = 'authority-evidence-extractor-v2'
export const RETRIEVAL_USER_AGENT =
  'ReverieAuthorityScout/0.1 (+https://reveriereads.app/data-sources)'
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1_000
const HTML_MEDIA_TYPES = new Set(['text/html', 'text/plain'])

const mediaType = (headers) => (headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
const decodeUtf8 = (body) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body)
  } catch (error) {
    throw new RetrievalError('unsupported_media', error)
  }
}

const contentRequestOptions = {
  headers: {
    Accept: 'text/html, text/plain;q=0.8',
    'Accept-Encoding': 'identity',
    'User-Agent': RETRIEVAL_USER_AGENT,
  },
  maxBytes: 512 * 1024,
  maxRedirects: 2,
}

export class OriginRequestLimiter {
  constructor({
    intervalMs = 1_000,
    now = () => Date.now(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = {}) {
    this.intervalMs = intervalMs
    this.now = now
    this.sleep = sleep
    this.tails = new Map()
    this.lastRequestAt = new Map()
  }

  async acquire(origin) {
    const previous = this.tails.get(origin) ?? Promise.resolve()
    let release
    const current = new Promise((resolve) => {
      release = resolve
    })
    this.tails.set(
      origin,
      previous.then(() => current),
    )
    await previous
    try {
      const remaining =
        this.intervalMs - (this.now() - (this.lastRequestAt.get(origin) ?? -Infinity))
      if (remaining > 0) await this.sleep(remaining)
      this.lastRequestAt.set(origin, this.now())
    } catch (error) {
      release()
      throw error
    }
    return () => {
      release()
    }
  }
}

export class RetrievalRequestBudget {
  constructor({ maxRequests = 9 } = {}) {
    this.maxRequests = maxRequests
    this.used = 0
  }

  claim() {
    if (this.used >= this.maxRequests) throw new RetrievalError('request_limit')
    this.used += 1
  }
}

const DEFAULT_ROBOTS_CACHE = new Map()
const DEFAULT_LIMITER = new OriginRequestLimiter()

const typedFailure = (reason, detail = {}) => {
  const manifest = detail.manifest
    ? { ...detail.manifest, terminalResult: reason }
    : { terminalResult: reason }
  return { status: 'unresolved', reason, reviewOnly: true, ...detail, manifest }
}

const robotsCacheKey = (origin) => `${origin}|${RETRIEVAL_USER_AGENT}`

async function robotsPolicy(origin, profile, dependencies, now) {
  const key = robotsCacheKey(origin)
  const cached = dependencies.robotsCache.get(key)
  if (cached?.pending) return cached.pending
  const cacheAgeMs = cached ? now.valueOf() - cached.observedAt : null
  if (cached && cacheAgeMs >= 0 && cacheAgeMs < ROBOTS_TTL_MS) {
    return { ...cached, cacheAgeMs }
  }

  const pending = (async () => {
    let response
    try {
      response = await safeRequest(
        `${origin}/robots.txt`,
        profile,
        {
          ...contentRequestOptions,
          headers: { ...contentRequestOptions.headers, Accept: 'text/plain' },
        },
        {
          resolveDns: dependencies.resolveDns,
          requestImpl: dependencies.requestImpl,
          beforeRequest: (url) => {
            dependencies.requestBudget.claim()
            return dependencies.limiter.acquire(url.origin)
          },
        },
      )
    } catch (error) {
      if (
        error instanceof RetrievalError &&
        [
          'unsafe_url',
          'unsafe_dns',
          'redirect_outside_profile',
          'redirect_limit',
          'request_limit',
        ].includes(error.reason)
      )
        throw error
      throw new RetrievalError('robots_unreachable', error)
    }

    let policy
    if (response.status >= 400 && response.status < 500) {
      policy = { origin, state: 'unavailable', groups: [], connections: response.connections }
    } else if (response.status >= 500 || response.status < 200 || response.status >= 300) {
      throw new RetrievalError('robots_unreachable')
    } else if (mediaType(response.headers) !== 'text/plain') {
      throw new RetrievalError('robots_unreachable')
    } else {
      try {
        const text = decodeUtf8(response.body)
        policy = {
          origin,
          state: 'rules',
          groups: parseRobots(text),
          connections: response.connections,
        }
      } catch (error) {
        throw new RetrievalError('robots_unreachable', error)
      }
    }
    const stored = { ...policy, observedAt: now.valueOf(), cacheAgeMs: 0 }
    dependencies.robotsCache.set(key, stored)
    return stored
  })()
  dependencies.robotsCache.set(key, { pending })
  try {
    return await pending
  } catch (error) {
    if (dependencies.robotsCache.get(key)?.pending === pending) {
      dependencies.robotsCache.delete(key)
    }
    throw error
  }
}

const assertRobotsAccess = (policy, url) => {
  if (policy.state === 'unavailable') return
  if (!robotsAccess(policy.groups, url).allowed) throw new RetrievalError('robots_disallow')
}

async function fetchContent(url, profile, dependencies) {
  const response = await safeRequest(url, profile, contentRequestOptions, {
    resolveDns: dependencies.resolveDns,
    requestImpl: dependencies.requestImpl,
    beforeRequest: async (current) => {
      const policy = await dependencies.policyForOrigin(current.origin)
      assertRobotsAccess(policy, current)
      dependencies.requestBudget.claim()
      return dependencies.limiter.acquire(current.origin)
    },
  })
  if (response.status < 200 || response.status >= 300) throw new RetrievalError('http_status')
  if (!HTML_MEDIA_TYPES.has(mediaType(response.headers)))
    throw new RetrievalError('unsupported_media')
  const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase()
  if (encoding && encoding !== 'identity') throw new RetrievalError('unsupported_media')
  return { ...response, text: decodeUtf8(response.body) }
}

export function redactRetrievalResult(result) {
  if (result?.status !== 'retrieved') return result
  const redacted = { ...result }
  delete redacted.evidenceText
  return redacted
}

export async function retrieveAuthorityNavigation(
  { caseId, title, author, publicationYear = null, consultedUrl, consultedUrls },
  {
    profiles = [],
    now = new Date(),
    robotsCache = DEFAULT_ROBOTS_CACHE,
    limiter = DEFAULT_LIMITER,
    requestBudget = new RetrievalRequestBudget(),
    resolveDns,
    requestImpl,
  } = {},
) {
  const startedAt = now.toISOString()
  const baseManifest = {
    gatewayVersion: RETRIEVAL_GATEWAY_VERSION,
    policyVersion: RETRIEVAL_POLICY_VERSION,
    extractorVersion: RETRIEVAL_EXTRACTOR_VERSION,
    caseId,
    startedAt,
    target: { title, author, publicationYear },
  }
  if (
    typeof caseId !== 'string' ||
    !caseId.trim() ||
    typeof title !== 'string' ||
    !title.trim() ||
    typeof author !== 'string' ||
    !author.trim() ||
    (publicationYear != null && !Number.isInteger(publicationYear))
  ) {
    return typedFailure('invalid_target', { manifest: baseManifest })
  }
  if (!Array.isArray(consultedUrls) || !consultedUrls.includes(consultedUrl)) {
    return typedFailure('ungrounded_parent', { manifest: baseManifest })
  }

  const inspected = profileForConsultedUrl(consultedUrl, profiles, now)
  if (!inspected.eligible) return typedFailure(inspected.reason, { manifest: baseManifest })
  const profile = inspected.profile
  const observedPolicies = new Map()
  const dependencies = {
    robotsCache,
    limiter,
    requestBudget,
    resolveDns,
    requestImpl,
  }
  dependencies.policyForOrigin = async (origin) => {
    const policy = await robotsPolicy(origin, profile, dependencies, now)
    observedPolicies.set(origin, policy)
    return policy
  }
  const robotsManifest = () =>
    [...observedPolicies.values()]
      .sort((left, right) => left.origin.localeCompare(right.origin))
      .map((policy) => ({
        origin: policy.origin,
        state: policy.state,
        cacheAgeMs: policy.cacheAgeMs,
      }))
  const policyConnections = () =>
    [...observedPolicies.values()].flatMap((policy) => policy.connections ?? [])
  const requestManifest = () => ({ used: requestBudget.used, limit: requestBudget.maxRequests })

  try {
    const parentUrl = parseRetrievalUrl(consultedUrl).href
    const parent = await fetchContent(parentUrl, profile, dependencies)
    const selection = selectNavigationCandidate(parent.text, {
      parentUrl: parent.finalUrl,
      canonicalOrigin: profile.canonicalOrigin,
      targetTitle: title,
    })
    if (selection.status !== 'selected') {
      return typedFailure(selection.status, {
        manifest: {
          ...baseManifest,
          profileVersion: profile.profileVersion,
          parentUrl,
          parentFinalUrl: parent.finalUrl,
          candidates: selection.candidates.slice(0, 5),
          robots: robotsManifest(),
          requests: requestManifest(),
        },
      })
    }

    const child = await fetchContent(selection.selected.url, profile, dependencies)
    const extracted = extractEvidenceText(child.text)
    if (extracted.status !== 'extracted' || !extracted.text) {
      return typedFailure('parse_failure', { manifest: baseManifest })
    }
    const manifest = {
      ...baseManifest,
      terminalResult: 'retrieved',
      profileVersion: profile.profileVersion,
      sourceKind: profile.sourceKind,
      parentUrl,
      parentFinalUrl: parent.finalUrl,
      selectedAnchorText: selection.selected.label,
      selectedUrl: selection.selected.url,
      selectedScore: selection.selected.score,
      childFinalUrl: child.finalUrl,
      redirectChain: [...parent.redirectChain, ...child.redirectChain],
      connections: [...policyConnections(), ...parent.connections, ...child.connections],
      robots: robotsManifest(),
      requests: requestManifest(),
      response: {
        status: child.status,
        mediaType: mediaType(child.headers),
        encodedBytes: child.encodedBytes,
        decodedCharacters: child.text.length,
        truncated: extracted.truncated,
        omittedCharacters: extracted.omittedCharacters,
        etag: child.headers.etag ?? null,
        lastModified: child.headers['last-modified'] ?? null,
      },
      fetchedSha256: sha256(child.body),
      sanitizedSha256: sha256(extracted.text),
    }
    return {
      status: 'retrieved',
      reviewOnly: true,
      evidenceText: extracted.text,
      manifest,
    }
  } catch (error) {
    const reason = error instanceof RetrievalError ? error.reason : 'internal_error'
    return typedFailure(reason, {
      manifest: {
        ...baseManifest,
        profileVersion: profile.profileVersion,
        sourceKind: profile.sourceKind,
        robots: robotsManifest(),
        requests: requestManifest(),
      },
    })
  }
}
