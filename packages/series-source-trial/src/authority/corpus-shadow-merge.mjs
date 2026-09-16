import { buildCorpusShadowCandidateGraph } from './corpus-shadow-graph.mjs'

export const CORPUS_SHADOW_MERGED_PURPOSE = 'corpus-series-shadow-merged-graph'

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

const assertReport = (report) => {
  if (
    report?.schemaVersion !== 1 ||
    report?.purpose !== 'corpus-series-shadow-source-acquisition'
  ) {
    throw new Error('Every input must be a corpus shadow acquisition report')
  }
  const source = report.sourceFrame
  if (
    typeof source?.project !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source?.sha256 ?? '') ||
    !Number.isInteger(source?.totalWorks) ||
    !Number.isInteger(source?.offset) ||
    !Number.isInteger(source?.end) ||
    source.offset < 0 ||
    source.end <= source.offset ||
    source.end > source.totalWorks
  ) {
    throw new Error('Acquisition report has an invalid source-frame range')
  }
  if (
    !Array.isArray(report.caseSet?.cases) ||
    report.caseSet.cases.length !== source.end - source.offset ||
    report.candidateGraph?.counts?.works !== report.caseSet.cases.length
  ) {
    throw new Error('Acquisition report does not reconcile its selected identities')
  }
  if (
    !Array.isArray(report.providers) ||
    !report.providers.length ||
    !Array.isArray(report.runs) ||
    report.runs.length !== report.providers.length ||
    !equal(
      report.runs.map((run) => run.provider),
      report.providers,
    )
  ) {
    throw new Error('Acquisition report provider runs do not reconcile')
  }
}

export function mergeCorpusShadowReports(reports) {
  if (!Array.isArray(reports) || !reports.length) throw new Error('At least one report is required')
  for (const report of reports) assertReport(report)
  const ordered = [...reports].sort(
    (left, right) => left.sourceFrame.offset - right.sourceFrame.offset,
  )
  const baseline = ordered[0]
  const sourceIdentity = {
    project: baseline.sourceFrame.project,
    sha256: baseline.sourceFrame.sha256,
    totalWorks: baseline.sourceFrame.totalWorks,
  }
  const providers = baseline.providers
  let cursor = 0
  const seenWorks = new Set()

  for (const report of ordered) {
    if (
      report.sourceFrame.project !== sourceIdentity.project ||
      report.sourceFrame.sha256 !== sourceIdentity.sha256 ||
      report.sourceFrame.totalWorks !== sourceIdentity.totalWorks
    ) {
      throw new Error('Acquisition reports do not share one frozen source frame')
    }
    if (!equal(report.providers, providers)) {
      throw new Error('Acquisition reports do not share one ordered provider set')
    }
    if (report.sourceFrame.offset !== cursor) {
      throw new Error('Acquisition ranges must be complete, contiguous, and non-overlapping')
    }
    cursor = report.sourceFrame.end
    for (const testCase of report.caseSet.cases) {
      if (seenWorks.has(testCase.id)) throw new Error(`Duplicate frozen work ${testCase.id}`)
      seenWorks.add(testCase.id)
    }
  }
  if (cursor !== sourceIdentity.totalWorks || seenWorks.size !== sourceIdentity.totalWorks) {
    throw new Error('Acquisition reports do not cover the complete frozen inventory')
  }

  const cases = ordered.flatMap((report) => report.caseSet.cases)
  const runs = providers.map((provider, providerIndex) => {
    const providerRuns = ordered.map((report) => report.runs[providerIndex])
    const rights = providerRuns[0].rights
    if (providerRuns.some((run) => run.provider !== provider || !equal(run.rights, rights))) {
      throw new Error(`${provider} metadata drifted across acquisition batches`)
    }
    return {
      schemaVersion: 1,
      provider,
      observedAt: providerRuns.map((run) => run.observedAt).sort()[0],
      completedAt: providerRuns
        .map((run) => run.completedAt)
        .filter(Boolean)
        .sort()
        .at(-1),
      rights,
      results: providerRuns.flatMap((run) => run.results),
    }
  })
  const candidateGraph = buildCorpusShadowCandidateGraph(cases, runs)

  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_MERGED_PURPOSE,
    sourceFrame: {
      ...sourceIdentity,
      offset: 0,
      end: sourceIdentity.totalWorks,
    },
    providers,
    inputBatches: ordered.map((report) => ({
      offset: report.sourceFrame.offset,
      end: report.sourceFrame.end,
    })),
    caseSet: {
      schemaVersion: 1,
      purpose: baseline.caseSet.purpose,
      cases,
    },
    runs,
    candidateGraph,
  }
}
