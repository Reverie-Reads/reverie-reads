import { normalize } from '../normalize.mjs'
import { CORPUS_SHADOW_RECONCILIATION_PURPOSE } from './corpus-shadow-reconcile.mjs'

export const CORPUS_SHADOW_HISTORY_PURPOSE = 'corpus-series-shadow-historical-snapshot'
export const CORPUS_SHADOW_COMPARISON_PURPOSE = 'corpus-series-shadow-historical-comparison'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const asArray = (value) => (Array.isArray(value) ? value : [])

export function validateCorpusShadowHistoricalSnapshot(snapshot, frame, frameSha256) {
  if (
    snapshot?.schemaVersion !== 1 ||
    snapshot?.purpose !== CORPUS_SHADOW_HISTORY_PURPOSE ||
    snapshot?.sourceFrame?.project !== frame.project ||
    snapshot?.sourceFrame?.sha256 !== frameSha256 ||
    snapshot?.sourceFrame?.totalWorks !== frame.cases.length ||
    !Number.isFinite(Date.parse(snapshot.capturedAt ?? '')) ||
    !Array.isArray(snapshot.works) ||
    snapshot.works.length !== frame.cases.length
  ) {
    throw new Error('Historical snapshot does not match the frozen corpus frame')
  }
  const expected = new Map(frame.cases.map((testCase) => [testCase.id, testCase]))
  const seen = new Set()
  for (const work of snapshot.works) {
    if (!UUID_RE.test(work?.workId ?? '') || seen.has(work.workId)) {
      throw new Error('Historical snapshot has an invalid or duplicate work ID')
    }
    seen.add(work.workId)
    const frozen = expected.get(work.workId)
    if (!frozen || work.identityFingerprint !== frozen.identityFingerprint) {
      throw new Error(`Historical snapshot identity drifted for ${work.workId}`)
    }
    if (!Array.isArray(work.memberships) || !Array.isArray(work.pendingSuggestions)) {
      throw new Error(`Historical snapshot has invalid relationship arrays for ${work.workId}`)
    }
  }
  if (seen.size !== expected.size) throw new Error('Historical snapshot omits frozen works')
  const counts = {
    works: snapshot.works.length,
    projectionSeries: snapshot.works.filter(({ projection }) => projection?.series).length,
    worksWithMemberships: snapshot.works.filter(({ memberships }) => memberships.length).length,
    memberships: snapshot.works.reduce((total, { memberships }) => total + memberships.length, 0),
    pendingSuggestions: snapshot.works.reduce(
      (total, { pendingSuggestions }) => total + pendingSuggestions.length,
      0,
    ),
  }
  if (
    Object.keys(snapshot.counts ?? {}).length !== Object.keys(counts).length ||
    Object.entries(counts).some(([key, value]) => snapshot.counts?.[key] !== value)
  ) {
    throw new Error(
      `Historical snapshot counts do not reconcile: ${JSON.stringify({ reported: snapshot.counts, computed: counts })}`,
    )
  }
  return snapshot
}

const tuple = (membership) => ({
  series: String(membership?.series ?? '').trim(),
  position: Number.isFinite(membership?.position) ? Number(membership.position) : null,
  role: String(membership?.role ?? 'unknown'),
})
const sortedTuples = (memberships) =>
  asArray(memberships)
    .map(tuple)
    .filter(({ series }) => series)
    .sort((left, right) => normalize(left.series).localeCompare(normalize(right.series)))
const seriesKeys = (memberships) => memberships.map(({ series }) => normalize(series))

const currentState = (historicalWork) => {
  const graph = sortedTuples(
    historicalWork.memberships.map((membership) => ({
      series: membership.series,
      position: membership.position,
      role: membership.isPrimary ? 'primary' : 'unknown',
    })),
  )
  const projected = historicalWork.projection?.series
    ? [
        tuple({
          series: historicalWork.projection.series,
          position: historicalWork.projection.position,
          role: 'primary',
        }),
      ]
    : []
  const issues = []
  if (graph.length && projected.length && !seriesKeys(graph).includes(seriesKeys(projected)[0])) {
    issues.push('projection_graph_mismatch')
  }
  return {
    memberships: graph.length ? graph : projected,
    origin: graph.length ? 'graph' : 'projection',
    issues,
  }
}

const compareResolvedSeries = (desired, current) => {
  if (!current.length) return { action: 'add_series', reason: 'resolved_series_missing' }
  if (!equal(seriesKeys(desired), seriesKeys(current))) {
    return { action: 'replace_series', reason: 'resolved_series_name_conflict' }
  }
  let positionNeedsUpdate = false
  let positionNeedsReview = false
  for (let index = 0; index < desired.length; index += 1) {
    const wanted = desired[index].position
    const existing = current[index].position
    if (wanted !== null && wanted !== existing) positionNeedsUpdate = true
    if (wanted === null && existing !== null) positionNeedsReview = true
  }
  if (positionNeedsUpdate)
    return { action: 'update_position', reason: 'resolved_position_conflict' }
  if (positionNeedsReview)
    return { action: 'review_position', reason: 'authority_position_unknown' }
  return { action: 'match', reason: 'exact_resolved_match' }
}

export function compareCorpusShadowWithHistory({ reconciliation, historical }) {
  if (
    reconciliation?.schemaVersion !== 1 ||
    reconciliation?.purpose !== CORPUS_SHADOW_RECONCILIATION_PURPOSE ||
    !Array.isArray(reconciliation.works) ||
    reconciliation.works.length !== historical.works.length ||
    reconciliation.sourceFrame?.sha256 !== historical.sourceFrame.sha256
  ) {
    throw new Error('Reconciliation and historical snapshot do not share one frozen corpus')
  }
  const historicalIds = historical.works.map(({ workId }) => workId)
  if (
    new Set(historicalIds).size !== historicalIds.length ||
    historical.sourceFrame?.totalWorks !== historical.works.length ||
    historical.counts?.works !== historical.works.length
  ) {
    throw new Error('Historical snapshot is incomplete or contains duplicate works')
  }
  const historyById = new Map(historical.works.map((work) => [work.workId, work]))
  const works = reconciliation.works.map((shadow) => {
    const history = historyById.get(shadow.workId)
    if (!history || history.identityFingerprint !== shadow.identityFingerprint) {
      throw new Error(`Historical comparison identity drifted for ${shadow.workId}`)
    }
    const current = currentState(history)
    const desired = sortedTuples(shadow.memberships)
    let comparison
    if (shadow.status === 'resolved_series') {
      comparison = compareResolvedSeries(desired, current.memberships)
    } else if (shadow.status === 'resolved_standalone') {
      comparison = current.memberships.length
        ? {
            action: 'review_standalone_conflict',
            reason: 'affirmative_standalone_conflicts_with_history',
          }
        : { action: 'match', reason: 'exact_resolved_match' }
    } else if (shadow.status === 'historical_review_complete_unresolved') {
      comparison = {
        action: 'review_historical_authority',
        reason: 'historical_authority_remains_unresolved_or_quarantined',
      }
    } else {
      comparison = current.memberships.length
        ? { action: 'review_unverified_historical', reason: 'shadow_not_resolved' }
        : { action: 'no_action_unresolved', reason: 'shadow_not_resolved' }
    }
    return {
      workId: shadow.workId,
      title: shadow.title,
      shadowStatus: shadow.status,
      action: comparison.action,
      reason: comparison.reason,
      currentOrigin: current.origin,
      currentMemberships: current.memberships,
      desiredMemberships: desired,
      historicalIssues: current.issues,
      pendingSuggestionCount: history.pendingSuggestions.length,
    }
  })
  const actions = [
    'match',
    'add_series',
    'replace_series',
    'update_position',
    'review_position',
    'review_standalone_conflict',
    'review_historical_authority',
    'review_unverified_historical',
    'no_action_unresolved',
  ]
  const counts = {
    works: works.length,
    ...Object.fromEntries(
      actions.map((action) => [action, works.filter((work) => work.action === action).length]),
    ),
    projectionGraphMismatches: works.filter(({ historicalIssues }) => historicalIssues.length)
      .length,
  }
  return { counts, works }
}

export function buildCorpusShadowHistoricalComparison({
  reconciliation,
  reconciliationSha256,
  historical,
  historicalSha256,
}) {
  const compared = compareCorpusShadowWithHistory({ reconciliation, historical })
  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_COMPARISON_PURPOSE,
    sourceFrame: reconciliation.sourceFrame,
    inputs: { reconciliationSha256, historicalSha256 },
    ...compared,
    mutationBoundary: 'review_only_no_supabase_or_corpus_writer',
  }
}
