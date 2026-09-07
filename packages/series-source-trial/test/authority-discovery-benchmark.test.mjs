import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadTrialCases } from '../src/cases.mjs'
import { buildAuthorityTarget } from '../src/authority/evidence.mjs'
import {
  auditAuthorityDiscoveryHoldout,
  expectedAuthoritySources,
  scoreAuthorityDiscovery,
} from '../src/authority/discovery-benchmark.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const loadJson = (path) => readFile(resolve(packageRoot, path), 'utf8').then(JSON.parse)

const loadFixture = async () => {
  const [caseSet, benchmark, authorityGoldText] = await Promise.all([
    loadTrialCases(),
    loadJson('data/authority-discovery-holdout.json'),
    readFile(resolve(packageRoot, 'data/authority-gold.json'), 'utf8'),
  ])
  return { caseSet, benchmark, authorityGoldText }
}

test('frozen discovery holdout is balanced, distinct, and source-backed', async () => {
  const { caseSet, benchmark, authorityGoldText } = await loadFixture()
  const audit = auditAuthorityDiscoveryHoldout(caseSet, benchmark, { authorityGoldText })

  assert.equal(audit.valid, true, audit.errors.join('\n'))
  assert.equal(audit.caseCount, 22)
  assert.equal(audit.distinctAuthors, 22)
  assert.deepEqual(
    audit.cells.map(({ id, selected }) => [id, selected]),
    [
      ['standalone_publisher', 5],
      ['series_author', 6],
      ['series_publisher', 5],
      ['standalone_author', 6],
    ],
  )
})

test('acquisition targets for the discovery holdout remain truth-blind', async () => {
  const { caseSet, benchmark } = await loadFixture()
  const casesById = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))

  for (const selected of benchmark.cases) {
    const target = buildAuthorityTarget(casesById.get(selected.id))
    assert.deepEqual(Object.keys(target.target).sort(), ['authors', 'publicationYear', 'title'])
    assert.equal(JSON.stringify(target).includes('truth'), false)
    assert.equal(JSON.stringify(target).includes('source'), false)
  }
})

test('discovery score separates origin, channel, exact page, citation, and resolution', async () => {
  const { caseSet, benchmark, authorityGoldText } = await loadFixture()
  const casesById = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const cellsById = new Map(benchmark.cells.map((cell) => [cell.id, cell]))
  const results = benchmark.cases.map((selected, index) => {
    const testCase = casesById.get(selected.id)
    const cell = cellsById.get(selected.cell)
    const source = expectedAuthoritySources(testCase, caseSet.sharedSources, benchmark).find(
      (candidate) => candidate.channel === cell.channel,
    )
    return {
      caseId: selected.id,
      status: 'completed',
      consultedUrls: index === 0 ? ['https://discovery.example/work'] : [source.url],
      output: {
        classification: index === 1 ? cell.classification : 'unresolved',
        authoritySources: index === 2 ? [{ url: source.url }] : [],
      },
    }
  })
  const run = {
    model: 'test-model',
    promptVersion: benchmark.promptVersion,
    holdoutId: benchmark.id,
    retrievalEnabled: true,
    targets: benchmark.cases.map(({ id }) => ({ caseId: id })),
    results,
    score: { operations: { modelCalls: 22, webSearchCalls: 44 } },
  }

  const score = scoreAuthorityDiscovery(caseSet, benchmark, run, { authorityGoldText })

  assert.equal(score.valid, true, score.errors.join('\n'))
  assert.equal(score.summary.originDiscovered, 21)
  assert.equal(score.summary.channelOriginDiscovered, 21)
  assert.equal(score.summary.exactPageDiscovered, 21)
  assert.equal(score.summary.expectedOriginCited, 1)
  assert.equal(score.summary.resolved, 1)
})

test('discovery score rejects a run whose target order differs from the freeze', async () => {
  const { caseSet, benchmark, authorityGoldText } = await loadFixture()
  const ids = benchmark.cases.map(({ id }) => id)
  const score = scoreAuthorityDiscovery(
    caseSet,
    benchmark,
    {
      promptVersion: benchmark.promptVersion,
      targets: [...ids].reverse().map((caseId) => ({ caseId })),
      results: ids.map((caseId) => ({ caseId, status: 'error' })),
    },
    { authorityGoldText },
  )

  assert.equal(score.valid, false)
  assert.match(score.errors.join('\n'), /targets do not exactly match/)
})
