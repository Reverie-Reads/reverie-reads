import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import {
  buildCorpusShadowReviewManifest,
  validateCorpusShadowReviewManifest,
} from '../src/authority/corpus-shadow-review-manifest.mjs'

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
