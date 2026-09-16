import { createHash } from 'node:crypto'
import {
  authorityPolicyForCase,
  buildAuthorityTarget,
  canonicalizeAuthorityAcquisition,
  validateAuthorityAcquisition,
} from './evidence.mjs'
import { normalize } from '../normalize.mjs'

export const CORPUS_SHADOW_REVIEW_PROMPT_VERSION = 'corpus-series-shadow-group-review-v1'
export const CORPUS_SHADOW_REVIEW_PURPOSE = 'corpus-series-shadow-luna-group-review'

const asArray = (value) => (Array.isArray(value) ? value : [])
const seriesKey = (value) => normalize(value).replace(/ (?:series|books)$/, '')
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right)

export const corpusShadowGroupTarget = (group) => ({
  schemaVersion: 1,
  groupId: group.groupId,
  proposedSeries: group.series,
  authors: [...group.authorScope],
  members: group.members.map((member) => ({
    caseId: member.workId,
    title: member.title,
    authors: [...group.authorScope],
    publicationYear: Number.isInteger(member.publicationYear) ? member.publicationYear : null,
    proposedPosition: Number.isFinite(member.proposedPosition) ? member.proposedPosition : null,
  })),
})

export const corpusShadowGroupCacheMaterial = (target, experiment) => ({
  promptVersion: CORPUS_SHADOW_REVIEW_PROMPT_VERSION,
  target,
  model: experiment.model,
  reasoningEffort: experiment.reasoningEffort,
  searchContextSize: experiment.searchContextSize,
  maxToolCalls: experiment.maxToolCalls,
})

export const corpusShadowGroupCacheKey = (target, experiment) =>
  createHash('sha256')
    .update(JSON.stringify(corpusShadowGroupCacheMaterial(target, experiment)))
    .digest('hex')

export function validateCorpusShadowReviewInput(report) {
  if (report?.schemaVersion !== 1 || report?.purpose !== 'corpus-series-shadow-merged-graph') {
    throw new Error('Input must be a complete merged corpus shadow graph')
  }
  const source = report.sourceFrame
  if (
    typeof source?.project !== 'string' ||
    !/^[a-f0-9]{64}$/.test(source?.sha256 ?? '') ||
    !Number.isInteger(source?.totalWorks) ||
    source.offset !== 0 ||
    source.end !== source.totalWorks
  ) {
    throw new Error('Merged corpus shadow graph does not cover its complete frozen frame')
  }
  const groups = report.candidateGraph?.candidateGroups
  if (
    !Array.isArray(groups) ||
    groups.length !== report.candidateGraph?.counts?.groupsRequiringModelReview ||
    groups.some(
      (group) =>
        typeof group?.groupId !== 'string' ||
        typeof group?.series !== 'string' ||
        !group.series.trim() ||
        !Array.isArray(group.authorScope) ||
        !group.authorScope.length ||
        !group.authorScope.every((author) => typeof author === 'string' && author.trim()) ||
        !Array.isArray(group.members) ||
        !group.members.length ||
        group.modelReview !== 'required',
    )
  ) {
    throw new Error('Merged corpus shadow graph has invalid review groups')
  }
  const groupIds = groups.map((group) => group.groupId)
  if (new Set(groupIds).size !== groupIds.length) {
    throw new Error('Merged corpus shadow graph has duplicate group IDs')
  }
  return report
}

export function finalizeCorpusShadowGroupReview(group, acquired) {
  const target = corpusShadowGroupTarget(group)
  if (acquired?.output?.groupId !== target.groupId || !Array.isArray(acquired.output.reviews)) {
    return {
      groupId: target.groupId,
      proposedSeries: target.proposedSeries,
      status: 'invalid',
      errors: ['group output does not match the target'],
      consultedUrls: asArray(acquired?.consultedUrls),
      reviews: [],
    }
  }
  const expected = new Map(target.members.map((member) => [member.caseId, member]))
  const seen = new Set()
  const errors = []
  const reviews = []

  for (const raw of acquired.output.reviews) {
    const member = expected.get(raw?.caseId)
    if (!member) {
      errors.push('group output contains a foreign member')
      continue
    }
    if (seen.has(member.caseId)) {
      errors.push(`group output duplicates member ${member.caseId}`)
      continue
    }
    seen.add(member.caseId)
    const testCase = {
      id: member.caseId,
      title: member.title,
      authors: member.authors,
      publicationYear: member.publicationYear,
    }
    const workTarget = buildAuthorityTarget(testCase)
    const policy = authorityPolicyForCase(testCase)
    const output = canonicalizeAuthorityAcquisition(raw, acquired.consultedUrls, policy)
    const validation = validateAuthorityAcquisition(
      workTarget,
      output,
      acquired.consultedUrls,
      policy,
    )
    const candidateMembership = asArray(output.memberships).find(
      (membership) => seriesKey(membership?.series) === seriesKey(target.proposedSeries),
    )
    reviews.push({
      caseId: member.caseId,
      title: member.title,
      proposedPosition: member.proposedPosition,
      candidateSupported: Boolean(
        validation.valid &&
        validation.policySafe &&
        output.classification === 'series' &&
        candidateMembership,
      ),
      authorityPosition: candidateMembership?.position ?? null,
      output,
      validation,
    })
  }

  for (const caseId of expected.keys()) {
    if (!seen.has(caseId)) errors.push(`group output omits member ${caseId}`)
  }
  reviews.sort(
    (left, right) =>
      target.members.findIndex((member) => member.caseId === left.caseId) -
      target.members.findIndex((member) => member.caseId === right.caseId),
  )
  const fullySupported =
    !errors.length &&
    reviews.length === target.members.length &&
    reviews.every((review) => review.candidateSupported)
  const allResolvedAgainstCandidate =
    !errors.length &&
    reviews.length === target.members.length &&
    reviews.every(
      (review) =>
        review.validation.valid &&
        review.validation.policySafe &&
        review.output.classification !== 'unresolved',
    ) &&
    reviews.every((review) => !review.candidateSupported)

  return {
    groupId: target.groupId,
    proposedSeries: target.proposedSeries,
    status: fullySupported
      ? 'supported'
      : allResolvedAgainstCandidate
        ? 'rejected'
        : errors.length
          ? 'invalid'
          : 'review',
    errors,
    consultedUrls: asArray(acquired.consultedUrls),
    searchedQueries: asArray(acquired.searchedQueries),
    reviews,
  }
}

export function buildCorpusShadowReviewReport({
  input,
  inputSha256,
  offset,
  end,
  experiment,
  results,
}) {
  const counts = {
    groups: results.length,
    supported: results.filter((result) => result.status === 'supported').length,
    rejected: results.filter((result) => result.status === 'rejected').length,
    review: results.filter((result) => result.status === 'review').length,
    invalid: results.filter((result) => result.status === 'invalid').length,
    errors: results.filter((result) => result.status === 'error').length,
    modelCalls: results.reduce(
      (total, result) => total + Number(result.billing?.modelCalls ?? 0),
      0,
    ),
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
  }
  return {
    schemaVersion: 1,
    purpose: CORPUS_SHADOW_REVIEW_PURPOSE,
    sourceFrame: input.sourceFrame,
    inputSha256,
    reviewRange: { offset, end, totalGroups: input.candidateGraph.candidateGroups.length },
    experiment,
    counts,
    results,
  }
}

export const sameCorpusShadowReviewExperiment = (left, right) => equal(left, right)
