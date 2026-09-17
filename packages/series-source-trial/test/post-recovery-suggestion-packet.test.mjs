import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPostRecoverySuggestionPacket,
  validatePostRecoverySuggestionPacket,
} from '../src/authority/post-recovery-suggestion-packet.mjs'

const workId = '11111111-1111-4111-8111-111111111111'
const sourceRunId = '22222222-2222-4222-8222-222222222222'
const project = 'abcdefghijklmnopqrst'
const authority = {
  evaluationPartition: 'post_recovery_review',
  postRecoveryFrame: { sourceRunId },
  results: [
    {
      caseId: workId,
      status: 'completed',
      validation: { valid: true, policySafe: true },
      output: {
        classification: 'series',
        memberships: [{ series: 'New Saga', position: 3 }],
      },
    },
  ],
}
const comparison = {
  schemaVersion: 1,
  purpose: 'post-recovery-authority-comparison',
  sourceRunId,
  comparisons: [{ workId, disposition: 'series_conflict' }],
}
const decisions = {
  schemaVersion: 1,
  purpose: 'post-recovery-authority-reviewed-decisions',
  project,
  sourceRunId,
  decisions: [
    {
      workId,
      series: 'New Saga',
      position: 3,
      sourceUrl: 'https://publisher.example/series/new-saga',
      note: 'The publisher series page lists this exact work as volume three.',
      authorityFindingReviewed: true,
      sourceIndependentlyVerified: true,
    },
  ],
}
const removal = {
  id: '33333333-3333-4333-8333-333333333333',
  proposalAction: 'remove',
  series: 'Old Saga',
  position: 1,
  source: 'corpus_shadow_authority_removal_review',
  stagingManifestSha256: 'd'.repeat(64),
  stagingProposalSha256: 'e'.repeat(64),
}
const liveRows = [
  {
    work_id: workId,
    title: 'Exact Work',
    author_text: 'Exact Writer',
    identity_fingerprint: 'a'.repeat(32),
    series_fingerprint: 'b'.repeat(32),
    review_revision: 4,
    pending_suggestion: removal,
  },
]
const input = (patch = {}) => ({
  project,
  authority,
  authoritySha256: '1'.repeat(64),
  comparison,
  comparisonSha256: '2'.repeat(64),
  decisions,
  decisionsSha256: '3'.repeat(64),
  liveRows,
  createdAt: '2026-09-17T12:00:00.000Z',
  ...patch,
})

test('builds a hash-bound packet without accepting or writing a proposal', () => {
  const packet = buildPostRecoverySuggestionPacket(input())
  assert.equal(packet.purpose, 'post-recovery-authority-suggestion-staging-packet')
  assert.equal(packet.counts.stageable, 1)
  assert.deepEqual(packet.stageable[0].expectedPendingSuggestion, removal)
  assert.equal(packet.stageable[0].proposal.series, 'New Saga')
  assert.equal(packet.stageable[0].proposal.position, 3)
  assert.match(packet.stageable[0].proposal.decisionSha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(validatePostRecoverySuggestionPacket(packet), packet)
})

test('refuses to displace an ordinary pending suggestion', () => {
  assert.throws(
    () =>
      buildPostRecoverySuggestionPacket(
        input({
          liveRows: [
            {
              ...liveRows[0],
              pending_suggestion: {
                ...removal,
                proposalAction: 'set',
                source: 'hardcover',
              },
            },
          ],
        }),
      ),
    /live baseline is unsafe/,
  )
})

test('requires policy-safe model output plus explicit independent human verification', () => {
  assert.throws(
    () =>
      buildPostRecoverySuggestionPacket(
        input({
          authority: {
            ...authority,
            results: [{ ...authority.results[0], validation: { valid: true, policySafe: false } }],
          },
        }),
      ),
    /not policy-safe series evidence/,
  )
  assert.throws(
    () =>
      buildPostRecoverySuggestionPacket(
        input({
          decisions: {
            ...decisions,
            decisions: [{ ...decisions.decisions[0], sourceIndependentlyVerified: false }],
          },
        }),
      ),
    /review decision is invalid/,
  )
})

test('detects packet tampering', () => {
  const packet = buildPostRecoverySuggestionPacket(input())
  assert.throws(
    () =>
      validatePostRecoverySuggestionPacket({
        ...packet,
        stageable: [
          {
            ...packet.stageable[0],
            proposal: { ...packet.stageable[0].proposal, position: 4 },
          },
        ],
      }),
    /hash does not match/,
  )
})
