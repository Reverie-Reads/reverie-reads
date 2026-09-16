import { CORPUS_SHADOW_REVIEW_PURPOSE } from './corpus-shadow-review.mjs'

export const CORPUS_SHADOW_REVIEW_MERGED_PURPOSE = 'corpus-series-shadow-luna-group-review-merged'

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const statuses = new Set(['supported', 'rejected', 'review', 'invalid', 'error'])

const summarize = (results) => ({
  groups: results.length,
  supported: results.filter((result) => result.status === 'supported').length,
  rejected: results.filter((result) => result.status === 'rejected').length,
  review: results.filter((result) => result.status === 'review').length,
  invalid: results.filter((result) => result.status === 'invalid').length,
  errors: results.filter((result) => result.status === 'error').length,
  modelCalls: results.reduce((total, result) => total + Number(result.billing?.modelCalls ?? 0), 0),
  cached: results.filter((result) => result.cached).length,
  webSearchCalls: results.reduce(
    (total, result) => total + Number(result.billing?.webSearchCalls ?? 0),
    0,
  ),
  inputTokens: results.reduce(
    (total, result) => total + Number(result.billing?.inputTokens ?? 0),
    0,
  ),
  outputTokens: results.reduce(
    (total, result) => total + Number(result.billing?.outputTokens ?? 0),
    0,
  ),
})

const exaQueueFor = (results) => {
  const items = []
  for (const result of results) {
    if (result.status !== 'review') continue
    for (const review of Array.isArray(result.reviews) ? result.reviews : []) {
      const reason =
        review.output?.classification === 'unresolved'
          ? 'unresolved'
          : review.validation?.valid === true && review.validation?.policySafe !== true
            ? 'policy_quarantined'
            : null
      if (!reason) continue
      items.push({ groupId: result.groupId, caseId: review.caseId, reason })
    }
  }
  return {
    groups: new Set(items.map((item) => item.groupId)).size,
    works: items.length,
    unresolved: items.filter((item) => item.reason === 'unresolved').length,
    policyQuarantined: items.filter((item) => item.reason === 'policy_quarantined').length,
    items,
  }
}

const assertReport = (report) => {
  if (report?.schemaVersion !== 1 || report?.purpose !== CORPUS_SHADOW_REVIEW_PURPOSE) {
    throw new Error('Every input must be a corpus shadow Luna group-review report')
  }
  const source = report.sourceFrame
  const range = report.reviewRange
  if (
    typeof source?.project !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source?.sha256 ?? '') ||
    !Number.isInteger(source?.totalWorks) ||
    source.offset !== 0 ||
    source.end !== source.totalWorks ||
    !/^[a-f0-9]{64}$/.test(report.inputSha256 ?? '') ||
    !Number.isInteger(range?.offset) ||
    !Number.isInteger(range?.end) ||
    !Number.isInteger(range?.totalGroups) ||
    range.offset < 0 ||
    range.end <= range.offset ||
    range.end > range.totalGroups ||
    !Array.isArray(report.results) ||
    report.results.length !== range.end - range.offset
  ) {
    throw new Error('Review report has an invalid source frame or review range')
  }
  if (
    !report.experiment ||
    typeof report.experiment !== 'object' ||
    report.results.some(
      (result) => typeof result?.groupId !== 'string' || !statuses.has(result?.status),
    )
  ) {
    throw new Error('Review report has invalid experiment or result data')
  }
  const ids = report.results.map((result) => result.groupId)
  if (new Set(ids).size !== ids.length) throw new Error('Review report has duplicate group IDs')
  if (!equal(report.counts, summarize(report.results))) {
    throw new Error('Review report counts do not reconcile')
  }
}

export function mergeCorpusShadowReviewReports(reports) {
  if (!Array.isArray(reports) || !reports.length) throw new Error('At least one report is required')
  for (const report of reports) assertReport(report)
  const ordered = [...reports].sort(
    (left, right) => left.reviewRange.offset - right.reviewRange.offset,
  )
  const baseline = ordered[0]
  let cursor = 0
  const seenGroups = new Set()

  for (const report of ordered) {
    if (
      !equal(report.sourceFrame, baseline.sourceFrame) ||
      report.inputSha256 !== baseline.inputSha256 ||
      report.reviewRange.totalGroups !== baseline.reviewRange.totalGroups
    ) {
      throw new Error('Review reports do not share one frozen input graph')
    }
    if (!equal(report.experiment, baseline.experiment)) {
      throw new Error('Review reports do not share one Luna experiment')
    }
    if (report.reviewRange.offset !== cursor) {
      throw new Error('Review ranges must be complete, contiguous, and non-overlapping')
    }
    cursor = report.reviewRange.end
    for (const result of report.results) {
      if (seenGroups.has(result.groupId))
        throw new Error(`Duplicate review group ${result.groupId}`)
      seenGroups.add(result.groupId)
    }
  }
  if (cursor !== baseline.reviewRange.totalGroups || seenGroups.size !== cursor) {
    throw new Error('Review reports do not cover the complete candidate graph')
  }

  const results = ordered.flatMap((report) => report.results)
  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_REVIEW_MERGED_PURPOSE,
    sourceFrame: baseline.sourceFrame,
    inputSha256: baseline.inputSha256,
    reviewRange: { offset: 0, end: cursor, totalGroups: cursor },
    experiment: baseline.experiment,
    inputBatches: ordered.map((report) => ({
      offset: report.reviewRange.offset,
      end: report.reviewRange.end,
    })),
    counts: summarize(results),
    exaQueue: exaQueueFor(results),
    results,
  }
}
