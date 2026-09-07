import { createHash } from 'node:crypto'
import {
  auditAuthorityDiscoveryHoldout,
  expectedAuthoritySources,
  normalizeAuthorityOrigin,
  normalizeAuthorityUrl,
  scoreAuthorityDiscovery,
} from './discovery-benchmark.mjs'
import {
  EXA_AUTHORITY_LOCATOR_VERSION,
  EXA_SEARCH_REQUEST_USD,
  EXA_SEARCHES_PER_CASE,
} from './exa-locator.mjs'

const asArray = (value) => (Array.isArray(value) ? value : [])
const rate = (numerator, denominator) => (denominator ? numerator / denominator : null)

export function auditAuthorityLocatorBenchmark(caseSet, benchmark, options = {}) {
  const audit = auditAuthorityDiscoveryHoldout(caseSet, benchmark, options)
  const errors = [...audit.errors]
  if (benchmark?.evaluationPartition !== 'development') {
    errors.push('authority locator may run only on a development partition')
  }
  if (benchmark?.locatorVersion !== EXA_AUTHORITY_LOCATOR_VERSION) {
    errors.push(`benchmark locatorVersion must be ${EXA_AUTHORITY_LOCATOR_VERSION}`)
  }
  return { ...audit, valid: errors.length === 0, errors }
}

const summarize = (rows, baselineEnabled) => {
  const count = rows.length
  const total = (field) => rows.filter((row) => row[field]).length
  const summary = {
    cases: count,
    casesCompleted: total('completed'),
    casesPartial: total('partial'),
    casesFailed: total('failed'),
    knownOriginDiscovered: total('originDiscovered'),
    knownOriginDiscoveryRate: rate(total('originDiscovered'), count),
    targetedChannelDiscovered: total('channelOriginDiscovered'),
    targetedChannelDiscoveryRate: rate(total('channelOriginDiscovered'), count),
    exactKnownPageDiscovered: total('exactPageDiscovered'),
    exactKnownPageDiscoveryRate: rate(total('exactPageDiscovered'), count),
  }
  if (!baselineEnabled) return summary
  return {
    ...summary,
    baselineKnownOriginDiscovered: total('baselineOriginDiscovered'),
    locatorRecoveryAmongBaselineOriginMisses: total('incrementalOriginDiscovered'),
    combinedKnownOriginDiscovered: total('combinedOriginDiscovered'),
    combinedKnownOriginDiscoveryRate: rate(total('combinedOriginDiscovered'), count),
    baselineExactKnownPageDiscovered: total('baselineExactPageDiscovered'),
    locatorRecoveryAmongBaselineExactPageMisses: total('incrementalExactPageDiscovered'),
    combinedExactKnownPageDiscovered: total('combinedExactPageDiscovered'),
    combinedExactKnownPageDiscoveryRate: rate(total('combinedExactPageDiscovered'), count),
  }
}

export function scoreAuthorityLocator(
  caseSet,
  benchmark,
  locatorRun,
  { authorityGoldText = null, baselineRun = null } = {},
) {
  const audit = auditAuthorityLocatorBenchmark(caseSet, benchmark, { authorityGoldText })
  const errors = [...audit.errors]
  const selectedIds = asArray(benchmark?.cases).map((selected) => selected.id)
  const resultIds = asArray(locatorRun?.results).map((result) => result.caseId)
  if (
    resultIds.length !== selectedIds.length ||
    resultIds.some((id, index) => id !== selectedIds[index])
  ) {
    errors.push('locator results do not exactly match the frozen benchmark order')
  }
  if (locatorRun?.locatorVersion !== benchmark?.locatorVersion) {
    errors.push('locator run version does not match the frozen benchmark')
  }

  let baselineScore = null
  if (baselineRun) {
    baselineScore = scoreAuthorityDiscovery(caseSet, benchmark, baselineRun, {
      authorityGoldText,
    })
    if (!baselineScore.valid) {
      errors.push(...baselineScore.errors.map((error) => `baseline: ${error}`))
    }
  }

  const casesById = new Map(asArray(caseSet?.cases).map((testCase) => [testCase.id, testCase]))
  const cellsById = new Map(asArray(benchmark?.cells).map((cell) => [cell.id, cell]))
  const resultsById = new Map(asArray(locatorRun?.results).map((result) => [result.caseId, result]))
  const baselineById = new Map(
    asArray(baselineScore?.details).map((detail) => [detail.caseId, detail]),
  )

  const rows = asArray(benchmark?.cases).map((selected) => {
    const testCase = casesById.get(selected.id)
    const cell = cellsById.get(selected.cell)
    const result = resultsById.get(selected.id)
    const expected = expectedAuthoritySources(testCase, caseSet.sharedSources, benchmark)
    const expectedOrigins = new Set(expected.map((source) => source.origin))
    const expectedChannelOrigins = new Set(
      expected.filter((source) => source.channel === cell?.channel).map((source) => source.origin),
    )
    const expectedUrls = new Set(expected.map((source) => source.normalizedUrl))
    const observedOrigins = new Set(
      asArray(result?.urls).map(normalizeAuthorityOrigin).filter(Boolean),
    )
    const observedUrls = new Set(asArray(result?.urls).map(normalizeAuthorityUrl).filter(Boolean))
    const baseline = baselineById.get(selected.id)
    const originDiscovered = [...expectedOrigins].some((origin) => observedOrigins.has(origin))
    const channelOriginDiscovered = [...expectedChannelOrigins].some((origin) =>
      observedOrigins.has(origin),
    )
    const exactPageDiscovered = [...expectedUrls].some((url) => observedUrls.has(url))
    const baselineOriginDiscovered = baseline?.originDiscovered === true
    const baselineExactPageDiscovered = baseline?.exactPageDiscovered === true

    return {
      cell: selected.cell,
      completed: result?.status === 'completed',
      partial: result?.status === 'partial',
      failed: result?.status === 'error' || !result,
      originDiscovered,
      channelOriginDiscovered,
      exactPageDiscovered,
      baselineOriginDiscovered,
      baselineExactPageDiscovered,
      incrementalOriginDiscovered: originDiscovered && !baselineOriginDiscovered,
      combinedOriginDiscovered: originDiscovered || baselineOriginDiscovered,
      incrementalExactPageDiscovered: exactPageDiscovered && !baselineExactPageDiscovered,
      combinedExactPageDiscovered: exactPageDiscovered || baselineExactPageDiscovered,
    }
  })

  const operations = asArray(locatorRun?.results).reduce(
    (total, result) => ({
      queriesPlanned: total.queriesPlanned + Number(result?.operations?.queriesPlanned ?? 0),
      queriesCompleted: total.queriesCompleted + Number(result?.operations?.queriesCompleted ?? 0),
      requests: total.requests + Number(result?.operations?.requests ?? 0),
      urlsInspected: total.urlsInspected + Number(result?.operations?.urlsInspected ?? 0),
      latencyMs: total.latencyMs + Number(result?.operations?.latencyMs ?? 0),
    }),
    { queriesPlanned: 0, queriesCompleted: 0, requests: 0, urlsInspected: 0, latencyMs: 0 },
  )
  const errorCounts = asArray(locatorRun?.results)
    .flatMap((result) => asArray(result?.errorCodes))
    .reduce((counts, errorCode) => {
      counts[errorCode] = (counts[errorCode] ?? 0) + 1
      return counts
    }, {})
  const benchmarkDigest = createHash('sha256').update(JSON.stringify(benchmark)).digest('hex')

  return {
    schemaVersion: 1,
    valid: errors.length === 0,
    benchmarkId: benchmark?.id ?? null,
    benchmarkSha256: benchmarkDigest,
    evaluationPartition: benchmark?.evaluationPartition ?? null,
    provider: 'exa_search_api',
    locatorVersion: locatorRun?.locatorVersion ?? null,
    retention: {
      providerPayloadRetained: false,
      resultUrlsRetained: false,
      resultTitlesRetained: false,
      resultSnippetsRetained: false,
      caseLevelProviderOutputRetained: false,
      persistedReport: 'aggregate metrics only',
    },
    summary: summarize(rows, Boolean(baselineRun)),
    cells: asArray(benchmark?.cells).map((cell) => ({
      id: cell.id,
      classification: cell.classification,
      channel: cell.channel,
      ...summarize(
        rows.filter((row) => row.cell === cell.id),
        Boolean(baselineRun),
      ),
    })),
    baseline: baselineRun
      ? {
          model: baselineScore?.model ?? null,
          promptVersion: baselineScore?.promptVersion ?? null,
          retrievalEnabled: baselineScore?.retrievalEnabled === true,
        }
      : null,
    operations: {
      ...operations,
      errorCounts,
      estimatedCostUsd: Number((operations.requests * EXA_SEARCH_REQUEST_USD).toFixed(6)),
      priceAssumptionUsdPerThousandRequests: EXA_SEARCH_REQUEST_USD * 1_000,
    },
    errors,
  }
}

const percent = (value) => (value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`)

export function renderAuthorityLocatorMarkdown(score) {
  const lines = [
    '# Reverie independent authority-locator experiment',
    '',
    `Benchmark: ${score.benchmarkId}; partition: ${score.evaluationPartition}.`,
    `Provider: Exa Search API; locator: ${score.locatorVersion}.`,
    `Status: ${score.valid ? 'valid frozen run' : 'invalid run'}.`,
    '',
    '| Cases | Complete | Partial | Failed | Known origin | Targeted channel | Exact known page |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${score.summary.cases} | ${score.summary.casesCompleted} | ${score.summary.casesPartial} | ${score.summary.casesFailed} | ${percent(score.summary.knownOriginDiscoveryRate)} | ${percent(score.summary.targetedChannelDiscoveryRate)} | ${percent(score.summary.exactKnownPageDiscoveryRate)} |`,
    '',
    '## Discovery cells',
    '',
    '| Cell | Cases | Known origin | Targeted channel | Exact known page |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...score.cells.map(
      (cell) =>
        `| ${cell.id} | ${cell.cases} | ${percent(cell.knownOriginDiscoveryRate)} | ${percent(cell.targetedChannelDiscoveryRate)} | ${percent(cell.exactKnownPageDiscoveryRate)} |`,
    ),
  ]

  if (score.baseline) {
    lines.push(
      '',
      '## Complement to Luna',
      '',
      `Baseline: ${score.baseline.model ?? 'unknown'}; prompt: ${score.baseline.promptVersion ?? 'unknown'}.`,
      '',
      '| Baseline origins | Exa-only recovery | Combined origins | Baseline exact pages | Exa-only exact recovery | Combined exact pages |',
      '| ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${score.summary.baselineKnownOriginDiscovered}/${score.summary.cases} | ${score.summary.locatorRecoveryAmongBaselineOriginMisses} | ${score.summary.combinedKnownOriginDiscovered}/${score.summary.cases} | ${score.summary.baselineExactKnownPageDiscovered}/${score.summary.cases} | ${score.summary.locatorRecoveryAmongBaselineExactPageMisses} | ${score.summary.combinedExactKnownPageDiscovered}/${score.summary.cases} |`,
    )
  }

  lines.push(
    '',
    `Operations: ${score.operations.requests} requests; ${score.operations.queriesCompleted}/${score.operations.queriesPlanned} searches completed; ${score.operations.urlsInspected} result URLs inspected in memory; ${score.operations.latencyMs} ms cumulative latency; estimated $${score.operations.estimatedCostUsd.toFixed(4)} at $${score.operations.priceAssumptionUsdPerThousandRequests}/1,000 requests.`,
    '',
    'The locator received only title, author, and optional publication year. Known authority sources and classifications were used only after retrieval for aggregate scoring.',
    'No Exa response, title, author, result URL, query, request ID, or case-level provider output is retained. The aggregate report cannot establish identity, series membership, position, or standalone status and has no Supabase or corpus write path.',
  )

  if (score.errors.length) {
    lines.push('', '## Validation errors', '', ...score.errors.map((error) => `- ${error}`))
  }
  return `${lines.join('\n').trimEnd()}\n`
}

export function authorityLocatorDryRun(audit) {
  const requests = audit.caseCount * EXA_SEARCHES_PER_CASE
  return {
    schemaVersion: 1,
    valid: audit.valid,
    benchmarkId: audit.id,
    evaluationPartition: 'development',
    provider: 'exa_search_api',
    locatorVersion: EXA_AUTHORITY_LOCATOR_VERSION,
    cases: audit.caseCount,
    distinctAuthors: audit.distinctAuthors,
    plannedSearches: requests,
    estimatedCostUsd: Number((requests * EXA_SEARCH_REQUEST_USD).toFixed(6)),
    priceAssumptionUsdPerThousandRequests: EXA_SEARCH_REQUEST_USD * 1_000,
    errors: audit.errors,
  }
}
