import assert from 'node:assert/strict'
import test from 'node:test'
import { compareAuthorityResultToSuggestion } from '../src/authority/post-recovery-compare.mjs'

const suggestion = (patch = {}) => ({
  proposed_series: 'Fae Isles',
  proposed_position: 2,
  proposed_count: null,
  ...patch,
})
const result = (patch = {}) => ({
  status: 'completed',
  validation: { valid: true, policySafe: true },
  output: {
    classification: 'series',
    memberships: [{ series: 'Fae Isles', position: 2 }],
  },
  ...patch,
})

test('corroborates only the exact proposed tuple', () => {
  assert.deepEqual(compareAuthorityResultToSuggestion(result(), suggestion()), {
    disposition: 'corroborated_exact_tuple',
  })
})

test('keeps missing, conflicting, and count evidence in review', () => {
  assert.equal(
    compareAuthorityResultToSuggestion(
      result({
        output: {
          classification: 'series',
          memberships: [{ series: 'Fae Isles', position: null }],
        },
      }),
      suggestion(),
    ).disposition,
    'membership_only_position_unconfirmed',
  )
  assert.equal(
    compareAuthorityResultToSuggestion(
      result({
        output: { classification: 'series', memberships: [{ series: 'Other Isles', position: 2 }] },
      }),
      suggestion(),
    ).disposition,
    'series_conflict',
  )
  assert.equal(
    compareAuthorityResultToSuggestion(result(), suggestion({ proposed_count: 4 })).disposition,
    'membership_only_count_unconfirmed',
  )
  assert.equal(
    compareAuthorityResultToSuggestion(result(), suggestion({ proposed_position: null }))
      .disposition,
    'membership_corroborated_position_additional',
  )
})

test('never upgrades unresolved or policy-quarantined output', () => {
  assert.equal(
    compareAuthorityResultToSuggestion(
      result({ validation: { valid: true, policySafe: false } }),
      suggestion(),
    ).disposition,
    'policy_quarantined',
  )
  assert.equal(
    compareAuthorityResultToSuggestion(
      result({ output: { classification: 'unresolved', memberships: [] } }),
      suggestion(),
    ).disposition,
    'unresolved',
  )
})
