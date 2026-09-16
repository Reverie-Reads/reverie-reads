import { CORPUS_SHADOW_EXA_PURPOSE, summarizeCorpusShadowExaResults } from './corpus-shadow-exa.mjs'

export const CORPUS_SHADOW_EXA_MERGED_PURPOSE = 'corpus-series-shadow-exa-fallback-merged'

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const assertReport = (report) => {
  const range = report?.queueRange
  if (
    report?.schemaVersion !== 1 ||
    report?.purpose !== CORPUS_SHADOW_EXA_PURPOSE ||
    !/^[a-f0-9]{64}$/.test(report?.reviewSha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(report?.graphSha256 ?? '') ||
    !Number.isInteger(range?.offset) ||
    !Number.isInteger(range?.end) ||
    !Number.isInteger(range?.totalWorks) ||
    range.offset < 0 ||
    range.end <= range.offset ||
    range.end > range.totalWorks ||
    !Array.isArray(report?.results) ||
    report.results.length !== range.end - range.offset ||
    !equal(report.counts, summarizeCorpusShadowExaResults(report.results))
  ) {
    throw new Error('Every input must be a reconciled corpus shadow Exa report')
  }
  const caseIds = report.results.map((result) => result?.caseId)
  if (
    caseIds.some((caseId) => typeof caseId !== 'string') ||
    new Set(caseIds).size !== caseIds.length
  ) {
    throw new Error('Exa report has invalid or duplicate work IDs')
  }
}

export function mergeCorpusShadowExaReports(reports) {
  if (!Array.isArray(reports) || !reports.length) throw new Error('At least one report is required')
  for (const report of reports) assertReport(report)
  const ordered = [...reports].sort(
    (left, right) => left.queueRange.offset - right.queueRange.offset,
  )
  const baseline = ordered[0]
  let cursor = 0
  const seenWorks = new Set()

  for (const report of ordered) {
    if (
      !equal(report.sourceFrame, baseline.sourceFrame) ||
      report.reviewSha256 !== baseline.reviewSha256 ||
      report.graphSha256 !== baseline.graphSha256 ||
      report.queueRange.totalWorks !== baseline.queueRange.totalWorks
    ) {
      throw new Error('Exa reports do not share one frozen review queue')
    }
    if (!equal(report.experiment, baseline.experiment)) {
      throw new Error('Exa reports do not share one fallback experiment')
    }
    if (report.queueRange.offset !== cursor) {
      throw new Error('Exa ranges must be complete, contiguous, and non-overlapping')
    }
    cursor = report.queueRange.end
    for (const result of report.results) {
      if (seenWorks.has(result.caseId)) throw new Error(`Duplicate Exa work ${result.caseId}`)
      seenWorks.add(result.caseId)
    }
  }
  if (cursor !== baseline.queueRange.totalWorks || seenWorks.size !== cursor) {
    throw new Error('Exa reports do not cover the complete unique-work queue')
  }

  const results = ordered.flatMap((report) => report.results)
  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_EXA_MERGED_PURPOSE,
    sourceFrame: baseline.sourceFrame,
    reviewSha256: baseline.reviewSha256,
    graphSha256: baseline.graphSha256,
    queueRange: { offset: 0, end: cursor, totalWorks: cursor },
    experiment: baseline.experiment,
    inputBatches: ordered.map((report) => ({
      offset: report.queueRange.offset,
      end: report.queueRange.end,
    })),
    counts: summarizeCorpusShadowExaResults(results),
    results,
  }
}
