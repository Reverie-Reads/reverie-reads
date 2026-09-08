import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { loadTrialCases } from '../src/cases.mjs'
import {
  EXA_AUTHORITY_LOCATOR_VERSION,
  buildExaAuthorityQueries,
  runExaAuthorityLocator,
  searchExa,
} from '../src/authority/exa-locator.mjs'
import { augmentWithExaAuthorityFallback } from '../src/authority/exa-fallback.mjs'
import { rankedAuthorityDomains } from '../src/authority/focused-search.mjs'
import {
  auditAuthorityLocatorBenchmark,
  scoreAuthorityLocator,
} from '../src/authority/locator-benchmark.mjs'
import { expectedAuthoritySources } from '../src/authority/discovery-benchmark.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const loadFixture = async () => {
  const [caseSet, discoveryBenchmark, authorityGoldText] = await Promise.all([
    loadTrialCases(),
    readFile(resolve(packageRoot, 'data/authority-discovery-holdout.json'), 'utf8').then(
      JSON.parse,
    ),
    readFile(resolve(packageRoot, 'data/authority-gold.json'), 'utf8'),
  ])
  const benchmark = {
    ...discoveryBenchmark,
    id: 'authority-locator-test-v1',
    evaluationPartition: 'development',
    locatorVersion: EXA_AUTHORITY_LOCATOR_VERSION,
  }
  return { caseSet, benchmark, authorityGoldText }
}

test('Exa locator queries use only the truth-blind target fields', () => {
  const authorityTarget = {
    schemaVersion: 1,
    caseId: 'case-one',
    target: {
      title: 'The Book',
      authors: ['A. Writer'],
      publicationYear: 2026,
    },
    truth: { standalone: false },
    sources: ['https://known.example/book'],
  }

  const queries = buildExaAuthorityQueries(authorityTarget)

  assert.deepEqual(queries, [
    '"The Book" "A. Writer" official 2026',
    '"A. Writer" official author books',
    '"The Book" "A. Writer" publisher',
  ])
  assert.equal(JSON.stringify(queries).includes('known.example'), false)
  assert.equal(JSON.stringify(queries).includes('standalone'), false)
})

test('Exa search keeps the key in a header and returns only normalized HTTPS URLs', async () => {
  let observedUrl
  let observedRequest
  const result = await searchExa('a private query', {
    apiKey: 'secret-test-key',
    fetchImpl: async (url, request) => {
      observedUrl = url
      observedRequest = request
      return {
        ok: true,
        status: 200,
        json: async () => ({
          requestId: 'not-retained',
          results: [
            { title: 'One', author: 'Not retained', url: 'https://www.example.com/book/' },
            { title: 'Duplicate', url: 'https://example.com/book' },
            { title: 'Unsafe', url: 'http://example.com/plaintext' },
            { title: 'Invalid', url: 'not a URL' },
          ],
        }),
      }
    },
  })

  assert.equal(observedUrl, 'https://api.exa.ai/search')
  assert.equal(observedRequest.headers['x-api-key'], 'secret-test-key')
  assert.deepEqual(JSON.parse(observedRequest.body), {
    query: 'a private query',
    type: 'auto',
    numResults: 10,
    moderation: true,
    userLocation: 'US',
  })
  assert.equal(observedRequest.body.includes('secret-test-key'), false)
  assert.deepEqual(result.urls, ['https://example.com/book'])
  assert.equal(JSON.stringify(result).includes('Not retained'), false)
})

test('Exa search retries a rate limit once without reading its response body', async () => {
  let calls = 0
  const sleeps = []
  const result = await searchExa('retry me', {
    apiKey: 'test-key',
    sleep: async (milliseconds) => sleeps.push(milliseconds),
    fetchImpl: async () => {
      calls += 1
      if (calls === 1) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => '0' },
          json: async () => {
            throw new Error('error bodies must not be read')
          },
        }
      }
      return { ok: true, status: 200, json: async () => ({ results: [] }) }
    },
  })

  assert.equal(calls, 2)
  assert.deepEqual(sleeps, [250])
  assert.equal(result.status, 'completed')
  assert.equal(result.attempts, 2)
})

test('ranks repeated candidate origins and excludes discovery-only domains', () => {
  const domains = rankedAuthorityDomains(
    [
      {
        urls: [
          'https://retailer.example/book',
          'https://author.example/book',
          'https://www.goodreads.com/book/show/1',
          'https://127.0.0.1/private',
        ],
      },
      {
        urls: ['https://author.example/books', 'https://publisher.example/title'],
      },
      {
        urls: ['https://publisher.example/catalog', 'https://author.example/about'],
      },
    ],
    2,
  )

  assert.deepEqual(domains, ['author.example', 'publisher.example'])
})

test('Exa authority locator preserves only ephemeral URL and aggregate operation data', async () => {
  let calls = 0
  const result = await runExaAuthorityLocator(
    {
      caseId: 'case-one',
      target: { title: 'The Book', authors: ['A. Writer'], publicationYear: null },
    },
    {
      apiKey: 'test-key',
      search: async () => {
        calls += 1
        if (calls === 2) {
          return {
            status: 'error',
            errorCode: 'http_503',
            attempts: 2,
            latencyMs: 2,
            urls: [],
          }
        }
        return {
          status: 'completed',
          errorCode: null,
          attempts: 1,
          latencyMs: 1,
          urls: ['https://example.com/book'],
        }
      },
    },
  )

  assert.equal(result.status, 'partial')
  assert.deepEqual(result.urls, ['https://example.com/book'])
  assert.deepEqual(result.candidateDomains, ['example.com'])
  assert.deepEqual(result.errorCodes, ['http_503'])
  assert.deepEqual(result.operations, {
    queriesPlanned: 3,
    queriesCompleted: 2,
    requests: 4,
    urlsInspected: 1,
    latencyMs: 4,
  })
})

test('uses Exa candidates only to focus a second grounded model search', async () => {
  const firstPass = {
    caseId: 'case-one',
    status: 'completed',
    output: { classification: 'unresolved' },
    validation: { valid: true, policySafe: true },
    consultedUrls: ['https://first.example/book'],
    searchedQueries: ['first query'],
    webSearchCalls: 1,
    modelCallCount: 1,
    latencyMs: 10,
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    billing: { modelCalls: 1, webSearchCalls: 1, inputTokens: 100, outputTokens: 20 },
    cached: false,
  }
  let observedKey
  let observedDomains
  const augmented = await augmentWithExaAuthorityFallback(
    { caseId: 'case-one', target: { title: 'Book', authors: ['Writer'] } },
    firstPass,
    {
      apiKey: 'secret-key',
      locate: async (_target, options) => {
        observedKey = options.apiKey
        return {
          status: 'completed',
          urls: ['https://exa-only.example/result'],
          candidateDomains: ['exa-only.example'],
          errorCodes: [],
          operations: {
            queriesPlanned: 3,
            queriesCompleted: 3,
            requests: 3,
            urlsInspected: 20,
            latencyMs: 30,
          },
        }
      },
      searchDomains: async (_target, domains) => {
        observedDomains = domains
        return {
          status: 'completed',
          output: { classification: 'series' },
          validation: { valid: true, policySafe: true },
          consultedUrls: ['https://publisher.example/book'],
          searchedQueries: ['restricted query'],
          webSearchCalls: 1,
          modelCallCount: 1,
          latencyMs: 40,
          usage: { input_tokens: 50, output_tokens: 10, total_tokens: 60 },
          billing: { modelCalls: 1, webSearchCalls: 1, inputTokens: 50, outputTokens: 10 },
          cached: false,
        }
      },
    },
  )

  assert.equal(observedKey, 'secret-key')
  assert.deepEqual(observedDomains, ['exa-only.example'])
  assert.equal(augmented.selectedPass, 'exa_fallback')
  assert.equal(augmented.output.classification, 'series')
  assert.equal(augmented.exaFallback.selected, true)
  assert.equal(augmented.exaFallback.baseline.output.classification, 'unresolved')
  assert.equal(augmented.exaFallback.candidateDomainCount, 1)
  assert.equal(augmented.exaFallback.locator.operations.estimatedCostUsd, 0.021)
  assert.equal(JSON.stringify(augmented.exaFallback).includes('secret-key'), false)
  assert.equal(JSON.stringify(augmented.exaFallback).includes('exa-only.example/result'), false)
  assert.equal(augmented.billing.modelCalls, 2)
  assert.equal(augmented.billing.webSearchCalls, 2)
})

test('does not spend Exa requests after a safe resolved first pass', async () => {
  let locatorCalls = 0
  const firstPass = {
    status: 'completed',
    output: { classification: 'standalone' },
    validation: { valid: true, policySafe: true },
  }
  const augmented = await augmentWithExaAuthorityFallback({}, firstPass, {
    locate: async () => {
      locatorCalls += 1
    },
    searchDomains: async () => {},
  })

  assert.equal(locatorCalls, 0)
  assert.deepEqual(augmented.exaFallback, {
    status: 'skipped',
    reason: 'first_pass_resolved',
    selected: false,
  })
})

test('locator benchmark is valid, distinct, and qualification-safe', async () => {
  const { caseSet, benchmark, authorityGoldText } = await loadFixture()
  const audit = auditAuthorityLocatorBenchmark(caseSet, benchmark, { authorityGoldText })

  assert.equal(audit.valid, true, audit.errors.join('\n'))
  assert.equal(audit.caseCount, 22)
  assert.equal(audit.distinctAuthors, 22)
  assert.equal(benchmark.evaluationPartition, 'development')
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

test('committed Exa development benchmark matches its completed blind run', async () => {
  const [caseSet, benchmark, authorityGoldText] = await Promise.all([
    loadTrialCases(),
    readFile(resolve(packageRoot, 'data/authority-locator-development.json'), 'utf8').then(
      JSON.parse,
    ),
    readFile(resolve(packageRoot, 'data/authority-gold.json'), 'utf8'),
  ])
  const audit = auditAuthorityLocatorBenchmark(caseSet, benchmark, { authorityGoldText })

  assert.equal(audit.valid, true, audit.errors.join('\n'))
  assert.equal(audit.caseCount, 18)
  assert.equal(audit.distinctAuthors, 18)
  assert.deepEqual(
    audit.cells.map(({ id, selected }) => [id, selected]),
    [
      ['standalone_author', 3],
      ['series_author', 7],
      ['series_publisher', 8],
    ],
  )
})

test('locator score persists aggregates without provider result content', async () => {
  const { caseSet, benchmark, authorityGoldText } = await loadFixture()
  const casesById = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const cellsById = new Map(benchmark.cells.map((cell) => [cell.id, cell]))
  const results = benchmark.cases.map((selected) => {
    const testCase = casesById.get(selected.id)
    const cell = cellsById.get(selected.cell)
    const source = expectedAuthoritySources(testCase, caseSet.sharedSources, benchmark).find(
      (candidate) => candidate.channel === cell.channel,
    )
    return {
      caseId: selected.id,
      status: 'completed',
      urls: [source.url],
      candidateDomains: [source.origin],
      errorCodes: [],
      operations: {
        queriesPlanned: 3,
        queriesCompleted: 3,
        requests: 3,
        urlsInspected: 1,
        latencyMs: 5,
      },
    }
  })

  const score = scoreAuthorityLocator(
    caseSet,
    benchmark,
    { locatorVersion: EXA_AUTHORITY_LOCATOR_VERSION, results },
    { authorityGoldText },
  )
  const persisted = JSON.stringify(score)

  assert.equal(score.valid, true, score.errors.join('\n'))
  assert.equal(score.summary.knownOriginDiscovered, 22)
  assert.equal(score.summary.exactKnownPageDiscovered, 22)
  assert.equal(score.operations.requests, 66)
  assert.equal(score.operations.estimatedCostUsd, 0.462)
  assert.equal(score.retention.caseLevelProviderOutputRetained, false)
  assert.equal(persisted.includes(benchmark.cases[0].id), false)
  assert.equal(persisted.includes(casesById.get(benchmark.cases[0].id).title), false)
  assert.equal(persisted.includes(results[0].urls[0]), false)
  assert.equal(persisted.includes(results[0].candidateDomains[0]), false)
})

test('locator score measures recovery beyond a compatible Luna acquisition run', async () => {
  const { caseSet, benchmark, authorityGoldText } = await loadFixture()
  const casesById = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const cellsById = new Map(benchmark.cells.map((cell) => [cell.id, cell]))
  const locatorResults = benchmark.cases.map((selected) => {
    const source = expectedAuthoritySources(
      casesById.get(selected.id),
      caseSet.sharedSources,
      benchmark,
    ).find((candidate) => candidate.channel === cellsById.get(selected.cell).channel)
    return {
      caseId: selected.id,
      status: 'completed',
      urls: [source.url],
      errorCodes: [],
      operations: { queriesPlanned: 3, queriesCompleted: 3, requests: 3 },
    }
  })
  const baselineRun = {
    model: 'gpt-5.6-luna',
    promptVersion: benchmark.promptVersion,
    holdoutId: benchmark.id,
    targets: benchmark.cases.map(({ id }) => ({ caseId: id })),
    results: benchmark.cases.map(({ id }) => ({
      caseId: id,
      status: 'completed',
      consultedUrls: [],
      output: { classification: 'unresolved', authoritySources: [] },
      validation: { valid: true, policySafe: true },
    })),
  }

  const score = scoreAuthorityLocator(
    caseSet,
    benchmark,
    { locatorVersion: EXA_AUTHORITY_LOCATOR_VERSION, results: locatorResults },
    { authorityGoldText, baselineRun },
  )

  assert.equal(score.valid, true, score.errors.join('\n'))
  assert.equal(score.summary.baselineKnownOriginDiscovered, 0)
  assert.equal(score.summary.locatorRecoveryAmongBaselineOriginMisses, 22)
  assert.equal(score.summary.combinedKnownOriginDiscovered, 22)
})

test('locator rejects a qualification benchmark before any provider request', async () => {
  const { caseSet, benchmark, authorityGoldText } = await loadFixture()
  const audit = auditAuthorityLocatorBenchmark(
    caseSet,
    { ...benchmark, evaluationPartition: 'qualification' },
    { authorityGoldText },
  )

  assert.equal(audit.valid, false)
  assert.match(audit.errors.join('\n'), /development partition/)
})
