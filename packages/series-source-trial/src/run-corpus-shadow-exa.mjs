import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnvironment } from './env.mjs'
import {
  authorityPolicyForCase,
  buildAuthorityTarget,
  canonicalizeAuthorityAcquisition,
  validateAuthorityAcquisition,
} from './authority/evidence.mjs'
import { acquireAuthorityEvidence } from './authority/openai.mjs'
import { augmentWithExaAuthorityFallback } from './authority/exa-fallback.mjs'
import { runExaAuthorityLocator } from './authority/exa-locator.mjs'
import { createCorpusShadowExaBudget } from './authority/corpus-shadow-exa-budget.mjs'
import {
  buildCorpusShadowExaReport,
  buildCorpusShadowExaWorkQueue,
  corpusShadowExaCacheKey,
  corpusShadowExaFirstPass,
  validateCorpusShadowExaInputs,
} from './authority/corpus-shadow-exa.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const timestamp = () =>
  new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
const emptyBilling = () => ({ modelCalls: 0, webSearchCalls: 0, inputTokens: 0, outputTokens: 0 })

const parseArgs = (argv) => {
  const options = {
    review: null,
    graph: null,
    out: null,
    envFile: null,
    offset: 0,
    limit: 25,
    concurrency: 2,
    maximumExaSpendUsd: 10,
    apiUrl: process.env.BOOK_AUTHORITY_API_URL ?? 'https://api.openai.com/v1/responses',
    dryRun: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--review') options.review = argv[++index]
    else if (value === '--graph') options.graph = argv[++index]
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--env') options.envFile = argv[++index]
    else if (value === '--offset') options.offset = Number(argv[++index])
    else if (value === '--limit') options.limit = Number(argv[++index])
    else if (value === '--concurrency') options.concurrency = Number(argv[++index])
    else if (value === '--maximum-exa-spend') options.maximumExaSpendUsd = Number(argv[++index])
    else if (value === '--dry-run') options.dryRun = true
    else if (value === '--help') options.help = true
    else if (value === '--refresh') throw new Error('--refresh is not available in the Exa stage')
    else throw new Error(`Unknown argument ${value}`)
  }
  return options
}

const usage = `Usage: authority:corpus-shadow:exa --review MERGED_REVIEW.json --graph MERGED_GRAPH.json [options]

Options:
  --offset N              First unique queued work (default 0)
  --limit N               Unique works to process, 1..50 (default 25)
  --concurrency N         1..4 (default 2)
  --maximum-exa-spend N   Cumulative frozen-run ceiling, >0..10 USD (default 10)
  --env PATH              Local environment file
  --out PATH              Create-only private JSON report
  --dry-run               Validate and print the selected range without API calls`

const assertPrivate = (path, label) => {
  const nested = relative(privateRoot, path)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
}

const options = parseArgs(process.argv.slice(2))
if (options.help) {
  console.log(usage)
  process.exit(0)
}
if (!options.review || !options.graph) throw new Error(usage)
if (!Number.isInteger(options.offset) || options.offset < 0) {
  throw new Error('Exa offset must be a non-negative integer')
}
if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) {
  throw new Error('Exa limit must be an integer from 1 to 50')
}
if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) {
  throw new Error('Exa concurrency must be an integer from 1 to 4')
}
if (
  !Number.isFinite(options.maximumExaSpendUsd) ||
  options.maximumExaSpendUsd <= 0 ||
  options.maximumExaSpendUsd > 10
) {
  throw new Error('Exa spend ceiling must be greater than zero and at most $10')
}

const reviewPath = resolve(repositoryRoot, options.review)
const graphPath = resolve(repositoryRoot, options.graph)
assertPrivate(reviewPath, 'review')
assertPrivate(graphPath, 'graph')
const [reviewText, graphText] = await Promise.all([
  readFile(reviewPath, 'utf8'),
  readFile(graphPath, 'utf8'),
])
const reviewSha256 = createHash('sha256').update(reviewText).digest('hex')
const graphSha256 = createHash('sha256').update(graphText).digest('hex')
const { reviewReport, graphReport } = validateCorpusShadowExaInputs(
  JSON.parse(reviewText),
  JSON.parse(graphText),
  graphSha256,
)
const queue = buildCorpusShadowExaWorkQueue(reviewReport, graphReport)
const selected = queue.slice(options.offset, options.offset + options.limit)
if (!selected.length) throw new Error('Selected Exa range is empty')
const end = options.offset + selected.length
const experiment = {
  model: reviewReport.experiment.model,
  reasoningEffort: reviewReport.experiment.reasoningEffort,
  searchContextSize: reviewReport.experiment.searchContextSize,
  maxToolCalls: Math.min(2, reviewReport.experiment.maxToolCalls),
  maximumExaSpendUsd: options.maximumExaSpendUsd,
}
const defaultOut = `packages/series-source-trial/private-results/corpus-series-shadow-exa/${reviewSha256.slice(0, 12)}_${options.offset}-${end}_${timestamp()}.json`
const outputPath = resolve(repositoryRoot, options.out ?? defaultOut)
assertPrivate(outputPath, 'output')

if (options.dryRun) {
  console.log(
    JSON.stringify({
      purpose: 'corpus-series-shadow-exa-fallback-dry-run',
      sourceFrameSha256: reviewReport.sourceFrame.sha256,
      reviewSha256,
      graphSha256,
      offset: options.offset,
      end,
      totalWorks: queue.length,
      selectedWorks: selected.length,
      experiment,
    }),
  )
  process.exit(0)
}

if (options.envFile) await loadLocalEnvironment(options.envFile)
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for Exa follow-up')
if (!process.env.EXA_API_KEY) throw new Error('EXA_API_KEY is required for Exa follow-up')

const cacheRoot = resolve(privateRoot, `corpus-series-shadow-exa-cache/${reviewSha256}`)
await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
const budget = await createCorpusShadowExaBudget({
  path: resolve(privateRoot, `corpus-series-shadow-exa-state/${reviewSha256}.json`),
  reviewSha256,
  maximumUsd: options.maximumExaSpendUsd,
})

const restrictedSearch = async (target, domains, policy, cacheKey) => {
  const domainsHash = createHash('sha256').update(JSON.stringify(domains)).digest('hex')
  const cachePath = resolve(cacheRoot, `${cacheKey}-${domainsHash}-luna.json`)
  try {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'))
    const output = canonicalizeAuthorityAcquisition(cached.rawOutput, cached.consultedUrls, policy)
    return {
      status: 'completed',
      ...cached,
      output,
      validation: validateAuthorityAcquisition(target, output, cached.consultedUrls, policy),
      cached: true,
      billing: emptyBilling(),
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  try {
    const acquired = await acquireAuthorityEvidence(target, {
      apiUrl: options.apiUrl,
      model: experiment.model,
      reasoningEffort: experiment.reasoningEffort,
      searchContextSize: experiment.searchContextSize,
      maxToolCalls: experiment.maxToolCalls,
      allowedDomains: domains,
      searchStrategy: 'exa-discovered-origin-focus',
    })
    const output = canonicalizeAuthorityAcquisition(acquired.output, acquired.consultedUrls, policy)
    const validation = validateAuthorityAcquisition(target, output, acquired.consultedUrls, policy)
    const { output: rawOutput, ...metadata } = acquired
    const record = { ...metadata, rawOutput }
    await writeFile(cachePath, `${JSON.stringify(record, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    return {
      status: 'completed',
      ...record,
      output,
      validation,
      cached: false,
      billing: {
        modelCalls: 1,
        webSearchCalls: Number(acquired.webSearchCalls ?? 0),
        inputTokens: Number(acquired.usage?.input_tokens ?? 0),
        outputTokens: Number(acquired.usage?.output_tokens ?? 0),
      },
    }
  } catch (error) {
    return {
      status: 'error',
      infrastructureFailure: error?.infrastructureFailure === true,
      cached: false,
      billing: emptyBilling(),
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
      webSearchCalls: 0,
    }
  }
}

const runOne = async (work) => {
  const target = buildAuthorityTarget(work.identity)
  const policy = authorityPolicyForCase(work.identity)
  const cacheKey = corpusShadowExaCacheKey(work, experiment, reviewSha256)
  const cachePath = resolve(cacheRoot, `${cacheKey}.json`)
  try {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'))
    if (cached?.cacheKey !== cacheKey || !cached?.result) {
      throw new Error('Corpus shadow Exa cache does not match the current work')
    }
    return {
      ...cached.result,
      cached: true,
      runBilling: emptyBilling(),
      runExaOperations: { requests: 0, estimatedCostUsd: 0 },
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const firstPass = corpusShadowExaFirstPass(work)
  const result = await augmentWithExaAuthorityFallback(target, firstPass, {
    policy,
    apiKey: process.env.EXA_API_KEY,
    locate: (locatedTarget, locatorOptions) =>
      runExaAuthorityLocator(locatedTarget, {
        ...locatorOptions,
        fetchImpl: async (...args) => {
          await budget.reserve()
          return fetch(...args)
        },
      }),
    searchDomains: (restrictedTarget, domains) =>
      restrictedSearch(restrictedTarget, domains, policy, cacheKey),
  })
  const runExaOperations = result.exaFallback?.locator?.operations ?? {
    requests: 0,
    estimatedCostUsd: 0,
  }
  const complete = {
    ...result,
    caseId: work.caseId,
    reasons: work.reasons,
    groupIds: work.groupIds,
    cached: false,
    runBilling: result.billing ?? emptyBilling(),
    runExaOperations,
  }
  if (
    complete.exaFallback?.locator?.status === 'completed' &&
    complete.exaFallback?.search?.status !== 'error'
  ) {
    await writeFile(cachePath, `${JSON.stringify({ cacheKey, result: complete }, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
  }
  return complete
}

const results = Array(selected.length)
let nextIndex = 0
let completed = 0
async function worker() {
  while (nextIndex < selected.length) {
    const index = nextIndex
    nextIndex += 1
    try {
      results[index] = await runOne(selected[index])
    } catch (error) {
      results[index] = {
        caseId: selected[index].caseId,
        reasons: selected[index].reasons,
        groupIds: selected[index].groupIds,
        status: 'error',
        error:
          error?.message === 'corpus_shadow_exa_budget_exhausted'
            ? 'budget_exhausted'
            : 'fallback_failed',
        cached: false,
        runBilling: emptyBilling(),
        runExaOperations: { requests: 0, estimatedCostUsd: 0 },
      }
    }
    completed += 1
    console.log(`corpus shadow Exa fallback ${completed}/${selected.length}`)
  }
}

await Promise.all(Array.from({ length: options.concurrency }, () => worker()))
const report = buildCorpusShadowExaReport({
  reviewReport,
  reviewSha256,
  graphSha256,
  offset: options.offset,
  end,
  totalWorks: queue.length,
  experiment,
  results,
})
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
  flag: 'wx',
})
console.log(
  JSON.stringify({
    purpose: report.purpose,
    sourceFrameSha256: report.sourceFrame.sha256,
    reviewSha256,
    queueRange: report.queueRange,
    counts: report.counts,
    budget: budget.snapshot(),
    output: outputPath,
  }),
)
