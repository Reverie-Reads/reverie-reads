import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reusableProviderResults } from '../src/resume.mjs'

const testCase = (id, title = `Book ${id}`) => ({
  id,
  title,
  authors: ['Example Author'],
})

const report = (cases, provider, results) => ({
  caseSet: { cases },
  runs: [{ provider, results }],
})

test('reuses successful exact-identity results and leaves errors for retry', () => {
  const cases = [testCase('one'), testCase('two')]
  const reusable = reusableProviderResults(cases, [
    report(cases, 'google-books', [
      { caseId: 'one', workMatch: { matched: true } },
      { caseId: 'two', error: 'Error: 429' },
    ]),
  ])

  assert.deepEqual([...reusable.get('google-books').keys()], ['one'])
})

test('combines successful retries without letting a later error erase a success', () => {
  const cases = [testCase('one'), testCase('two')]
  const reusable = reusableProviderResults(cases, [
    report(cases, 'google-books', [
      { caseId: 'one', workMatch: { matched: true } },
      { caseId: 'two', error: 'Error: 429' },
    ]),
    report(cases, 'google-books', [
      { caseId: 'one', error: 'Error: 429' },
      { caseId: 'two', workMatch: { matched: false } },
    ]),
  ])

  assert.deepEqual([...reusable.get('google-books').keys()], ['one', 'two'])
})

test('does not reuse a result after the case identity changes', () => {
  const current = [testCase('one', 'Corrected Title')]
  const recorded = [testCase('one', 'Original Title')]
  const reusable = reusableProviderResults(current, [
    report(recorded, 'google-books', [{ caseId: 'one', workMatch: { matched: true } }]),
  ])

  assert.equal(reusable.get('google-books').size, 0)
})
