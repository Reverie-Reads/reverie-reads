import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCorpusShadowReviewReport,
  corpusShadowGroupCacheKey,
  corpusShadowGroupTarget,
  finalizeCorpusShadowGroupReview,
  validateCorpusShadowReviewInput,
} from '../src/authority/corpus-shadow-review.mjs'
import { reviewCorpusShadowGroup } from '../src/authority/corpus-shadow-review-openai.mjs'

const group = {
  groupId: 'group-1',
  series: 'The Test Cycle',
  authorScope: ['A. Writer'],
  modelReview: 'required',
  members: [
    {
      workId: 'work-1',
      title: 'First Test',
      publicationYear: 2024,
      proposedPosition: 1,
    },
    {
      workId: 'work-2',
      title: 'Second Test',
      publicationYear: 2025,
      proposedPosition: 2,
    },
  ],
}

const merged = {
  schemaVersion: 1,
  purpose: 'corpus-series-shadow-merged-graph',
  sourceFrame: {
    project: 'project',
    sha256: 'a'.repeat(64),
    totalWorks: 2,
    offset: 0,
    end: 2,
  },
  candidateGraph: {
    counts: { groupsRequiringModelReview: 1 },
    candidateGroups: [group],
  },
}

const proposal = (caseId, title, position) => ({
  caseId,
  identity: {
    matched: true,
    confidence: 'high',
    evidenceUrls: ['https://author.example/books'],
  },
  classification: 'series',
  memberships: [
    {
      series: 'The Test Cycle',
      position,
      role: 'primary',
      evidenceUrls: ['https://author.example/books'],
    },
  ],
  authoritySources: [
    {
      url: 'https://author.example/books',
      kind: 'author',
      supports: ['identity', 'series_membership', 'position'],
      evidenceSummary: `The author lists ${title} in The Test Cycle as book ${position}.`,
      relationshipClaims: [{ name: 'The Test Cycle', kind: 'book_series', position }],
      observedIdentity: { title, authors: ['A. Writer'], workKind: 'single_work' },
      originAssessment: 'claimed_first_party',
    },
  ],
  uncertainties: [],
  note: 'Direct author evidence.',
})

test('validates a complete merged graph and builds a bounded group target', () => {
  assert.equal(validateCorpusShadowReviewInput(merged), merged)
  assert.deepEqual(corpusShadowGroupTarget(group), {
    schemaVersion: 1,
    groupId: 'group-1',
    proposedSeries: 'The Test Cycle',
    authors: ['A. Writer'],
    members: [
      {
        caseId: 'work-1',
        title: 'First Test',
        authors: ['A. Writer'],
        publicationYear: 2024,
        proposedPosition: 1,
      },
      {
        caseId: 'work-2',
        title: 'Second Test',
        authors: ['A. Writer'],
        publicationYear: 2025,
        proposedPosition: 2,
      },
    ],
  })
})

test('requires every member to have grounded policy-safe authority evidence', () => {
  const result = finalizeCorpusShadowGroupReview(group, {
    output: {
      groupId: 'group-1',
      reviews: [proposal('work-1', 'First Test', 1), proposal('work-2', 'Second Test', 2)],
    },
    consultedUrls: ['https://author.example/books'],
    searchedQueries: ['site:author.example "The Test Cycle"'],
  })

  assert.equal(result.status, 'supported')
  assert.deepEqual(
    result.reviews.map((review) => [review.caseId, review.candidateSupported]),
    [
      ['work-1', true],
      ['work-2', true],
    ],
  )

  const incomplete = finalizeCorpusShadowGroupReview(group, {
    output: { groupId: 'group-1', reviews: [proposal('work-1', 'First Test', 1)] },
    consultedUrls: ['https://author.example/books'],
  })
  assert.equal(incomplete.status, 'invalid')
  assert.match(incomplete.errors[0], /omits member work-2/)
})

test('cache keys bind the complete group and model configuration', () => {
  const target = corpusShadowGroupTarget(group)
  const experiment = {
    model: 'gpt-5.6-luna',
    reasoningEffort: 'low',
    searchContextSize: 'medium',
    maxToolCalls: 3,
  }
  assert.equal(corpusShadowGroupCacheKey(target, experiment).length, 64)
  assert.notEqual(
    corpusShadowGroupCacheKey(target, experiment),
    corpusShadowGroupCacheKey(target, { ...experiment, maxToolCalls: 4 }),
  )
})

test('summarizes billable and cached review outcomes without a writer', () => {
  const report = buildCorpusShadowReviewReport({
    input: merged,
    inputSha256: 'b'.repeat(64),
    offset: 0,
    end: 1,
    experiment: { model: 'gpt-5.6-luna' },
    results: [
      {
        status: 'supported',
        cached: false,
        billing: { modelCalls: 1, webSearchCalls: 2, inputTokens: 100, outputTokens: 50 },
      },
    ],
  })
  assert.deepEqual(report.counts, {
    groups: 1,
    supported: 1,
    rejected: 0,
    review: 0,
    invalid: 0,
    errors: 0,
    modelCalls: 1,
    cached: 0,
    webSearchCalls: 2,
    inputTokens: 100,
    outputTokens: 50,
  })
})

test('sends one strict no-store grouped Luna search request', async () => {
  let request
  const response = {
    id: 'resp_1',
    model: 'gpt-5.6-luna',
    usage: { input_tokens: 10, output_tokens: 20 },
    output: [
      {
        type: 'web_search_call',
        action: {
          query: 'test query',
          sources: [{ url: 'https://author.example/books' }],
        },
      },
      {
        type: 'message',
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({ groupId: 'group-1', reviews: [] }),
            annotations: [],
          },
        ],
      },
    ],
  }
  const result = await reviewCorpusShadowGroup(corpusShadowGroupTarget(group), {
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body)
      return { ok: true, json: async () => response }
    },
  })

  assert.equal(request.store, false)
  assert.equal(request.model, 'gpt-5.6-luna')
  assert.equal(request.reasoning.effort, 'low')
  assert.equal(request.tool_choice, 'required')
  assert.equal(request.text.format.type, 'json_schema')
  assert.equal(request.metadata.group_id, 'group-1')
  assert.deepEqual(result.consultedUrls, ['https://author.example/books'])
})
