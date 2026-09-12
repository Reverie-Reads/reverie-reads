import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldSelectFocusedAuthoritySearch } from '../src/authority/focused-search.mjs'
import { augmentWithExaAuthorityFallback } from '../src/authority/exa-fallback.mjs'

const target = {
  caseId: 'synthetic-pass-review',
  target: { title: 'Second Book', authors: ['Ada Reader'] },
}
const url = 'https://publisher.example/books/second-book'
const pass = (name = 'The Sequence', position = 2) => ({
  status: 'completed',
  output: {
    caseId: target.caseId,
    classification: 'series',
    identity: { matched: true, confidence: 'high', evidenceUrls: [url] },
    memberships: [{ series: name, position, role: 'primary', evidenceUrls: [url] }],
    authoritySources: [
      {
        url,
        kind: 'publisher',
        supports: ['identity', 'series_membership', 'position'],
        evidenceSummary: 'The publisher explicitly places the exact book in its named series.',
        relationshipClaims: [{ name, kind: 'book_series', position }],
      },
    ],
    uncertainties: [],
    note: '',
  },
  consultedUrls: [url],
  validation: { valid: true, policySafe: true },
})
const unresolved = (name, position) => {
  const result = pass(name, position)
  result.output.classification = 'unresolved'
  result.output.memberships = []
  return result
}
const augment = (first, next) =>
  augmentWithExaAuthorityFallback(target, first, {
    locate: async () => ({ status: 'completed', candidateDomains: ['publisher.example'] }),
    searchDomains: async () => next,
  })

test('a later pass cannot hide an earlier named relationship or order conflict', () => {
  for (const first of [unresolved('Another Sequence', 2), unresolved('The Sequence', 3)]) {
    assert.equal(shouldSelectFocusedAuthoritySearch(first, pass()), false)
  }
})

test('same URL with a changed claim still conflicts, including normalization-preserving names', () => {
  assert.equal(
    shouldSelectFocusedAuthoritySearch(unresolved('The Sequence Trilogy', 2), pass()),
    false,
  )
  assert.equal(shouldSelectFocusedAuthoritySearch(unresolved('Sequence', 2), pass()), false)
  assert.equal(
    shouldSelectFocusedAuthoritySearch(unresolved('THE SEQUENCE series', 2), pass()),
    true,
  )
})

test('an earlier uncertain named relationship cannot disappear in another pass', () => {
  const first = unresolved('Uncertain Group', null)
  first.output.authoritySources[0].relationshipClaims[0].kind = 'unknown'
  assert.equal(shouldSelectFocusedAuthoritySearch(first, pass()), false)
})

test('an earlier affirmative standalone statement cannot disappear behind a series answer', () => {
  const first = unresolved()
  first.output.authoritySources[0].supports = ['identity', 'standalone']
  first.output.authoritySources[0].evidenceSummary =
    'The publisher explicitly calls the exact book a standalone novel.'
  first.output.authoritySources[0].relationshipClaims = []
  assert.equal(shouldSelectFocusedAuthoritySearch(first, pass()), false)
  first.output.authoritySources[0].evidenceSummary = 'The book can be read as a standalone.'
  assert.equal(shouldSelectFocusedAuthoritySearch(first, pass()), true)
})

test('standalone cannot erase an earlier series claim', () => {
  const next = pass()
  next.output.classification = 'standalone'
  next.output.memberships = []
  assert.equal(shouldSelectFocusedAuthoritySearch(unresolved(), next), false)
})

test('identity-only evidence and unknown order can gain a supported answer', () => {
  const first = unresolved()
  first.output.authoritySources[0].supports = ['identity']
  first.output.authoritySources[0].relationshipClaims = []
  assert.equal(shouldSelectFocusedAuthoritySearch(first, pass()), true)
  assert.equal(shouldSelectFocusedAuthoritySearch(unresolved('The Sequence', null), pass()), true)
  assert.equal(
    shouldSelectFocusedAuthoritySearch(unresolved('The Sequence', 2), pass('The Sequence', null)),
    true,
  )
})

test('unconsulted, selection-frame and known discovery sources cannot introduce a conflict', () => {
  const first = unresolved('Another Sequence', 2)
  first.consultedUrls = []
  assert.equal(shouldSelectFocusedAuthoritySearch(first, pass()), true)
  first.consultedUrls = [url]
  assert.equal(
    shouldSelectFocusedAuthoritySearch(first, pass(), { classificationBlockedUrls: [url] }),
    true,
  )
  first.output.authoritySources[0].url = 'https://goodreads.com/book/show/123'
  first.consultedUrls = [first.output.authoritySources[0].url]
  assert.equal(shouldSelectFocusedAuthoritySearch(first, pass()), true)
})

test('actual Exa fallback retains rejected-pass claims for the following pass without mutation', async () => {
  const first = unresolved()
  const conflict = pass('Another Sequence', 3)
  const snapshot = structuredClone([first, conflict])
  const second = await augment(first, conflict)
  assert.equal(second.exaFallback.selected, false)
  assert.ok(second.exaFallback.reviewReasons.length)
  assert.deepEqual([first, conflict], snapshot)
  const third = await augment(second, pass())
  assert.equal(third.exaFallback.selected, false)
  assert.ok(third.exaFallback.reviewReasons.includes('prior_series_claim_not_represented'))
  assert.equal(third.authorityPassHistory.length, 3)
})

test('actual fallback still selects independently supported nonconflicting evidence', async () => {
  const result = await augment(unresolved('The Sequence', null), pass())
  assert.equal(result.exaFallback.selected, true)
  assert.deepEqual(result.exaFallback.reviewReasons, [])
  assert.equal(result.output.memberships[0].position, 2)
})
