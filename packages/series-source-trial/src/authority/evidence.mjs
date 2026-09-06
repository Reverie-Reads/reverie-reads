import { normalize, seriesMatches } from '../normalize.mjs'

const classifications = new Set(['series', 'standalone', 'unresolved'])
const confidenceValues = new Set(['high', 'medium', 'low', 'none'])
const roles = new Set(['primary', 'secondary', 'unknown'])
const sourceKinds = new Set(['author', 'author_post', 'publisher', 'publisher_catalog'])
const supportsValues = new Set(['identity', 'series_membership', 'position', 'standalone'])
const discoveryOnlyHosts = new Set([
  'amazon.com',
  'barnesandnoble.com',
  'goodreads.com',
  'linktr.ee',
  'target.com',
  'wikipedia.org',
])

const asArray = (value) => (Array.isArray(value) ? value : [])
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const ratio = (numerator, denominator) => (denominator ? numerator / denominator : null)
const genericSeriesTail = new Set([
  'book',
  'books',
  'collection',
  'crime',
  'cycle',
  'duology',
  'murder',
  'mystery',
  'novel',
  'novels',
  'romance',
  'saga',
  'series',
  'stories',
  'trilogy',
])

export const buildAuthorityTarget = (testCase) => ({
  schemaVersion: 1,
  caseId: testCase.id,
  target: {
    title: testCase.title,
    authors: [...testCase.authors],
    publicationYear: Number.isInteger(testCase.publicationYear) ? testCase.publicationYear : null,
  },
})

export const authorityPolicyForCase = (testCase) => ({
  classificationBlockedUrls: asArray(testCase.sampleSources)
    .map((source) => source?.url)
    .filter(Boolean),
})

const comparableUrl = (value) => {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:') return null
    url.hash = ''
    for (const name of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|source$)/i.test(name)) url.searchParams.delete(name)
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    url.hostname = url.hostname.toLowerCase()
    return url.toString()
  } catch {
    return null
  }
}

const citedSource = (sources, url, support) => {
  const wanted = comparableUrl(url)
  return sources.find(
    (source) => comparableUrl(source.url) === wanted && asArray(source.supports).includes(support),
  )
}

const knownClassificationRisk = (source) => {
  const comparable = comparableUrl(source?.url)
  if (!comparable) return null
  const url = new URL(comparable)
  const rootHost = url.hostname.replace(/^www\./, '')
  if (discoveryOnlyHosts.has(rootHost) || rootHost.endsWith('.fandom.com')) {
    return 'known_discovery_only_host'
  }
  if (
    url.hostname === 'www.hachettebookgroup.com' &&
    /\/(?:orbit-books\/standalone-sff-books|landing-page\/standalone-sff-books|book-list\/best-books-for-romantasy-fans)\/?$/i.test(
      url.pathname,
    )
  ) {
    return 'known_marketing_taxonomy_conflict'
  }
  if (
    (rootHost === 'kierstenmodglinauthor.com' &&
      (/\/(?:uploads\/.*)?[^/]*(?:booklist|reading[_-]age[_-]guide)[^/]*\.pdf$/i.test(
        url.pathname,
      ) ||
        url.pathname === '/books')) ||
    ((rootHost === 'squarespace.com' || rootHost.endsWith('.squarespace.com')) &&
      /kiersten[^/]*modglin[^/]*booklist\.pdf$/i.test(url.pathname))
  ) {
    // The catalog labels The Nanny's Secret standalone while its exact author page calls it a
    // Locke Industries Series installment. Treat revisions and mirrors as one profiled taxonomy.
    return 'known_author_catalog_taxonomy_conflict'
  }
  return null
}

const knownMembershipEvidenceRisk = (source) => {
  const summary = source?.evidenceSummary ?? ''
  if (/\b(?:trigger[- ]?warnings?|tropes?)\b/i.test(summary)) {
    return 'non_bibliographic_taxonomy'
  }
  if (
    /\bheading\b/i.test(summary) &&
    !/\b(?:series|trilogy|duology|collection|saga|cycle)\b/i.test(summary)
  ) {
    return 'unlabelled_grouping'
  }
  if (
    /\b(?:spin[- ]?off|companion|shared characters?|same (?:world|universe|setting))\b/i.test(
      summary,
    )
  ) {
    return 'indirect_relationship_inference'
  }
  return null
}

const sourceClassificationEligible = (source, blockedUrls, support) => {
  if (!source || !asArray(source.supports).includes(support)) return false
  const blocked = new Set(asArray(blockedUrls).map(comparableUrl).filter(Boolean))
  if (blocked.has(comparableUrl(source.url))) return false
  if (knownClassificationRisk(source)) return false
  if (support === 'series_membership' && knownMembershipEvidenceRisk(source)) return false
  if (support === 'standalone' && !/\bstand-?alones?\b/i.test(source.evidenceSummary ?? '')) {
    return false
  }
  return true
}

const reviewedSourceKind = (policy, url) => {
  const wanted = comparableUrl(url)
  return asArray(policy.retrievedSources).find((source) => comparableUrl(source?.url) === wanted)
    ?.sourceKind
}

export const authorityPolicyForRetrievedSource = (policy = {}, { url, sourceKind }) => ({
  ...policy,
  retrievedSources: [
    ...asArray(policy.retrievedSources).filter(
      (source) => comparableUrl(source?.url) !== comparableUrl(url),
    ),
    { url, sourceKind },
  ],
})

const genericSeriesKey = (value) => {
  const words = normalize(value).split(' ').filter(Boolean)
  while (words.length > 1 && genericSeriesTail.has(words.at(-1))) words.pop()
  return words.join(' ')
}

const selfTitleKey = (value) => {
  const words = genericSeriesKey(value).split(' ').filter(Boolean)
  while (['a', 'an', 'the'].includes(words[0])) words.shift()
  return words.join(' ')
}

const authoritySeriesMatches = (membership, actualSeries) =>
  seriesMatches(membership, actualSeries) ||
  [membership.series, ...(membership.aliases ?? [])]
    .map(genericSeriesKey)
    .includes(genericSeriesKey(actualSeries))

export function canonicalizeAuthorityAcquisition(output, consultedUrls = null, policy = {}) {
  if (!isObject(output) || !Array.isArray(output.authoritySources)) return output
  const consulted = Array.isArray(consultedUrls)
    ? new Set(consultedUrls.map(comparableUrl).filter(Boolean))
    : null
  const classificationBlocked = new Set(
    asArray(policy.classificationBlockedUrls).map(comparableUrl).filter(Boolean),
  )
  const sources = output.authoritySources
    .filter((source) => !consulted || consulted.has(comparableUrl(source?.url)))
    .map((source) => {
      if (!isObject(source)) return source
      const reviewedKind = reviewedSourceKind(policy, source.url)
      const normalizedSource = reviewedKind ? { ...source, kind: reviewedKind } : source
      const supports = asArray(source.supports)
      if (
        !knownClassificationRisk(normalizedSource) &&
        !classificationBlocked.has(comparableUrl(normalizedSource.url))
      ) {
        const relationshipRisk = knownMembershipEvidenceRisk(normalizedSource)
        return {
          ...normalizedSource,
          supports: relationshipRisk
            ? supports.filter(
                (support) => support !== 'series_membership' && support !== 'position',
              )
            : supports,
        }
      }
      return {
        ...normalizedSource,
        supports: supports.filter((support) => support === 'identity'),
      }
    })
    .filter((source) => !isObject(source) || source.supports.length)
  const filterFor = (urls, support) => [
    ...new Set(asArray(urls).filter((url) => citedSource(sources, url, support))),
  ]
  const identityUrls = filterFor(output.identity?.evidenceUrls, 'identity')
  return {
    ...output,
    authoritySources: sources,
    identity: isObject(output.identity)
      ? {
          ...output.identity,
          evidenceUrls:
            output.identity.matched && !identityUrls.length
              ? sources
                  .filter((source) => asArray(source.supports).includes('identity'))
                  .map((source) => source.url)
              : identityUrls,
        }
      : output.identity,
    memberships: asArray(output.memberships)
      .map((membership) => {
        if (!isObject(membership)) return membership
        const evidenceUrls = filterFor(membership.evidenceUrls, 'series_membership')
        const positionSupported = evidenceUrls.some((url) => citedSource(sources, url, 'position'))
        return {
          ...membership,
          position: positionSupported ? membership.position : null,
          evidenceUrls,
        }
      })
      .filter(
        (membership, index) =>
          !isObject(membership) ||
          !asArray(output.memberships[index]?.evidenceUrls).length ||
          membership.evidenceUrls.length,
      ),
  }
}

export function validateAuthorityAcquisition(target, output, consultedUrls, policy = {}) {
  const errors = []
  const policyViolations = []
  let citedUrlCount = 0
  let groundedUrlCount = 0
  if (!isObject(output)) {
    return {
      valid: false,
      policySafe: false,
      reviewOnly: true,
      errors: ['output must be an object'],
      policyViolations,
      citedUrlCount,
      groundedUrlCount,
    }
  }
  if (output.caseId !== target.caseId) errors.push('caseId does not match the target')
  if (!isObject(output.identity)) errors.push('identity must be an object')
  if (!classifications.has(output.classification)) errors.push('classification is invalid')
  if (!Array.isArray(output.memberships)) errors.push('memberships must be an array')
  if (!Array.isArray(output.authoritySources)) errors.push('authoritySources must be an array')
  if (!Array.isArray(output.uncertainties)) errors.push('uncertainties must be an array')
  if (typeof output.note !== 'string' || output.note.length > 240) {
    errors.push('note must be a string of at most 240 characters')
  }
  if (errors.length) {
    return {
      valid: false,
      policySafe: false,
      reviewOnly: true,
      errors,
      policyViolations,
      citedUrlCount,
      groundedUrlCount,
    }
  }

  const consulted = new Set(asArray(consultedUrls).map(comparableUrl).filter(Boolean))
  const sources = output.authoritySources
  for (const [index, source] of sources.entries()) {
    if (!isObject(source)) {
      errors.push(`authority source ${index} must be an object`)
      continue
    }
    citedUrlCount += 1
    const comparable = comparableUrl(source.url)
    if (!comparable) errors.push(`authority source ${index} requires an HTTPS URL`)
    else if (consulted.has(comparable)) groundedUrlCount += 1
    else errors.push(`authority source ${index} URL is absent from the consulted-source manifest`)
    if (!sourceKinds.has(source.kind)) errors.push(`authority source ${index} kind is invalid`)
    const reviewedKind = reviewedSourceKind(policy, source.url)
    if (reviewedKind && source.kind !== reviewedKind) {
      errors.push(`authority source ${index} kind does not match its reviewed origin profile`)
    }
    if (!Array.isArray(source.supports) || !source.supports.length) {
      errors.push(`authority source ${index} requires at least one support type`)
    }
    for (const support of asArray(source.supports)) {
      if (!supportsValues.has(support)) {
        errors.push(`authority source ${index} support type ${support} is invalid`)
      }
    }
    if (
      typeof source.evidenceSummary !== 'string' ||
      !source.evidenceSummary.trim() ||
      source.evidenceSummary.length > 320
    ) {
      errors.push(`authority source ${index} evidenceSummary must be 1 to 320 characters`)
    }
    const risk = knownClassificationRisk(source)
    if (risk && asArray(source.supports).some((support) => support !== 'identity')) {
      policyViolations.push(`authority source ${index} has ${risk}`)
    }
    const membershipRisk = knownMembershipEvidenceRisk(source)
    if (membershipRisk && asArray(source.supports).includes('series_membership')) {
      policyViolations.push(`authority source ${index} has ${membershipRisk}`)
    }
    if (
      asArray(policy.classificationBlockedUrls).map(comparableUrl).includes(comparable) &&
      asArray(source.supports).some((support) => support !== 'identity')
    ) {
      policyViolations.push(`authority source ${index} is selection provenance, not truth evidence`)
    }
    if (
      output.classification === 'standalone' &&
      asArray(source.supports).includes('standalone') &&
      !/\bstand-?alones?\b/i.test(source.evidenceSummary ?? '')
    ) {
      policyViolations.push(
        `authority source ${index} does not summarize an affirmative standalone statement`,
      )
    }
  }

  const identity = output.identity
  if (isObject(identity)) {
    if (typeof identity.matched !== 'boolean') errors.push('identity.matched must be boolean')
    if (!confidenceValues.has(identity.confidence)) errors.push('identity.confidence is invalid')
    if (!Array.isArray(identity.evidenceUrls)) errors.push('identity.evidenceUrls must be an array')
    for (const url of asArray(identity.evidenceUrls)) {
      citedUrlCount += 1
      if (citedSource(sources, url, 'identity')) groundedUrlCount += 1
      else errors.push('identity evidence URL is not a grounded identity authority source')
    }
    if (identity.matched && !identity.evidenceUrls?.length) {
      errors.push('a matched identity requires authority evidence')
    }
    if (!identity.matched && identity.evidenceUrls?.length) {
      errors.push('an unmatched identity cannot cite identity evidence')
    }
  }

  for (const [index, membership] of output.memberships.entries()) {
    if (!isObject(membership)) {
      errors.push(`membership ${index} must be an object`)
      continue
    }
    if (typeof membership.series !== 'string' || !membership.series.trim()) {
      errors.push(`membership ${index} requires a series`)
    }
    if (membership.position !== null && !Number.isFinite(membership.position)) {
      errors.push(`membership ${index} position is invalid`)
    }
    if (!roles.has(membership.role)) errors.push(`membership ${index} role is invalid`)
    if (!Array.isArray(membership.evidenceUrls) || !membership.evidenceUrls.length) {
      errors.push(`membership ${index} requires authority evidence`)
    }
    for (const url of asArray(membership.evidenceUrls)) {
      citedUrlCount += 1
      if (citedSource(sources, url, 'series_membership')) groundedUrlCount += 1
      else errors.push(`membership ${index} evidence URL is not a series authority source`)
    }
    if (
      !asArray(membership.evidenceUrls).some((url) =>
        sourceClassificationEligible(
          citedSource(sources, url, 'series_membership'),
          policy.classificationBlockedUrls,
          'series_membership',
        ),
      )
    ) {
      policyViolations.push(`membership ${index} lacks classification-eligible authority evidence`)
    }
    if (
      membership.position !== null &&
      !asArray(membership.evidenceUrls).some((url) =>
        sourceClassificationEligible(
          citedSource(sources, url, 'position'),
          policy.classificationBlockedUrls,
          'position',
        ),
      )
    ) {
      policyViolations.push(`membership ${index} position lacks eligible explicit evidence`)
    }
  }

  const identityResolved =
    identity?.matched &&
    ['high', 'medium'].includes(identity?.confidence) &&
    identity.evidenceUrls.length
  if (output.classification === 'series') {
    if (!identityResolved) errors.push('series classification requires a matched identity')
    if (!output.memberships.length) errors.push('series classification requires a membership')
    for (const membership of output.memberships) {
      if (
        !isObject(membership) ||
        !selfTitleKey(membership.series) ||
        selfTitleKey(membership.series) !== selfTitleKey(target.target?.title)
      ) {
        continue
      }
      const exactWorkCorroboration = asArray(membership.evidenceUrls)
        .map((url) => citedSource(sources, url, 'series_membership'))
        .filter(Boolean)
        .some(
          (source) =>
            source.kind !== 'publisher_catalog' && asArray(source.supports).includes('identity'),
        )
      if (!exactWorkCorroboration) {
        policyViolations.push(
          'self-titled series relationship requires exact-work membership corroboration',
        )
      }
    }
  }
  if (output.classification === 'standalone') {
    if (!identityResolved) errors.push('standalone classification requires a matched identity')
    if (output.memberships.length)
      errors.push('standalone classification cannot contain memberships')
    if (
      !sources.some((source) =>
        sourceClassificationEligible(source, policy.classificationBlockedUrls, 'standalone'),
      )
    ) {
      policyViolations.push(
        'standalone classification requires eligible affirmative authority evidence',
      )
    }
  }

  return {
    valid: errors.length === 0,
    policySafe: errors.length === 0 && policyViolations.length === 0,
    reviewOnly: true,
    errors,
    policyViolations: [...new Set(policyViolations)],
    citedUrlCount,
    groundedUrlCount,
  }
}

const predictedMemberships = (result) =>
  result.status === 'completed' &&
  result.validation?.valid &&
  result.validation?.policySafe &&
  result.output.classification === 'series'
    ? result.output.memberships
    : []

export function scoreAuthorityAcquisition(caseSet, results, model) {
  const caseById = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const reviewed = results
    .map((result) => ({ result, testCase: caseById.get(result.caseId) }))
    .filter(({ testCase }) => testCase?.truth?.status === 'reviewed')
  const positives = reviewed.filter(({ testCase }) => !testCase.truth.standalone)
  const standalones = reviewed.filter(({ testCase }) => testCase.truth.standalone)
  const candidates = results
    .map((result) => ({ result, testCase: caseById.get(result.caseId) }))
    .filter(({ testCase }) => testCase?.truth?.status === 'candidate')
  let resolvedCases = 0
  let correctResolvedCases = 0
  let truePositiveClaims = 0
  let falsePositiveClaims = 0
  let recoveredPositiveCases = 0
  let falseStandaloneCases = 0
  let falseSeriesCases = 0
  const details = []

  for (const { result, testCase } of reviewed) {
    const valid = result.status === 'completed' && result.validation?.valid
    const policySafe = valid && result.validation?.policySafe
    const classification = policySafe ? result.output.classification : 'unresolved'
    const memberships = predictedMemberships(result)
    const matching = memberships.filter((claim) =>
      testCase.truth.memberships.some((membership) =>
        authoritySeriesMatches(membership, claim.series),
      ),
    )
    const resolved = classification !== 'unresolved'
    if (resolved) resolvedCases += 1
    if (testCase.truth.standalone) {
      if (classification === 'standalone') correctResolvedCases += 1
      if (classification === 'series') falseSeriesCases += 1
      falsePositiveClaims += memberships.length
    } else {
      if (classification === 'series' && matching.length) correctResolvedCases += 1
      if (classification === 'standalone') falseStandaloneCases += 1
      truePositiveClaims += matching.length
      falsePositiveClaims += memberships.length - matching.length
      if (matching.length) recoveredPositiveCases += 1
    }
    details.push({
      caseId: testCase.id,
      truth: testCase.truth.standalone ? 'standalone' : 'series',
      classification,
      valid,
      policySafe,
      matchingMemberships: matching.map((entry) => entry.series),
      proposedMemberships: memberships.map((entry) => entry.series),
    })
  }

  const completed = results.filter((result) => result.status === 'completed')
  const citations = completed.reduce(
    (total, result) => total + (result.validation?.citedUrlCount ?? 0),
    0,
  )
  const grounded = completed.reduce(
    (total, result) => total + (result.validation?.groundedUrlCount ?? 0),
    0,
  )
  const inputTokens = completed.reduce(
    (total, result) => total + Number(result.usage?.input_tokens ?? 0),
    0,
  )
  const outputTokens = completed.reduce(
    (total, result) => total + Number(result.usage?.output_tokens ?? 0),
    0,
  )
  const candidateClassification = (result) => {
    if (result.status !== 'completed' || !result.validation?.policySafe) return 'quarantined'
    return result.output.classification
  }

  return {
    schemaVersion: 1,
    model,
    scope: {
      cases: results.length,
      reviewedCases: reviewed.length,
      positiveCases: positives.length,
      standaloneCases: standalones.length,
      candidateCases: results.length - reviewed.length,
    },
    capability: {
      validResponseRate: ratio(
        completed.filter((result) => result.validation?.valid).length,
        results.length,
      ),
      policySafeResponseRate: ratio(
        completed.filter((result) => result.validation?.policySafe).length,
        results.length,
      ),
      sourceGroundingRate: ratio(grounded, citations),
      resolutionRate: ratio(resolvedCases, reviewed.length),
      resolvedAccuracy: ratio(correctResolvedCases, resolvedCases),
      effectiveAccuracy: ratio(correctResolvedCases, reviewed.length),
      membershipPrecision: ratio(truePositiveClaims, truePositiveClaims + falsePositiveClaims),
      membershipRecall: ratio(recoveredPositiveCases, positives.length),
      falseStandaloneRate: ratio(falseStandaloneCases, positives.length),
      falseSeriesRate: ratio(falseSeriesCases, standalones.length),
    },
    operations: {
      errors: results.filter((result) => result.status === 'error').length,
      cached: results.filter((result) => result.cached).length,
      modelCalls: results.filter((result) => result.status === 'completed' && !result.cached)
        .length,
      webSearchCalls: results.reduce(
        (total, result) => total + Number(result.webSearchCalls ?? 0),
        0,
      ),
      inputTokens,
      outputTokens,
      retrievalAttempts: results.filter((result) => result.retrieval?.manifest?.startedAt).length,
      retrievalSucceeded: results.filter((result) => result.retrieval?.status === 'retrieved')
        .length,
      retrievalSelected: results.filter((result) => result.selectedPass === 'retrieval').length,
      retrievalRequests: results.reduce(
        (total, result) => total + Number(result.retrieval?.manifest?.requests?.used ?? 0),
        0,
      ),
      retrievalEncodedBytes: results.reduce(
        (total, result) => total + Number(result.retrieval?.manifest?.response?.encodedBytes ?? 0),
        0,
      ),
      secondModelCalls: results.filter(
        (result) =>
          result.retrievalInterpretation?.output && !result.retrievalInterpretation.cached,
      ).length,
      secondCached: results.filter((result) => result.retrievalInterpretation?.cached).length,
      secondInputTokens: results.reduce(
        (total, result) => total + Number(result.retrievalInterpretation?.usage?.input_tokens ?? 0),
        0,
      ),
      secondOutputTokens: results.reduce(
        (total, result) =>
          total + Number(result.retrievalInterpretation?.usage?.output_tokens ?? 0),
        0,
      ),
    },
    candidateQueue: {
      seriesProposals: candidates.filter(
        ({ result }) => candidateClassification(result) === 'series',
      ).length,
      standaloneProposals: candidates.filter(
        ({ result }) => candidateClassification(result) === 'standalone',
      ).length,
      unresolved: candidates.filter(
        ({ result }) => candidateClassification(result) === 'unresolved',
      ).length,
      quarantined: candidates.filter(
        ({ result }) => candidateClassification(result) === 'quarantined',
      ).length,
    },
    counts: {
      resolvedCases,
      correctResolvedCases,
      truePositiveClaims,
      falsePositiveClaims,
      recoveredPositiveCases,
      falseStandaloneCases,
      falseSeriesCases,
    },
    details,
  }
}

export const authorityAcquisitionCacheMaterial = (target) => ({
  schemaVersion: target.schemaVersion,
  caseId: target.caseId,
  target: {
    title: normalize(target.target?.title),
    authors: asArray(target.target?.authors).map(normalize).sort(),
    publicationYear: target.target?.publicationYear ?? null,
  },
})
