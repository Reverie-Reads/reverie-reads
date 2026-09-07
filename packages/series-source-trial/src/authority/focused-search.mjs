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

const domainFor = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    const domain = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!domain.includes('.') || isExcludedDomain(domain) || domain.endsWith('.fandom.com')) {
      return null
    }
    return domain
  } catch {
    return null
  }
}

export const shouldAttemptFocusedAuthoritySearch = (firstPass) =>
  firstPass?.status === 'completed' &&
  (firstPass.output?.classification === 'unresolved' || !firstPass.validation?.policySafe)

export function discoveredAuthorityDomains(firstPass, limit = 2) {
  if (!shouldAttemptFocusedAuthoritySearch(firstPass)) return []
  const consultedDomains = new Set(asArray(firstPass.consultedUrls).map(domainFor).filter(Boolean))
  const domains = []
  for (const source of asArray(firstPass.output?.authoritySources)) {
    if (!asArray(source?.supports).includes('identity')) continue
    const domain = domainFor(source?.url)
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
