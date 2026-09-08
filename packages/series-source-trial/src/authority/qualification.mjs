import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { authorityWorkKey } from '../authority-sample.mjs'
import { AUTHORITY_ACQUISITION_PROMPT_VERSION } from './schema.mjs'

const asArray = (value) => (Array.isArray(value) ? value : [])

const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)]),
    )
  }
  return value
}

export const stableJson = (value) => JSON.stringify(stableValue(value))
export const sha256Text = (value) => createHash('sha256').update(value).digest('hex')
export const sha256Json = (value) => sha256Text(stableJson(value))

const authorKey = (testCase) =>
  asArray(testCase?.authors)
    .map((author) => author.trim().toLocaleLowerCase('en-US'))
    .sort()
    .join('|')

const qualificationRank = (testCase, seed) => sha256Text(`${seed}\n${authorityWorkKey(testCase)}`)

const authoritySources = (testCase, sharedSources) => [
  ...asArray(testCase?.truth?.sources),
  ...asArray(testCase?.truth?.sourceGroups).flatMap((group) => asArray(sharedSources?.[group])),
]

const qualificationStrata = (testCase, sharedSources) => {
  const strata = new Set(asArray(testCase?.qualificationStrata))
  if (Number.isInteger(testCase?.publicationYear)) {
    strata.add(testCase.publicationYear >= 2021 ? 'recent_2021_plus' : 'backlist_pre_2021')
  }
  if (testCase?.publicationPath === 'traditional') strata.add('traditional')
  if (['independent', 'kindle_first'].includes(testCase?.publicationPath)) {
    strata.add('independent_or_kindle_first')
  }
  if (
    asArray(testCase?.riskFeatures).some((feature) =>
      ['multi_series', 'connected_universe'].includes(feature),
    )
  ) {
    strata.add('complex_relationship')
  }
  const sourceKinds = new Set(
    authoritySources(testCase, sharedSources).map((source) => source?.kind),
  )
  if (sourceKinds.has('author') || sourceKinds.has('author_post')) strata.add('author_truth')
  if (sourceKinds.has('publisher') || sourceKinds.has('publisher_catalog')) {
    strata.add('publisher_truth')
  }
  return [...strata]
}

export function auditQualificationCoverage(cases, plan, sharedSources = {}) {
  const known = new Set(asArray(plan?.selection?.coverageMinimums).map(({ id }) => id))
  const errors = []
  for (const testCase of asArray(cases)) {
    for (const stratum of asArray(testCase?.qualificationStrata)) {
      if (!known.has(stratum))
        errors.push(`${testCase.id}: unknown qualification stratum ${stratum}`)
    }
  }
  const strata = asArray(plan?.selection?.coverageMinimums).map((stratum) => {
    const selected = asArray(cases).filter((testCase) =>
      qualificationStrata(testCase, sharedSources).includes(stratum.id),
    ).length
    const minimum = Number(stratum.minimumSelected)
    if (!Number.isInteger(minimum) || minimum < 1) {
      errors.push(`${stratum.id}: minimumSelected must be a positive integer`)
    }
    return {
      id: stratum.id,
      label: stratum.label,
      selected,
      minimum,
      gap: Math.max(0, minimum - selected),
      met: Number.isInteger(minimum) && minimum > 0 && selected >= minimum,
    }
  })
  for (const stratum of strata) {
    if (!stratum.met) {
      errors.push(
        `${stratum.id}: requires ${stratum.minimum} selected cases; found ${stratum.selected}`,
      )
    }
  }
  return { valid: errors.length === 0, strata, errors }
}

const qualificationCounts = (cases) => ({
  cases: cases.length,
  series: cases.filter((testCase) => testCase.truth?.standalone === false).length,
  standalone: cases.filter((testCase) => testCase.truth?.standalone === true).length,
})

export function auditQualificationPool(
  pool,
  plan,
  { developmentCases = [], requirePoolMinimum = true } = {},
) {
  const errors = []
  const cases = asArray(pool?.cases)
  const selection = plan?.selection ?? {}
  const allowedSelectionKinds = new Set(asArray(selection.allowedSelectionSourceKinds))
  const prohibitedSelectionKinds = new Set(asArray(selection.prohibitedSelectionSourceKinds))
  const authorityKinds = new Set(asArray(plan?.truth?.authoritySourceKinds))
  const developmentWorkKeys = new Set(asArray(developmentCases).map(authorityWorkKey))
  const seenIds = new Set()
  const seenWorks = new Set()
  const selectionFrames = asArray(pool?.selectionFrames)
  const frameById = new Map()

  if (plan?.schemaVersion !== 1) errors.push('qualification plan schemaVersion must be 1')
  if (plan?.evaluationPartition !== 'qualification') {
    errors.push('qualification plan evaluationPartition must be qualification')
  }
  if (selection.algorithm !== 'sha256-ranked-greedy-coverage-v1') {
    errors.push('qualification selection algorithm is not supported')
  }
  if (typeof selection.seed !== 'string' || !selection.seed.trim()) {
    errors.push('qualification selection seed is required')
  }
  const coverageIds = asArray(selection.coverageMinimums).map((stratum) => stratum?.id)
  if (new Set(coverageIds).size !== coverageIds.length) {
    errors.push('qualification coverage minimum ids must be unique')
  }
  for (const kind of allowedSelectionKinds) {
    if (prohibitedSelectionKinds.has(kind)) {
      errors.push(`selection source kind cannot be both allowed and prohibited: ${kind}`)
    }
  }
  if (pool?.schemaVersion !== 1) errors.push('qualification pool schemaVersion must be 1')
  if (requirePoolMinimum && cases.length < Number(selection.candidatePoolMinimum ?? 0)) {
    errors.push(
      `qualification pool requires at least ${selection.candidatePoolMinimum} cases; found ${cases.length}`,
    )
  }

  if (!selectionFrames.length) errors.push('qualification pool requires selectionFrames')
  for (const frame of selectionFrames) {
    const label = frame?.id ?? '<missing frame id>'
    if (!frame?.id || frameById.has(frame.id)) {
      errors.push(`${label}: selection frame id must be present and unique`)
      continue
    }
    frameById.set(frame.id, frame)
    if (!allowedSelectionKinds.has(frame.kind)) {
      errors.push(`${label}: unknown selection frame kind ${frame.kind ?? '<missing>'}`)
    }
    if (typeof frame.url !== 'string' || !frame.url.startsWith('https://')) {
      errors.push(`${label}: selection frame requires an HTTPS URL`)
    }
    if (frame.complete !== true) errors.push(`${label}: selection frame must declare complete=true`)
    if (!Number.isFinite(Date.parse(frame.capturedAt))) {
      errors.push(`${label}: selection frame requires a capturedAt timestamp`)
    }
    if (!Number.isInteger(frame.populationCases) || frame.populationCases < 1) {
      errors.push(`${label}: selection frame requires a positive populationCases count`)
    }
    if (!Number.isInteger(frame.eligibleReviewedCases) || frame.eligibleReviewedCases < 1) {
      errors.push(`${label}: selection frame requires a positive eligibleReviewedCases count`)
    }
    if (
      Number.isInteger(frame.populationCases) &&
      Number.isInteger(frame.eligibleReviewedCases) &&
      frame.eligibleReviewedCases > frame.populationCases
    ) {
      errors.push(`${label}: eligibleReviewedCases cannot exceed populationCases`)
    }
    if (!Array.isArray(frame.exclusions)) {
      errors.push(`${label}: selection frame requires an exclusions array`)
    } else {
      for (const [index, exclusion] of frame.exclusions.entries()) {
        if (typeof exclusion?.reason !== 'string' || !exclusion.reason.trim()) {
          errors.push(`${label}: exclusion ${index} requires a reason`)
        }
        if (!Number.isInteger(exclusion?.count) || exclusion.count < 1) {
          errors.push(`${label}: exclusion ${index} requires a positive count`)
        }
      }
      if (
        Number.isInteger(frame.populationCases) &&
        Number.isInteger(frame.eligibleReviewedCases) &&
        frame.exclusions.reduce((total, exclusion) => total + Number(exclusion?.count ?? 0), 0) !==
          frame.populationCases - frame.eligibleReviewedCases
      ) {
        errors.push(`${label}: selection frame exclusion counts do not reconcile`)
      }
    }
  }

  for (const testCase of cases) {
    const label = testCase?.id ?? '<missing id>'
    if (
      typeof testCase?.id !== 'string' ||
      !testCase.id.trim() ||
      typeof testCase?.title !== 'string' ||
      !testCase.title.trim() ||
      !asArray(testCase?.authors).length ||
      !testCase.authors.every((author) => typeof author === 'string' && author.trim())
    ) {
      errors.push(`${label}: id, title, and at least one author are required`)
      continue
    }
    if (testCase.evaluationPartition !== 'qualification') {
      errors.push(`${label}: evaluationPartition must be qualification`)
    }
    if (
      selection.requirePublicationMetadata &&
      (!Number.isInteger(testCase.publicationYear) ||
        !['traditional', 'independent', 'kindle_first'].includes(testCase.publicationPath))
    ) {
      errors.push(`${label}: qualification cases require publicationYear and publicationPath`)
    }
    if (testCase.truth?.status !== 'reviewed') {
      errors.push(`${label}: qualification truth must be authority-reviewed before freezing`)
      continue
    }
    if (!Array.isArray(testCase.truth.memberships) || !Array.isArray(testCase.truth.sources)) {
      errors.push(`${label}: truth requires memberships and sources arrays`)
      continue
    }
    if (typeof testCase.truth.standalone !== 'boolean') {
      errors.push(`${label}: reviewed truth requires a boolean standalone value`)
    } else if (testCase.truth.standalone && testCase.truth.memberships.length) {
      errors.push(`${label}: a standalone case cannot have series memberships`)
    } else if (!testCase.truth.standalone && !testCase.truth.memberships.length) {
      errors.push(`${label}: a series case requires at least one membership`)
    }
    for (const [index, membership] of testCase.truth.memberships.entries()) {
      if (typeof membership?.series !== 'string' || !membership.series.trim()) {
        errors.push(`${label}: membership ${index} requires a series name`)
      }
      if (!Array.isArray(membership?.aliases) || !Array.isArray(membership?.positions)) {
        errors.push(`${label}: membership ${index} requires aliases and positions arrays`)
      }
    }
    if (
      asArray(testCase.riskFeatures).some((feature) =>
        ['multi_series', 'connected_universe'].includes(feature),
      ) &&
      testCase.truth.membershipsComplete !== true
    ) {
      errors.push(`${label}: complex qualification truth must declare membershipsComplete`)
    }

    const sources = authoritySources(testCase, pool?.sharedSources)
    if (
      !sources.some(
        (source) =>
          authorityKinds.has(source?.kind) &&
          typeof source?.url === 'string' &&
          source.url.startsWith('https://'),
      )
    ) {
      errors.push(`${label}: reviewed truth requires an author or publisher authority source`)
    }

    const frameIds = asArray(testCase.selectionFrameIds)
    if (!frameIds.length) {
      errors.push(`${label}: at least one selection frame id is required`)
    }
    if (!asArray(testCase.selectionSources).length) {
      errors.push(`${label}: at least one provider-independent selection source is required`)
    }
    for (const source of asArray(testCase.selectionSources)) {
      if (prohibitedSelectionKinds.has(source?.kind)) {
        errors.push(`${label}: selection provenance cannot use ${source.kind}`)
      } else if (!allowedSelectionKinds.has(source?.kind)) {
        errors.push(`${label}: unknown selection provenance kind ${source?.kind ?? '<missing>'}`)
      }
      if (typeof source?.url !== 'string' || !source.url.startsWith('https://')) {
        errors.push(`${label}: selection provenance requires an HTTPS URL`)
      }
      const frame = frameById.get(source?.frameId)
      if (!frameIds.includes(source?.frameId) || !frame) {
        errors.push(`${label}: selection source requires a declared frameId`)
      } else if (frame.kind !== source.kind || frame.url !== source.url) {
        errors.push(`${label}: selection source must match its declared frame`)
      }
    }
    for (const frameId of frameIds) {
      if (!frameById.has(frameId)) {
        errors.push(`${label}: unknown selection frame ${frameId}`)
      } else if (
        !asArray(testCase.selectionSources).some((source) => source?.frameId === frameId)
      ) {
        errors.push(`${label}: selection frame ${frameId} lacks a matching source`)
      }
    }

    if (seenIds.has(testCase.id)) errors.push(`${label}: duplicate case id`)
    seenIds.add(testCase.id)
    const workKey = authorityWorkKey(testCase)
    if (seenWorks.has(workKey)) errors.push(`${label}: duplicate work identity`)
    seenWorks.add(workKey)
    if (developmentWorkKeys.has(workKey)) {
      errors.push(`${label}: work already appears in the development partition`)
    }
  }

  if (requirePoolMinimum) {
    for (const frame of selectionFrames) {
      const observed = cases.filter((testCase) =>
        asArray(testCase.selectionFrameIds).includes(frame.id),
      ).length
      if (observed !== frame.eligibleReviewedCases) {
        errors.push(
          `${frame.id}: expected ${frame.eligibleReviewedCases} eligible reviewed cases; found ${observed}`,
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    counts: qualificationCounts(cases),
    errors,
  }
}

export function selectQualificationCases(pool, plan, options = {}) {
  const audit = auditQualificationPool(pool, plan, options)
  if (!audit.valid) throw new Error(`Invalid qualification pool: ${audit.errors.join('; ')}`)

  const selection = plan.selection
  const targets = {
    series: Number(selection.targetSeriesCases),
    standalone: Number(selection.targetStandaloneCases),
  }
  if (targets.series + targets.standalone !== Number(selection.targetCases)) {
    throw new Error('Qualification class targets must sum to targetCases')
  }
  const maximumPerAuthor = Number(selection.maximumSelectedWorksPerAuthor)
  if (!Number.isInteger(maximumPerAuthor) || maximumPerAuthor < 1) {
    throw new Error('maximumSelectedWorksPerAuthor must be a positive integer')
  }

  const selected = []
  const selectedIds = new Set()
  const counts = { series: 0, standalone: 0 }
  const selectedByAuthor = new Map()
  const ranked = [...pool.cases].sort((left, right) => {
    const rankComparison = qualificationRank(left, selection.seed).localeCompare(
      qualificationRank(right, selection.seed),
    )
    return rankComparison || left.id.localeCompare(right.id)
  })

  const minimumByStratum = new Map(
    asArray(selection.coverageMinimums).map((stratum) => [
      stratum.id,
      Number(stratum.minimumSelected),
    ]),
  )
  const selectedByStratum = new Map([...minimumByStratum.keys()].map((id) => [id, 0]))
  const caseStrata = new Map(
    ranked.map((testCase) => [
      testCase.id,
      qualificationStrata(testCase, pool.sharedSources).filter((id) => minimumByStratum.has(id)),
    ]),
  )

  const eligible = (testCase) => {
    if (selectedIds.has(testCase.id)) return false
    const classification = testCase.truth.standalone ? 'standalone' : 'series'
    if (counts[classification] >= targets[classification]) return false
    return (selectedByAuthor.get(authorKey(testCase)) ?? 0) < maximumPerAuthor
  }
  const add = (testCase) => {
    const classification = testCase.truth.standalone ? 'standalone' : 'series'
    selected.push(testCase)
    selectedIds.add(testCase.id)
    counts[classification] += 1
    const key = authorKey(testCase)
    selectedByAuthor.set(key, (selectedByAuthor.get(key) ?? 0) + 1)
    for (const stratum of caseStrata.get(testCase.id) ?? []) {
      selectedByStratum.set(stratum, (selectedByStratum.get(stratum) ?? 0) + 1)
    }
  }

  while (selected.length < selection.targetCases) {
    let best = null
    let bestGain = 0
    for (const testCase of ranked) {
      if (!eligible(testCase)) continue
      const gain = (caseStrata.get(testCase.id) ?? []).filter(
        (stratum) => (selectedByStratum.get(stratum) ?? 0) < (minimumByStratum.get(stratum) ?? 0),
      ).length
      if (gain > bestGain) {
        best = testCase
        bestGain = gain
      }
    }
    if (!best) break
    add(best)
  }

  for (const testCase of ranked) {
    if (!eligible(testCase)) continue
    add(testCase)
    if (selected.length === selection.targetCases) break
  }

  if (counts.series !== targets.series || counts.standalone !== targets.standalone) {
    throw new Error(
      `Qualification pool cannot satisfy the frozen class and author caps: selected ${counts.series} series and ${counts.standalone} standalone`,
    )
  }
  const coverage = auditQualificationCoverage(selected, plan, pool.sharedSources)
  if (!coverage.valid) {
    throw new Error(`Qualification selection misses coverage floors: ${coverage.errors.join('; ')}`)
  }
  return selected
}

export const qualificationDataset = (pool, plan, selectedCases) => ({
  schemaVersion: 1,
  id: plan.id,
  evaluationPartition: 'qualification',
  sharedSources: pool.sharedSources ?? {},
  selectionFrames: pool.selectionFrames,
  cases: selectedCases,
})

export function evaluateQualificationScore(score, policy) {
  const gates = policy?.qualificationGates ?? {}
  const evaluatedMembershipClaims =
    Number(score?.counts?.truePositiveClaims ?? 0) + Number(score?.counts?.falsePositiveClaims ?? 0)
  const checks = [
    {
      id: 'reviewed_cases',
      actual: Number(score?.scope?.reviewedCases ?? 0),
      comparator: 'minimum',
      threshold: Number(gates.minimumReviewedCases),
    },
    {
      id: 'series_positive_cases',
      actual: Number(score?.scope?.positiveCases ?? 0),
      comparator: 'minimum',
      threshold: Number(gates.minimumReviewedPositiveCases),
    },
    {
      id: 'standalone_cases',
      actual: Number(score?.scope?.standaloneCases ?? 0),
      comparator: 'minimum',
      threshold: Number(gates.minimumReviewedStandaloneCases),
    },
    {
      id: 'evaluated_membership_claims',
      actual: evaluatedMembershipClaims,
      comparator: 'minimum',
      threshold: Number(gates.minimumEvaluatedMembershipClaims),
    },
    {
      id: 'membership_precision',
      actual: score?.capability?.membershipPrecision,
      comparator: 'minimum',
      threshold: Number(gates.minimumMembershipPrecision),
    },
    {
      id: 'membership_recall',
      actual: score?.capability?.membershipRecall,
      comparator: 'minimum',
      threshold: Number(gates.minimumMembershipRecall),
    },
    {
      id: 'resolution_rate',
      actual: score?.capability?.resolutionRate,
      comparator: 'minimum',
      threshold: Number(gates.minimumResolutionRate),
    },
    {
      id: 'false_standalone_rate',
      actual: score?.capability?.falseStandaloneRate,
      comparator: 'maximum',
      threshold: Number(gates.maximumFalseStandaloneRate),
    },
    {
      id: 'false_standalone_cases',
      actual: Number(score?.counts?.falseStandaloneCases ?? 0),
      comparator: 'maximum',
      threshold: Number(gates.maximumFalseStandaloneCases),
    },
    {
      id: 'false_positive_membership_claims',
      actual: Number(score?.counts?.falsePositiveClaims ?? 0),
      comparator: 'maximum',
      threshold: Number(gates.maximumFalsePositiveMembershipClaims),
    },
    {
      id: 'operational_errors',
      actual: Number(score?.operations?.errors ?? 0),
      comparator: 'maximum',
      threshold: 0,
    },
  ].map((check) => ({
    ...check,
    passed:
      Number.isFinite(check.actual) &&
      Number.isFinite(check.threshold) &&
      (check.comparator === 'minimum'
        ? check.actual >= check.threshold
        : check.actual <= check.threshold),
  }))
  return {
    passed: checks.every((check) => check.passed),
    evaluatedMembershipClaims,
    checks,
  }
}

const systemFiles = [
  'src/acquire-authority.mjs',
  'src/authority/evidence.mjs',
  'src/authority/exa-fallback.mjs',
  'src/authority/exa-locator.mjs',
  'src/authority/focused-search.mjs',
  'src/authority/openai.mjs',
  'src/authority/qualification.mjs',
  'src/authority/schema.mjs',
  'src/normalize.mjs',
  'data/authority-sample-plan.json',
  'data/evaluation-policy.json',
]

export async function buildQualificationSystemManifest(packageRoot, runtime) {
  const files = {}
  for (const path of systemFiles) {
    files[path] = sha256Text(await readFile(resolve(packageRoot, path), 'utf8'))
  }
  const manifest = {
    schemaVersion: 1,
    promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
    runtime: { ...runtime, nodeVersion: process.version },
    files,
  }
  return { ...manifest, sha256: sha256Json(manifest) }
}

export function createQualificationLock({ plan, dataset, systemManifest, datasetFile }) {
  const counts = qualificationCounts(dataset.cases)
  const lock = {
    schemaVersion: 1,
    id: plan.id,
    status: 'sealed',
    evaluationPartition: 'qualification',
    plan: { id: plan.id, sha256: sha256Json(plan) },
    dataset: {
      file: datasetFile,
      sha256: sha256Json(dataset),
      ...counts,
    },
    system: systemManifest,
    runPolicy: plan.runPolicy,
  }
  return { ...lock, sha256: sha256Json(lock) }
}

export function auditQualificationLock({
  lock,
  dataset,
  plan,
  systemManifest,
  developmentCases = [],
}) {
  const errors = []
  const poolAudit = auditQualificationPool(dataset, plan, {
    developmentCases,
    requirePoolMinimum: false,
  })
  const coverage = auditQualificationCoverage(dataset?.cases, plan, dataset?.sharedSources)
  const counts = qualificationCounts(asArray(dataset?.cases))
  if (!poolAudit.valid) errors.push(...poolAudit.errors)
  if (!coverage.valid) errors.push(...coverage.errors)
  if (lock?.schemaVersion !== 1) errors.push('qualification lock schemaVersion must be 1')
  if (lock?.status !== 'sealed') errors.push('qualification lock status must be sealed')
  if (lock?.id !== plan?.id || dataset?.id !== plan?.id) {
    errors.push('qualification lock, dataset, and plan ids must match')
  }
  if (lock?.plan?.sha256 !== sha256Json(plan)) errors.push('qualification plan sha256 changed')
  if (sha256Json(lock?.runPolicy) !== sha256Json(plan?.runPolicy)) {
    errors.push('qualification run policy changed')
  }
  if (lock?.dataset?.sha256 !== sha256Json(dataset)) {
    errors.push('qualification dataset sha256 changed')
  }
  for (const key of ['cases', 'series', 'standalone']) {
    if (lock?.dataset?.[key] !== counts[key]) errors.push(`qualification ${key} count changed`)
  }
  if (lock?.system?.sha256 !== systemManifest?.sha256) {
    errors.push('qualification system manifest changed')
  }
  const { sha256: recordedLockSha, ...lockMaterial } = lock ?? {}
  if (recordedLockSha !== sha256Json(lockMaterial)) errors.push('qualification lock sha256 changed')
  if (counts.cases !== plan?.selection?.targetCases) {
    errors.push(`qualification dataset must contain ${plan?.selection?.targetCases} cases`)
  }
  if (counts.series !== plan?.selection?.targetSeriesCases) {
    errors.push(
      `qualification dataset must contain ${plan?.selection?.targetSeriesCases} series cases`,
    )
  }
  if (counts.standalone !== plan?.selection?.targetStandaloneCases) {
    errors.push(
      `qualification dataset must contain ${plan?.selection?.targetStandaloneCases} standalone cases`,
    )
  }

  return { valid: errors.length === 0, counts, coverage: coverage.strata, errors }
}
