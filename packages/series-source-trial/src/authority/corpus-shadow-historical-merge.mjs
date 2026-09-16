import { createHash } from 'node:crypto'

import { AUTHORITY_ACQUISITION_PROMPT_VERSION } from './schema.mjs'
import { validateCorpusShadowReviewManifest } from './corpus-shadow-review-manifest.mjs'

export const CORPUS_SHADOW_HISTORICAL_MERGE_PURPOSE =
  'corpus-series-shadow-historical-authority-merge'

const sha256Json = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const fail = (message) => {
  throw new Error(`Invalid corpus shadow historical acquisition: ${message}`)
}

const expectedTarget = (item) => ({
  schemaVersion: 1,
  caseId: item.id,
  target: {
    title: item.title,
    authors: item.authors,
    publicationYear: item.publicationYear,
  },
})

const resultStatus = (result) => {
  if (
    !result.validation?.valid ||
    !result.validation?.policySafe ||
    result.output?.caseId !== result.caseId
  )
    return 'manual_review'
  if (result.output?.classification === 'series' && result.output.memberships?.length) {
    return 'resolved_series'
  }
  if (result.output?.classification === 'standalone') return 'resolved_standalone'
  return 'unresolved'
}

export function mergeCorpusShadowHistoricalReports({ manifest, reports }) {
  validateCorpusShadowReviewManifest(manifest)
  if (!Array.isArray(reports) || !reports.length) fail('at least one report is required')
  const ordered = [...reports].sort(
    (left, right) =>
      left.report.corpusShadowManifest.reviewRange.offset -
      right.report.corpusShadowManifest.reviewRange.offset,
  )
  const expectedExperiment = {
    reasoningEffort: 'low',
    searchContextSize: 'medium',
    maxToolCalls: 3,
  }
  let nextOffset = 0
  const works = []
  const inputReports = []
  const operations = {
    modelCalls: 0,
    webSearchCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    errors: 0,
    exaFallbackAttempts: 0,
    exaFallbackRequests: 0,
    exaFallbackSelected: 0,
    exaFallbackEstimatedCostUsd: 0,
  }

  for (const { report, sha256 } of ordered) {
    const binding = report?.corpusShadowManifest
    const range = binding?.reviewRange
    if (
      report?.schemaVersion !== 1 ||
      report?.evaluationPartition !== 'corpus_shadow_historical_review' ||
      report?.model !== 'gpt-5.6-luna' ||
      !equal(report.experiment, expectedExperiment) ||
      report?.promptVersion !== AUTHORITY_ACQUISITION_PROMPT_VERSION ||
      report?.exaFallbackEnabled !== true ||
      report?.focusedSearchEnabled !== false ||
      report?.retrievalEnabled !== false ||
      binding?.sha256 !== manifest.manifestSha256 ||
      binding?.sourceFrame?.sha256 !== manifest.sourceFrame.sha256 ||
      range?.total !== manifest.counts.historicalVerification ||
      !Number.isInteger(range?.offset) ||
      !Number.isInteger(range?.end) ||
      range.end <= range.offset ||
      !Array.isArray(report.targets) ||
      !Array.isArray(report.results) ||
      report.targets.length !== range.end - range.offset ||
      report.results.length !== report.targets.length ||
      !/^[a-f0-9]{64}$/.test(sha256 ?? '')
    ) {
      fail('report metadata, experiment, or range drifted')
    }

    const firstIncompleteIndex = report.results.findIndex(
      (result) => result?.status !== 'completed',
    )
    const effectiveLength =
      firstIncompleteIndex === -1 ? report.results.length : firstIncompleteIndex
    if (report.results.slice(effectiveLength).some((result) => result?.status === 'completed')) {
      fail('a completed result appears after an incomplete result')
    }
    const effectiveEnd = range.offset + effectiveLength
    if (range.offset !== nextOffset || effectiveEnd <= range.offset) {
      fail('report ranges are not a contiguous completed prefix and must be retried')
    }

    const expected = manifest.lanes.historicalVerification.slice(range.offset, effectiveEnd)
    for (let index = 0; index < expected.length; index += 1) {
      const target = report.targets[index]
      const result = report.results[index]
      const item = expected[index]
      if (!equal(target, expectedTarget(item)) || result?.caseId !== item.id) {
        fail(`target identity or order drifted at ${range.offset + index}`)
      }
      if (result.status !== 'completed') {
        fail(`work ${item.id} did not complete and must be retried`)
      }
      const status = resultStatus(result)
      const trustedOutput = status !== 'manual_review'
      works.push({
        workId: item.id,
        title: item.title,
        authors: item.authors,
        publicationYear: item.publicationYear,
        identityFingerprint: item.identityFingerprint,
        status,
        classification: trustedOutput ? result.output.classification : 'unresolved',
        memberships:
          trustedOutput && result.output.classification === 'series'
            ? result.output.memberships.map(({ series, position, role }) => ({
                series,
                position,
                role,
              }))
            : [],
        selectedPass: result.selectedPass ?? 'first',
        provenance: {
          reportSha256: sha256,
          resultIndex: index,
          outputSha256: sha256Json(result.output ?? null),
        },
      })
    }

    const reportOperations = report.score?.operations ?? {}
    for (const key of Object.keys(operations)) {
      if (key === 'errors') continue
      operations[key] += Number(reportOperations[key] ?? 0)
    }
    inputReports.push({
      sha256,
      offset: range.offset,
      declaredEnd: range.end,
      effectiveEnd,
      truncatedIncomplete: range.end - effectiveEnd,
    })
    nextOffset = effectiveEnd
  }

  if (nextOffset !== manifest.counts.historicalVerification) {
    fail(`reports stop at ${nextOffset}; expected ${manifest.counts.historicalVerification}`)
  }
  operations.exaFallbackEstimatedCostUsd = Number(operations.exaFallbackEstimatedCostUsd.toFixed(6))
  const counts = {
    works: works.length,
    resolvedSeries: works.filter(({ status }) => status === 'resolved_series').length,
    resolvedStandalone: works.filter(({ status }) => status === 'resolved_standalone').length,
    manualReview: works.filter(({ status }) => status === 'manual_review').length,
    unresolved: works.filter(({ status }) => status === 'unresolved').length,
    exaSelected: works.filter(({ selectedPass }) => selectedPass === 'exa_fallback').length,
  }
  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_HISTORICAL_MERGE_PURPOSE,
    sourceManifest: {
      sha256: manifest.manifestSha256,
      sourceFrame: manifest.sourceFrame,
      historicalVerificationCount: manifest.counts.historicalVerification,
    },
    experiment: {
      model: 'gpt-5.6-luna',
      ...expectedExperiment,
      promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
      exaFallback: true,
    },
    inputReports,
    counts,
    operations,
    works,
    mutationBoundary: 'private_review_artifact_no_supabase_or_corpus_writer',
  }
}
