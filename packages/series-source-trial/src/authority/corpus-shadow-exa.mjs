import { createHash } from 'node:crypto'
import { CORPUS_SHADOW_REVIEW_MERGED_PURPOSE } from './corpus-shadow-review-merge.mjs'

export const CORPUS_SHADOW_EXA_PURPOSE = 'corpus-series-shadow-exa-fallback'
export const CORPUS_SHADOW_EXA_CACHE_VERSION = 1

const asArray = (value) => (Array.isArray(value) ? value : [])
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export function validateCorpusShadowExaInputs(reviewReport, graphReport, graphSha256) {
  if (
    reviewReport?.schemaVersion !== 1 ||
    reviewReport?.purpose !== CORPUS_SHADOW_REVIEW_MERGED_PURPOSE ||
    !Array.isArray(reviewReport?.exaQueue?.items) ||
    !Array.isArray(reviewReport?.results)
  ) {
    throw new Error('Review input must be a complete merged Luna report')
  }
  if (
    graphReport?.schemaVersion !== 1 ||
    graphReport?.purpose !== 'corpus-series-shadow-merged-graph' ||
    !Array.isArray(graphReport?.candidateGraph?.candidateGroups)
  ) {
    throw new Error('Graph input must be a complete merged corpus shadow graph')
  }
  if (
    !/^[a-f0-9]{64}$/.test(graphSha256 ?? '') ||
    reviewReport.inputSha256 !== graphSha256 ||
    !equal(reviewReport.sourceFrame, graphReport.sourceFrame) ||
    reviewReport.reviewRange?.offset !== 0 ||
    reviewReport.reviewRange?.end !== reviewReport.reviewRange?.totalGroups ||
    reviewReport.reviewRange?.totalGroups !== graphReport.candidateGraph.candidateGroups.length
  ) {
    throw new Error('Merged Luna report does not match the frozen candidate graph')
  }
  return { reviewReport, graphReport }
}

export function buildCorpusShadowExaWorkQueue(reviewReport, graphReport) {
  const groups = new Map(
    graphReport.candidateGraph.candidateGroups.map((group) => [group.groupId, group]),
  )
  const results = new Map(reviewReport.results.map((result) => [result.groupId, result]))
  const works = new Map()

  for (const item of reviewReport.exaQueue.items) {
    if (!['unresolved', 'policy_quarantined'].includes(item?.reason)) {
      throw new Error('Exa queue contains an ineligible reason')
    }
    const group = groups.get(item.groupId)
    const result = results.get(item.groupId)
    const member = group?.members?.find((candidate) => candidate.workId === item.caseId)
    const review = result?.reviews?.find((candidate) => candidate.caseId === item.caseId)
    if (!group || !member || !review || result.status !== 'review') {
      throw new Error('Exa queue item does not match its Luna review and graph member')
    }
    const actuallyEligible =
      review.output?.classification === 'unresolved' ||
      (review.validation?.valid === true && review.validation?.policySafe !== true)
    if (!actuallyEligible) throw new Error('Exa queue item is not unresolved or policy-quarantined')

    const identity = {
      id: member.workId,
      title: member.title,
      authors: [...group.authorScope],
      publicationYear: Number.isInteger(member.publicationYear) ? member.publicationYear : null,
    }
    const existing = works.get(item.caseId)
    if (existing && !equal(existing.identity, identity)) {
      throw new Error(`Exa queue identity drifted for ${item.caseId}`)
    }
    const work = existing ?? {
      caseId: item.caseId,
      identity,
      reasons: [],
      groupIds: [],
      passes: [],
    }
    if (!work.reasons.includes(item.reason)) work.reasons.push(item.reason)
    if (!work.groupIds.includes(item.groupId)) work.groupIds.push(item.groupId)
    work.passes.push({
      output: review.output,
      validation: review.validation,
      consultedUrls: asArray(result.consultedUrls),
      searchedQueries: asArray(result.searchedQueries),
    })
    works.set(item.caseId, work)
  }

  return [...works.values()]
}

export function corpusShadowExaFirstPass(work) {
  if (!work?.passes?.length) throw new Error('Exa work requires at least one Luna pass')
  const baseline = work.passes[0]
  return {
    caseId: work.caseId,
    status: 'completed',
    output: baseline.output,
    validation: baseline.validation,
    consultedUrls: baseline.consultedUrls,
    searchedQueries: baseline.searchedQueries,
    authorityPassHistory: work.passes.map((pass) => ({
      output: pass.output,
      consultedUrls: pass.consultedUrls,
    })),
    cached: true,
    billing: { modelCalls: 0, webSearchCalls: 0, inputTokens: 0, outputTokens: 0 },
    usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
    modelCallCount: 0,
    latencyMs: 0,
    webSearchCalls: 0,
  }
}

export const corpusShadowExaCacheKey = (work, experiment, reviewSha256) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        cacheVersion: CORPUS_SHADOW_EXA_CACHE_VERSION,
        reviewSha256,
        identity: work.identity,
        reasons: work.reasons,
        groupIds: work.groupIds,
        passes: work.passes,
        experiment,
      }),
    )
    .digest('hex')

export function summarizeCorpusShadowExaResults(results) {
  const operations = results.map((result) => result.runExaOperations).filter(Boolean)
  return {
    works: results.length,
    selected: results.filter((result) => result.exaFallback?.selected).length,
    unresolved: results.filter((result) => !result.exaFallback?.selected).length,
    errors: results.filter(
      (result) =>
        result.status === 'error' ||
        result.exaFallback?.status === 'error' ||
        (result.exaFallback?.locator && result.exaFallback.locator.status !== 'completed'),
    ).length,
    cached: results.filter((result) => result.cached).length,
    exaRequests: operations.reduce((total, entry) => total + Number(entry.requests ?? 0), 0),
    exaEstimatedCostUsd: Number(
      operations
        .reduce((total, entry) => total + Number(entry.estimatedCostUsd ?? 0), 0)
        .toFixed(6),
    ),
    modelCalls: results.reduce(
      (total, result) => total + Number(result.runBilling?.modelCalls ?? 0),
      0,
    ),
    webSearchCalls: results.reduce(
      (total, result) => total + Number(result.runBilling?.webSearchCalls ?? 0),
      0,
    ),
    inputTokens: results.reduce(
      (total, result) => total + Number(result.runBilling?.inputTokens ?? 0),
      0,
    ),
    outputTokens: results.reduce(
      (total, result) => total + Number(result.runBilling?.outputTokens ?? 0),
      0,
    ),
  }
}

export function buildCorpusShadowExaReport({
  reviewReport,
  reviewSha256,
  graphSha256,
  offset,
  end,
  totalWorks,
  experiment,
  results,
}) {
  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_EXA_PURPOSE,
    sourceFrame: reviewReport.sourceFrame,
    reviewSha256,
    graphSha256,
    queueRange: { offset, end, totalWorks },
    experiment,
    counts: summarizeCorpusShadowExaResults(results),
    results,
  }
}
