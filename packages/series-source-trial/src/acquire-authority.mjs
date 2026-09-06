import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadTrialCases } from './cases.mjs'
import samplePlan from '../data/authority-sample-plan.json' with { type: 'json' }
import { loadLocalEnvironment } from './env.mjs'
import {
  authorityAcquisitionCacheMaterial,
  authorityPolicyForCase,
  buildAuthorityTarget,
  canonicalizeAuthorityAcquisition,
  scoreAuthorityAcquisition,
  shouldRepairAuthorityAcquisition,
  validateAuthorityAcquisition,
} from './authority/evidence.mjs'
import { acquireAuthorityEvidence, repairAuthorityEvidence } from './authority/openai.mjs'
import { interpretRetrievedAuthorityEvidenceWithCache } from './authority/retrieval/cache.mjs'
import { augmentAuthorityAcquisition } from './authority/retrieval/pipeline.mjs'
import {
  AUTHORITY_RETRIEVAL_PROFILES_VERSION,
  authorityRetrievalProfiles,
} from './authority/retrieval/profiles.mjs'
import { AUTHORITY_ACQUISITION_PROMPT_VERSION } from './authority/schema.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')

const parseArgs = (argv) => {
  const options = {
    scope: 'gold',
    max: null,
    ids: null,
    out: null,
    refresh: false,
    retrieval: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--scope') options.scope = argv[++index]
    else if (value === '--max') options.max = Number(argv[++index])
    else if (value === '--ids') options.ids = argv[++index].split(',').filter(Boolean)
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--refresh') options.refresh = true
    else if (value === '--retrieval') options.retrieval = true
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!['all', 'gold', 'candidate'].includes(options.scope)) {
    throw new Error('Authority acquisition scope must be all, gold, or candidate')
  }
  if (options.max !== null && (!Number.isInteger(options.max) || options.max < 1)) {
    throw new Error('Authority acquisition max must be a positive integer')
  }
  return options
}

const timestamp = () =>
  new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
const percent = (value) => (value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`)

const renderMarkdown = (score) =>
  `${[
    '# Reverie authority-source acquisition shadow score',
    '',
    `Model: ${score.model}`,
    `Cases: ${score.scope.cases}; reviewed: ${score.scope.reviewedCases}; series: ${score.scope.positiveCases}; standalone: ${score.scope.standaloneCases}; candidates: ${score.scope.candidateCases}.`,
    '',
    '| Valid output | Policy-safe | Grounded URLs | Resolved | Resolved accuracy | Effective accuracy | Series precision | Series recall | False standalone | False series |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${percent(score.capability.validResponseRate)} | ${percent(score.capability.policySafeResponseRate)} | ${percent(score.capability.sourceGroundingRate)} | ${percent(score.capability.resolutionRate)} | ${percent(score.capability.resolvedAccuracy)} | ${percent(score.capability.effectiveAccuracy)} | ${percent(score.capability.membershipPrecision)} | ${percent(score.capability.membershipRecall)} | ${percent(score.capability.falseStandaloneRate)} | ${percent(score.capability.falseSeriesRate)} |`,
    '',
    `Model calls: ${score.operations.modelCalls}; cached: ${score.operations.cached}; web-search calls: ${score.operations.webSearchCalls}; input/output tokens: ${score.operations.inputTokens}/${score.operations.outputTokens}; errors: ${score.operations.errors}.`,
    `Structural repair: ${score.operations.repairCalls} calls; ${score.operations.repairInputTokens}/${score.operations.repairOutputTokens} input/output tokens.`,
    `Retrieval: ${score.operations.retrievalAttempts} attempted; ${score.operations.retrievalSucceeded} retrieved; ${score.operations.retrievalSelected} selected; ${score.operations.retrievalRequests} HTTP requests; ${score.operations.retrievalEncodedBytes} encoded bytes; ${score.operations.secondModelCalls} second model calls; ${score.operations.secondCached} cached; ${score.operations.secondInputTokens}/${score.operations.secondOutputTokens} second-pass input/output tokens.`,
    ...(score.scope.candidateCases
      ? [
          `Candidate queue: ${score.candidateQueue.seriesProposals} series proposals; ${score.candidateQueue.standaloneProposals} standalone proposals; ${score.candidateQueue.unresolved} unresolved; ${score.candidateQueue.quarantined} quarantined.`,
        ]
      : []),
    '',
    'Gold labels and known authority URLs were withheld from the model. A URL is grounded only when it appears in the applicable same-run source manifest: hosted search for the first pass or the retrieved child for the second. Policy-safe also excludes selection-frame evidence and known conflicting marketing taxonomies.',
    'Every result is review-only. This tool cannot write authority gold, Supabase, or Reverie corpus data.',
  ].join('\n')}\n`

await loadLocalEnvironment(resolve(packageRoot, '.env.local'))
const options = parseArgs(process.argv.slice(2))
const caseSet = await loadTrialCases()
let cases = caseSet.cases.filter((testCase) => {
  if (options.scope === 'gold') return testCase.truth.status === 'reviewed'
  if (options.scope === 'candidate') return testCase.truth.status === 'candidate'
  return true
})
if (options.ids) {
  const ids = new Set(options.ids)
  cases = cases.filter((testCase) => ids.has(testCase.id))
  const missing = options.ids.filter((id) => !cases.some((testCase) => testCase.id === id))
  if (missing.length) throw new Error(`Unknown or out-of-scope case ids: ${missing.join(', ')}`)
}
cases = cases.slice(0, options.max ?? undefined)
if (!cases.length) throw new Error('Authority acquisition selection is empty')

const model = process.env.BOOK_AUTHORITY_MODEL ?? 'gpt-5.6-luna'
const cacheRoot = resolve(packageRoot, 'private-results/authority-acquisition-cache')
await mkdir(cacheRoot, { recursive: true })
const retrievalCacheRoot = resolve(
  packageRoot,
  'private-results/authority-retrieval-interpretation-cache',
)
if (options.retrieval) await mkdir(retrievalCacheRoot, { recursive: true })
const cacheKey = (target) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        cacheVersion: 3,
        model,
        promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
        target: authorityAcquisitionCacheMaterial(target),
      }),
    )
    .digest('hex')

const interpretWithCache = async (target, retrieval, interpretOptions) => {
  return interpretRetrievedAuthorityEvidenceWithCache(target, retrieval, {
    cacheRoot: retrievalCacheRoot,
    model,
    refresh: options.refresh,
    interpretOptions,
  })
}

const runOne = async (testCase) => {
  const target = buildAuthorityTarget(testCase)
  const policy = authorityPolicyForCase(testCase, samplePlan)
  const finalize = (firstPass) =>
    options.retrieval
      ? augmentAuthorityAcquisition(target, firstPass, {
          profiles: authorityRetrievalProfiles,
          policy,
          interpret: interpretWithCache,
          interpretOptions: { model },
        })
      : firstPass
  const cachePath = resolve(cacheRoot, `${cacheKey(target)}.json`)
  if (!options.refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'))
      const rawOutput = cached.rawOutput ?? cached.output
      const output = canonicalizeAuthorityAcquisition(rawOutput, cached.consultedUrls, policy)
      const cachedMetadata = { ...cached }
      delete cachedMetadata.output
      delete cachedMetadata.rawOutput
      return await finalize({
        caseId: target.caseId,
        status: 'completed',
        ...cachedMetadata,
        output,
        cached: true,
        validation: validateAuthorityAcquisition(target, output, cached.consultedUrls, policy),
      })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  try {
    const acquired = await acquireAuthorityEvidence(target, { model })
    const { output: firstRawOutput, ...acquiredMetadata } = acquired
    let rawOutput = firstRawOutput
    let output = canonicalizeAuthorityAcquisition(rawOutput, acquired.consultedUrls, policy)
    let validation = validateAuthorityAcquisition(target, output, acquired.consultedUrls, policy)
    let repair = null
    if (shouldRepairAuthorityAcquisition(validation)) {
      repair = await repairAuthorityEvidence(target, output, validation.errors, { model })
      rawOutput = repair.output
      output = canonicalizeAuthorityAcquisition(rawOutput, acquired.consultedUrls, policy)
      validation = validateAuthorityAcquisition(target, output, acquired.consultedUrls, policy)
    }
    const usage = {
      input_tokens:
        Number(acquired.usage?.input_tokens ?? 0) + Number(repair?.usage?.input_tokens ?? 0),
      output_tokens:
        Number(acquired.usage?.output_tokens ?? 0) + Number(repair?.usage?.output_tokens ?? 0),
      total_tokens:
        Number(acquired.usage?.total_tokens ?? 0) + Number(repair?.usage?.total_tokens ?? 0),
    }
    const cacheRecord = {
      ...acquiredMetadata,
      usage,
      primaryUsage: acquired.usage,
      repair,
      modelCallCount: repair ? 2 : 1,
      rawOutput,
    }
    await writeFile(cachePath, `${JSON.stringify(cacheRecord, null, 2)}\n`)
    return await finalize({
      caseId: target.caseId,
      status: 'completed',
      ...cacheRecord,
      output,
      cached: false,
      validation,
    })
  } catch (error) {
    return {
      caseId: target.caseId,
      status: 'error',
      error: String(error),
      cached: false,
      latencyMs: null,
      webSearchCalls: 0,
    }
  }
}

const concurrency = Math.max(1, Math.min(4, Number(process.env.BOOK_AUTHORITY_CONCURRENCY ?? 2)))
const results = Array(cases.length)
let nextIndex = 0
let completed = 0
async function worker() {
  while (nextIndex < cases.length) {
    const index = nextIndex
    nextIndex += 1
    results[index] = await runOne(cases[index])
    completed += 1
    console.log(`authority acquisition ${completed}/${cases.length}`)
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()))

const selectedCaseSet = { ...caseSet, cases }
const score = scoreAuthorityAcquisition(selectedCaseSet, results, model)
const basePath = resolve(
  repositoryRoot,
  options.out ??
    `packages/series-source-trial/private-results/authority-acquisition/${options.scope}_${timestamp()}`,
)
await mkdir(dirname(basePath), { recursive: true })
await Promise.all([
  writeFile(
    `${basePath}.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        model,
        promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
        retrievalEnabled: options.retrieval,
        retrievalProfilesVersion: AUTHORITY_RETRIEVAL_PROFILES_VERSION,
        targets: cases.map(buildAuthorityTarget),
        results,
        score,
      },
      null,
      2,
    )}\n`,
  ),
  writeFile(`${basePath}.md`, renderMarkdown(score)),
])

console.log(renderMarkdown(score))
console.log(`Wrote ${basePath}.json and ${basePath}.md`)
