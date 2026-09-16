import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCorpusShadowCandidateGraph } from '../src/authority/corpus-shadow-graph.mjs'
import { mergeCorpusShadowReports } from '../src/authority/corpus-shadow-merge.mjs'

const identities = [
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
]
const rights = {
  commercialUsePermitted: true,
  persistentStoragePermitted: true,
  claimLevelProvenance: true,
}
const runFor = (testCase, position) => ({
  schemaVersion: 1,
  provider: 'wikidata',
  observedAt: '2026-09-15T00:00:00Z',
  completedAt: '2026-09-15T00:00:01Z',
  rights,
  results: [
    {
      caseId: testCase.id,
      latencyMs: 1,
      workMatch: {
        matched: true,
        confidence: 'high',
        providerWorkId: `wd:${position}`,
        matchedTitle: testCase.title,
        matchedAuthors: testCase.authors,
      },
      seriesClaims: [
        {
          evidenceKind: 'relational_membership',
          providerSeriesId: 'wd:series',
          series: 'The Sequence',
          position,
          memberCount: 2,
          orderType: 'unspecified',
          role: 'unknown',
          sourceRef: `wd:${position}`,
        },
      ],
    },
  ],
})

const report = (offset, testCase, position) => {
  const run = runFor(testCase, position)
  return {
    schemaVersion: 1,
    purpose: 'corpus-series-shadow-source-acquisition',
    sourceFrame: {
      project: 'abcdefghijklmnopqrst',
      sha256: 'a'.repeat(64),
      totalWorks: 2,
      offset,
      end: offset + 1,
    },
    caseSet: {
      schemaVersion: 1,
      purpose: 'corpus-series-shadow-rebuild',
      cases: [testCase],
    },
    providers: ['wikidata'],
    runs: [run],
    candidateGraph: buildCorpusShadowCandidateGraph([testCase], [run]),
  }
}

test('rebuilds one series group across complete batch boundaries', () => {
  const merged = mergeCorpusShadowReports([
    report(1, identities[1], 2),
    report(0, identities[0], 1),
  ])
  assert.equal(merged.candidateGraph.counts.works, 2)
  assert.equal(merged.candidateGraph.counts.candidateGroups, 1)
  assert.deepEqual(
    merged.candidateGraph.candidateGroups[0].members.map((member) => member.title),
    ['First Book', 'Second Book'],
  )
  assert.deepEqual(merged.inputBatches, [
    { offset: 0, end: 1 },
    { offset: 1, end: 2 },
  ])
})

test('rejects gaps, overlaps, source drift, and provider drift', () => {
  const first = report(0, identities[0], 1)
  const second = report(1, identities[1], 2)
  assert.throws(() => mergeCorpusShadowReports([second]), /complete, contiguous/)
  assert.throws(() => mergeCorpusShadowReports([first]), /complete frozen inventory/)
  assert.throws(
    () =>
      mergeCorpusShadowReports([
        first,
        { ...second, sourceFrame: { ...second.sourceFrame, sha256: 'b'.repeat(64) } },
      ]),
    /one frozen source frame/,
  )
  assert.throws(
    () =>
      mergeCorpusShadowReports([
        first,
        {
          ...second,
          providers: ['openlibrary'],
          runs: [{ ...second.runs[0], provider: 'openlibrary' }],
        },
      ]),
    /ordered provider set/,
  )
})

test('rejects duplicate work identities even when ranges look complete', () => {
  const first = report(0, identities[0], 1)
  const duplicate = report(1, identities[0], 2)
  assert.throws(() => mergeCorpusShadowReports([first, duplicate]), /Duplicate frozen work/)
})
