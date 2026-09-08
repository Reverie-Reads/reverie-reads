import { isIP } from 'node:net'

const asArray = (value) => (Array.isArray(value) ? value : [])

const excludedDomains = new Set([
  'amazon.com',
  'barnesandnoble.com',
  'facebook.com',
  'fantasticfiction.com',
  'google.com',
  'goodreads.com',
  'instagram.com',
  'isfdb.org',
  'linktr.ee',
  'sf-encyclopedia.com',
  'target.com',
  'thecwa.co.uk',
  'tiktok.com',
  'twitter.com',
  'wikipedia.org',
  'x.com',
  'youtube.com',
])

const isExcludedDomain = (domain) =>
  [...excludedDomains].some((excluded) => domain === excluded || domain.endsWith(`.${excluded}`))

export const authorityDomainForUrl = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const domain = url.hostname.toLowerCase().replace(/^www\./, '')
    if (
      !domain.includes('.') ||
      isIP(domain) ||
      domain.endsWith('.local') ||
      isExcludedDomain(domain) ||
      domain.endsWith('.fandom.com')
    ) {
      return null
    }
    return domain
  } catch {
    return null
  }
}

export function rankedAuthorityDomains(searchResults, limit = 8) {
  const boundedLimit = Math.max(0, Math.floor(limit))
  if (!boundedLimit) return []

  const evidenceByDomain = new Map()
  let firstSeen = 0
  for (const [queryIndex, result] of asArray(searchResults).entries()) {
    for (const [rank, url] of asArray(result?.urls).entries()) {
      const domain = authorityDomainForUrl(url)
      if (!domain) continue
      const evidence = evidenceByDomain.get(domain) ?? {
        domain,
        queryIndexes: new Set(),
        bestRank: Number.POSITIVE_INFINITY,
        firstSeen,
      }
      evidence.queryIndexes.add(queryIndex)
      evidence.bestRank = Math.min(evidence.bestRank, rank)
      evidenceByDomain.set(domain, evidence)
      firstSeen += 1
    }
  }

  return [...evidenceByDomain.values()]
    .sort(
      (left, right) =>
        right.queryIndexes.size - left.queryIndexes.size ||
        left.bestRank - right.bestRank ||
        left.firstSeen - right.firstSeen ||
        left.domain.localeCompare(right.domain),
    )
    .slice(0, boundedLimit)
    .map(({ domain }) => domain)
}

export const shouldAttemptFocusedAuthoritySearch = (firstPass) =>
  firstPass?.status === 'completed' &&
  (firstPass.output?.classification === 'unresolved' || !firstPass.validation?.policySafe)

export function discoveredAuthorityDomains(firstPass, limit = 2) {
  if (!shouldAttemptFocusedAuthoritySearch(firstPass)) return []
  const consultedDomains = new Set(
    asArray(firstPass.consultedUrls).map(authorityDomainForUrl).filter(Boolean),
  )
  const domains = []
  for (const source of asArray(firstPass.output?.authoritySources)) {
    if (!asArray(source?.supports).includes('identity')) continue
    const domain = authorityDomainForUrl(source?.url)
    if (!domain || !consultedDomains.has(domain) || domains.includes(domain)) continue
    domains.push(domain)
    if (domains.length === limit) break
  }
  return domains
}

export const shouldSelectFocusedAuthoritySearch = (firstPass, focusedPass) => {
  if (
    focusedPass?.status !== 'completed' ||
    !focusedPass.validation?.valid ||
    !focusedPass.validation?.policySafe ||
    focusedPass.output?.classification === 'unresolved'
  ) {
    return false
  }
  return (
    !firstPass.validation?.valid ||
    !firstPass.validation?.policySafe ||
    firstPass.output?.classification === 'unresolved'
  )
}
