import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  buildCorpusShadowReconciliation,
  reconcileCorpusShadowDecisions,
} from '../src/authority/corpus-shadow-reconcile.mjs'
import { summarizeCorpusShadowExaResults } from '../src/authority/corpus-shadow-exa.mjs'

const safe = (caseId, classification, memberships = []) => ({
  caseId,
  output: { caseId, classification, memberships },
  validation: { valid: true, policySafe: true },
})
const unresolved = (caseId) => ({
  caseId,
  output: { caseId, classification: 'unresolved', memberships: [] },
  validation: { valid: true, policySafe: false },
})
const identity = (suffix, title) => ({
  id: `${suffix.repeat(8)}-${suffix.repeat(4)}-4${suffix.repeat(3)}-8${suffix.repeat(3)}-${suffix.repeat(12)}`,
  title,
  authors: ['A. Writer'],
  publicationYear: 2025,
  identityFingerprint: suffix.repeat(32),
})
const members = [
  identity('1', 'Resolved Series'),
  identity('2', 'No Candidate'),
  identity('3', 'Conflicting Authority'),
  identity('4', 'Partial Candidate Review'),
  identity('5', 'Exa Resolved'),
  identity('6', 'Resolved Standalone'),
]
const group = (groupId, testCase) => ({
  groupId,
  series: `Candidate ${groupId}`,
  authorScope: testCase.authors,
  members: [{ workId: testCase.id, title: testCase.title }],
})
const groups = [
  group('g1', members[0]),
  group('g2', members[2]),
  group('g3', members[2]),
  group('g4', members[3]),
  group('g5', members[3]),
  group('g6', members[4]),
  group('g7', members[5]),
]

test('reconciles safe work decisions while keeping gaps and competing claims visible', () => {
  const graph = { caseSet: { cases: members }, candidateGraph: { candidateGroups: groups } }
  const review = {
    results: [
      {
        groupId: 'g1',
        reviews: [
          safe(members[0].id, 'series', [{ series: 'Alpha', position: 1, role: 'primary' }]),
        ],
      },
      {
        groupId: 'g2',
        reviews: [
          safe(members[2].id, 'series', [{ series: 'Alpha', position: 1, role: 'primary' }]),
        ],
      },
      {
        groupId: 'g3',
        reviews: [
          safe(members[2].id, 'series', [{ series: 'Beta', position: 1, role: 'primary' }]),
        ],
      },
      {
        groupId: 'g4',
        reviews: [
          safe(members[3].id, 'series', [{ series: 'Alpha', position: null, role: 'primary' }]),
        ],
      },
      { groupId: 'g5', reviews: [unresolved(members[3].id)] },
      { groupId: 'g6', reviews: [unresolved(members[4].id)] },
      { groupId: 'g7', reviews: [safe(members[5].id, 'standalone')] },
    ],
  }
  const exa = {
    results: [
      {
        caseId: members[4].id,
        exaFallback: {
          selected: true,
          search: safe(members[4].id, 'series', [
            { series: 'Gamma', position: 2, role: 'primary' },
          ]),
        },
      },
    ],
  }

  const result = reconcileCorpusShadowDecisions({ graph, review, exa })
  assert.deepEqual(result.counts, {
    works: 6,
    resolvedSeries: 2,
    resolvedStandalone: 1,
    manualReview: 2,
    unresolved: 1,
    exaSelected: 1,
  })
  const byId = new Map(result.works.map((work) => [work.workId, work]))
  assert.equal(byId.get(members[0].id).status, 'resolved_series')
  assert.equal(byId.get(members[1].id).reason, 'no_relational_source_candidate')
  assert.equal(byId.get(members[2].id).reason, 'authority_membership_conflict')
  assert.equal(byId.get(members[3].id).reason, 'unresolved_competing_candidate')
  assert.deepEqual(byId.get(members[4].id).memberships, [
    { series: 'Gamma', position: 2, role: 'primary' },
  ])
  assert.equal(byId.get(members[5].id).status, 'resolved_standalone')
  assert.ok(result.works.every((work) => !JSON.stringify(work).includes('https://')))
})

test('binds a reconciliation to the exact graph, Luna review, and complete Exa queue', () => {
  const testCase = members[0]
  const candidateGroup = {
    ...group('bound-group', testCase),
    modelReview: 'required',
  }
  const sourceFrame = {
    project: 'abcdefghijklmnopqrst',
    sha256: 'a'.repeat(64),
    totalWorks: 1,
    offset: 0,
    end: 1,
  }
  const graph = {
    schemaVersion: 1,
    purpose: 'corpus-series-shadow-merged-graph',
    sourceFrame,
    caseSet: { cases: [testCase] },
    candidateGraph: {
      counts: { groupsRequiringModelReview: 1 },
      candidateGroups: [candidateGroup],
    },
  }
  const graphSha256 = createHash('sha256').update(JSON.stringify(graph)).digest('hex')
  const memberReview = unresolved(testCase.id)
  const review = {
    schemaVersion: 1,
    purpose: 'corpus-series-shadow-luna-group-review-merged',
    sourceFrame,
    inputSha256: graphSha256,
    reviewRange: { offset: 0, end: 1, totalGroups: 1 },
    exaQueue: {
      items: [{ groupId: candidateGroup.groupId, caseId: testCase.id, reason: 'unresolved' }],
    },
    results: [{ groupId: candidateGroup.groupId, status: 'review', reviews: [memberReview] }],
  }
  const reviewSha256 = createHash('sha256').update(JSON.stringify(review)).digest('hex')
  const exaResult = {
    caseId: testCase.id,
    exaFallback: {
      selected: true,
      search: safe(testCase.id, 'series', [
        { series: 'Bound Series', position: 1, role: 'primary' },
      ]),
    },
    runBilling: { modelCalls: 1, webSearchCalls: 1, inputTokens: 10, outputTokens: 2 },
    runExaOperations: { requests: 3, estimatedCostUsd: 0.021 },
  }
  const exa = {
    schemaVersion: 1,
    purpose: 'corpus-series-shadow-exa-fallback-merged',
    sourceFrame,
    graphSha256,
    reviewSha256,
    queueRange: { offset: 0, end: 1, totalWorks: 1 },
    results: [exaResult],
    counts: summarizeCorpusShadowExaResults([exaResult]),
  }
  const report = buildCorpusShadowReconciliation({
    graph,
    graphSha256,
    review,
    reviewSha256,
    exa,
    exaSha256: 'b'.repeat(64),
  })
  assert.equal(report.counts.resolvedSeries, 1)
  assert.equal(report.works[0].memberships[0].series, 'Bound Series')
  assert.equal(report.mutationBoundary, 'review_only_no_supabase_or_corpus_writer')
  assert.throws(
    () =>
      buildCorpusShadowReconciliation({
        graph,
        graphSha256,
        review,
        reviewSha256: 'c'.repeat(64),
        exa,
        exaSha256: 'b'.repeat(64),
      }),
    /complete fallback/,
  )
})
