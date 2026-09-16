import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCorpusShadowExaBudget } from '../src/authority/corpus-shadow-exa-budget.mjs'
import { mergeCorpusShadowExaReports } from '../src/authority/corpus-shadow-exa-merge.mjs'
import {
  buildCorpusShadowExaReport,
  buildCorpusShadowExaWorkQueue,
  corpusShadowExaFirstPass,
  validateCorpusShadowExaInputs,
} from '../src/authority/corpus-shadow-exa.mjs'

const sourceFrame = {
  project: 'abcdefghijklmnopqrst',
  sha256: 'a'.repeat(64),
  totalWorks: 2,
  offset: 0,
  end: 2,
}
const member = {
  workId: '11111111-1111-4111-8111-111111111111',
  title: 'First Book',
  publicationYear: 2024,
}
const graph = {
  schemaVersion: 1,
  purpose: 'corpus-series-shadow-merged-graph',
  sourceFrame,
  candidateGraph: {
    candidateGroups: [
      { groupId: 'group-a', authorScope: ['A. Writer'], members: [member] },
      { groupId: 'group-b', authorScope: ['A. Writer'], members: [member] },
    ],
  },
}
const reviewFor = (groupId, classification, policySafe) => ({
  groupId,
  status: 'review',
  consultedUrls: [`https://author.example/${groupId}`],
  searchedQueries: [`${groupId} query`],
  reviews: [
    {
      caseId: member.workId,
      output: { caseId: member.workId, classification },
      validation: { valid: true, policySafe },
    },
  ],
})
const mergedReview = {
  schemaVersion: 1,
  purpose: 'corpus-series-shadow-luna-group-review-merged',
  sourceFrame,
  inputSha256: 'b'.repeat(64),
  reviewRange: { offset: 0, end: 2, totalGroups: 2 },
  experiment: {
    model: 'gpt-5.6-luna',
    reasoningEffort: 'low',
    searchContextSize: 'medium',
    maxToolCalls: 3,
  },
  exaQueue: {
    items: [
      { groupId: 'group-a', caseId: member.workId, reason: 'unresolved' },
      { groupId: 'group-b', caseId: member.workId, reason: 'policy_quarantined' },
    ],
  },
  results: [reviewFor('group-a', 'unresolved', false), reviewFor('group-b', 'series', false)],
}

test('validates the frozen graph and deduplicates queued groups into one work with full pass history', () => {
  validateCorpusShadowExaInputs(mergedReview, graph, 'b'.repeat(64))
  const queue = buildCorpusShadowExaWorkQueue(mergedReview, graph)
  assert.equal(queue.length, 1)
  assert.deepEqual(queue[0].reasons, ['unresolved', 'policy_quarantined'])
  assert.deepEqual(queue[0].groupIds, ['group-a', 'group-b'])
  assert.equal(queue[0].passes.length, 2)
  const firstPass = corpusShadowExaFirstPass(queue[0])
  assert.equal(firstPass.authorityPassHistory.length, 2)
  assert.equal(firstPass.billing.modelCalls, 0)
})

test('rejects graph drift and an ineligible queue item', () => {
  assert.throws(
    () => validateCorpusShadowExaInputs(mergedReview, graph, 'c'.repeat(64)),
    /does not match/,
  )
  const altered = structuredClone(mergedReview)
  altered.exaQueue.items[0].reason = 'supported'
  assert.throws(() => buildCorpusShadowExaWorkQueue(altered, graph), /ineligible reason/)
})

test('summarizes only current-run Exa and Luna usage', () => {
  const report = buildCorpusShadowExaReport({
    reviewReport: mergedReview,
    reviewSha256: 'c'.repeat(64),
    graphSha256: 'b'.repeat(64),
    offset: 0,
    end: 2,
    totalWorks: 2,
    experiment: mergedReview.experiment,
    results: [
      {
        status: 'completed',
        cached: false,
        exaFallback: { selected: true, status: 'completed', locator: { status: 'completed' } },
        runExaOperations: { requests: 3, estimatedCostUsd: 0.021 },
        runBilling: { modelCalls: 1, webSearchCalls: 1, inputTokens: 20, outputTokens: 3 },
      },
      {
        status: 'completed',
        cached: true,
        exaFallback: { selected: false, status: 'unresolved', locator: { status: 'completed' } },
        runExaOperations: { requests: 0, estimatedCostUsd: 0 },
        runBilling: { modelCalls: 0, webSearchCalls: 0, inputTokens: 0, outputTokens: 0 },
      },
    ],
  })
  assert.deepEqual(report.counts, {
    works: 2,
    selected: 1,
    unresolved: 1,
    errors: 0,
    cached: 1,
    exaRequests: 3,
    exaEstimatedCostUsd: 0.021,
    modelCalls: 1,
    webSearchCalls: 1,
    inputTokens: 20,
    outputTokens: 3,
  })
})

test('durably reserves concurrent Exa requests and enforces the cumulative ceiling', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reverie-exa-budget-'))
  const path = join(directory, 'state.json')
  const budget = await createCorpusShadowExaBudget({
    path,
    reviewSha256: 'd'.repeat(64),
    maximumUsd: 0.014,
  })
  await Promise.all([budget.reserve(), budget.reserve()])
  await assert.rejects(() => budget.reserve(), /budget_exhausted/)
  const persisted = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(persisted.reservedRequests, 2)
  assert.equal(persisted.reservedUsd, 0.014)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  await assert.rejects(
    () =>
      createCorpusShadowExaBudget({
        path,
        reviewSha256: 'd'.repeat(64),
        maximumUsd: 0.021,
      }),
    /does not match/,
  )
})

test('merges only complete contiguous Exa batches from one frozen experiment', () => {
  const result = (caseId) => ({
    caseId,
    status: 'completed',
    cached: false,
    exaFallback: { selected: false, status: 'unresolved', locator: { status: 'completed' } },
    runExaOperations: { requests: 3, estimatedCostUsd: 0.021 },
    runBilling: { modelCalls: 0, webSearchCalls: 0, inputTokens: 0, outputTokens: 0 },
  })
  const batch = (offset, results) =>
    buildCorpusShadowExaReport({
      reviewReport: mergedReview,
      reviewSha256: 'c'.repeat(64),
      graphSha256: 'b'.repeat(64),
      offset,
      end: offset + results.length,
      totalWorks: 2,
      experiment: mergedReview.experiment,
      results,
    })
  const first = batch(0, [result('case-a')])
  const second = batch(1, [result('case-b')])
  const merged = mergeCorpusShadowExaReports([second, first])
  assert.equal(merged.counts.works, 2)
  assert.equal(merged.counts.exaRequests, 6)
  assert.deepEqual(merged.inputBatches, [
    { offset: 0, end: 1 },
    { offset: 1, end: 2 },
  ])
  assert.throws(() => mergeCorpusShadowExaReports([second]), /complete, contiguous/)
  assert.throws(() => mergeCorpusShadowExaReports([first]), /complete unique-work queue/)
  assert.throws(
    () => mergeCorpusShadowExaReports([first, { ...second, reviewSha256: 'd'.repeat(64) }]),
    /one frozen review queue/,
  )
  assert.throws(
    () => mergeCorpusShadowExaReports([first, batch(1, [result('case-a')])]),
    /Duplicate Exa work/,
  )
})
