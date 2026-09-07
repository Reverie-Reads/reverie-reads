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
import {
  discoveredAuthorityDomains,
  shouldSelectFocusedAuthoritySearch,
} from './authority/focused-search.mjs'
import { interpretRetrievedAuthorityEvidenceWithCache } from './authority/retrieval/cache.mjs'
import { augmentAuthorityAcquisition } from './authority/retrieval/pipeline.mjs'
import {
  AUTHORITY_RETRIEVAL_PROFILES_VERSION,
  authorityRetrievalProfiles,
} from './authority/retrieval/profiles.mjs'
import { AUTHORITY_ACQUISITION_PROMPT_VERSION } from './authority/schema.mjs'
import { auditAuthorityDiscoveryHoldout } from './authority/discovery-benchmark.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')

const parseArgs = (argv) => {
  const options = {
    scope: 'gold',
    max: null,
    ids: null,
    holdout: null,
    out: null,
    refresh: false,
    retrieval: false,
    model: process.env.BOOK_AUTHORITY_MODEL ?? 'gpt-5.6-luna',
    reasoningEffort: process.env.BOOK_AUTHORITY_REASONING ?? 'low',
    searchContextSize: process.env.BOOK_AUTHORITY_SEARCH_CONTEXT_SIZE ?? 'medium',
    maxToolCalls: Number(process.env.BOOK_AUTHORITY_MAX_TOOL_CALLS ?? 3),
    focusedSearch: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--scope') options.scope = argv[++index]
    else if (value === '--max') options.max = Number(argv[++index])
    else if (value === '--ids') options.ids = argv[++index].split(',').filter(Boolean)
    else if (value === '--holdout') options.holdout = argv[++index]
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--model') options.model = argv[++index]
    else if (value === '--reasoning') options.reasoningEffort = argv[++index]
    else if (value === '--search-context') options.searchContextSize = argv[++index]
    else if (value === '--max-tool-calls') options.maxToolCalls = Number(argv[++index])
    else if (value === '--focused-search') options.focusedSearch = true
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
  if (options.holdout && (options.ids || options.max !== null || options.scope !== 'gold')) {
    throw new Error('Authority acquisition --holdout requires gold scope without --ids or --max')
  }
  if (!options.model?.trim()) throw new Error('Authority acquisition model is required')
  if (
    !['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(
      options.reasoningEffort,
    )
  ) {
    throw new Error(
      'Authority acquisition reasoning must be none, minimal, low, medium, high, xhigh, max, or ultra',
    )
  }
  if (!['low', 'medium', 'high'].includes(options.searchContextSize)) {
    throw new Error('Authority acquisition search context must be low, medium, or high')
  }
  if (
    !Number.isInteger(options.maxToolCalls) ||
    options.maxToolCalls < 1 ||
    options.maxToolCalls > 6
  ) {
    throw new Error('Authority acquisition max tool calls must be an integer from 1 to 6')
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
    `Model: ${score.model}; reasoning: ${score.experiment.reasoningEffort}; search context: ${score.experiment.searchContextSize}; search budget: ${score.experiment.maxToolCalls}.`,
    `Cases: ${score.scope.cases}; reviewed: ${score.scope.reviewedCases}; series: ${score.scope.positiveCases}; standalone: ${score.scope.standaloneCases}; candidates: ${score.scope.candidateCases}.`,
    '',
    '| Valid output | Policy-safe | Grounded URLs | Resolved | Resolved accuracy | Effective accuracy | Series precision | Series recall | False standalone | False series |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${percent(score.capability.validResponseRate)} | ${percent(score.capability.policySafeResponseRate)} | ${percent(score.capability.sourceGroundingRate)} | ${percent(score.capability.resolutionRate)} | ${percent(score.capability.resolvedAccuracy)} | ${percent(score.capability.effectiveAccuracy)} | ${percent(score.capability.membershipPrecision)} | ${percent(score.capability.membershipRecall)} | ${percent(score.capability.falseStandaloneRate)} | ${percent(score.capability.falseSeriesRate)} |`,
    '',
    `Model calls: ${score.operations.modelCalls}; cached: ${score.operations.cached}; web-search calls: ${score.operations.webSearchCalls}; input/output tokens: ${score.operations.inputTokens}/${score.operations.outputTokens}; errors: ${score.operations.errors}.`,
    `Focused search: ${score.operations.focusedSearchAttempts} attempted; ${score.operations.focusedSearchCalls} model calls; ${score.operations.focusedSearchSelected} selected; ${score.operations.focusedSearchInputTokens}/${score.operations.focusedSearchOutputTokens} input/output tokens.`,
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
let holdout = null
if (options.holdout) {
  const holdoutPath = resolve(repositoryRoot, options.holdout)
  const authorityGoldPath = resolve(packageRoot, 'data/authority-gold.json')
  const [loadedHoldout, authorityGoldText] = await Promise.all([
    readFile(holdoutPath, 'utf8').then(JSON.parse),
    readFile(authorityGoldPath, 'utf8'),
  ])
  const audit = auditAuthorityDiscoveryHoldout(caseSet, loadedHoldout, { authorityGoldText })
  if (!audit.valid)
    throw new Error(`Invalid authority discovery holdout: ${audit.errors.join('; ')}`)
  if (loadedHoldout.promptVersion !== AUTHORITY_ACQUISITION_PROMPT_VERSION) {
    throw new Error(
      `Authority discovery holdout requires ${loadedHoldout.promptVersion}; current prompt is ${AUTHORITY_ACQUISITION_PROMPT_VERSION}`,
    )
  }
  holdout = loadedHoldout
}
let cases = caseSet.cases.filter((testCase) => {
  if (options.scope === 'gold') return testCase.truth.status === 'reviewed'
  if (options.scope === 'candidate') return testCase.truth.status === 'candidate'
  return true
})
const selectedIds = holdout ? holdout.cases.map(({ id }) => id) : options.ids
if (selectedIds) {
  const availableById = new Map(cases.map((testCase) => [testCase.id, testCase]))
  const missing = selectedIds.filter((id) => !availableById.has(id))
  if (missing.length) throw new Error(`Unknown or out-of-scope case ids: ${missing.join(', ')}`)
  cases = selectedIds.map((id) => availableById.get(id))
}
cases = cases.slice(0, options.max ?? undefined)
if (!cases.length) throw new Error('Authority acquisition selection is empty')

const model = options.model
const experiment = {
  reasoningEffort: options.reasoningEffort,
  searchContextSize: options.searchContextSize,
  maxToolCalls: options.maxToolCalls,
}
const cacheRoot = resolve(packageRoot, 'private-results/authority-acquisition-cache')
await mkdir(cacheRoot, { recursive: true })
const retrievalCacheRoot = resolve(
  packageRoot,
  'private-results/authority-retrieval-interpretation-cache',
)
if (options.retrieval) await mkdir(retrievalCacheRoot, { recursive: true })
const focusedSearchCacheRoot = resolve(
  packageRoot,
  'private-results/authority-focused-search-cache',
)
if (options.focusedSearch) await mkdir(focusedSearchCacheRoot, { recursive: true })
const cacheKey = (target) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        cacheVersion: 5,
        model,
        experiment,
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

const emptyBilling = () => ({
  modelCalls: 0,
  webSearchCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
})
const usageFor = (value) => ({
  input_tokens: Number(value?.input_tokens ?? 0),
  output_tokens: Number(value?.output_tokens ?? 0),
  total_tokens: Number(value?.total_tokens ?? 0),
})
const addUsage = (...values) =>
  values.map(usageFor).reduce(
    (total, value) => ({
      input_tokens: total.input_tokens + value.input_tokens,
      output_tokens: total.output_tokens + value.output_tokens,
      total_tokens: total.total_tokens + value.total_tokens,
    }),
    usageFor(),
  )
const addBilling = (...values) =>
  values.reduce(
    (total, value) => ({
      modelCalls: total.modelCalls + Number(value?.modelCalls ?? 0),
      webSearchCalls: total.webSearchCalls + Number(value?.webSearchCalls ?? 0),
      inputTokens: total.inputTokens + Number(value?.inputTokens ?? 0),
      outputTokens: total.outputTokens + Number(value?.outputTokens ?? 0),
    }),
    emptyBilling(),
  )

const focusedCacheKey = (target, domains) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        cacheVersion: 1,
        model,
        experiment,
        promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
        target: authorityAcquisitionCacheMaterial(target),
        domains,
      }),
    )
    .digest('hex')

const focusedSearchWithCache = async (target, domains, policy) => {
  const cachePath = resolve(focusedSearchCacheRoot, `${focusedCacheKey(target, domains)}.json`)
  if (!options.refresh) {
    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf8'))
      const rawOutput = cached.rawOutput ?? cached.output
      const output = canonicalizeAuthorityAcquisition(rawOutput, cached.consultedUrls, policy)
      return {
        status: 'completed',
        ...cached,
        rawOutput,
        output,
        validation: validateAuthorityAcquisition(target, output, cached.consultedUrls, policy),
        cached: true,
        billing: emptyBilling(),
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  try {
    const acquired = await acquireAuthorityEvidence(target, {
      model,
      reasoningEffort: experiment.reasoningEffort,
      searchContextSize: experiment.searchContextSize,
      maxToolCalls: Math.min(2, experiment.maxToolCalls),
      allowedDomains: domains,
      searchStrategy: 'discovered-origin-focus',
    })
    const { output: rawOutput, ...metadata } = acquired
    const output = canonicalizeAuthorityAcquisition(rawOutput, acquired.consultedUrls, policy)
    const validation = validateAuthorityAcquisition(target, output, acquired.consultedUrls, policy)
    const cacheRecord = { ...metadata, rawOutput, modelCallCount: 1 }
    await writeFile(cachePath, `${JSON.stringify(cacheRecord, null, 2)}\n`)
    return {
      status: 'completed',
      ...cacheRecord,
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
      error: String(error),
      cached: false,
      billing: emptyBilling(),
      webSearchCalls: 0,
      usage: usageFor(),
    }
  }
}

const augmentWithFocusedSearch = async (target, firstPass, policy) => {
  const domains = discoveredAuthorityDomains(firstPass)
  if (!domains.length) {
    return {
      ...firstPass,
      focusedSearch: { status: 'skipped', reason: 'no_discovered_authority_origin' },
    }
  }
  const focusedPass = await focusedSearchWithCache(target, domains, policy)
  const selected = shouldSelectFocusedAuthoritySearch(firstPass, focusedPass)
  const billing = addBilling(firstPass.billing, focusedPass.billing)
  const combined = {
    ...firstPass,
    ...(selected ? { output: focusedPass.output, validation: focusedPass.validation } : {}),
    consultedUrls: [
      ...new Set([...(firstPass.consultedUrls ?? []), ...(focusedPass.consultedUrls ?? [])]),
    ],
    searchedQueries: [
      ...new Set([...(firstPass.searchedQueries ?? []), ...(focusedPass.searchedQueries ?? [])]),
    ],
    webSearchCalls: Number(firstPass.webSearchCalls ?? 0) + Number(focusedPass.webSearchCalls ?? 0),
    usage: addUsage(firstPass.usage, focusedPass.usage),
    modelCallCount: Number(firstPass.modelCallCount ?? 1) + Number(focusedPass.modelCallCount ?? 0),
    latencyMs: Number(firstPass.latencyMs ?? 0) + Number(focusedPass.latencyMs ?? 0),
    selectedPass: selected ? 'focused_search' : (firstPass.selectedPass ?? 'first'),
    billing,
    cached: billing.modelCalls === 0,
    focusedSearch: {
      ...focusedPass,
      candidateDomains: domains,
      selected,
      baseline: {
        output: firstPass.output,
        validation: firstPass.validation,
        consultedUrls: firstPass.consultedUrls ?? [],
      },
    },
  }
  return combined
}

const runOne = async (testCase) => {
  const target = buildAuthorityTarget(testCase)
  const policy = authorityPolicyForCase(testCase, samplePlan)
  const finalize = async (firstPass) => {
    const searched = options.focusedSearch
      ? await augmentWithFocusedSearch(target, firstPass, policy)
      : firstPass
    return options.retrieval
      ? augmentAuthorityAcquisition(target, searched, {
          profiles: authorityRetrievalProfiles,
          policy,
          interpret: interpretWithCache,
          interpretOptions: { model },
        })
      : searched
  }
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
        billing: emptyBilling(),
        validation: validateAuthorityAcquisition(target, output, cached.consultedUrls, policy),
      })
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }

  try {
    const acquired = await acquireAuthorityEvidence(target, {
      model,
      reasoningEffort: experiment.reasoningEffort,
      searchContextSize: experiment.searchContextSize,
      maxToolCalls: experiment.maxToolCalls,
    })
    const { output: firstRawOutput, ...acquiredMetadata } = acquired
    let rawOutput = firstRawOutput
    let output = canonicalizeAuthorityAcquisition(rawOutput, acquired.consultedUrls, policy)
    let validation = validateAuthorityAcquisition(target, output, acquired.consultedUrls, policy)
    let repair = null
    if (shouldRepairAuthorityAcquisition(validation)) {
      repair = await repairAuthorityEvidence(target, output, validation.errors, {
        model,
        reasoningEffort: experiment.reasoningEffort,
      })
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
      billing: {
        modelCalls: repair ? 2 : 1,
        webSearchCalls: Number(acquired.webSearchCalls ?? 0),
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      },
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
const score = {
  ...scoreAuthorityAcquisition(selectedCaseSet, results, model),
  experiment,
}
const basePath = resolve(
  repositoryRoot,
  options.out ??
    `packages/series-source-trial/private-results/authority-acquisition/${holdout?.id ?? options.scope}_${timestamp()}`,
)
await mkdir(dirname(basePath), { recursive: true })
await Promise.all([
  writeFile(
    `${basePath}.json`,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        model,
        experiment,
        promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
        holdoutId: holdout?.id ?? null,
        retrievalEnabled: options.retrieval,
        focusedSearchEnabled: options.focusedSearch,
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
