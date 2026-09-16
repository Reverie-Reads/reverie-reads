import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLocalEnvironment } from './env.mjs'
import {
  buildCorpusShadowReviewReport,
  corpusShadowGroupCacheKey,
  corpusShadowGroupCacheMaterial,
  corpusShadowGroupTarget,
  finalizeCorpusShadowGroupReview,
  sameCorpusShadowReviewExperiment,
  validateCorpusShadowReviewInput,
} from './authority/corpus-shadow-review.mjs'
import { reviewCorpusShadowGroup } from './authority/corpus-shadow-review-openai.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const timestamp = () =>
  new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)

const parseArgs = (argv) => {
  const options = {
    input: null,
    out: null,
    envFile: null,
    offset: 0,
    limit: 25,
    dryRun: false,
    model: process.env.BOOK_AUTHORITY_MODEL ?? 'gpt-5.6-luna',
    reasoningEffort: process.env.BOOK_AUTHORITY_REASONING ?? 'low',
    searchContextSize: process.env.BOOK_AUTHORITY_SEARCH_CONTEXT_SIZE ?? 'medium',
    maxToolCalls: Number(process.env.BOOK_AUTHORITY_MAX_TOOL_CALLS ?? 3),
    concurrency: Number(process.env.BOOK_AUTHORITY_CONCURRENCY ?? 2),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--input') options.input = argv[++index]
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--env') options.envFile = argv[++index]
    else if (value === '--offset') options.offset = Number(argv[++index])
    else if (value === '--limit') options.limit = Number(argv[++index])
    else if (value === '--model') options.model = argv[++index]
    else if (value === '--reasoning') options.reasoningEffort = argv[++index]
    else if (value === '--search-context') options.searchContextSize = argv[++index]
    else if (value === '--max-tool-calls') options.maxToolCalls = Number(argv[++index])
    else if (value === '--concurrency') options.concurrency = Number(argv[++index])
    else if (value === '--dry-run') options.dryRun = true
    else if (value === '--help') options.help = true
    else if (value === '--refresh' || value === '--exa-fallback') {
      throw new Error(`${value} is not available in the Luna group-review stage`)
    } else throw new Error(`Unknown argument ${value}`)
  }
  return options
}

const usage = `Usage: authority:corpus-shadow:review --input MERGED.json [options]

Options:
  --offset N            First candidate group (default 0)
  --limit N             Groups to review, 1..50 (default 25)
  --out PATH            Create-only private JSON report
  --env PATH            Local environment file
  --model MODEL         Default gpt-5.6-luna
  --reasoning LEVEL     Default low
  --search-context SIZE Default medium
  --max-tool-calls N    1..6, default 3
  --concurrency N       1..4, default 2
  --dry-run             Validate and print the selected range without API calls

Exa fallback is intentionally a later stage for unresolved or policy-quarantined Luna output.`

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
if (!options.input) throw new Error(usage)
if (!Number.isInteger(options.offset) || options.offset < 0) {
  throw new Error('Review offset must be a non-negative integer')
}
if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 50) {
  throw new Error('Review limit must be an integer from 1 to 50')
}
if (!options.model?.trim()) throw new Error('Review model is required')
if (
  !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(
    options.reasoningEffort,
  )
) {
  throw new Error('Review reasoning level is invalid')
}
if (!['low', 'medium', 'high'].includes(options.searchContextSize)) {
  throw new Error('Review search context must be low, medium, or high')
}
if (
  !Number.isInteger(options.maxToolCalls) ||
  options.maxToolCalls < 1 ||
  options.maxToolCalls > 6
) {
  throw new Error('Review max tool calls must be an integer from 1 to 6')
}
if (!Number.isInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 4) {
  throw new Error('Review concurrency must be an integer from 1 to 4')
}

const inputPath = resolve(repositoryRoot, options.input)
assertPrivate(inputPath, 'input')
const inputText = await readFile(inputPath, 'utf8')
const inputSha256 = createHash('sha256').update(inputText).digest('hex')
const input = validateCorpusShadowReviewInput(JSON.parse(inputText))
const groups = input.candidateGraph.candidateGroups.slice(
  options.offset,
  options.offset + options.limit,
)
if (!groups.length) throw new Error('Selected review range is empty')
const end = options.offset + groups.length
const experiment = {
  model: options.model,
  reasoningEffort: options.reasoningEffort,
  searchContextSize: options.searchContextSize,
  maxToolCalls: options.maxToolCalls,
}
const defaultOut = `packages/series-source-trial/private-results/corpus-series-shadow-review/${inputSha256.slice(0, 12)}_${options.offset}-${end}_${timestamp()}.json`
const outputPath = resolve(repositoryRoot, options.out ?? defaultOut)
assertPrivate(outputPath, 'output')

if (options.dryRun) {
  console.log(
    JSON.stringify({
      purpose: 'corpus-series-shadow-luna-group-review-dry-run',
      inputSha256,
      sourceFrameSha256: input.sourceFrame.sha256,
      offset: options.offset,
      end,
      totalGroups: input.candidateGraph.candidateGroups.length,
      selectedGroups: groups.length,
      selectedMemberships: groups.reduce((total, group) => total + group.members.length, 0),
      experiment,
    }),
  )
  process.exit(0)
}

if (options.envFile) await loadLocalEnvironment(options.envFile)
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for live review')
const cacheRoot = resolve(privateRoot, `corpus-series-shadow-review-cache/${inputSha256}`)
await mkdir(cacheRoot, { recursive: true, mode: 0o700 })
const results = Array(groups.length)
let nextIndex = 0
let completed = 0

async function reviewOne(group) {
  const target = corpusShadowGroupTarget(group)
  const cacheKey = corpusShadowGroupCacheKey(target, experiment)
  const cachePath = resolve(cacheRoot, `${cacheKey}.json`)
  let acquired
  let cached = false
  try {
    const record = JSON.parse(await readFile(cachePath, 'utf8'))
    if (
      record?.schemaVersion !== 1 ||
      !sameCorpusShadowReviewExperiment(record.experiment, experiment) ||
      JSON.stringify(record.cacheMaterial) !==
        JSON.stringify(corpusShadowGroupCacheMaterial(target, experiment)) ||
      !record.acquired
    ) {
      throw new Error('Corpus shadow review cache does not match the current target')
    }
    acquired = record.acquired
    cached = true
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  if (!acquired) {
    try {
      acquired = await reviewCorpusShadowGroup(target, experiment)
      await writeFile(
        cachePath,
        `${JSON.stringify(
          {
            schemaVersion: 1,
            experiment,
            cacheMaterial: corpusShadowGroupCacheMaterial(target, experiment),
            acquired,
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', mode: 0o600, flag: 'wx' },
      )
    } catch (error) {
      return {
        groupId: target.groupId,
        proposedSeries: target.proposedSeries,
        status: 'error',
        error: error?.infrastructureFailure ? 'infrastructure_failure' : 'review_failed',
        httpStatus: error?.httpStatus ?? null,
        cached: false,
        billing: {
          modelCalls: 0,
          webSearchCalls: 0,
          inputTokens: 0,
          outputTokens: 0,
        },
      }
    }
  }

  const finalized = finalizeCorpusShadowGroupReview(group, acquired)
  return {
    ...finalized,
    cached,
    responseModel: acquired.responseModel ?? experiment.model,
    latencyMs: acquired.latencyMs ?? null,
    billing: {
      modelCalls: cached ? 0 : 1,
      webSearchCalls: cached ? 0 : Number(acquired.webSearchCalls ?? 0),
      inputTokens: cached ? 0 : Number(acquired.usage?.input_tokens ?? 0),
      outputTokens: cached ? 0 : Number(acquired.usage?.output_tokens ?? 0),
    },
  }
}

async function worker() {
  while (nextIndex < groups.length) {
    const index = nextIndex
    nextIndex += 1
    results[index] = await reviewOne(groups[index])
    completed += 1
    console.log(`corpus shadow group review ${completed}/${groups.length}`)
  }
}

await Promise.all(Array.from({ length: options.concurrency }, () => worker()))
const report = buildCorpusShadowReviewReport({
  input,
  inputSha256,
  offset: options.offset,
  end,
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
    inputSha256: report.inputSha256,
    reviewRange: report.reviewRange,
    counts: report.counts,
    output: outputPath,
  }),
)
