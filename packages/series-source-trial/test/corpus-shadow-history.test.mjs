import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compareCorpusShadowWithHistory,
  CORPUS_SHADOW_HISTORY_PURPOSE,
  validateCorpusShadowHistoricalSnapshot,
} from '../src/authority/corpus-shadow-history.mjs'

const ids = Array.from({ length: 8 }, (_, index) => {
  const digit = String(index + 1)
  return `${digit.repeat(8)}-${digit.repeat(4)}-4${digit.repeat(3)}-8${digit.repeat(3)}-${digit.repeat(12)}`
})
const frozen = ids.map((id, index) => ({
  id,
  title: `Work ${index + 1}`,
  authors: ['A. Writer'],
  publicationYear: 2025,
  identityFingerprint: String(index + 1).repeat(32),
}))
const frame = {
  project: 'abcdefghijklmnopqrst',
  cases: frozen,
}
const sourceFrame = {
  project: frame.project,
  sha256: 'a'.repeat(64),
  totalWorks: frozen.length,
}
const graphMembership = (series, position) => ({
  seriesId: ids[0],
  series,
  position,
  isPrimary: true,
  source: 'historical',
  membershipClaim: { origin: 'corpus' },
  positionClaim: { origin: 'corpus' },
})
const historyWork = (index, memberships = [], projectionSeries = null) => ({
  workId: frozen[index].id,
  identityFingerprint: frozen[index].identityFingerprint,
  projection: {
    series: projectionSeries,
    position: null,
    seriesCount: null,
    status: null,
    seriesCheckState: 'unknown',
  },
  memberships,
  pendingSuggestions: [],
})

test('validates a complete identity-bound historical snapshot', () => {
  const works = frozen.map((_, index) => historyWork(index))
  const snapshot = {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_HISTORY_PURPOSE,
    sourceFrame,
    capturedAt: '2026-09-16T12:00:00.000Z',
    counts: {
      works: 8,
      projectionSeries: 0,
      worksWithMemberships: 0,
      memberships: 0,
      pendingSuggestions: 0,
    },
    works,
  }
  assert.equal(
    validateCorpusShadowHistoricalSnapshot(snapshot, frame, sourceFrame.sha256),
    snapshot,
  )
  assert.throws(
    () =>
      validateCorpusShadowHistoricalSnapshot(
        {
          ...snapshot,
          works: [{ ...works[0], identityFingerprint: 'f'.repeat(32) }, ...works.slice(1)],
        },
        frame,
        sourceFrame.sha256,
      ),
    /identity drifted/,
  )
})

test('classifies exact, add, replace, position, removal, and unresolved historical deltas', () => {
  const historical = {
    counts: { works: 8 },
    sourceFrame,
    works: [
      historyWork(0, [graphMembership('Alpha', 1)]),
      historyWork(1),
      historyWork(2, [graphMembership('Old', 1)]),
      historyWork(3, [graphMembership('Alpha', 1)]),
      historyWork(4, [graphMembership('Alpha', 2)]),
      historyWork(5, [graphMembership('Wrong Series', 1)]),
      historyWork(6, [graphMembership('Unverified', 1)], 'Projection Conflict'),
      historyWork(7),
    ],
  }
  const seriesWork = (index, series, position) => ({
    ...frozen[index],
    workId: frozen[index].id,
    status: 'resolved_series',
    memberships: [{ series, position, role: 'primary' }],
  })
  const reconciliation = {
    schemaVersion: 1,
    purpose: 'corpus-series-shadow-authority-reconciliation',
    sourceFrame,
    works: [
      seriesWork(0, 'Alpha', 1),
      seriesWork(1, 'Alpha', 1),
      seriesWork(2, 'New', 1),
      seriesWork(3, 'Alpha', 2),
      seriesWork(4, 'Alpha', null),
      { ...frozen[5], workId: frozen[5].id, status: 'resolved_standalone' },
      { ...frozen[6], workId: frozen[6].id, status: 'manual_review' },
      { ...frozen[7], workId: frozen[7].id, status: 'unresolved' },
    ],
  }
  const result = compareCorpusShadowWithHistory({ reconciliation, historical })
  assert.deepEqual(
    result.works.map(({ action }) => action),
    [
      'match',
      'add_series',
      'replace_series',
      'update_position',
      'review_position',
      'remove_series',
      'review_unverified_historical',
      'no_action_unresolved',
    ],
  )
  assert.equal(result.counts.projectionGraphMismatches, 1)
  assert.equal(result.counts.works, 8)

  assert.throws(
    () =>
      compareCorpusShadowWithHistory({
        reconciliation,
        historical: {
          ...historical,
          works: [...historical.works.slice(0, 7), historical.works[0]],
        },
      }),
    /duplicate works/,
  )
})
