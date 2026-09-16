import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  buildCorpusShadowReviewManifest,
  corpusShadowHistoricalTrialCaseSet,
  validateCorpusShadowReviewManifest,
} from '../src/authority/corpus-shadow-review-manifest.mjs'
import { mergeCorpusShadowHistoricalReports } from '../src/authority/corpus-shadow-historical-merge.mjs'
import {
  buildCorpusShadowSuggestionPacket,
  validateCorpusShadowSuggestionPacket,
} from '../src/authority/corpus-shadow-suggestion-packet.mjs'
import { AUTHORITY_ACQUISITION_PROMPT_VERSION } from '../src/authority/schema.mjs'

const actions = [
  'add_series',
  'replace_series',
  'update_position',
  'review_position',
  'review_standalone_conflict',
  'review_unverified_historical',
  'match',
  'no_action_unresolved',
]
const works = actions.map((action, index) => {
  const digit = String(index + 1)
  return {
    workId: `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`,
    title: `Work ${index + 1}`,
    authors: ['Full Author'],
    publicationYear: 2020 + index,
    identityFingerprint: digit.repeat(32),
    status:
      action === 'review_standalone_conflict'
        ? 'resolved_standalone'
        : action === 'review_unverified_historical' || action === 'no_action_unresolved'
          ? 'unresolved'
          : 'resolved_series',
    classification: action === 'review_standalone_conflict' ? 'standalone' : 'series',
    memberships:
      action === 'review_standalone_conflict' ||
      action === 'review_unverified_historical' ||
      action === 'no_action_unresolved'
        ? []
        : [{ series: `Series ${index + 1}`, position: index + 1, role: 'primary' }],
    provenance: [{ stage: 'luna', outputSha256: 'f'.repeat(64) }],
  }
})
const sourceFrame = {
  project: 'abcdefghijklmnopqrst',
  sha256: 'a'.repeat(64),
  totalWorks: works.length,
  offset: 0,
  end: works.length,
}
const reconciliationSha256 = 'b'.repeat(64)
const comparison = {
  schemaVersion: 1,
  purpose: 'corpus-series-shadow-historical-comparison',
  sourceFrame,
  inputs: { reconciliationSha256, historicalSha256: 'c'.repeat(64) },
  counts: { works: works.length },
  works: works.map((work, index) => ({
    workId: work.workId,
    title: work.title,
    action: actions[index],
    reason: `reason_${index}`,
    currentOrigin: 'graph',
    currentMemberships:
      actions[index] === 'no_action_unresolved'
        ? []
        : [{ series: 'Old', position: 1, role: 'primary' }],
    desiredMemberships: work.memberships,
    historicalIssues: [],
    pendingSuggestionCount: 0,
  })),
}
const reconciliation = {
  schemaVersion: 1,
  purpose: 'corpus-series-shadow-authority-reconciliation',
  sourceFrame,
  inputs: {
    graphSha256: 'd'.repeat(64),
    reviewSha256: 'e'.repeat(64),
    exaSha256: 'f'.repeat(64),
  },
  counts: { works: works.length },
  works,
}

test('builds one hash-bound manifest with isolated staging, review, and identity-only lanes', () => {
  const manifest = buildCorpusShadowReviewManifest({
    comparison,
    comparisonSha256: '1'.repeat(64),
    reconciliation,
    reconciliationSha256,
    createdAt: '2026-09-16T12:00:00.000Z',
  })
  assert.equal(validateCorpusShadowReviewManifest(manifest), manifest)
  assert.deepEqual(manifest.counts, {
    works: 8,
    pendingSuggestions: 3,
    positionReview: 1,
    standaloneConflict: 1,
    historicalVerification: 1,
    exactMatches: 1,
    unresolvedWithoutHistory: 1,
  })
  assert.deepEqual(Object.keys(manifest.lanes.historicalVerification[0]).sort(), [
    'authors',
    'id',
    'identityFingerprint',
    'publicationYear',
    'title',
  ])
  const trial = corpusShadowHistoricalTrialCaseSet(manifest)
  assert.equal(trial.cases.length, 1)
  assert.deepEqual(trial.cases[0], {
    id: works[5].workId,
    title: works[5].title,
    authors: works[5].authors,
    publicationYear: works[5].publicationYear,
    evaluationPartition: 'corpus_shadow_historical_review',
    sampleOrigin: 'production_shared_catalog_historical_verification',
    stratum: 'historical_verification',
    identityFingerprint: works[5].identityFingerprint,
    truth: { status: 'candidate', standalone: null, memberships: [], sources: [] },
  })
})

test('rejects manifest drift, source drift, and historical-label leakage', () => {
  const manifest = buildCorpusShadowReviewManifest({
    comparison,
    comparisonSha256: '1'.repeat(64),
    reconciliation,
    reconciliationSha256,
    createdAt: '2026-09-16T12:00:00.000Z',
  })
  assert.throws(
    () =>
      validateCorpusShadowReviewManifest({
        ...manifest,
        counts: { ...manifest.counts, works: 9 },
      }),
    /manifest hash/,
  )
  assert.throws(
    () =>
      buildCorpusShadowReviewManifest({
        comparison,
        comparisonSha256: '1'.repeat(64),
        reconciliation,
        reconciliationSha256: '9'.repeat(64),
      }),
    /complete frozen corpus/,
  )
  const leaked = structuredClone(manifest)
  leaked.lanes.historicalVerification[0].series = 'Historical label'
  const core = { ...leaked }
  delete core.manifestSha256
  leaked.manifestSha256 = createHash('sha256').update(JSON.stringify(core)).digest('hex')
  assert.throws(() => validateCorpusShadowReviewManifest(leaked), /exposes series/)
})

test('builds a private staging packet and isolates relationships unsupported by the primary queue', () => {
  const secondaryComparison = structuredClone(comparison)
  const secondaryReconciliation = structuredClone(reconciliation)
  secondaryComparison.works[1].desiredMemberships[0].role = 'secondary'
  secondaryReconciliation.works[1].memberships[0].role = 'secondary'
  const manifest = buildCorpusShadowReviewManifest({
    comparison: secondaryComparison,
    comparisonSha256: '1'.repeat(64),
    reconciliation: secondaryReconciliation,
    reconciliationSha256,
    createdAt: '2026-09-16T12:00:00.000Z',
  })
  const historical = {
    schemaVersion: 1,
    purpose: 'corpus-series-shadow-historical-snapshot',
    sourceFrame,
    counts: { works: works.length },
    works: works.map((work) => ({
      workId: work.workId,
      identityFingerprint: work.identityFingerprint,
      pendingSuggestions: [],
    })),
  }
  const packet = buildCorpusShadowSuggestionPacket({
    manifest,
    historical,
    historicalSha256: manifest.inputs.historicalSha256,
    createdAt: '2026-09-16T13:00:00.000Z',
  })
  assert.equal(validateCorpusShadowSuggestionPacket(packet), packet)
  assert.deepEqual(packet.counts, {
    resolvedDecisions: 3,
    stageable: 2,
    manualReview: 1,
    batches: 1,
  })
  assert.equal(packet.manualReview[0].proposal.role, 'secondary')
  assert.equal(packet.manualReview[0].reason, 'primary_suggestion_schema_does_not_model_role')
  assert.equal(packet.mutationBoundary, 'private_staging_packet_no_supabase_or_corpus_writer')
})

test('merges only complete, contiguous, manifest-bound historical acquisition reports', () => {
  const manifest = buildCorpusShadowReviewManifest({
    comparison,
    comparisonSha256: '1'.repeat(64),
    reconciliation,
    reconciliationSha256,
    createdAt: '2026-09-16T12:00:00.000Z',
  })
  const item = manifest.lanes.historicalVerification[0]
  const output = {
    caseId: item.id,
    identity: {
      matched: true,
      confidence: 'high',
      evidenceUrls: ['https://publisher.example/work'],
    },
    classification: 'series',
    memberships: [
      {
        series: 'Verified Series',
        position: 2,
        role: 'primary',
        evidenceUrls: ['https://publisher.example/work'],
      },
    ],
    authoritySources: [],
    uncertainties: [],
    note: 'Verified.',
  }
  const report = {
    schemaVersion: 1,
    model: 'gpt-5.6-luna',
    experiment: { reasoningEffort: 'low', searchContextSize: 'medium', maxToolCalls: 3 },
    promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
    evaluationPartition: 'corpus_shadow_historical_review',
    exaFallbackEnabled: true,
    focusedSearchEnabled: false,
    retrievalEnabled: false,
    corpusShadowManifest: {
      sha256: manifest.manifestSha256,
      sourceFrame: manifest.sourceFrame,
      reviewRange: { offset: 0, end: 1, total: 1 },
    },
    targets: [
      {
        schemaVersion: 1,
        caseId: item.id,
        target: {
          title: item.title,
          authors: item.authors,
          publicationYear: item.publicationYear,
        },
      },
    ],
    results: [
      {
        caseId: item.id,
        status: 'completed',
        output,
        validation: { valid: true, policySafe: true },
        selectedPass: 'exa_fallback',
      },
    ],
    score: {
      operations: {
        modelCalls: 2,
        webSearchCalls: 4,
        inputTokens: 100,
        outputTokens: 20,
        errors: 0,
        exaFallbackAttempts: 1,
        exaFallbackRequests: 3,
        exaFallbackSelected: 1,
        exaFallbackEstimatedCostUsd: 0.021,
      },
    },
  }
  const merged = mergeCorpusShadowHistoricalReports({
    manifest,
    reports: [{ report, sha256: '9'.repeat(64) }],
  })
  assert.deepEqual(merged.counts, {
    works: 1,
    resolvedSeries: 1,
    resolvedStandalone: 0,
    manualReview: 0,
    unresolved: 0,
    exaSelected: 1,
  })
  assert.deepEqual(merged.works[0].memberships, [
    { series: 'Verified Series', position: 2, role: 'primary' },
  ])
  assert.equal(JSON.stringify(merged).includes('publisher.example'), false)

  const quarantined = structuredClone(report)
  quarantined.results[0].output.caseId = 'wrong-case'
  quarantined.results[0].validation = { valid: false, policySafe: false }
  const quarantinedMerge = mergeCorpusShadowHistoricalReports({
    manifest,
    reports: [{ report: quarantined, sha256: '6'.repeat(64) }],
  })
  assert.equal(quarantinedMerge.works[0].status, 'manual_review')
  assert.equal(quarantinedMerge.works[0].classification, 'unresolved')
  assert.deepEqual(quarantinedMerge.works[0].memberships, [])

  const failed = structuredClone(report)
  failed.results[0] = { caseId: item.id, status: 'error' }
  assert.throws(
    () =>
      mergeCorpusShadowHistoricalReports({
        manifest,
        reports: [{ report: failed, sha256: '9'.repeat(64) }],
      }),
    /must be retried/,
  )
})

test('historical merge keeps a completed prefix and resumes at the first trailing error', () => {
  const twoHistoricalComparison = structuredClone(comparison)
  const twoHistoricalReconciliation = structuredClone(reconciliation)
  twoHistoricalComparison.works[4].action = 'review_unverified_historical'
  twoHistoricalComparison.works[4].desiredMemberships = []
  twoHistoricalReconciliation.works[4].status = 'unresolved'
  twoHistoricalReconciliation.works[4].classification = 'unresolved'
  twoHistoricalReconciliation.works[4].memberships = []
  const manifest = buildCorpusShadowReviewManifest({
    comparison: twoHistoricalComparison,
    comparisonSha256: '1'.repeat(64),
    reconciliation: twoHistoricalReconciliation,
    reconciliationSha256,
    createdAt: '2026-09-16T12:00:00.000Z',
  })
  const lane = manifest.lanes.historicalVerification
  const completedResult = (item) => ({
    caseId: item.id,
    status: 'completed',
    output: {
      caseId: item.id,
      identity: { matched: true, title: item.title, authors: item.authors },
      classification: 'unresolved',
      memberships: [],
      authoritySources: [],
      uncertainties: ['No eligible authority claim.'],
      note: 'Unresolved.',
    },
    validation: { valid: true, policySafe: true },
  })
  const base = {
    schemaVersion: 1,
    model: 'gpt-5.6-luna',
    experiment: { reasoningEffort: 'low', searchContextSize: 'medium', maxToolCalls: 3 },
    promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
    evaluationPartition: 'corpus_shadow_historical_review',
    exaFallbackEnabled: true,
    focusedSearchEnabled: false,
    retrievalEnabled: false,
  }
  const first = {
    ...base,
    corpusShadowManifest: {
      sha256: manifest.manifestSha256,
      sourceFrame: manifest.sourceFrame,
      reviewRange: { offset: 0, end: 1, total: 1 },
    },
    targets: [
      {
        schemaVersion: 1,
        caseId: lane[0].id,
        target: {
          title: lane[0].title,
          authors: lane[0].authors,
          publicationYear: lane[0].publicationYear,
        },
      },
    ],
    results: [completedResult(lane[0])],
    score: { operations: { errors: 0 } },
  }
  first.corpusShadowManifest.reviewRange = { offset: 0, end: 2, total: 2 }
  first.targets.push({
    schemaVersion: 1,
    caseId: lane[1].id,
    target: {
      title: lane[1].title,
      authors: lane[1].authors,
      publicationYear: lane[1].publicationYear,
    },
  })
  first.results.push({ caseId: lane[1].id, status: 'error' })
  const second = {
    ...base,
    corpusShadowManifest: {
      sha256: manifest.manifestSha256,
      sourceFrame: manifest.sourceFrame,
      reviewRange: { offset: 1, end: 2, total: 2 },
    },
    targets: [first.targets[1]],
    results: [completedResult(lane[1])],
    score: { operations: { errors: 0 } },
  }
  const merged = mergeCorpusShadowHistoricalReports({
    manifest,
    reports: [
      { report: first, sha256: '8'.repeat(64) },
      { report: second, sha256: '7'.repeat(64) },
    ],
  })
  assert.equal(merged.counts.works, 2)
  assert.deepEqual(merged.inputReports[0], {
    sha256: '8'.repeat(64),
    offset: 0,
    declaredEnd: 2,
    effectiveEnd: 1,
    truncatedIncomplete: 1,
  })
})
