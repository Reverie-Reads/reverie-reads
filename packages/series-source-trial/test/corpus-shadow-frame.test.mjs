import assert from 'node:assert/strict'
import test from 'node:test'
import {
  corpusShadowFrameSha256,
  validateCorpusShadowFrame,
} from '../src/authority/corpus-shadow-frame.mjs'

const frame = () => ({
  schemaVersion: 1,
  purpose: 'corpus-series-shadow-rebuild',
  project: 'tzimctugmzuadrsitnpr',
  frozenAt: '2026-09-16T01:30:00.000Z',
  counts: { total: 2 },
  cases: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'First Work',
      authors: ['First Writer', 'Second Writer'],
      publicationYear: 2025,
      identityFingerprint: 'a'.repeat(32),
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'An Ancient Work',
      authors: ['Ancient Writer'],
      publicationYear: 125,
      identityFingerprint: 'b'.repeat(32),
    },
  ],
})

test('validates a complete identity-only corpus shadow frame', () => {
  assert.equal(validateCorpusShadowFrame(frame()).cases.length, 2)
  assert.match(corpusShadowFrameSha256(frame()), /^[a-f0-9]{64}$/)
})

test('rejects every historical series hint that could steer the rebuild', () => {
  for (const key of [
    'currentSeries',
    'proposedSeries',
    'series',
    'position',
    'seriesCount',
    'seriesCheckState',
    'memberships',
    'evidence',
    'truth',
  ]) {
    const changed = frame()
    changed.cases[0][key] = key === 'position' ? 1 : 'historical hint'
    assert.throws(() => validateCorpusShadowFrame(changed), new RegExp(`contains ${key}`))
  }
})

test('rejects partial identities, duplicates, and inventory drift', () => {
  const partialAuthor = frame()
  partialAuthor.cases[0].authors = ['']
  assert.throws(() => validateCorpusShadowFrame(partialAuthor), /invalid full authors/)

  const duplicate = frame()
  duplicate.cases[1].id = duplicate.cases[0].id
  assert.throws(() => validateCorpusShadowFrame(duplicate), /duplicate case/)

  const drifted = frame()
  drifted.counts.total = 3
  assert.throws(() => validateCorpusShadowFrame(drifted), /total count does not reconcile/)
})
