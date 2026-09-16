import { createHash } from 'node:crypto'
import { normalize } from '../normalize.mjs'
import {
  buildCorpusShadowExaWorkQueue,
  summarizeCorpusShadowExaResults,
  validateCorpusShadowExaInputs,
} from './corpus-shadow-exa.mjs'
import { CORPUS_SHADOW_EXA_MERGED_PURPOSE } from './corpus-shadow-exa-merge.mjs'

export const CORPUS_SHADOW_RECONCILIATION_PURPOSE = 'corpus-series-shadow-authority-reconciliation'

const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)
const asArray = (value) => (Array.isArray(value) ? value : [])
const sha256Json = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const safeAuthorityOutput = (output, validation) =>
  validation?.valid === true &&
  validation?.policySafe === true &&
  ['series', 'standalone'].includes(output?.classification)

const proposalFor = ({ stage, groupId = null, output, validation }) => {
  if (!safeAuthorityOutput(output, validation)) return null
  return {
    stage,
    groupId,
    classification: output.classification,
    memberships: asArray(output.memberships).map((membership) => ({
      series: String(membership?.series ?? '').trim(),
      position: Number.isFinite(membership?.position) ? Number(membership.position) : null,
      role: String(membership?.role ?? 'unknown'),
    })),
    outputSha256: sha256Json(output),
  }
}

const seriesDecision = (proposals) => {
  const membershipSets = proposals.map((proposal) =>
    [...new Set(proposal.memberships.map((membership) => normalize(membership.series)))].sort(),
  )
  if (
    membershipSets.some((keys) => !keys.length) ||
    membershipSets.some((keys) => !equal(keys, membershipSets[0]))
  ) {
    return { status: 'manual_review', reason: 'authority_membership_conflict' }
  }

  const memberships = []
  for (const seriesKey of membershipSets[0]) {
    const observations = proposals.flatMap((proposal) =>
      proposal.memberships.filter((membership) => normalize(membership.series) === seriesKey),
    )
    const positions = [
      ...new Set(observations.map(({ position }) => position).filter(Number.isFinite)),
    ]
    const roles = [
      ...new Set(observations.map(({ role }) => role).filter((role) => role && role !== 'unknown')),
    ]
    if (positions.length > 1 || roles.length > 1) {
      return {
        status: 'manual_review',
        reason: positions.length > 1 ? 'authority_position_conflict' : 'authority_role_conflict',
      }
    }
    memberships.push({
      series: observations[0].series,
      position: positions[0] ?? null,
      role: roles[0] ?? 'unknown',
    })
  }
  memberships.sort((left, right) => normalize(left.series).localeCompare(normalize(right.series)))
  return { status: 'resolved_series', classification: 'series', memberships }
}

const reconcileProposals = (proposals) => {
  const classifications = [...new Set(proposals.map(({ classification }) => classification))]
  if (classifications.length !== 1) {
    return { status: 'manual_review', reason: 'authority_classification_conflict' }
  }
  if (classifications[0] === 'standalone') {
    return { status: 'resolved_standalone', classification: 'standalone', memberships: [] }
  }
  return seriesDecision(proposals)
}

export function validateCorpusShadowReconciliationInputs({
  graph,
  graphSha256,
  review,
  reviewSha256,
  exa,
}) {
  validateCorpusShadowExaInputs(review, graph, graphSha256)
  if (
    exa?.schemaVersion !== 1 ||
    exa?.purpose !== CORPUS_SHADOW_EXA_MERGED_PURPOSE ||
    exa.graphSha256 !== graphSha256 ||
    exa.reviewSha256 !== reviewSha256 ||
    !equal(exa.sourceFrame, graph.sourceFrame) ||
    exa.queueRange?.offset !== 0 ||
    exa.queueRange?.end !== exa.queueRange?.totalWorks ||
    !Array.isArray(exa.results) ||
    !equal(exa.counts, summarizeCorpusShadowExaResults(exa.results))
  ) {
    throw new Error('Exa input must be the complete fallback for the frozen Luna review')
  }

  const cases = graph.caseSet?.cases
  if (
    !Array.isArray(cases) ||
    cases.length !== graph.sourceFrame.totalWorks ||
    new Set(cases.map(({ id }) => id)).size !== cases.length
  ) {
    throw new Error('Graph case inventory does not reconcile')
  }
  const graphGroupIds = graph.candidateGraph.candidateGroups.map(({ groupId }) => groupId)
  const reviewGroupIds = review.results.map(({ groupId }) => groupId)
  if (!equal(graphGroupIds, reviewGroupIds)) {
    throw new Error('Luna results do not match the candidate-group order')
  }

  const queue = buildCorpusShadowExaWorkQueue(review, graph)
  const expectedExaIds = queue.map(({ caseId }) => caseId)
  const actualExaIds = exa.results.map(({ caseId }) => caseId)
  if (!equal(actualExaIds, expectedExaIds)) {
    throw new Error('Exa results do not match the complete unique-work queue')
  }
  return { graph, review, exa }
}

export function reconcileCorpusShadowDecisions({ graph, review, exa }) {
  const cases = graph.caseSet.cases
  const groupsByWork = new Map(cases.map(({ id }) => [id, []]))
  for (const group of graph.candidateGraph.candidateGroups) {
    for (const member of group.members) groupsByWork.get(member.workId)?.push(group.groupId)
  }

  const proposalsByWork = new Map(cases.map(({ id }) => [id, []]))
  const safelyReviewedGroupsByWork = new Map(cases.map(({ id }) => [id, new Set()]))
  for (const result of review.results) {
    for (const memberReview of asArray(result.reviews)) {
      const proposal = proposalFor({
        stage: 'luna',
        groupId: result.groupId,
        output: memberReview.output,
        validation: memberReview.validation,
      })
      if (!proposal) continue
      proposalsByWork.get(memberReview.caseId)?.push(proposal)
      safelyReviewedGroupsByWork.get(memberReview.caseId)?.add(result.groupId)
    }
  }

  const exaSelected = new Set()
  for (const result of exa.results) {
    if (result.exaFallback?.selected !== true) continue
    const proposal = proposalFor({
      stage: 'exa_luna',
      output: result.exaFallback.search?.output,
      validation: result.exaFallback.search?.validation,
    })
    if (!proposal) {
      throw new Error(`Selected Exa fallback is not policy-safe for ${result.caseId}`)
    }
    proposalsByWork.get(result.caseId)?.push(proposal)
    exaSelected.add(result.caseId)
  }

  const works = cases.map((testCase) => {
    const candidateGroupIds = groupsByWork.get(testCase.id) ?? []
    const proposals = proposalsByWork.get(testCase.id) ?? []
    const safelyReviewed = safelyReviewedGroupsByWork.get(testCase.id) ?? new Set()
    let decision

    if (!proposals.length) {
      decision = {
        status: 'unresolved',
        reason: candidateGroupIds.length
          ? 'no_policy_safe_authority_resolution'
          : 'no_relational_source_candidate',
      }
    } else if (
      !exaSelected.has(testCase.id) &&
      candidateGroupIds.some((groupId) => !safelyReviewed.has(groupId))
    ) {
      decision = { status: 'manual_review', reason: 'unresolved_competing_candidate' }
    } else {
      decision = reconcileProposals(proposals)
    }

    return {
      workId: testCase.id,
      title: testCase.title,
      authors: testCase.authors,
      publicationYear: testCase.publicationYear,
      identityFingerprint: testCase.identityFingerprint,
      candidateGroupIds,
      ...decision,
      provenance: proposals.map(({ stage, groupId, outputSha256 }) => ({
        stage,
        groupId,
        outputSha256,
      })),
    }
  })

  const counts = {
    works: works.length,
    resolvedSeries: works.filter(({ status }) => status === 'resolved_series').length,
    resolvedStandalone: works.filter(({ status }) => status === 'resolved_standalone').length,
    manualReview: works.filter(({ status }) => status === 'manual_review').length,
    unresolved: works.filter(({ status }) => status === 'unresolved').length,
    exaSelected: exaSelected.size,
  }
  if (
    counts.resolvedSeries + counts.resolvedStandalone + counts.manualReview + counts.unresolved !==
    counts.works
  ) {
    throw new Error('Reconciled work counts do not sum to the frozen inventory')
  }

  return { counts, works }
}

export function buildCorpusShadowReconciliation({
  graph,
  graphSha256,
  review,
  reviewSha256,
  exa,
  exaSha256,
}) {
  validateCorpusShadowReconciliationInputs({ graph, graphSha256, review, reviewSha256, exa })
  const reconciled = reconcileCorpusShadowDecisions({ graph, review, exa })
  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_RECONCILIATION_PURPOSE,
    sourceFrame: graph.sourceFrame,
    inputs: { graphSha256, reviewSha256, exaSha256 },
    ...reconciled,
    mutationBoundary: 'review_only_no_supabase_or_corpus_writer',
  }
}
