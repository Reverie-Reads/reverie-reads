import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decisionPacketCacheKey } from '../src/resolver/cache.mjs'

const packet = {
  schemaVersion: 1,
  caseId: 'book',
  target: { title: 'Second Book', authors: ['Ada Reader'] },
  identityEvidence: [
    {
      evidenceId: 'hardcover:identity',
      provider: 'hardcover',
      confidence: 'high',
      providerWorkId: 'edition-1',
      title: 'Second Book',
      authors: ['Ada Reader'],
      sourceLineage: { originProvider: 'hardcover', originEntityId: 'edition-1' },
    },
  ],
  membershipEvidence: [
    {
      evidenceId: 'hardcover:membership:0',
      provider: 'hardcover',
      evidenceKind: 'relational_membership',
      providerSeriesId: 'series-1',
      series: 'The Sequence',
      position: 2,
      memberCount: 3,
      orderType: 'unspecified',
      role: 'unknown',
      sourceRef: 'https://example.test/first',
      sourceLineage: { originProvider: 'hardcover', originEntityId: 'series-1' },
      quality: {
        sourceRole: 'high_coverage_supplement',
        dataUse: 'decision_input_pending_terms',
        membershipRule: 'independent_corroboration_required',
        positionRule: 'independent_corroboration_required',
        independentOriginCount: 1,
        corroboratingEvidenceIds: [],
        positionCorroboratingEvidenceIds: [],
        riskFlags: ['independent_corroboration_required', 'position_uncorroborated'],
        membershipEligible: false,
        positionEligible: false,
      },
    },
  ],
  providerProfiles: {
    hardcover: {
      sourceRole: 'high_coverage_supplement',
      membershipRule: 'independent_corroboration_required',
    },
  },
  providerErrors: [],
}

const key = (value) =>
  decisionPacketCacheKey({ model: 'test-model', promptVersion: 'test-prompt', packet: value })

test('reuses a decision when only provider storage identifiers or URLs drift', () => {
  const drifted = structuredClone(packet)
  drifted.identityEvidence[0].providerWorkId = 'edition-2'
  drifted.identityEvidence[0].sourceLineage.originEntityId = 'edition-2'
  drifted.membershipEvidence[0].providerSeriesId = 'series-2'
  drifted.membershipEvidence[0].sourceRef = 'https://example.test/second'
  drifted.membershipEvidence[0].sourceLineage.originEntityId = 'series-2'

  assert.equal(key(drifted), key(packet))
})

test('invalidates a decision when the claim or its eligibility changes', () => {
  const renamed = structuredClone(packet)
  renamed.membershipEvidence[0].series = 'A Different Sequence'
  assert.notEqual(key(renamed), key(packet))

  const quarantined = structuredClone(packet)
  quarantined.membershipEvidence[0].quality.membershipEligible = false
  quarantined.membershipEvidence[0].quality.riskFlags.push(
    'possible_companion_collection_not_series',
  )
  assert.notEqual(key(quarantined), key(packet))
})
