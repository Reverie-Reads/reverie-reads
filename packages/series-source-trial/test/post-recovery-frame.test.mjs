import assert from 'node:assert/strict'
import test from 'node:test'
import {
  postRecoveryTrialCaseSet,
  validatePostRecoveryAuthorityFrame,
} from '../src/authority/post-recovery-frame.mjs'

const frame = () => ({
  schemaVersion: 1,
  purpose: 'post-recovery-authority-review',
  project: 'tzimctugmzuadrsitnpr',
  sourceRunId: 'c6a89954-ddc4-44c4-825e-aada6ffd95b1',
  frozenAt: '2026-09-15T08:30:00.000Z',
  run: { status: 'completed', phase: 'complete', uncertain: 0 },
  counts: { total: 2, review: 1, deferred: 1 },
  cases: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      title: 'A Reviewed Work',
      authors: ['First Writer', 'Second Writer'],
      publicationYear: 2025,
      queue: 'review',
      reasonCode: 'pending_series_review',
      identityFingerprint: 'a'.repeat(32),
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      title: 'A Deferred Work',
      authors: ['Another Writer'],
      publicationYear: null,
      queue: 'deferred',
      reasonCode: 'ambiguous_relationship',
      identityFingerprint: 'b'.repeat(32),
    },
  ],
})

test('validates a completed, reconciled post-recovery frame', () => {
  assert.equal(validatePostRecoveryAuthorityFrame(frame()).cases.length, 2)
})

test('converts only identity into truth-blind candidate cases', () => {
  const converted = postRecoveryTrialCaseSet(frame())
  assert.deepEqual(converted.cases[0].authors, ['First Writer', 'Second Writer'])
  assert.deepEqual(converted.cases[0].truth, {
    status: 'candidate',
    standalone: null,
    memberships: [],
    sources: [],
  })
  assert.equal(converted.cases[0].reviewQueue, 'review')
  assert.equal(converted.cases[1].reviewReasonCode, 'ambiguous_relationship')
})

test('rejects series hints and truth that could steer acquisition', () => {
  for (const key of ['currentSeries', 'proposedSeries', 'truth']) {
    const changed = frame()
    changed.cases[0][key] = key === 'truth' ? { status: 'reviewed' } : 'Steered Saga'
    assert.throws(() => validatePostRecoveryAuthorityFrame(changed), new RegExp(`contains ${key}`))
  }
})

test('rejects uncertain source runs, bad authors, and count drift', () => {
  const uncertain = frame()
  uncertain.run.uncertain = 1
  assert.throws(() => validatePostRecoveryAuthorityFrame(uncertain), /uncertain writes/)

  const partialAuthor = frame()
  partialAuthor.cases[0].authors = ['']
  assert.throws(() => validatePostRecoveryAuthorityFrame(partialAuthor), /invalid full authors/)

  const drifted = frame()
  drifted.counts.review = 2
  assert.throws(() => validatePostRecoveryAuthorityFrame(drifted), /counts do not reconcile/)
})
