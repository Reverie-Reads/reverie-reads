import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCorpusShadowCandidateGraph } from '../src/authority/corpus-shadow-graph.mjs'

const cases = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'First Book',
    authors: ['A. Writer'],
    publicationYear: 2024,
    identityFingerprint: '11111111111111111111111111111111',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Second Book',
    authors: ['A. Writer'],
    publicationYear: 2025,
    identityFingerprint: '22222222222222222222222222222222',
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Unrelated Book',
    authors: ['Another Writer'],
    publicationYear: 2025,
    identityFingerprint: '33333333333333333333333333333333',
  },
]

const result = (testCase, providerWorkId, claims = []) => ({
  caseId: testCase.id,
  latencyMs: 10,
  workMatch: {
    matched: true,
    confidence: 'high',
    providerWorkId,
    matchedTitle: testCase.title,
    matchedAuthors: testCase.authors,
  },
  seriesClaims: claims,
})

const claim = (series, position, sourceRef, evidenceKind = 'relational_membership') => ({
  evidenceKind,
  providerSeriesId: series,
  series,
  position,
  memberCount: evidenceKind === 'singleton_relation' ? 1 : 2,
  orderType: 'unspecified',
  role: 'unknown',
  sourceRef,
})

const run = (provider, results) => ({
  provider,
  observedAt: '2026-09-15T00:00:00Z',
  results,
})

test('builds exact-name, full-author candidate groups and leaves missing relationships unresolved', () => {
  const openLibrary = run('openlibrary', [
    result(cases[0], 'ol-1', [claim('The Sequence', 1, 'ol:1')]),
    result(cases[1], 'ol-2', [claim('The Sequence', 2, 'ol:2')]),
    result(cases[2], 'ol-3', []),
  ])
  const wikidata = run('wikidata', [
    result(cases[0], 'wd-1', [claim('The Sequence', 1, 'wd:1')]),
    result(cases[1], 'wd-2', [claim('The Sequence', 2, 'wd:2')]),
    result(cases[2], 'wd-3', []),
  ])

  const graph = buildCorpusShadowCandidateGraph(cases, [openLibrary, wikidata])
  assert.deepEqual(graph.counts, {
    works: 3,
    worksWithCandidates: 2,
    unresolvedWorks: 1,
    candidateGroups: 1,
    candidateMemberships: 2,
    groupsRequiringModelReview: 1,
    affirmativeStandaloneClaims: 0,
  })
  assert.equal(graph.candidateGroups[0].series, 'The Sequence')
  assert.equal(graph.candidateGroups[0].members.length, 2)
  assert.equal(
    graph.candidateGroups[0].members[0].identityFingerprint,
    cases[0].identityFingerprint,
  )
  assert.deepEqual(
    graph.candidateGroups[0].members.map((entry) => entry.proposedPosition),
    [1, 2],
  )
  assert.equal(graph.candidateGroups[0].modelReview, 'required')
  assert.equal(graph.unresolvedWorks[0].reason, 'no_exact_relationship')
  assert.equal(graph.unresolvedWorks[0].standalone, null)
})

test('keeps author scopes separate and quarantines singleton and search-label evidence', () => {
  const provider = run('hardcover', [
    result(cases[0], 'hc-1', [claim('Shared Name', 1, 'hc:1', 'singleton_relation')]),
    result(cases[1], 'hc-2', [claim('Search Only', 2, 'hc:2', 'candidate_label')]),
    result(cases[2], 'hc-3', [claim('Shared Name', 1, 'hc:3', 'singleton_relation')]),
  ])

  const graph = buildCorpusShadowCandidateGraph(cases, [provider])
  assert.equal(graph.candidateGroups.length, 2)
  assert.ok(graph.candidateGroups.every((group) => group.riskFlags.includes('singleton')))
  assert.ok(graph.candidateGroups.every((group) => group.riskFlags.includes('single_work_group')))
  assert.equal(graph.unresolvedWorks.length, 1)
  assert.equal(graph.unresolvedWorks[0].workId, cases[1].id)
})

test('rejects incomplete provider batches instead of manufacturing absence', () => {
  assert.throws(
    () =>
      buildCorpusShadowCandidateGraph(cases, [
        run('wikidata', [result(cases[0], 'wd-1'), result(cases[1], 'wd-2')]),
      ]),
    /does not exactly cover/,
  )
})
