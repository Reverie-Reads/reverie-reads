import { normalize } from './normalize.mjs'

const publicationPaths = new Set(['independent', 'kindle_first', 'traditional'])
const riskFeatures = new Set(['multi_series', 'connected_universe'])
const evaluationPartitions = new Set(['development', 'qualification'])

const asArray = (value) => (Array.isArray(value) ? value : [])
const difference = (minimum, actual) => Math.max(0, minimum - actual)
const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0)
const evaluationPartition = (testCase) => testCase?.evaluationPartition ?? 'development'

export function zeroEventMinimum(maximumRate, confidenceLevel) {
  if (!Number.isFinite(maximumRate) || maximumRate <= 0 || maximumRate >= 1) {
    throw new RangeError('maximumRate must be greater than 0 and less than 1')
  }
  if (!Number.isFinite(confidenceLevel) || confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new RangeError('confidenceLevel must be greater than 0 and less than 1')
  }

  return Math.ceil(Math.log(1 - confidenceLevel) / Math.log(1 - maximumRate))
}

const usableAuthoritySources = (sources, plan) => {
  const authorityKinds = new Set(asArray(plan?.authoritySourceKinds))
  return asArray(sources).filter(
    (source) =>
      authorityKinds.has(source?.kind) &&
      typeof source?.url === 'string' &&
      /^https:\/\//.test(source.url),
  )
}

const usableSamplingSources = (sources, plan) => {
  const samplingKinds = new Set(
    asArray(plan?.samplingSourceKinds).length
      ? asArray(plan.samplingSourceKinds)
      : asArray(plan?.authoritySourceKinds),
  )
  return asArray(sources).filter(
    (source) =>
      samplingKinds.has(source?.kind) &&
      typeof source?.url === 'string' &&
      /^https:\/\//.test(source.url),
  )
}

export const authorityWorkKey = (testCase) =>
  [
    normalize(testCase?.title ?? ''),
    asArray(testCase?.authors)
      .map((author) => normalize(author))
      .sort()
      .join('&'),
  ].join('|')

export const authorityCaseSelectionFrames = (testCase) => {
  const legacy =
    typeof testCase?.selectionFrame === 'string' && testCase.selectionFrame
      ? [testCase.selectionFrame]
      : []
  return [...new Set([...legacy, ...asArray(testCase?.selectionFrames)])]
}

export function authorityCaseStrata(testCase, plan) {
  const known = new Set(asArray(plan?.strata).map((stratum) => stratum.id))
  const strata = new Set(asArray(testCase?.strata))

  if (testCase?.sampleOrigin === 'reverie') strata.add('reverie_series')
  if (testCase?.truth?.status === 'reviewed' && testCase.truth.standalone === true) {
    strata.add('standalone_control')
  }
  if (known.has(testCase?.stratum)) strata.add(testCase.stratum)

  return [...strata]
}

const sharedSourceGroups = (testCase, sharedSources) => {
  const explicit = asArray(testCase?.truth?.sourceGroups)
  const legacy = sharedSources?.[testCase?.stratum] ? [testCase.stratum] : []
  return [...new Set([...explicit, ...legacy])]
}

const resolveAuthoritySources = (testCase, sharedSources) => [
  ...asArray(testCase?.truth?.sources),
  ...sharedSourceGroups(testCase, sharedSources).flatMap((group) =>
    asArray(sharedSources?.[group]),
  ),
]

const validateRecentStratum = (testCase, stratum, plan, errors) => {
  const year = testCase.publicationYear
  if (!Number.isInteger(year) || year < plan.recentPublicationYearFloor) {
    errors.push(
      `${testCase.id}: ${stratum} requires publicationYear >= ${plan.recentPublicationYearFloor}`,
    )
  }

  if (!publicationPaths.has(testCase.publicationPath)) {
    errors.push(`${testCase.id}: ${stratum} requires a recognized publicationPath`)
    return
  }

  if (
    stratum === 'recent_independent_or_kindle_first' &&
    !['independent', 'kindle_first'].includes(testCase.publicationPath)
  ) {
    errors.push(`${testCase.id}: ${stratum} requires independent or kindle_first`)
  }
  if (stratum === 'recent_traditional' && testCase.publicationPath !== 'traditional') {
    errors.push(`${testCase.id}: ${stratum} requires traditional`)
  }

  if (!usableSamplingSources(testCase.sampleSources, plan).length) {
    errors.push(`${testCase.id}: ${stratum} requires a recognized sampling-provenance source`)
  }
}

const validateSelectionFrame = (testCase, plan, errors) => {
  for (const frameId of authorityCaseSelectionFrames(testCase)) {
    const frame = asArray(plan?.selectionFrames).find(({ id }) => id === frameId)
    if (!frame) {
      errors.push(`${testCase.id}: unknown selectionFrame ${frameId}`)
      continue
    }

    const sourceMatches = usableSamplingSources(testCase.sampleSources, plan).some(
      (source) => source.kind === frame.source?.kind && source.url === frame.source?.url,
    )
    if (!sourceMatches) {
      errors.push(`${testCase.id}: selectionFrame ${frame.id} requires its declared source`)
    }
    if (frame.publicationYear !== undefined && testCase.publicationYear !== frame.publicationYear) {
      errors.push(`${testCase.id}: selectionFrame ${frame.id} publicationYear does not match`)
    }
    if (frame.publicationPath !== undefined && testCase.publicationPath !== frame.publicationPath) {
      errors.push(`${testCase.id}: selectionFrame ${frame.id} publicationPath does not match`)
    }

    const caseStrata = new Set(authorityCaseStrata(testCase, plan))
    for (const stratum of asArray(frame.strata)) {
      if (!caseStrata.has(stratum)) {
        errors.push(`${testCase.id}: selectionFrame ${frame.id} requires stratum ${stratum}`)
      }
    }
  }
}

const validateReviewedTruth = (testCase, sharedSources, plan, errors) => {
  const truth = testCase.truth
  if (typeof truth.standalone !== 'boolean') {
    errors.push(`${testCase.id}: reviewed truth requires a boolean standalone value`)
    return
  }

  if (truth.standalone && truth.memberships.length) {
    errors.push(`${testCase.id}: a reviewed standalone cannot have series memberships`)
  }
  if (!truth.standalone && !truth.memberships.length) {
    errors.push(`${testCase.id}: a reviewed series work requires at least one membership`)
  }

  const sources = resolveAuthoritySources(testCase, sharedSources)
  const usableSources = usableAuthoritySources(sources, plan)
  if (!usableSources.length) {
    errors.push(`${testCase.id}: reviewed truth requires an author or publisher authority source`)
  }

  for (const [index, membership] of truth.memberships.entries()) {
    if (typeof membership?.series !== 'string' || !membership.series.trim()) {
      errors.push(`${testCase.id}: membership ${index} requires a series name`)
    }
    if (!Array.isArray(membership?.aliases) || !Array.isArray(membership?.positions)) {
      errors.push(`${testCase.id}: membership ${index} requires aliases and positions arrays`)
    }
  }
}

export function auditAuthoritySample(caseSet, plan, policy) {
  const errors = []
  const cases = asArray(caseSet?.cases)
  const knownStrata = new Set(asArray(plan?.strata).map((stratum) => stratum.id))
  const seenIds = new Map()
  const seenWorks = new Map()

  for (const testCase of cases) {
    if (!testCase?.id || !testCase?.title || !asArray(testCase?.authors).length) {
      errors.push(
        `${testCase?.id ?? '<missing id>'}: id, title, and at least one author are required`,
      )
      continue
    }
    if (!['reviewed', 'candidate'].includes(testCase?.truth?.status)) {
      errors.push(`${testCase.id}: truth status must be reviewed or candidate`)
      continue
    }
    if (!evaluationPartitions.has(evaluationPartition(testCase))) {
      errors.push(`${testCase.id}: evaluationPartition must be development or qualification`)
    }
    if (!Array.isArray(testCase.truth.memberships) || !Array.isArray(testCase.truth.sources)) {
      errors.push(`${testCase.id}: truth requires memberships and sources arrays`)
      continue
    }

    const priorId = seenIds.get(testCase.id)
    if (priorId) errors.push(`${testCase.id}: duplicate case id`)
    else seenIds.set(testCase.id, testCase)

    const workKey = authorityWorkKey(testCase)
    const priorWork = seenWorks.get(workKey)
    if (priorWork) errors.push(`${testCase.id}: duplicates work ${priorWork.id}`)
    else seenWorks.set(workKey, testCase)

    const strata = authorityCaseStrata(testCase, plan)
    for (const stratum of asArray(testCase.strata)) {
      if (!knownStrata.has(stratum)) errors.push(`${testCase.id}: unknown stratum ${stratum}`)
    }
    if (strata.includes('recent_independent_or_kindle_first')) {
      validateRecentStratum(testCase, 'recent_independent_or_kindle_first', plan, errors)
    }
    if (strata.includes('recent_traditional')) {
      validateRecentStratum(testCase, 'recent_traditional', plan, errors)
    }
    if (strata.includes('multi_series_or_connected_universe')) {
      if (!asArray(testCase.riskFeatures).some((feature) => riskFeatures.has(feature))) {
        errors.push(
          `${testCase.id}: multi-series stratum requires multi_series or connected_universe riskFeatures`,
        )
      }
      if (testCase.truth.status === 'reviewed' && testCase.truth.membershipsComplete !== true) {
        errors.push(`${testCase.id}: multi-series reviewed truth must declare membershipsComplete`)
      }
    }

    validateSelectionFrame(testCase, plan, errors)

    if (testCase.truth.status === 'reviewed') {
      validateReviewedTruth(testCase, caseSet.sharedSources, plan, errors)
    }
  }

  for (const frame of asArray(plan?.selectionFrames)) {
    const selected = cases.filter((testCase) =>
      authorityCaseSelectionFrames(testCase).includes(frame.id),
    ).length
    if (!Number.isInteger(frame.expectedCases) || frame.expectedCases < 1) {
      errors.push(`${frame.id}: selection frame requires a positive expectedCases value`)
    } else if (selected !== frame.expectedCases) {
      errors.push(
        `${frame.id}: complete selection frame requires ${frame.expectedCases} cases; found ${selected}`,
      )
    }
  }

  const developmentCases = cases.filter(
    (testCase) => evaluationPartition(testCase) === 'development',
  )
  const qualificationCases = cases.filter(
    (testCase) => evaluationPartition(testCase) === 'qualification',
  )
  const reviewed = developmentCases.filter((testCase) => testCase?.truth?.status === 'reviewed')
  const candidates = developmentCases.filter((testCase) => testCase?.truth?.status === 'candidate')
  const positives = reviewed.filter((testCase) => testCase.truth.standalone === false)
  const standalones = reviewed.filter((testCase) => testCase.truth.standalone === true)
  const gates = policy?.hardGates ?? {}
  const targets = [
    {
      id: 'reviewed_cases',
      label: 'Authority-reviewed cases',
      minimum: gates.minimumReviewedCases,
      actual: reviewed.length,
    },
    {
      id: 'reviewed_positive_cases',
      label: 'Reviewed positive series cases',
      minimum: gates.minimumReviewedPositiveCases,
      actual: positives.length,
    },
    {
      id: 'reviewed_standalone_cases',
      label: 'Reviewed standalone controls',
      minimum: gates.minimumReviewedStandaloneCases,
      actual: standalones.length,
    },
  ].map((target) => ({
    ...target,
    gap: difference(target.minimum, target.actual),
    met: target.actual >= target.minimum,
  }))

  const strata = asArray(plan?.strata).map((stratum) => {
    const selected = developmentCases.filter((testCase) =>
      authorityCaseStrata(testCase, plan).includes(stratum.id),
    ).length
    const reviewedCount = reviewed.filter((testCase) =>
      authorityCaseStrata(testCase, plan).includes(stratum.id),
    ).length
    return {
      id: stratum.id,
      label: stratum.label,
      minimumReviewed: stratum.minimumReviewed,
      selected,
      reviewed: reviewedCount,
      candidate: selected - reviewedCount,
      gap: difference(stratum.minimumReviewed, reviewedCount),
      met: reviewedCount >= stratum.minimumReviewed,
    }
  })

  const qualificationReviewed = qualificationCases.filter(
    (testCase) => testCase?.truth?.status === 'reviewed',
  )
  const qualificationCandidates = qualificationCases.filter(
    (testCase) => testCase?.truth?.status === 'candidate',
  )
  const qualificationPositives = qualificationReviewed.filter(
    (testCase) => testCase.truth.standalone === false,
  )
  const qualificationStandalones = qualificationReviewed.filter(
    (testCase) => testCase.truth.standalone === true,
  )
  const qualificationGates = policy?.qualificationGates ?? {}
  const confidenceLevel = qualificationGates.confidenceLevel
  const falseStandaloneMinimum =
    Number.isFinite(confidenceLevel) &&
    Number.isFinite(qualificationGates.maximumFalseStandaloneRate)
      ? zeroEventMinimum(qualificationGates.maximumFalseStandaloneRate, confidenceLevel)
      : null
  const falsePositiveMembershipMinimum =
    Number.isFinite(confidenceLevel) &&
    Number.isFinite(qualificationGates.minimumMembershipPrecision)
      ? zeroEventMinimum(1 - qualificationGates.minimumMembershipPrecision, confidenceLevel)
      : null
  const qualificationTargets = [
    {
      id: 'qualification_reviewed_cases',
      label: 'Locked authority-reviewed cases',
      minimum: finiteOrZero(qualificationGates.minimumReviewedCases),
      actual: qualificationReviewed.length,
    },
    {
      id: 'qualification_reviewed_positive_cases',
      label: 'Locked positive series cases',
      minimum: finiteOrZero(qualificationGates.minimumReviewedPositiveCases),
      actual: qualificationPositives.length,
    },
    {
      id: 'qualification_reviewed_standalone_cases',
      label: 'Locked standalone controls',
      minimum: finiteOrZero(qualificationGates.minimumReviewedStandaloneCases),
      actual: qualificationStandalones.length,
    },
  ].map((target) => ({
    ...target,
    gap: difference(target.minimum, target.actual),
    met: target.actual >= target.minimum,
  }))

  if (
    falseStandaloneMinimum !== null &&
    finiteOrZero(qualificationGates.minimumReviewedStandaloneCases) < falseStandaloneMinimum
  ) {
    errors.push(
      `qualificationGates: minimumReviewedStandaloneCases must be at least ${falseStandaloneMinimum} for the configured zero-error confidence bound`,
    )
  }
  if (
    falsePositiveMembershipMinimum !== null &&
    finiteOrZero(qualificationGates.minimumEvaluatedMembershipClaims) <
      falsePositiveMembershipMinimum
  ) {
    errors.push(
      `qualificationGates: minimumEvaluatedMembershipClaims must be at least ${falsePositiveMembershipMinimum} for the configured zero-error confidence bound`,
    )
  }

  const selectionGap = difference(plan.selectionTarget, developmentCases.length)
  const developmentTarget = finiteOrZero(gates.minimumReviewedCases)
  const qualificationTarget = finiteOrZero(qualificationGates.minimumReviewedCases)
  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    ready:
      errors.length === 0 &&
      selectionGap === 0 &&
      targets.every((target) => target.met) &&
      strata.every((stratum) => stratum.met),
    counts: {
      selected: developmentCases.length,
      reviewed: reviewed.length,
      candidate: candidates.length,
      reviewedPositive: positives.length,
      reviewedStandalone: standalones.length,
      selectionTarget: plan.selectionTarget,
      selectionGap,
    },
    targets,
    strata,
    qualification: {
      sampleReady: errors.length === 0 && qualificationTargets.every((target) => target.met),
      confidenceLevel: Number.isFinite(confidenceLevel) ? confidenceLevel : null,
      counts: {
        selected: qualificationCases.length,
        reviewed: qualificationReviewed.length,
        candidate: qualificationCandidates.length,
        reviewedPositive: qualificationPositives.length,
        reviewedStandalone: qualificationStandalones.length,
      },
      targets: qualificationTargets,
      minimumEvaluatedMembershipClaims: finiteOrZero(
        qualificationGates.minimumEvaluatedMembershipClaims,
      ),
      zeroEventMinimums: {
        falseStandaloneCases: falseStandaloneMinimum,
        evaluatedMembershipClaims: falsePositiveMembershipMinimum,
      },
    },
    program: {
      reviewed: reviewed.length + qualificationReviewed.length,
      target: developmentTarget + qualificationTarget,
    },
    errors,
  }
}

export function renderAuthoritySampleMarkdown(audit) {
  const lines = [
    '# Reverie authority sample audit',
    '',
    `Status: ${audit.ready ? 'ready for gate evaluation' : audit.valid ? 'building' : 'invalid'}.`,
    `Selected: ${audit.counts.selected}/${audit.counts.selectionTarget}; reviewed: ${audit.counts.reviewed}; candidates awaiting authority review: ${audit.counts.candidate}.`,
    '',
    '## Accuracy-set gates',
    '',
    '| Gate | Reviewed | Minimum | Gap |',
    '| --- | ---: | ---: | ---: |',
    ...audit.targets.map(
      (target) => `| ${target.label} | ${target.actual} | ${target.minimum} | ${target.gap} |`,
    ),
    '',
    '## Sampling strata',
    '',
    '| Stratum | Selected | Reviewed | Candidates | Minimum reviewed | Gap |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...audit.strata.map(
      (stratum) =>
        `| ${stratum.label} | ${stratum.selected} | ${stratum.reviewed} | ${stratum.candidate} | ${stratum.minimumReviewed} | ${stratum.gap} |`,
    ),
    '',
    'Candidates never count toward an accuracy or review gate. Strata may overlap, so their counts do not sum to the sample total.',
    '',
    '## Locked production qualification set',
    '',
    `Status: ${audit.qualification.sampleReady ? 'sample ready for untouched qualification run' : 'not yet built'}.`,
    `Selected: ${audit.qualification.counts.selected}; reviewed: ${audit.qualification.counts.reviewed}; candidates: ${audit.qualification.counts.candidate}. Program progress: ${audit.program.reviewed}/${audit.program.target} reviewed cases.`,
    '',
    '| Gate | Reviewed | Minimum | Gap |',
    '| --- | ---: | ---: | ---: |',
    ...audit.qualification.targets.map(
      (target) => `| ${target.label} | ${target.actual} | ${target.minimum} | ${target.gap} |`,
    ),
    '',
    `With zero observed errors, the configured one-sided ${Math.round((audit.qualification.confidenceLevel ?? 0) * 100)}% bounds require at least ${audit.qualification.zeroEventMinimums.falseStandaloneCases ?? 'an unset number of'} true standalone controls and ${audit.qualification.zeroEventMinimums.evaluatedMembershipClaims ?? 'an unset number of'} emitted membership claims. The qualification run therefore must emit at least ${audit.qualification.minimumEvaluatedMembershipClaims} eligible membership claims; positive cases alone do not establish that denominator.`,
  ]

  if (audit.errors.length) {
    lines.push('', '## Validation errors', '', ...audit.errors.map((error) => `- ${error}`))
  }

  return `${lines.join('\n').trimEnd()}\n`
}
