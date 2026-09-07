import { parseRetrievalUrl, RetrievalError } from './network.mjs'

const PROFILE_STATUSES = new Set(['approved_trial', 'pending', 'blocked', 'manual_only'])
const SOURCE_KINDS = new Set(['author', 'author_post', 'publisher', 'publisher_catalog'])
export const REPEATED_NUMBERED_CATALOG_HEADINGS = 'repeated_numbered_catalog_headings'
const EVIDENCE_CAPABILITIES = new Set([REPEATED_NUMBERED_CATALOG_HEADINGS])

export const normalizeEvidenceCapabilities = (value) => {
  if (value == null) return []
  if (
    !Array.isArray(value) ||
    value.some(
      (capability) => typeof capability !== 'string' || !EVIDENCE_CAPABILITIES.has(capability),
    ) ||
    new Set(value).size !== value.length
  ) {
    return null
  }
  return [...value].sort()
}

export const evidenceCapabilitiesMatch = (left, right) => {
  const normalizedLeft = normalizeEvidenceCapabilities(left)
  const normalizedRight = normalizeEvidenceCapabilities(right)
  return (
    normalizedLeft !== null &&
    normalizedRight !== null &&
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((capability, index) => capability === normalizedRight[index])
  )
}

const normalizedOrigin = (raw) => {
  const url = parseRetrievalUrl(raw)
  if (url.pathname !== '/' || url.search) throw new RetrievalError('origin_pending')
  return url.origin
}

export function inspectOriginProfile(profile, now = new Date()) {
  if (!profile || profile.schemaVersion !== 1 || !PROFILE_STATUSES.has(profile.status)) {
    return { eligible: false, reason: 'origin_pending' }
  }
  if (profile.status !== 'approved_trial') {
    return {
      eligible: false,
      reason: profile.status === 'blocked' ? 'origin_blocked' : 'origin_pending',
    }
  }
  if (!SOURCE_KINDS.has(profile.sourceKind)) return { eligible: false, reason: 'origin_pending' }
  const evidenceCapabilities = normalizeEvidenceCapabilities(profile.evidenceCapabilities)
  if (evidenceCapabilities === null) return { eligible: false, reason: 'origin_pending' }
  if (
    !profile.profileVersion ||
    !profile.reviewedBy ||
    !profile.reviewReference ||
    !profile.termsReviewedAt ||
    !profile.expiresAt
  ) {
    return { eligible: false, reason: 'origin_pending' }
  }
  const expiresAt = new Date(profile.expiresAt)
  const reviewedAt = new Date(profile.termsReviewedAt)
  if (
    Number.isNaN(expiresAt.valueOf()) ||
    Number.isNaN(reviewedAt.valueOf()) ||
    reviewedAt > now ||
    expiresAt <= now
  ) {
    return { eligible: false, reason: 'origin_pending' }
  }

  try {
    const canonicalOrigin = normalizedOrigin(profile.canonicalOrigin)
    const canonicalAliases = [...new Set((profile.canonicalAliases ?? []).map(normalizedOrigin))]
    return {
      eligible: true,
      profile: { ...profile, canonicalOrigin, canonicalAliases, evidenceCapabilities },
    }
  } catch {
    return { eligible: false, reason: 'origin_pending' }
  }
}

export function profileForConsultedUrl(consultedUrl, profiles, now = new Date()) {
  let url
  try {
    url = parseRetrievalUrl(consultedUrl)
  } catch {
    return { eligible: false, reason: 'unsafe_url' }
  }
  const matchingProfiles = (profiles ?? []).filter((candidate) => {
    try {
      return new Set([
        normalizedOrigin(candidate.canonicalOrigin),
        ...(candidate.canonicalAliases ?? []).map(normalizedOrigin),
      ]).has(url.origin)
    } catch {
      return false
    }
  })
  if (!matchingProfiles.length) return { eligible: false, reason: 'origin_pending' }
  if (matchingProfiles.some((profile) => profile.status === 'blocked')) {
    return { eligible: false, reason: 'origin_blocked' }
  }
  if (matchingProfiles.length !== 1) return { eligible: false, reason: 'origin_pending' }
  return inspectOriginProfile(matchingProfiles[0], now)
}
