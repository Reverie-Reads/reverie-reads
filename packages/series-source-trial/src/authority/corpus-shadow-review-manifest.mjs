import { createHash } from 'node:crypto'

import { CORPUS_SHADOW_COMPARISON_PURPOSE } from './corpus-shadow-history.mjs'
import { CORPUS_SHADOW_RECONCILIATION_PURPOSE } from './corpus-shadow-reconcile.mjs'

export const CORPUS_SHADOW_REVIEW_MANIFEST_PURPOSE = 'corpus-series-shadow-review-manifest'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_RE = /^[a-f0-9]{64}$/
const MD5_RE = /^[a-f0-9]{32}$/
const STAGE_ACTIONS = new Set(['add_series', 'replace_series', 'update_position'])
const REVIEW_ACTIONS = new Set(['review_position', 'review_standalone_conflict'])
const HISTORICAL_FORBIDDEN_KEYS = new Set([
  'action',
  'candidateSeries',
  'currentMemberships',
  'currentSeries',
  'desiredMemberships',
  'evidence',
  'historicalIssues',
  'memberships',
  'position',
  'proposedSeries',
  'reason',
  'series',
  'sourceUrl',
  'truth',
])

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const sha256Json = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const asArray = (value) => (Array.isArray(value) ? value : [])
const fail = (message) => {
  throw new Error(`Invalid corpus shadow review manifest: ${message}`)
}

const identity = (work) => ({
  id: work.workId,
  title: work.title,
  authors: [...work.authors],
  publicationYear: work.publicationYear,
  identityFingerprint: work.identityFingerprint,
})

const baseline = (work) => ({
  currentOrigin: work.currentOrigin,
  currentMemberships: work.currentMemberships,
  pendingSuggestionCount: work.pendingSuggestionCount,
})

const decision = (work) => ({
  status: work.status,
  classification: work.classification ?? null,
  memberships: asArray(work.memberships),
  provenance: asArray(work.provenance),
})

const countsFor = (lanes) => ({
  works:
    lanes.pendingSuggestions.length +
    lanes.manualReview.length +
    lanes.historicalVerification.length +
    lanes.noAction.length,
  pendingSuggestions: lanes.pendingSuggestions.length,
  positionReview: lanes.manualReview.filter(({ action }) => action === 'review_position').length,
  standaloneConflict: lanes.manualReview.filter(
    ({ action }) => action === 'review_standalone_conflict',
  ).length,
  historicalVerification: lanes.historicalVerification.length,
  exactMatches: lanes.noAction.filter(({ action }) => action === 'match').length,
  unresolvedWithoutHistory: lanes.noAction.filter(({ action }) => action === 'no_action_unresolved')
    .length,
})

function validateIdentity(item, label) {
  if (!isObject(item) || !UUID_RE.test(item.id ?? '')) fail(`${label} has an invalid work ID`)
  if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500) {
    fail(`${label} has an invalid title`)
  }
  if (
    !Array.isArray(item.authors) ||
    !item.authors.length ||
    item.authors.length > 20 ||
    item.authors.some(
      (author) => typeof author !== 'string' || !author.trim() || author.length > 300,
    )
  ) {
    fail(`${label} has invalid full authors`)
  }
  if (
    item.publicationYear !== null &&
    (!Number.isInteger(item.publicationYear) ||
      item.publicationYear < 1 ||
      item.publicationYear > 2100)
  ) {
    fail(`${label} has an invalid publication year`)
  }
  if (!MD5_RE.test(item.identityFingerprint ?? '')) fail(`${label} has an invalid identity hash`)
}

export function buildCorpusShadowReviewManifest({
  comparison,
  comparisonSha256,
  reconciliation,
  reconciliationSha256,
  createdAt = new Date().toISOString(),
}) {
  if (
    comparison?.schemaVersion !== 1 ||
    comparison?.purpose !== CORPUS_SHADOW_COMPARISON_PURPOSE ||
    reconciliation?.schemaVersion !== 1 ||
    reconciliation?.purpose !== CORPUS_SHADOW_RECONCILIATION_PURPOSE
  ) {
    fail('inputs are not the completed comparison and reconciliation')
  }
  if (!HASH_RE.test(comparisonSha256 ?? '') || !HASH_RE.test(reconciliationSha256 ?? '')) {
    fail('input hashes are invalid')
  }
  if (
    comparison.inputs?.reconciliationSha256 !== reconciliationSha256 ||
    comparison.sourceFrame?.sha256 !== reconciliation.sourceFrame?.sha256 ||
    comparison.sourceFrame?.project !== reconciliation.sourceFrame?.project ||
    comparison.sourceFrame?.totalWorks !== reconciliation.sourceFrame?.totalWorks ||
    comparison.counts?.works !== comparison.works?.length ||
    reconciliation.counts?.works !== reconciliation.works?.length ||
    comparison.works.length !== reconciliation.works.length
  ) {
    fail('inputs do not share one complete frozen corpus')
  }

  const shadowById = new Map(reconciliation.works.map((work) => [work.workId, work]))
  if (shadowById.size !== reconciliation.works.length) fail('reconciliation has duplicate works')

  const lanes = {
    pendingSuggestions: [],
    manualReview: [],
    historicalVerification: [],
    noAction: [],
  }
  const seen = new Set()
  for (const compared of comparison.works) {
    if (seen.has(compared.workId)) fail(`comparison duplicates ${compared.workId}`)
    seen.add(compared.workId)
    const shadow = shadowById.get(compared.workId)
    if (
      !shadow ||
      shadow.title !== compared.title ||
      !MD5_RE.test(shadow.identityFingerprint ?? '')
    ) {
      fail(`comparison identity drifted for ${compared.workId}`)
    }
    const workIdentity = identity(shadow)
    const expectedBaseline = baseline(compared)

    if (STAGE_ACTIONS.has(compared.action)) {
      if (
        shadow.status !== 'resolved_series' ||
        !shadow.memberships?.length ||
        !compared.desiredMemberships?.length ||
        JSON.stringify(shadow.memberships) !== JSON.stringify(compared.desiredMemberships)
      ) {
        fail(`staging candidate is not a resolved series for ${compared.workId}`)
      }
      const result = decision(shadow)
      lanes.pendingSuggestions.push({
        ...workIdentity,
        action: compared.action,
        reason: compared.reason,
        expectedBaseline,
        expectedBaselineSha256: sha256Json(expectedBaseline),
        proposal: {
          memberships: compared.desiredMemberships,
          decision: result,
          decisionSha256: sha256Json(result),
        },
      })
    } else if (REVIEW_ACTIONS.has(compared.action)) {
      const result = decision(shadow)
      lanes.manualReview.push({
        ...workIdentity,
        action: compared.action,
        reason: compared.reason,
        expectedBaseline,
        expectedBaselineSha256: sha256Json(expectedBaseline),
        proposal: {
          memberships: compared.desiredMemberships,
          decision: result,
          decisionSha256: sha256Json(result),
        },
      })
    } else if (compared.action === 'review_unverified_historical') {
      // This is the only payload the truth-blind follow-up runner may consume. Historical labels,
      // positions, comparison reasons, and evidence deliberately stay outside this lane.
      lanes.historicalVerification.push(workIdentity)
    } else if (['match', 'no_action_unresolved'].includes(compared.action)) {
      lanes.noAction.push({ id: compared.workId, action: compared.action })
    } else {
      fail(`comparison has an unsupported action for ${compared.workId}`)
    }
  }
  if (seen.size !== shadowById.size) fail('comparison omits reconciled works')

  const manifestCore = {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_REVIEW_MANIFEST_PURPOSE,
    createdAt,
    sourceFrame: comparison.sourceFrame,
    inputs: {
      comparisonSha256,
      reconciliationSha256,
      historicalSha256: comparison.inputs.historicalSha256,
      graphSha256: reconciliation.inputs.graphSha256,
      reviewSha256: reconciliation.inputs.reviewSha256,
      exaSha256: reconciliation.inputs.exaSha256,
    },
    counts: countsFor(lanes),
    lanes,
    mutationBoundary: 'private_review_manifest_no_supabase_or_corpus_writer',
  }
  return { ...manifestCore, manifestSha256: sha256Json(manifestCore) }
}

export function validateCorpusShadowReviewManifest(manifest) {
  if (
    !isObject(manifest) ||
    manifest.schemaVersion !== 1 ||
    manifest.purpose !== CORPUS_SHADOW_REVIEW_MANIFEST_PURPOSE ||
    !Number.isFinite(Date.parse(manifest.createdAt ?? '')) ||
    !HASH_RE.test(manifest.manifestSha256 ?? '') ||
    manifest.mutationBoundary !== 'private_review_manifest_no_supabase_or_corpus_writer'
  ) {
    fail('header is invalid')
  }
  const { manifestSha256, ...core } = manifest
  if (sha256Json(core) !== manifestSha256) fail('manifest hash does not match its content')
  if (
    typeof manifest.sourceFrame?.project !== 'string' ||
    !HASH_RE.test(manifest.sourceFrame?.sha256 ?? '') ||
    !Number.isInteger(manifest.sourceFrame?.totalWorks) ||
    !Object.values(manifest.inputs ?? {}).every((value) => HASH_RE.test(value ?? ''))
  ) {
    fail('source bindings are invalid')
  }
  if (
    !isObject(manifest.lanes) ||
    !['pendingSuggestions', 'manualReview', 'historicalVerification', 'noAction'].every((lane) =>
      Array.isArray(manifest.lanes[lane]),
    )
  ) {
    fail('lanes are invalid')
  }

  const allIds = []
  for (const lane of ['pendingSuggestions', 'manualReview', 'historicalVerification']) {
    for (const item of manifest.lanes[lane]) {
      validateIdentity(item, `${lane} item`)
      allIds.push(item.id)
    }
  }
  for (const item of manifest.lanes.noAction) {
    if (!isObject(item) || !UUID_RE.test(item.id ?? '')) fail('noAction has an invalid work ID')
    if (!['match', 'no_action_unresolved'].includes(item.action)) {
      fail('noAction has an invalid action')
    }
    allIds.push(item.id)
  }
  if (new Set(allIds).size !== allIds.length) fail('work IDs are duplicated across lanes')
  if (allIds.length !== manifest.sourceFrame.totalWorks) fail('manifest omits frozen works')

  for (const item of manifest.lanes.pendingSuggestions) {
    if (!STAGE_ACTIONS.has(item.action)) fail('pendingSuggestions has an invalid action')
    if (
      !HASH_RE.test(item.expectedBaselineSha256 ?? '') ||
      !HASH_RE.test(item.proposal?.decisionSha256 ?? '')
    ) {
      fail(`pending suggestion ${item.id} has invalid decision bindings`)
    }
    if (sha256Json(item.expectedBaseline) !== item.expectedBaselineSha256) {
      fail(`pending suggestion ${item.id} baseline hash drifted`)
    }
    if (sha256Json(item.proposal?.decision) !== item.proposal.decisionSha256) {
      fail(`pending suggestion ${item.id} decision hash drifted`)
    }
    if (!asArray(item.proposal?.memberships).length) {
      fail(`pending suggestion ${item.id} has no proposed membership`)
    }
  }
  for (const item of manifest.lanes.manualReview) {
    if (!REVIEW_ACTIONS.has(item.action)) fail('manualReview has an invalid action')
  }
  for (const item of manifest.lanes.historicalVerification) {
    const leaked = Object.keys(item).find((key) => HISTORICAL_FORBIDDEN_KEYS.has(key))
    if (leaked) fail(`historical verification ${item.id} exposes ${leaked}`)
    if (
      Object.keys(item).sort().join(',') !== 'authors,id,identityFingerprint,publicationYear,title'
    ) {
      fail(`historical verification ${item.id} is not identity-only`)
    }
  }

  const counts = countsFor(manifest.lanes)
  if (JSON.stringify(counts) !== JSON.stringify(manifest.counts))
    fail('lane counts do not reconcile')
  if (counts.works !== manifest.sourceFrame.totalWorks)
    fail('work count does not match source frame')
  return manifest
}

export const corpusShadowReviewManifestHash = sha256Json
