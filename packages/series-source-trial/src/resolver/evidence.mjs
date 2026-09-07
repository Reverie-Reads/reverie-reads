import { normalize } from '../normalize.mjs'
import { scoreProvider } from '../score.mjs'
import { gradeMembershipEvidence, providerProfile } from './clean.mjs'

const confidenceValues = new Set(['high', 'medium', 'low', 'none'])
const decisions = new Set(['accept_membership', 'review', 'abstain'])
const orderTypes = new Set(['publication', 'recommended', 'narrative', 'unspecified'])
const roles = new Set(['primary', 'secondary', 'universe', 'unknown'])
const reviewReasons = new Set([
  'identity_conflict',
  'membership_conflict',
  'position_conflict',
  'series_role_unclear',
  'singleton_only',
  'insufficient_evidence',
  'source_requires_corroboration',
  'possible_universe_relation',
  'possible_reading_order_relation',
  'self_titled_relation',
  'position_uncorroborated',
])
const nonMembershipBlockingReviewReasons = new Set([
  'position_conflict',
  'position_uncorroborated',
  'series_role_unclear',
])

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const asArray = (value) => (Array.isArray(value) ? value : [])

export function buildEvidencePacket(testCase, runs) {
  const identityEvidence = []
  const membershipEvidence = []
  const providerErrors = []

  for (const run of runs) {
    const result = run.results?.find((entry) => entry.caseId === testCase.id)
    if (!result) continue
    if (result.error) providerErrors.push({ provider: run.provider, error: result.error })

    if (result.workMatch?.matched) {
      identityEvidence.push({
        evidenceId: `${run.provider}:identity`,
        provider: run.provider,
        confidence: result.workMatch.confidence,
        providerWorkId: result.workMatch.providerWorkId ?? null,
        title: result.workMatch.matchedTitle ?? null,
        authors: result.workMatch.matchedAuthors ?? [],
        sourceLineage: result.workMatch.sourceLineage ?? null,
      })
    }

    for (const [claimIndex, claim] of asArray(result.seriesClaims).entries()) {
      if (typeof claim.series !== 'string' || !claim.series.trim()) continue
      membershipEvidence.push({
        evidenceId: `${run.provider}:membership:${claimIndex}`,
        provider: run.provider,
        evidenceKind: claim.evidenceKind,
        providerSeriesId: claim.providerSeriesId ?? null,
        series: claim.series,
        position: claim.position ?? null,
        memberCount: claim.memberCount ?? null,
        orderType: claim.orderType ?? 'unspecified',
        role: claim.role ?? 'unknown',
        sourceRef: claim.sourceRef ?? null,
        sourceLineage: claim.sourceLineage ?? null,
        ...(claim.sourceKind ? { sourceKind: claim.sourceKind } : {}),
        ...(claim.evidenceSummary ? { evidenceSummary: claim.evidenceSummary } : {}),
        ...(claim.authorityPass ? { authorityPass: claim.authorityPass } : {}),
      })
    }
  }

  const target = { title: testCase.title, authors: testCase.authors }
  return {
    schemaVersion: 1,
    caseId: testCase.id,
    target,
    identityEvidence,
    membershipEvidence: gradeMembershipEvidence(target, membershipEvidence, identityEvidence),
    providerProfiles: Object.fromEntries(
      [...new Set(runs.map((run) => run.provider))].map((provider) => [
        provider,
        providerProfile(provider),
      ]),
    ),
    providerErrors,
  }
}

const validateShape = (packet, output, errors) => {
  if (!isObject(output)) {
    errors.push('output must be an object')
    return
  }
  if (output.caseId !== packet.caseId) errors.push('caseId does not match the evidence packet')
  if (!decisions.has(output.decision)) errors.push('decision is invalid')
  if (!isObject(output.identity)) errors.push('identity must be an object')
  if (!Array.isArray(output.memberships)) errors.push('memberships must be an array')
  if (!Array.isArray(output.reviewReasons)) errors.push('reviewReasons must be an array')
  for (const reason of asArray(output.reviewReasons)) {
    if (!reviewReasons.has(reason)) errors.push(`review reason ${reason} is invalid`)
  }
  if (output.decision === 'review' && asArray(output.reviewReasons).length === 0) {
    errors.push('review requires at least one review reason')
  }
  if (typeof output.note !== 'string' || output.note.length > 240) {
    errors.push('note must be a string of at most 240 characters')
  }
}

export function validateResolution(packet, output) {
  const errors = []
  const policyViolations = []
  validateShape(packet, output, errors)
  if (errors.length) {
    return {
      valid: false,
      policySafe: false,
      errors,
      policyViolations,
      citedEvidenceCount: 0,
      validEvidenceCitationCount: 0,
      unsupportedMembershipCount: 0,
    }
  }

  const identities = new Map(packet.identityEvidence.map((entry) => [entry.evidenceId, entry]))
  const memberships = new Map(packet.membershipEvidence.map((entry) => [entry.evidenceId, entry]))
  let citedEvidenceCount = 0
  let validEvidenceCitationCount = 0
  let unsupportedMembershipCount = 0

  const identity = output.identity
  if (typeof identity.matched !== 'boolean') errors.push('identity.matched must be boolean')
  if (!confidenceValues.has(identity.confidence)) errors.push('identity.confidence is invalid')
  if (!Array.isArray(identity.evidenceIds)) errors.push('identity.evidenceIds must be an array')
  const identityEvidenceIds = asArray(identity.evidenceIds)
  for (const evidenceId of identityEvidenceIds) {
    citedEvidenceCount += 1
    if (identities.has(evidenceId)) validEvidenceCitationCount += 1
    else errors.push(`identity cites unknown evidence ${evidenceId}`)
  }
  if (identity.matched && !identityEvidenceIds.length) {
    errors.push('a matched identity requires evidence')
  }
  if (!identity.matched && identityEvidenceIds.length) {
    errors.push('an unmatched identity cannot cite matched evidence')
  }

  for (const [index, proposed] of output.memberships.entries()) {
    if (!isObject(proposed)) {
      errors.push(`membership ${index} must be an object`)
      unsupportedMembershipCount += 1
      continue
    }
    if (typeof proposed.series !== 'string' || !proposed.series.trim()) {
      errors.push(`membership ${index} has no series`)
    }
    if (proposed.position !== null && !Number.isFinite(proposed.position)) {
      errors.push(`membership ${index} position is invalid`)
    }
    if (!orderTypes.has(proposed.orderType)) errors.push(`membership ${index} orderType is invalid`)
    if (!roles.has(proposed.role)) errors.push(`membership ${index} role is invalid`)
    if (!['high', 'medium', 'low'].includes(proposed.confidence)) {
      errors.push(`membership ${index} confidence is invalid`)
    }
    if (!Array.isArray(proposed.evidenceIds) || !proposed.evidenceIds.length) {
      errors.push(`membership ${index} requires evidence`)
      unsupportedMembershipCount += 1
      continue
    }

    const cited = []
    for (const evidenceId of proposed.evidenceIds) {
      citedEvidenceCount += 1
      const evidence = memberships.get(evidenceId)
      if (evidence) {
        cited.push(evidence)
        validEvidenceCitationCount += 1
      } else {
        errors.push(`membership ${index} cites unknown evidence ${evidenceId}`)
      }
    }
    const sameSeries = cited.filter(
      (evidence) => normalize(evidence.series) === normalize(proposed.series),
    )
    if (!sameSeries.length) {
      errors.push(`membership ${index} series is unsupported by its evidence`)
      unsupportedMembershipCount += 1
      continue
    }
    if (proposed.position !== null) {
      const positionSupported = sameSeries.some(
        (evidence) =>
          evidence.position !== null && Number(evidence.position) === Number(proposed.position),
      )
      if (!positionSupported) {
        errors.push(`membership ${index} position is unsupported by its evidence`)
        unsupportedMembershipCount += 1
      }
    }
    if (
      proposed.orderType !== 'unspecified' &&
      !sameSeries.some((evidence) => evidence.orderType === proposed.orderType)
    ) {
      errors.push(`membership ${index} orderType is unsupported by its evidence`)
      unsupportedMembershipCount += 1
    }
    if (
      proposed.role !== 'unknown' &&
      !sameSeries.some((evidence) => evidence.role === proposed.role)
    ) {
      errors.push(`membership ${index} role is unsupported by its evidence`)
      unsupportedMembershipCount += 1
    }

    if (output.decision === 'accept_membership') {
      const eligible = sameSeries.filter((evidence) => evidence.quality?.membershipEligible)
      if (!eligible.length) {
        const risks = [
          ...new Set(sameSeries.flatMap((evidence) => evidence.quality?.riskFlags ?? [])),
        ]
        policyViolations.push(
          `membership ${index} is not eligible after source cleaning${
            risks.length ? `: ${risks.join(', ')}` : ''
          }`,
        )
      }
      const positions = new Set(
        eligible
          .map((evidence) => evidence.position)
          .filter((position) => position !== null)
          .map(Number),
      )
      if (
        proposed.position !== null &&
        !sameSeries.some(
          (evidence) =>
            evidence.quality?.positionEligible &&
            Number(evidence.position) === Number(proposed.position),
        )
      ) {
        policyViolations.push(`membership ${index} position is not eligible after source cleaning`)
      } else if (proposed.position !== null && positions.size > 1) {
        policyViolations.push(`membership ${index} has a position conflict`)
      }
    }
  }

  if (output.decision === 'accept_membership') {
    if (!identity.matched) policyViolations.push('accept_membership requires a matched identity')
    if (
      !identityEvidenceIds.some((evidenceId) =>
        ['high', 'medium'].includes(identities.get(evidenceId)?.confidence),
      )
    ) {
      policyViolations.push('accept_membership requires high or medium identity evidence')
    }
    if (!output.memberships.length) policyViolations.push('accept_membership requires a membership')
    const distinctSeries = new Set(
      packet.membershipEvidence
        .filter((entry) => entry.quality?.membershipEligible)
        .map((entry) => normalize(entry.series)),
    )
    if (distinctSeries.size > 1) {
      policyViolations.push('multiple distinct series relationships require review')
    }
  }
  if (output.decision === 'abstain' && output.memberships.length) {
    errors.push('abstain cannot return memberships')
  }

  return {
    valid: errors.length === 0,
    policySafe:
      errors.length === 0 &&
      policyViolations.length === 0 &&
      output.decision === 'accept_membership',
    errors,
    policyViolations,
    citedEvidenceCount,
    validEvidenceCitationCount,
    unsupportedMembershipCount,
  }
}

export function canonicalizeResolutionDecision(packet, output) {
  if (!isObject(output)) return output

  if (output.decision === 'abstain' && asArray(output.memberships).length) {
    return { ...output, memberships: [] }
  }

  if (output.decision !== 'review') return output

  const reasons = asArray(output.reviewReasons)
  const memberships = asArray(output.memberships)
  if (
    reasons.length === 0 ||
    !memberships.length ||
    !reasons.every((reason) => nonMembershipBlockingReviewReasons.has(reason)) ||
    memberships.some((membership) => membership?.position !== null)
  ) {
    return output
  }

  const accepted = { ...output, decision: 'accept_membership' }
  return validateResolution(packet, accepted).policySafe ? accepted : output
}

const safeClaims = (packet, resolution) => {
  if (!resolution.validation?.policySafe) return []
  const evidence = new Map(packet.membershipEvidence.map((entry) => [entry.evidenceId, entry]))
  const dataUsePriority = new Map([
    ['durable_cc0', 0],
    ['trial_pending_rights_review', 1],
    ['trial_authority_claim_pending_rights', 2],
    ['decision_input_pending_terms', 3],
    ['trial_authority_candidate_pending_review', 4],
    ['blocked_pending_profile', 5],
  ])
  return resolution.output.memberships.map((membership) => {
    const cited = membership.evidenceIds.map((id) => evidence.get(id)).filter(Boolean)
    const first =
      cited
        .filter((entry) => entry.quality?.membershipEligible)
        .sort(
          (left, right) =>
            (dataUsePriority.get(left.quality?.dataUse) ?? 99) -
            (dataUsePriority.get(right.quality?.dataUse) ?? 99),
        )[0] ?? cited[0]
    return {
      evidenceKind: 'relational_membership',
      providerSeriesId: first?.providerSeriesId ?? null,
      series: membership.series,
      position: membership.position,
      orderType: membership.orderType,
      role: membership.role,
      sourceRef: first?.sourceRef ?? null,
      sourceLineage: first?.sourceLineage ?? null,
      sourceDataUse: first?.quality?.dataUse ?? 'blocked_pending_profile',
    }
  })
}

export function scoreResolutionRun(caseSet, packets, resolutions, policy, model) {
  const packetById = new Map(packets.map((packet) => [packet.caseId, packet]))
  const results = resolutions.map((resolution) => {
    const packet = packetById.get(resolution.caseId)
    const completed = resolution.status === 'completed' && resolution.validation?.valid
    return {
      caseId: resolution.caseId,
      latencyMs: resolution.latencyMs ?? null,
      workMatch: {
        matched: Boolean(completed && resolution.output.identity.matched),
        confidence: completed ? resolution.output.identity.confidence : 'none',
      },
      seriesClaims: completed ? safeClaims(packet, resolution) : [],
      ...(resolution.error ? { error: resolution.error } : {}),
    }
  })
  const acceptedClaims = results.flatMap((result) => result.seriesClaims)
  const allAcceptedClaimsDurable =
    acceptedClaims.length > 0 &&
    acceptedClaims.every((claim) => claim.sourceDataUse === 'durable_cc0')
  const providerScore = scoreProvider(
    caseSet,
    {
      provider: `resolver:${model}`,
      observedAt: new Date().toISOString(),
      rights: {
        commercialUsePermitted: allAcceptedClaimsDurable ? true : null,
        persistentStoragePermitted: allAcceptedClaimsDurable ? true : null,
        claimLevelProvenance: acceptedClaims.every((claim) => Boolean(claim.sourceRef)),
        note: 'Resolver output inherits the selected evidence source data-use boundary.',
      },
      results,
    },
    policy,
  )
  const completed = resolutions.filter((entry) => entry.status === 'completed')
  const citations = completed.reduce(
    (total, entry) => total + (entry.validation?.citedEvidenceCount ?? 0),
    0,
  )
  const validCitations = completed.reduce(
    (total, entry) => total + (entry.validation?.validEvidenceCitationCount ?? 0),
    0,
  )

  return {
    schemaVersion: 1,
    model,
    cases: resolutions.length,
    completed: completed.length,
    validResponses: completed.filter((entry) => entry.validation?.valid).length,
    policySafeProposals: completed.filter((entry) => entry.validation?.policySafe).length,
    reviewDecisions: completed.filter((entry) => entry.output?.decision === 'review').length,
    abstentions: completed.filter((entry) => entry.output?.decision === 'abstain').length,
    unsupportedMembershipCount: completed.reduce(
      (total, entry) => total + (entry.validation?.unsupportedMembershipCount ?? 0),
      0,
    ),
    policyViolationCount: completed.reduce(
      (total, entry) => total + (entry.validation?.policyViolations?.length ?? 0),
      0,
    ),
    citationFaithfulness: citations ? validCitations / citations : null,
    autoFillAccuracy: providerScore,
  }
}
