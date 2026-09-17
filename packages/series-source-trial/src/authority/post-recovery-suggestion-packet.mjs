import { createHash } from 'node:crypto'

export const POST_RECOVERY_SUGGESTION_PACKET_PURPOSE =
  'post-recovery-authority-suggestion-staging-packet'
export const POST_RECOVERY_DECISIONS_PURPOSE = 'post-recovery-authority-reviewed-decisions'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const HASH_RE = /^[a-f0-9]{64}$/
const MD5_RE = /^[a-f0-9]{32}$/
const PROJECT_RE = /^[a-z0-9]{20}$/
const HTTPS_RE = /^https:\/\/[^\s]+$/
const sha256Json = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (message) => {
  throw new Error(`Invalid post-recovery suggestion packet: ${message}`)
}

const pendingRemovalIsSafe = (pending) =>
  pending === null ||
  (pending &&
    typeof pending === 'object' &&
    UUID_RE.test(pending.id ?? '') &&
    pending.proposalAction === 'remove' &&
    pending.source === 'corpus_shadow_authority_removal_review')

export function buildPostRecoverySuggestionPacket({
  project,
  authority,
  authoritySha256,
  comparison,
  comparisonSha256,
  decisions,
  decisionsSha256,
  liveRows,
  createdAt = new Date().toISOString(),
}) {
  if (!PROJECT_RE.test(project ?? '')) fail('project is invalid')
  if (
    authority?.evaluationPartition !== 'post_recovery_review' ||
    !UUID_RE.test(authority?.postRecoveryFrame?.sourceRunId ?? '') ||
    !HASH_RE.test(authoritySha256 ?? '') ||
    !Array.isArray(authority.results)
  ) {
    fail('authority report is invalid')
  }
  if (
    comparison?.schemaVersion !== 1 ||
    comparison?.purpose !== 'post-recovery-authority-comparison' ||
    comparison.sourceRunId !== authority.postRecoveryFrame.sourceRunId ||
    !HASH_RE.test(comparisonSha256 ?? '') ||
    !Array.isArray(comparison.comparisons)
  ) {
    fail('comparison does not match the authority report')
  }
  if (
    decisions?.schemaVersion !== 1 ||
    decisions?.purpose !== POST_RECOVERY_DECISIONS_PURPOSE ||
    decisions.project !== project ||
    decisions.sourceRunId !== authority.postRecoveryFrame.sourceRunId ||
    !Array.isArray(decisions.decisions) ||
    decisions.decisions.length < 1 ||
    decisions.decisions.length > 25 ||
    !HASH_RE.test(decisionsSha256 ?? '') ||
    !Array.isArray(liveRows)
  ) {
    fail('reviewed decisions or live baseline are invalid')
  }

  const authorityById = new Map(authority.results.map((result) => [result.caseId, result]))
  const comparisonById = new Map(comparison.comparisons.map((item) => [item.workId, item]))
  const liveById = new Map(liveRows.map((row) => [row.work_id, row]))
  if (
    authorityById.size !== authority.results.length ||
    comparisonById.size !== comparison.comparisons.length ||
    liveById.size !== liveRows.length
  ) {
    fail('an input contains duplicate work identities')
  }

  const stageable = decisions.decisions.map((decision) => {
    const workId = decision?.workId
    const series = typeof decision?.series === 'string' ? decision.series.trim() : ''
    const position = decision?.position == null ? null : Number(decision.position)
    const sourceUrl = typeof decision?.sourceUrl === 'string' ? decision.sourceUrl.trim() : ''
    const note = typeof decision?.note === 'string' ? decision.note.trim() : ''
    if (
      !UUID_RE.test(workId ?? '') ||
      !series ||
      series.length > 1000 ||
      (position !== null && (!Number.isFinite(position) || position <= 0 || position > 999999)) ||
      !HTTPS_RE.test(sourceUrl) ||
      sourceUrl.length > 2000 ||
      note.length < 8 ||
      note.length > 2000 ||
      decision.authorityFindingReviewed !== true ||
      decision.sourceIndependentlyVerified !== true
    ) {
      fail(`review decision is invalid for ${workId ?? 'unknown work'}`)
    }
    const authorityResult = authorityById.get(workId)
    if (
      authorityResult?.status !== 'completed' ||
      authorityResult?.validation?.valid !== true ||
      authorityResult?.validation?.policySafe !== true ||
      authorityResult?.output?.classification !== 'series'
    ) {
      fail(`authority result is not policy-safe series evidence for ${workId}`)
    }
    if (!comparisonById.has(workId)) fail(`comparison is missing ${workId}`)
    const live = liveById.get(workId)
    if (
      !live ||
      !MD5_RE.test(live.identity_fingerprint ?? '') ||
      !MD5_RE.test(live.series_fingerprint ?? '') ||
      !Number.isInteger(Number(live.review_revision)) ||
      Number(live.review_revision) < 0 ||
      !pendingRemovalIsSafe(live.pending_suggestion ?? null)
    ) {
      fail(`live baseline is unsafe or incomplete for ${workId}`)
    }
    const proposalCore = {
      workId,
      series,
      position,
      sourceUrl,
      note,
      authoritySha256,
      comparisonSha256,
      identityFingerprint: live.identity_fingerprint,
      expectedSeriesFingerprint: live.series_fingerprint,
      expectedReviewRevision: Number(live.review_revision),
      expectedPendingSuggestion: live.pending_suggestion ?? null,
    }
    return {
      workId,
      title: live.title,
      authors: live.author_text,
      identityFingerprint: live.identity_fingerprint,
      expectedSeriesFingerprint: live.series_fingerprint,
      expectedReviewRevision: Number(live.review_revision),
      expectedPendingSuggestion: live.pending_suggestion ?? null,
      proposal: {
        series,
        position,
        role: 'primary',
        sourceUrl,
        note,
        decisionSha256: sha256Json(proposalCore),
      },
    }
  })
  if (new Set(stageable.map(({ workId }) => workId)).size !== stageable.length) {
    fail('reviewed decisions contain duplicate works')
  }

  const core = {
    schemaVersion: 1,
    purpose: POST_RECOVERY_SUGGESTION_PACKET_PURPOSE,
    createdAt,
    project,
    sourceRunId: authority.postRecoveryFrame.sourceRunId,
    sources: {
      authoritySha256,
      comparisonSha256,
      decisionsSha256,
    },
    counts: {
      stageable: stageable.length,
      batches: Math.ceil(stageable.length / 25),
    },
    stageable,
    mutationBoundary: 'private_staging_packet_no_catalog_or_personal_writer',
  }
  return { ...core, packetSha256: sha256Json(core) }
}

export function validatePostRecoverySuggestionPacket(packet) {
  if (
    packet?.schemaVersion !== 1 ||
    packet?.purpose !== POST_RECOVERY_SUGGESTION_PACKET_PURPOSE ||
    !Number.isFinite(Date.parse(packet.createdAt ?? '')) ||
    !PROJECT_RE.test(packet.project ?? '') ||
    !UUID_RE.test(packet.sourceRunId ?? '') ||
    !HASH_RE.test(packet.sources?.authoritySha256 ?? '') ||
    !HASH_RE.test(packet.sources?.comparisonSha256 ?? '') ||
    !HASH_RE.test(packet.sources?.decisionsSha256 ?? '') ||
    !HASH_RE.test(packet.packetSha256 ?? '') ||
    !Array.isArray(packet.stageable) ||
    packet.stageable.length < 1 ||
    packet.stageable.length > 25 ||
    packet.counts?.stageable !== packet.stageable.length ||
    packet.counts?.batches !== Math.ceil(packet.stageable.length / 25)
  ) {
    fail('packet metadata or counts are invalid')
  }
  const ids = packet.stageable.map((item) => item.workId)
  if (
    new Set(ids).size !== ids.length ||
    packet.stageable.some(
      (item) =>
        !UUID_RE.test(item.workId ?? '') ||
        !MD5_RE.test(item.identityFingerprint ?? '') ||
        !MD5_RE.test(item.expectedSeriesFingerprint ?? '') ||
        !Number.isInteger(item.expectedReviewRevision) ||
        item.expectedReviewRevision < 0 ||
        !pendingRemovalIsSafe(item.expectedPendingSuggestion) ||
        item.proposal?.role !== 'primary' ||
        !item.proposal?.series?.trim() ||
        (item.proposal.position !== null &&
          (!Number.isFinite(item.proposal.position) || item.proposal.position <= 0)) ||
        !HTTPS_RE.test(item.proposal?.sourceUrl ?? '') ||
        typeof item.proposal?.note !== 'string' ||
        item.proposal.note.trim().length < 8 ||
        !HASH_RE.test(item.proposal?.decisionSha256 ?? ''),
    )
  ) {
    fail('packet items are invalid')
  }
  const core = { ...packet }
  delete core.packetSha256
  if (packet.packetSha256 !== sha256Json(core)) fail('packet hash does not match its contents')
  return packet
}
