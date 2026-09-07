import { isDeepStrictEqual } from 'node:util'
import { normalize } from '../normalize.mjs'
import { evidenceCapabilitiesMatch, profileForConsultedUrl } from './retrieval/profile.mjs'
import { authorityRetrievalProfiles } from './retrieval/profiles.mjs'

const asArray = (value) => (Array.isArray(value) ? value : [])
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const providerForPass = (pass) => (pass === 'retrieval' ? 'authority-retrieval' : 'authority-scout')

const sourceForMembership = (output, membership) => {
  const sources = asArray(output.authoritySources)
  const cited = asArray(membership.evidenceUrls)
    .map((url) => sources.find((source) => source?.url === url))
    .filter((source) => isObject(source) && asArray(source.supports).includes('series_membership'))
  if (membership.position !== null) {
    return cited.find((source) => asArray(source.supports).includes('position')) ?? cited[0]
  }
  return cited[0]
}

const verifiedPass = (result, profiles, now) => {
  if (
    result?.status !== 'completed' ||
    !result.validation?.valid ||
    !result.validation?.policySafe ||
    !isObject(result.output)
  ) {
    return null
  }

  if (result.selectedPass !== 'retrieval') return 'first'
  const interpretation = result.retrievalInterpretation
  const retrieval = result.retrieval
  const retrievalManifest = retrieval?.manifest
  const manifestUrls = new Set(asArray(result.selectedSourceManifest?.urls))
  const reviewedOrigin = profileForConsultedUrl(retrievalManifest?.childFinalUrl, profiles, now)
  if (
    result.selectedSourceManifest?.kind !== 'retrieval' ||
    manifestUrls.size !== 1 ||
    retrieval?.status !== 'retrieved' ||
    retrieval?.reviewOnly !== true ||
    retrievalManifest?.caseId !== result.caseId ||
    typeof retrievalManifest.profileVersion !== 'string' ||
    !retrievalManifest.profileVersion ||
    typeof retrievalManifest.sourceKind !== 'string' ||
    !retrievalManifest.sourceKind ||
    !/^[a-f0-9]{64}$/i.test(retrievalManifest.sanitizedSha256 ?? '') ||
    !manifestUrls.has(retrievalManifest.childFinalUrl) ||
    !reviewedOrigin.eligible ||
    reviewedOrigin.profile.profileVersion !== retrievalManifest.profileVersion ||
    reviewedOrigin.profile.sourceKind !== retrievalManifest.sourceKind ||
    !evidenceCapabilitiesMatch(
      reviewedOrigin.profile.evidenceCapabilities,
      retrievalManifest.evidenceCapabilities,
    ) ||
    interpretation?.status !== 'completed' ||
    !interpretation.validation?.valid ||
    !interpretation.validation?.policySafe ||
    !isDeepStrictEqual(asArray(interpretation.sourceManifestUrls), [...manifestUrls]) ||
    !isDeepStrictEqual(interpretation.output, result.output) ||
    asArray(result.output.authoritySources).some(
      (source) => !manifestUrls.has(source?.url) || source?.kind !== retrievalManifest.sourceKind,
    )
  ) {
    return null
  }
  return 'retrieval'
}

const resultForProvider = (target, result, pass) => {
  const output = result.output
  const identitySource = asArray(output.authoritySources).find(
    (source) =>
      isObject(source) &&
      asArray(source.supports).includes('identity') &&
      asArray(output.identity?.evidenceUrls).includes(source.url),
  )
  const workMatched =
    output.identity?.matched &&
    ['high', 'medium'].includes(output.identity?.confidence) &&
    Boolean(identitySource)
  const provider = providerForPass(pass)
  const seriesClaims =
    workMatched && output.classification === 'series'
      ? asArray(output.memberships).flatMap((membership) => {
          if (!isObject(membership) || typeof membership.series !== 'string') return []
          const source = sourceForMembership(output, membership)
          if (!source) return []
          return [
            {
              evidenceKind: 'relational_membership',
              providerSeriesId: `authority:${normalize(membership.series)}`,
              series: membership.series,
              position: membership.position ?? null,
              memberCount: null,
              orderType: 'unspecified',
              role: membership.role ?? 'unknown',
              sourceRef: source.url,
              sourceKind: source.kind,
              evidenceSummary: source.evidenceSummary,
              authorityPass: pass,
              sourceLineage: {
                originProvider: 'authority-source',
                originEntityId: source.url,
                observedVia: provider,
              },
            },
          ]
        })
      : []

  return {
    caseId: target.caseId,
    workMatch: workMatched
      ? {
          matched: true,
          confidence: output.identity.confidence,
          providerWorkId: identitySource.url,
          matchedTitle: target.target.title,
          matchedAuthors: target.target.authors,
          sourceLineage: {
            originProvider: 'authority-source',
            originEntityId: identitySource.url,
            observedVia: provider,
          },
        }
      : { matched: false, confidence: 'none' },
    seriesClaims,
  }
}

export function authorityProviderRuns(
  report,
  { profiles = authorityRetrievalProfiles, now = new Date() } = {},
) {
  if (!Array.isArray(report?.targets) || !Array.isArray(report?.results)) {
    throw new Error('Authority input must be a complete authority-acquisition JSON report')
  }
  if (
    report.targets.some((target) => !isObject(target) || typeof target.caseId !== 'string') ||
    report.results.some((result) => !isObject(result) || typeof result.caseId !== 'string')
  ) {
    throw new Error('Authority input contains an invalid target or result')
  }
  const targets = new Map(report.targets.map((target) => [target.caseId, target]))
  if (targets.size !== report.targets.length) {
    throw new Error('Authority input contains duplicate target ids')
  }
  const resultIds = new Set(report.results.map((result) => result.caseId))
  if (resultIds.size !== report.results.length) {
    throw new Error('Authority input contains duplicate result ids')
  }
  const missingResults = report.targets
    .map((target) => target.caseId)
    .filter((id) => !resultIds.has(id))
  const unknownResults = report.results
    .map((result) => result.caseId)
    .filter((id) => !targets.has(id))
  if (missingResults.length || unknownResults.length) {
    throw new Error(
      `Authority input target/result ids differ: missing results ${missingResults.join(', ') || 'none'}; unknown results ${unknownResults.join(', ') || 'none'}`,
    )
  }
  const resultsByProvider = new Map()

  for (const result of report.results) {
    const target = targets.get(result.caseId)
    const pass = verifiedPass(result, profiles, now)
    if (
      !target ||
      !isObject(target.target) ||
      typeof target.target.title !== 'string' ||
      !Array.isArray(target.target.authors) ||
      !pass ||
      result.output.caseId !== target.caseId
    ) {
      continue
    }
    const provider = providerForPass(pass)
    const providerResults = resultsByProvider.get(provider) ?? []
    providerResults.push(resultForProvider(target, result, pass))
    resultsByProvider.set(provider, providerResults)
  }

  return [...resultsByProvider.entries()].map(([provider, results]) => ({
    schemaVersion: 1,
    provider,
    observedAt: report.observedAt ?? null,
    completedAt: report.completedAt ?? null,
    rights: {
      commercialUsePermitted: null,
      persistentStoragePermitted: null,
      claimLevelProvenance: true,
      note:
        provider === 'authority-retrieval'
          ? 'Hash-checked retrieval from a reviewed first-party origin; trial use pending rights review.'
          : 'Hosted-search scout output is review-only and cannot establish automatic membership.',
    },
    results,
  }))
}
