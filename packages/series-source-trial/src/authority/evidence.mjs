import { normalize, seriesMatches } from '../normalize.mjs'

const classifications = new Set(['series', 'standalone', 'unresolved'])
const confidenceValues = new Set(['high', 'medium', 'low', 'none'])
const roles = new Set(['primary', 'secondary', 'unknown'])
const sourceKinds = new Set(['author', 'author_post', 'publisher', 'publisher_catalog'])
const supportsValues = new Set(['identity', 'series_membership', 'position', 'standalone'])
const relationshipKinds = new Set([
  'book_series',
  'publisher_collection',
  'imprint',
  'reading_list',
  'universe',
  'unknown',
])
// Preserve articles and named forms. This is not the more permissive gold-scoring matcher.
const relationshipKey = (value) => normalize(value).replace(/ (?:series|books)$/, '')
const discoveryOnlyHosts = new Set([
  'amazon.com',
  'barnesandnoble.com',
  'goodreads.com',
  'linktr.ee',
  'mybookcave.com',
  'target.com',
  'thecwa.co.uk',
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
  'fiction',
  'murder',
  'mystery',
  'novel',
  'novels',
  'romance',
  'saga',
  'series',
  'stories',
  'thriller',
  'thrillers',
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

export const authorityPolicyForCase = (testCase, samplePlan = null) => {
  const frameIds = new Set(
    [testCase?.selectionFrame, ...asArray(testCase?.selectionFrames)].filter(Boolean),
  )
  const framedSources = asArray(samplePlan?.selectionFrames)
    .filter((frame) => frameIds.has(frame?.id))
    .map((frame) => frame?.source?.url)
    .filter(Boolean)
  const directSelectionSources = asArray(testCase?.selectionSources)
    .map((source) => source?.url)
    .filter(Boolean)
  return {
    requireRelationshipClaims: true,
    classificationBlockedUrls: samplePlan
      ? [...new Set([...framedSources, ...directSelectionSources])]
      : asArray(testCase?.sampleSources)
          .map((source) => source?.url)
          .filter(Boolean),
  }
}

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
  if (
    rootHost === 'penguinrandomhouse.com' &&
    /^\/series\/(?:RH8\/random-house-100|TV1\/thousand-voices)$/i.test(url.pathname)
  ) {
    return 'known_publisher_collection_not_book_series'
  }
  if (
    rootHost === 'arielsullivan.com' &&
    url.pathname === '/books/conform' &&
    /\bthousand voices\b/i.test(
      [
        source?.evidenceSummary,
        ...asArray(source?.relationshipClaims).map((claim) => claim?.name),
      ].join(' '),
    )
  ) {
    return 'known_imprint_series_label_conflict'
  }
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
  if (
    rootHost === 'hachettebookgroup.com' &&
    /\bthe violet wars\b/i.test(source?.evidenceSummary ?? '')
  ) {
    // Hachette assigns both Ymir and Annex to this catalog series even though Rich Larson's
    // author-controlled biography explicitly calls the novels unrelated standalones.
    return 'known_catalog_relationship_conflict'
  }
  return null
}

const knownMembershipEvidenceRisk = (source) => {
  const summary = source?.evidenceSummary ?? ''
  if (
    /\b(?:attribut(?:ed|ion)|blurb|endorsement|praise|quot(?:e|ed|ation)|review|testimonial)\b/i.test(
      summary,
    )
  ) {
    return 'third_party_attribution'
  }
  if (/\b(?:trigger[- ]?warnings?|tropes?)\b/i.test(summary)) {
    return 'non_bibliographic_taxonomy'
  }
  if (
    /\b(?:translated|translation|localized|foreign-language)\b/i.test(summary) &&
    /\b(?:series|trilogy|duology|collection|saga|cycle)\b/i.test(summary)
  ) {
    return 'unmapped_localized_taxonomy'
  }
  if (/\bexact work as\b.{0,120}:\s*[^#]{1,100}#\d+\b/i.test(summary)) {
    // A storefront title shaped "Installment: Collection #1" can invert the target work and
    // relationship names. It is useful discovery evidence but needs exact-title review.
    return 'title_relationship_ambiguity'
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

const knownStandaloneEvidenceRisk = (source) => {
  const summary = source?.evidenceSummary ?? ''
  if (
    /\b(?:attribut(?:ed|ion)|blurb|endorsement|praise|quot(?:e|ed|ation)|review|testimonial)\b/i.test(
      summary,
    )
  ) {
    return 'third_party_attribution'
  }
  if (
    /\b(?:works?|functions?|reads?) as (?:an? )?stand-?alone\b/i.test(summary) ||
    /\b(?:can|could|may|might) be (?:read|enjoyed|understood) (?:as (?:an? )?stand-?alone|independently)\b/i.test(
      summary,
    ) ||
    /\bindependently readable\b/i.test(summary)
  ) {
    return 'reading_independence_not_classification'
  }
  return null
}

const sourceClassificationEligible = (source, blockedUrls, support) => {
  if (!source || !asArray(source.supports).includes(support)) return false
  const blocked = new Set(asArray(blockedUrls).map(comparableUrl).filter(Boolean))
  if (blocked.has(comparableUrl(source.url))) return false
  if (knownClassificationRisk(source)) return false
  if (support === 'series_membership' && knownMembershipEvidenceRisk(source)) return false
  if (support === 'standalone' && knownStandaloneEvidenceRisk(source)) return false
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

const genericOnlySeriesName = (value) => {
  const words = normalize(value)
    .split(' ')
    .filter((word) => word && !['a', 'an', 'the'].includes(word))
  const descriptiveWords = new Set(['seasonal', 'smalltown', 'small', 'town', 'witchy', 'romantic'])
  return (
    words.length > 0 &&
    words.every((word) => genericSeriesTail.has(word) || descriptiveWords.has(word))
  )
}

const authoritySeriesMatches = (membership, actualSeries) =>
  seriesMatches(membership, actualSeries) ||
  [membership.series, ...(membership.aliases ?? [])].some(
    (expectedSeries) =>
      genericSeriesKey(expectedSeries) === genericSeriesKey(actualSeries) ||
      selfTitleKey(expectedSeries) === selfTitleKey(actualSeries),
  )

// Search passes are observations, not replacement verdicts. Keep rejected grounded claims too:
// otherwise focused search -> Exa -> retrieval can make an earlier disagreement disappear.
export function reviewAuthorityPassTransition(firstPass, nextPass, policy = {}) {
  const snapshot = (pass) => ({
    output: pass.output,
    consultedUrls: asArray(pass.consultedUrls),
  })
  const unique = (passes) => [
    ...new Map(passes.map((pass) => [JSON.stringify(pass), pass])).values(),
  ]
  const previous = unique([
    ...asArray(firstPass?.authorityPassHistory),
    ...(isObject(firstPass?.output) ? [snapshot(firstPass)] : []),
  ])
  const history = unique([...previous, ...(isObject(nextPass?.output) ? [snapshot(nextPass)] : [])])
  const reasons = new Set()
  const next = nextPass?.output
  if (!next || next.classification === 'unresolved') return { history, reasons: [] }
  const blocked = new Set(asArray(policy.classificationBlockedUrls).map(comparableUrl))
  for (const pass of previous) {
    if (pass.output?.caseId && next.caseId && pass.output.caseId !== next.caseId) {
      reasons.add('prior_case_identity_mismatch')
      continue
    }
    const consulted = new Set(asArray(pass.consultedUrls).map(comparableUrl).filter(Boolean))
    for (const source of asArray(pass.output?.authoritySources)) {
      const url = comparableUrl(source?.url)
      if (!url || !consulted.has(url) || blocked.has(url)) continue
      const risk = knownClassificationRisk(source)
      if (
        [
          'known_publisher_collection_not_book_series',
          'known_imprint_series_label_conflict',
        ].includes(risk)
      ) {
        reasons.add('prior_profiled_relationship_conflict')
      }
      if (risk) continue
      for (const claim of asArray(source?.relationshipClaims)) {
        if (!isObject(claim) || !relationshipKey(claim.name)) {
          reasons.add('prior_relationship_claim_incomplete')
          continue
        }
        const selected = asArray(next.memberships).filter(
          (membership) => relationshipKey(membership?.series) === relationshipKey(claim.name),
        )
        if (claim.kind === 'unknown') reasons.add('prior_relationship_type_unresolved')
        if (claim.kind === 'book_series' && !selected.length)
          reasons.add('prior_series_claim_not_represented')
        if (claim.kind !== 'book_series' && selected.length)
          reasons.add('prior_non_book_relationship_selected')
        if (
          claim.kind === 'book_series' &&
          Number.isFinite(claim.position) &&
          selected.some(
            (membership) =>
              Number.isFinite(membership.position) && membership.position !== claim.position,
          )
        )
          reasons.add('prior_position_conflict')
      }
      if (
        next.classification === 'series' &&
        sourceClassificationEligible(source, [], 'standalone')
      ) {
        reasons.add('prior_affirmative_standalone_conflict')
      }
    }
  }
  return { history, reasons: [...reasons] }
}

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
        const standaloneRisk = knownStandaloneEvidenceRisk(normalizedSource)
        return {
          ...normalizedSource,
          supports: supports.filter(
            (support) =>
              !(relationshipRisk && ['series_membership', 'position'].includes(support)) &&
              !(standaloneRisk && support === 'standalone'),
          ),
        }
      }
      return {
        ...normalizedSource,
        supports: supports.filter((support) => support === 'identity'),
      }
    })
    .filter(
      (source) =>
        !isObject(source) ||
        source.supports.length ||
        (asArray(source.relationshipClaims).length &&
          !knownClassificationRisk(source) &&
          !classificationBlocked.has(comparableUrl(source.url))) ||
        [
          'known_publisher_collection_not_book_series',
          'known_imprint_series_label_conflict',
        ].includes(knownClassificationRisk(source)),
    )
  const filterFor = (urls, support) => [
    ...new Set(asArray(urls).filter((url) => citedSource(sources, url, support))),
  ]
  const identityUrls = filterFor(output.identity?.evidenceUrls, 'identity')
  const canonicalIdentityUrls =
    output.identity?.matched && !identityUrls.length
      ? sources
          .filter((source) => asArray(source.supports).includes('identity'))
          .map((source) => source.url)
      : identityUrls
  const hasAuthorityIdentity = canonicalIdentityUrls.length > 0
  return {
    ...output,
    authoritySources: sources,
    identity: isObject(output.identity)
      ? {
          ...output.identity,
          matched: Boolean(output.identity.matched && hasAuthorityIdentity),
          confidence:
            output.identity.matched && hasAuthorityIdentity ? output.identity.confidence : 'none',
          evidenceUrls: canonicalIdentityUrls,
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

export const shouldRepairAuthorityAcquisition = (validation) =>
  validation?.valid === false &&
  asArray(validation?.policyViolations).length === 0 &&
  asArray(validation?.errors).length > 0 &&
  asArray(validation.errors).every(
    (error) => error === 'series classification requires a membership',
  )

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
    // Old frozen proposals remain replayable without manufacturing new extracted facts. Current
    // acquisition policies require these fields; a present malformed field is never legacy data.
    if (policy.requireRelationshipClaims || source.relationshipClaims !== undefined) {
      if (!Array.isArray(source.relationshipClaims)) {
        errors.push(`authority source ${index} requires relationshipClaims`)
      }
      if (
        asArray(source.supports).includes('series_membership') &&
        !asArray(source.relationshipClaims).length
      ) {
        policyViolations.push(
          `authority source ${index} membership support lacks a relationship claim`,
        )
      }
      for (const claim of asArray(source.relationshipClaims)) {
        if (
          !isObject(claim) ||
          typeof claim.name !== 'string' ||
          !relationshipKey(claim.name) ||
          !relationshipKinds.has(claim.kind) ||
          (claim.position !== null && !Number.isFinite(claim.position))
        ) {
          errors.push(`authority source ${index} has an invalid relationship claim`)
          continue
        }
        if (
          output.classification === 'unresolved' ||
          knownClassificationRisk(source) ||
          asArray(policy.classificationBlockedUrls).map(comparableUrl).includes(comparable)
        )
          continue
        const selected = output.memberships.filter(
          (membership) => relationshipKey(membership?.series) === relationshipKey(claim.name),
        )
        if (
          claim.kind === 'book_series' &&
          !selected.length &&
          !(output.classification === 'series' && output.memberships.length === 0)
        ) {
          policyViolations.push(`authority source ${index} has an unrepresented series claim`)
        }
        if (claim.kind === 'unknown') {
          policyViolations.push(`authority source ${index} has an unresolved relationship type`)
        }
        if (claim.kind !== 'book_series' && selected.length) {
          policyViolations.push(`authority source ${index} has a non-bibliographic selected claim`)
        }
        if (
          claim.kind === 'book_series' &&
          claim.position !== null &&
          selected.some(
            (membership) => membership.position !== null && membership.position !== claim.position,
          )
        ) {
          policyViolations.push(`authority source ${index} has a conflicting position claim`)
        }
      }
    }
    const risk = knownClassificationRisk(source)
    if (risk && asArray(source.supports).some((support) => support !== 'identity')) {
      policyViolations.push(`authority source ${index} has ${risk}`)
    }
    if (
      output.classification !== 'unresolved' &&
      [
        'known_publisher_collection_not_book_series',
        'known_imprint_series_label_conflict',
      ].includes(risk)
    ) {
      // Keep these observed contradictions visible after canonicalization demotes supports.
      // A structural repair must not launder a rejected label back into a membership.
      policyViolations.push(`authority source ${index} has ${risk}`)
    }
    const membershipRisk = knownMembershipEvidenceRisk(source)
    if (membershipRisk && asArray(source.supports).includes('series_membership')) {
      policyViolations.push(`authority source ${index} has ${membershipRisk}`)
    }
    const standaloneRisk = knownStandaloneEvidenceRisk(source)
    if (
      output.classification === 'standalone' &&
      standaloneRisk &&
      asArray(source.supports).includes('standalone')
    ) {
      policyViolations.push(`authority source ${index} has ${standaloneRisk}`)
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

  if (output.classification === 'series' && output.memberships.length === 0) {
    const pendingClaims = sources
      .filter((source) =>
        sourceClassificationEligible(source, policy.classificationBlockedUrls, 'series_membership'),
      )
      .flatMap((source) => asArray(source.relationshipClaims))
      .filter((claim) => claim?.kind === 'book_series')
    const names = new Set(pendingClaims.map((claim) => relationshipKey(claim.name)))
    const positions = new Set(pendingClaims.map((claim) => claim.position).filter(Number.isFinite))
    if (names.size > 1 || positions.size > 1) {
      policyViolations.push('empty membership proposal has competing source claims')
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
    } else if (genericOnlySeriesName(membership.series)) {
      policyViolations.push(
        `membership ${index} uses a generic form instead of a named bibliographic series`,
      )
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
      const source = citedSource(sources, url, 'series_membership')
      if (source && (policy.requireRelationshipClaims || source.relationshipClaims !== undefined)) {
        const claims = asArray(source.relationshipClaims).filter(
          (claim) =>
            claim?.kind === 'book_series' &&
            relationshipKey(claim.name) === relationshipKey(membership.series),
        )
        if (!claims.length) {
          policyViolations.push(`membership ${index} lacks a matching source relationship claim`)
        }
        if (
          membership.position !== null &&
          asArray(source.supports).includes('position') &&
          !claims.some((claim) => claim.position === membership.position)
        ) {
          policyViolations.push(`membership ${index} position differs from its cited source claim`)
        }
      }
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
  const billed = completed.filter((result) => !result.cached)
  const inputTokens = billed.reduce(
    (total, result) =>
      total + Number(result.billing?.inputTokens ?? result.usage?.input_tokens ?? 0),
    0,
  )
  const outputTokens = billed.reduce(
    (total, result) =>
      total + Number(result.billing?.outputTokens ?? result.usage?.output_tokens ?? 0),
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
      modelCalls: results.reduce(
        (total, result) =>
          total +
          (result.status === 'completed' && !result.cached
            ? Number(result.billing?.modelCalls ?? result.modelCallCount ?? 1)
            : 0),
        0,
      ),
      repairCalls: results.filter(
        (result) => result.status === 'completed' && !result.cached && result.repair?.output,
      ).length,
      repairInputTokens: results.reduce(
        (total, result) =>
          total + (!result.cached ? Number(result.repair?.usage?.input_tokens ?? 0) : 0),
        0,
      ),
      repairOutputTokens: results.reduce(
        (total, result) =>
          total + (!result.cached ? Number(result.repair?.usage?.output_tokens ?? 0) : 0),
        0,
      ),
      webSearchCalls: results.reduce(
        (total, result) =>
          total + Number(result.billing?.webSearchCalls ?? result.webSearchCalls ?? 0),
        0,
      ),
      focusedSearchAttempts: results.filter(
        (result) => result.focusedSearch?.candidateDomains?.length,
      ).length,
      focusedSearchCalls: results.reduce(
        (total, result) => total + Number(result.focusedSearch?.billing?.modelCalls ?? 0),
        0,
      ),
      focusedSearchSelected: results.filter((result) => result.focusedSearch?.selected === true)
        .length,
      focusedSearchInputTokens: results.reduce(
        (total, result) => total + Number(result.focusedSearch?.billing?.inputTokens ?? 0),
        0,
      ),
      focusedSearchOutputTokens: results.reduce(
        (total, result) => total + Number(result.focusedSearch?.billing?.outputTokens ?? 0),
        0,
      ),
      exaFallbackAttempts: results.filter((result) => result.exaFallback?.locator).length,
      exaFallbackSearchesCompleted: results.reduce(
        (total, result) =>
          total + Number(result.exaFallback?.locator?.operations?.queriesCompleted ?? 0),
        0,
      ),
      exaFallbackRequests: results.reduce(
        (total, result) => total + Number(result.exaFallback?.locator?.operations?.requests ?? 0),
        0,
      ),
      exaFallbackUrlsInspected: results.reduce(
        (total, result) =>
          total + Number(result.exaFallback?.locator?.operations?.urlsInspected ?? 0),
        0,
      ),
      exaFallbackEstimatedCostUsd: Number(
        results
          .reduce(
            (total, result) =>
              total + Number(result.exaFallback?.locator?.operations?.estimatedCostUsd ?? 0),
            0,
          )
          .toFixed(6),
      ),
      exaFallbackModelCalls: results.reduce(
        (total, result) => total + Number(result.exaFallback?.search?.billing?.modelCalls ?? 0),
        0,
      ),
      exaFallbackSelected: results.filter((result) => result.exaFallback?.selected === true).length,
      exaFallbackInputTokens: results.reduce(
        (total, result) => total + Number(result.exaFallback?.search?.billing?.inputTokens ?? 0),
        0,
      ),
      exaFallbackOutputTokens: results.reduce(
        (total, result) => total + Number(result.exaFallback?.search?.billing?.outputTokens ?? 0),
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
