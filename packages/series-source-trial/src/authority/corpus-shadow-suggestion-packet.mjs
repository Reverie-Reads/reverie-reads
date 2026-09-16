import { createHash } from 'node:crypto'

import { CORPUS_SHADOW_HISTORY_PURPOSE } from './corpus-shadow-history.mjs'
import { validateCorpusShadowReviewManifest } from './corpus-shadow-review-manifest.mjs'

export const CORPUS_SHADOW_SUGGESTION_PACKET_PURPOSE =
  'corpus-series-shadow-suggestion-staging-packet'

const sha256Json = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const fail = (message) => {
  throw new Error(`Invalid corpus shadow suggestion packet: ${message}`)
}

export function buildCorpusShadowSuggestionPacket({
  manifest,
  historical,
  historicalSha256,
  createdAt = new Date().toISOString(),
}) {
  validateCorpusShadowReviewManifest(manifest)
  if (
    historical?.schemaVersion !== 1 ||
    historical?.purpose !== CORPUS_SHADOW_HISTORY_PURPOSE ||
    historicalSha256 !== manifest.inputs.historicalSha256 ||
    historical.sourceFrame?.sha256 !== manifest.sourceFrame.sha256 ||
    historical.sourceFrame?.project !== manifest.sourceFrame.project ||
    historical.counts?.works !== manifest.counts.works ||
    !Array.isArray(historical.works) ||
    historical.works.length !== manifest.counts.works
  ) {
    fail('historical snapshot does not match the frozen manifest')
  }
  const historyById = new Map(historical.works.map((work) => [work.workId, work]))
  if (historyById.size !== historical.works.length) fail('historical snapshot has duplicate works')

  const stageable = []
  const removalReviews = []
  const manualReview = []
  for (const item of manifest.lanes.pendingSuggestions) {
    const history = historyById.get(item.id)
    if (
      !history ||
      history.identityFingerprint !== item.identityFingerprint ||
      !Array.isArray(history.pendingSuggestions) ||
      history.pendingSuggestions.length !== item.expectedBaseline.pendingSuggestionCount
    ) {
      fail(`historical baseline drifted for ${item.id}`)
    }
    const memberships = item.proposal.memberships
    const packetItem = {
      workId: item.id,
      title: item.title,
      authors: item.authors,
      identityFingerprint: item.identityFingerprint,
      action: item.action,
      expectedBaseline: item.expectedBaseline,
      expectedPendingSuggestions: history.pendingSuggestions,
      proposal: {
        series: memberships[0]?.series ?? null,
        position: memberships[0]?.position ?? null,
        role: memberships[0]?.role ?? null,
        decisionSha256: item.proposal.decisionSha256,
      },
    }
    if (memberships.length === 1 && memberships[0].role === 'primary') {
      stageable.push(packetItem)
    } else {
      manualReview.push({ ...packetItem, reason: 'primary_suggestion_schema_does_not_model_role' })
    }
  }

  for (const item of manifest.lanes.manualReview) {
    if (!['review_historical_authority', 'review_standalone_conflict'].includes(item.action)) {
      continue
    }
    const history = historyById.get(item.id)
    if (
      !history ||
      history.identityFingerprint !== item.identityFingerprint ||
      !Array.isArray(history.pendingSuggestions) ||
      history.pendingSuggestions.length !== item.expectedBaseline.pendingSuggestionCount
    ) {
      fail(`historical removal-review baseline drifted for ${item.id}`)
    }
    const current = item.expectedBaseline.currentMemberships
    if (
      current.length !== 1 ||
      current[0]?.role !== 'primary' ||
      !current[0]?.series?.trim() ||
      item.proposal.memberships.length !== 0
    ) {
      fail(`removal review is not one current primary with no replacement for ${item.id}`)
    }
    removalReviews.push({
      workId: item.id,
      title: item.title,
      authors: item.authors,
      identityFingerprint: item.identityFingerprint,
      action: item.action,
      expectedBaseline: item.expectedBaseline,
      expectedPendingSuggestions: history.pendingSuggestions,
      proposal: {
        action: 'remove',
        series: current[0].series,
        position: current[0].position ?? null,
        role: 'primary',
        decisionSha256: item.proposal.decisionSha256,
      },
    })
  }

  const core = {
    schemaVersion: 2,
    purpose: CORPUS_SHADOW_SUGGESTION_PACKET_PURPOSE,
    createdAt,
    project: manifest.sourceFrame.project,
    sourceManifest: {
      sha256: manifest.manifestSha256,
      historicalSha256,
    },
    counts: {
      resolvedDecisions: manifest.lanes.pendingSuggestions.length,
      stageable: stageable.length,
      removalReviews: removalReviews.length,
      manualReview: manualReview.length,
      batches: Math.ceil(stageable.length / 25) + Math.ceil(removalReviews.length / 25),
    },
    stageable,
    removalReviews,
    manualReview,
    mutationBoundary: 'private_staging_packet_no_supabase_or_corpus_writer',
  }
  return { ...core, packetSha256: sha256Json(core) }
}

export function validateCorpusShadowSuggestionPacket(packet) {
  if (
    packet?.schemaVersion !== 2 ||
    packet?.purpose !== CORPUS_SHADOW_SUGGESTION_PACKET_PURPOSE ||
    !Number.isFinite(Date.parse(packet.createdAt ?? '')) ||
    !/^[a-z0-9]{20}$/.test(packet.project ?? '') ||
    !/^[a-f0-9]{64}$/.test(packet.sourceManifest?.sha256 ?? '') ||
    !/^[a-f0-9]{64}$/.test(packet.sourceManifest?.historicalSha256 ?? '') ||
    !Array.isArray(packet.stageable) ||
    !Array.isArray(packet.removalReviews) ||
    !Array.isArray(packet.manualReview)
  ) {
    fail('packet metadata is invalid')
  }
  const represented = [...packet.stageable, ...packet.removalReviews, ...packet.manualReview]
  const ids = represented.map(({ workId }) => workId)
  if (
    new Set(ids).size !== ids.length ||
    packet.counts?.resolvedDecisions !== packet.stageable.length + packet.manualReview.length ||
    packet.counts?.stageable !== packet.stageable.length ||
    packet.counts?.removalReviews !== packet.removalReviews.length ||
    packet.counts?.manualReview !== packet.manualReview.length ||
    packet.counts?.batches !==
      Math.ceil(packet.stageable.length / 25) + Math.ceil(packet.removalReviews.length / 25) ||
    packet.stageable.some(
      (item) =>
        item.proposal?.role !== 'primary' ||
        !item.proposal?.series?.trim() ||
        !/^[a-f0-9]{32}$/.test(item.identityFingerprint ?? '') ||
        !/^[a-f0-9]{64}$/.test(item.proposal?.decisionSha256 ?? ''),
    ) ||
    packet.removalReviews.some(
      (item) =>
        !['review_historical_authority', 'review_standalone_conflict'].includes(item.action) ||
        item.proposal?.action !== 'remove' ||
        item.proposal?.role !== 'primary' ||
        !item.proposal?.series?.trim() ||
        !/^[a-f0-9]{32}$/.test(item.identityFingerprint ?? '') ||
        !/^[a-f0-9]{64}$/.test(item.proposal?.decisionSha256 ?? ''),
    )
  ) {
    fail('packet items or counts are invalid')
  }
  const core = { ...packet }
  delete core.packetSha256
  if (packet.packetSha256 !== sha256Json(core)) fail('packet hash does not match its contents')
  return packet
}
