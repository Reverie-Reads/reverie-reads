import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeCorpusShadowReviewReports } from '../src/authority/corpus-shadow-review-merge.mjs'

const sourceFrame = {
  project: 'abcdefghijklmnopqrst',
  sha256: 'a'.repeat(64),
  totalWorks: 10,
  offset: 0,
  end: 10,
}
const experiment = {
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  searchContextSize: 'medium',
  maxToolCalls: 3,
}
const result = (groupId, status, classification = 'series', policySafe = true) => ({
  groupId,
  proposedSeries: `Series ${groupId}`,
  status,
  errors: [],
  consultedUrls: [],
  searchedQueries: [],
  reviews: [
    {
      caseId: `case-${groupId}`,
      output: { classification },
      validation: { valid: true, policySafe },
    },
  ],
  cached: false,
  billing: { modelCalls: 1, webSearchCalls: 1, inputTokens: 10, outputTokens: 2 },
})
const counts = (results) => ({
  groups: results.length,
  supported: results.filter((entry) => entry.status === 'supported').length,
  rejected: results.filter((entry) => entry.status === 'rejected').length,
  review: results.filter((entry) => entry.status === 'review').length,
  invalid: results.filter((entry) => entry.status === 'invalid').length,
  errors: results.filter((entry) => entry.status === 'error').length,
  modelCalls: results.length,
  cached: 0,
  webSearchCalls: results.length,
  inputTokens: results.length * 10,
  outputTokens: results.length * 2,
})
const report = (offset, results, totalGroups = 4) => ({
  schemaVersion: 1,
  purpose: 'corpus-series-shadow-luna-group-review',
  sourceFrame,
  inputSha256: 'b'.repeat(64),
  reviewRange: { offset, end: offset + results.length, totalGroups },
  experiment,
  counts: counts(results),
  results,
})

test('merges a complete review and selects only unresolved or policy-quarantined works for Exa', () => {
  const merged = mergeCorpusShadowReviewReports([
    report(2, [result('c', 'review', 'series', false), result('d', 'rejected')]),
    report(0, [result('a', 'supported'), result('b', 'review', 'unresolved')]),
  ])
  assert.equal(merged.counts.groups, 4)
  assert.equal(merged.counts.supported, 1)
  assert.equal(merged.counts.rejected, 1)
  assert.equal(merged.counts.review, 2)
  assert.deepEqual(merged.exaQueue, {
    groups: 2,
    works: 2,
    unresolved: 1,
    policyQuarantined: 1,
    items: [
      { groupId: 'b', caseId: 'case-b', reason: 'unresolved' },
      { groupId: 'c', caseId: 'case-c', reason: 'policy_quarantined' },
    ],
  })
})

test('rejects gaps, overlaps, input drift, experiment drift, duplicate groups, and count drift', () => {
  const first = report(0, [result('a', 'supported'), result('b', 'review')])
  const second = report(2, [result('c', 'supported'), result('d', 'rejected')])
  assert.throws(() => mergeCorpusShadowReviewReports([second]), /complete, contiguous/)
  assert.throws(() => mergeCorpusShadowReviewReports([first]), /complete candidate graph/)
  assert.throws(
    () => mergeCorpusShadowReviewReports([first, { ...second, inputSha256: 'c'.repeat(64) }]),
    /one frozen input graph/,
  )
  assert.throws(
    () =>
      mergeCorpusShadowReviewReports([
        first,
        { ...second, experiment: { ...experiment, reasoningEffort: 'medium' } },
      ]),
    /one Luna experiment/,
  )
  assert.throws(
    () =>
      mergeCorpusShadowReviewReports([
        first,
        report(2, [result('a', 'supported'), result('d', 'rejected')]),
      ]),
    /Duplicate review group/,
  )
  assert.throws(
    () => mergeCorpusShadowReviewReports([{ ...first, counts: { ...first.counts, groups: 3 } }]),
    /counts do not reconcile/,
  )
})

test('does not route malformed Luna output or a valid alternative classification into Exa', () => {
  const invalid = result('a', 'review', 'series', true)
  invalid.reviews[0].validation.valid = false
  const alternative = result('b', 'review', 'series', true)
  const merged = mergeCorpusShadowReviewReports([report(0, [invalid, alternative], 2)])
  assert.equal(merged.exaQueue.works, 0)
})
