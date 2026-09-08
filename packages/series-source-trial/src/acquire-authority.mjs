import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
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
import { augmentWithExaAuthorityFallback } from './authority/exa-fallback.mjs'
import { EXA_SEARCH_REQUEST_USD, runExaAuthorityLocator } from './authority/exa-locator.mjs'
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
import qualificationPlan from '../data/authority-qualification-plan.json' with { type: 'json' }
import evaluationPolicy from '../data/evaluation-policy.json' with { type: 'json' }
import {
  auditQualificationLock,
  buildQualificationSystemManifest,
  evaluateQualificationScore,
} from './authority/qualification.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')

const parseArgs = (argv) => {
  const options = {
    scope: 'gold',
    max: null,
    ids: null,
    holdout: null,
    qualificationLock: null,
    resume: false,
    out: null,
    refresh: false,
    retrieval: false,
    model: process.env.BOOK_AUTHORITY_MODEL ?? 'gpt-5.6-luna',
    apiUrl: process.env.BOOK_AUTHORITY_API_URL ?? 'https://api.openai.com/v1/responses',
    reasoningEffort: process.env.BOOK_AUTHORITY_REASONING ?? 'low',
    searchContextSize: process.env.BOOK_AUTHORITY_SEARCH_CONTEXT_SIZE ?? 'medium',
    maxToolCalls: Number(process.env.BOOK_AUTHORITY_MAX_TOOL_CALLS ?? 3),
    concurrency: Number(process.env.BOOK_AUTHORITY_CONCURRENCY ?? 2),
    focusedSearch: false,
    exaFallback: false,
    maximumExaSpendUsd: Number(process.env.BOOK_AUTHORITY_EXA_BUDGET_USD ?? 10),
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--scope') options.scope = argv[++index]
    else if (value === '--max') options.max = Number(argv[++index])
    else if (value === '--ids') options.ids = argv[++index].split(',').filter(Boolean)
    else if (value === '--holdout') options.holdout = argv[++index]
    else if (value === '--qualification-lock') options.qualificationLock = argv[++index]
    else if (value === '--out') options.out = argv[++index]
    else if (value === '--model') options.model = argv[++index]
    else if (value === '--reasoning') options.reasoningEffort = argv[++index]
    else if (value === '--search-context') options.searchContextSize = argv[++index]
    else if (value === '--max-tool-calls') options.maxToolCalls = Number(argv[++index])
    else if (value === '--focused-search') options.focusedSearch = true
    else if (value === '--exa-fallback') options.exaFallback = true
    else if (value === '--refresh') options.refresh = true
    else if (value === '--retrieval') options.retrieval = true
    else if (value === '--resume') options.resume = true
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
  if (options.qualificationLock) {
    if (
      options.holdout ||
      options.ids ||
      options.max !== null ||
      options.scope !== 'gold' ||
      options.out ||
      options.refresh
    ) {
      throw new Error(
        'Qualification acquisition requires gold scope and forbids --holdout, --ids, --max, --out, and --refresh',
      )
    }
  } else if (options.resume) {
    throw new Error('Authority acquisition --resume requires --qualification-lock')
  }
  if (!options.model?.trim()) throw new Error('Authority acquisition model is required')
  if (options.focusedSearch && options.exaFallback) {
    throw new Error(
      'Authority acquisition focused search and Exa fallback are separate experiments',
    )
  }
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
  if (!Number.isFinite(options.maximumExaSpendUsd) || options.maximumExaSpendUsd <= 0) {
    throw new Error('Authority acquisition Exa budget must be a positive number')
  }
  if (
    !Number.isInteger(options.concurrency) ||
    options.concurrency < 1 ||
    options.concurrency > 4
  ) {
    throw new Error('Authority acquisition concurrency must be an integer from 1 to 4')
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
    `Partition: ${score.evaluationPartition ?? 'development'}. Cases: ${score.scope.cases}; reviewed: ${score.scope.reviewedCases}; series: ${score.scope.positiveCases}; standalone: ${score.scope.standaloneCases}; candidates: ${score.scope.candidateCases}.`,
    '',
    '| Valid output | Policy-safe | Grounded URLs | Resolved | Resolved accuracy | Effective accuracy | Series precision | Series recall | False standalone | False series |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    `| ${percent(score.capability.validResponseRate)} | ${percent(score.capability.policySafeResponseRate)} | ${percent(score.capability.sourceGroundingRate)} | ${percent(score.capability.resolutionRate)} | ${percent(score.capability.resolvedAccuracy)} | ${percent(score.capability.effectiveAccuracy)} | ${percent(score.capability.membershipPrecision)} | ${percent(score.capability.membershipRecall)} | ${percent(score.capability.falseStandaloneRate)} | ${percent(score.capability.falseSeriesRate)} |`,
    ...(score.qualification
      ? [
          '',
          `Qualification: ${score.qualification.passed ? 'passed' : 'failed'}; evaluated membership claims: ${score.qualification.evaluatedMembershipClaims}; failed gates: ${
            score.qualification.checks
              .filter((check) => !check.passed)
              .map((check) => check.id)
              .join(', ') || 'none'
          }.`,
        ]
      : []),
    '',
    `Model calls: ${score.operations.modelCalls}; cached: ${score.operations.cached}; web-search calls: ${score.operations.webSearchCalls}; input/output tokens: ${score.operations.inputTokens}/${score.operations.outputTokens}; errors: ${score.operations.errors}.`,
    `Focused search: ${score.operations.focusedSearchAttempts} attempted; ${score.operations.focusedSearchCalls} model calls; ${score.operations.focusedSearchSelected} selected; ${score.operations.focusedSearchInputTokens}/${score.operations.focusedSearchOutputTokens} input/output tokens.`,
    `Exa fallback: ${score.operations.exaFallbackAttempts} attempted; ${score.operations.exaFallbackSearchesCompleted} searches; ${score.operations.exaFallbackRequests} requests; ${score.operations.exaFallbackUrlsInspected} URLs inspected in memory; ${score.operations.exaFallbackModelCalls} restricted model calls; ${score.operations.exaFallbackSelected} selected; ${score.operations.exaFallbackInputTokens}/${score.operations.exaFallbackOutputTokens} input/output tokens; estimated $${score.operations.exaFallbackEstimatedCostUsd.toFixed(4)} Exa cost.`,
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
if (options.exaFallback && !process.env.EXA_API_KEY?.trim()) {
  throw new Error('EXA_API_KEY is required in packages/series-source-trial/.env.local')
}
const developmentCaseSet = await loadTrialCases()
let caseSet = developmentCaseSet
let holdout = null
let qualificationLock = null
let qualificationLockPath = null
let qualificationRunStatePath = null
let qualificationRunState = null
let qualificationStateWrite = Promise.resolve()
if (options.qualificationLock) {
  qualificationLockPath = resolve(repositoryRoot, options.qualificationLock)
  qualificationLock = await readFile(qualificationLockPath, 'utf8').then(JSON.parse)
  const qualificationSetPath = resolve(repositoryRoot, qualificationLock.dataset.file)
  const privateSetRoot = resolve(packageRoot, 'private-results/authority-qualification')
  const relativeSetPath = relative(privateSetRoot, qualificationSetPath)
  if (!relativeSetPath || relativeSetPath.startsWith('..') || isAbsolute(relativeSetPath)) {
    throw new Error('Qualification lock dataset must remain under private-results')
  }
  const qualificationSet = await readFile(qualificationSetPath, 'utf8').then(JSON.parse)
  const runtime = {
    apiUrl: options.apiUrl,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    searchContextSize: options.searchContextSize,
    maxToolCalls: options.maxToolCalls,
    concurrency: options.concurrency,
    focusedSearch: options.focusedSearch,
    exaFallback: options.exaFallback,
    maximumExaSpendUsd: options.maximumExaSpendUsd,
    retrieval: options.retrieval,
  }
  const systemManifest = await buildQualificationSystemManifest(packageRoot, runtime)
  const audit = auditQualificationLock({
    lock: qualificationLock,
    dataset: qualificationSet,
    plan: qualificationPlan,
    systemManifest,
    developmentCases: developmentCaseSet.cases,
  })
  if (!audit.valid) throw new Error(`Invalid qualification lock: ${audit.errors.join('; ')}`)
  caseSet = qualificationSet

  const stateRoot = resolve(packageRoot, 'private-results/authority-qualification-runs')
  qualificationRunStatePath = resolve(stateRoot, `${qualificationLock.id}.state.json`)
  await mkdir(stateRoot, { recursive: true })
  let existingState = null
  try {
    existingState = JSON.parse(await readFile(qualificationRunStatePath, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }
  if (existingState?.status === 'completed') {
    throw new Error(`Qualification ${qualificationLock.id} already completed and cannot be rerun`)
  }
  if (existingState?.status === 'burned') {
    throw new Error(`Qualification ${qualificationLock.id} is burned and cannot be resumed`)
  }
  if (
    existingState?.status === 'running' &&
    Date.now() - Date.parse(existingState.heartbeatAt ?? existingState.startedAt) < 15 * 60 * 1000
  ) {
    throw new Error(`Qualification ${qualificationLock.id} already has an active run`)
  }
  if (existingState && !options.resume) {
    throw new Error(
      `Qualification ${qualificationLock.id} already started; use --resume only to recover incomplete infrastructure failures`,
    )
  }
  if (existingState?.lockSha256 && existingState.lockSha256 !== qualificationLock.sha256) {
    throw new Error('Qualification run state belongs to a different lock')
  }
  qualificationRunState = existingState
    ? { ...existingState, status: 'running', resumedAt: new Date().toISOString() }
    : {
        schemaVersion: 1,
        qualificationId: qualificationLock.id,
        lockSha256: qualificationLock.sha256,
        status: 'running',
        startedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
        completedCases: 0,
        exaReservedUsd: 0,
      }
  qualificationRunState.heartbeatAt = new Date().toISOString()
  await writeFile(
    qualificationRunStatePath,
    `${JSON.stringify(qualificationRunState, null, 2)}\n`,
    existingState ? undefined : { flag: 'wx', mode: 0o600 },
  )
}
const persistQualificationRunState = async () => {
  if (!qualificationRunStatePath || !qualificationRunState) return
  const snapshot = `${JSON.stringify(qualificationRunState, null, 2)}\n`
  qualificationStateWrite = qualificationStateWrite.then(() =>
    writeFile(qualificationRunStatePath, snapshot),
  )
  await qualificationStateWrite
}
const qualificationHeartbeat = qualificationRunState
  ? setInterval(() => {
      qualificationRunState.heartbeatAt = new Date().toISOString()
      void persistQualificationRunState().catch(() => {})
    }, 60_000)
  : null
qualificationHeartbeat?.unref()
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
  if (!qualificationLock && (testCase.evaluationPartition ?? 'development') !== 'development') {
    return false
  }
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
let reservedExaSpendUsd = Number(qualificationRunState?.exaReservedUsd ?? 0)
let qualificationBudgetExhausted = false
const qualificationExaLocator = async (target, locatorOptions) => {
  if (!qualificationLock) return runExaAuthorityLocator(target, locatorOptions)
  const budgetedFetch = async (...args) => {
    if (reservedExaSpendUsd + EXA_SEARCH_REQUEST_USD > options.maximumExaSpendUsd) {
      qualificationBudgetExhausted = true
      throw new Error('qualification_exa_budget_exhausted')
    }
    reservedExaSpendUsd += EXA_SEARCH_REQUEST_USD
    qualificationRunState.exaReservedUsd = Number(reservedExaSpendUsd.toFixed(6))
    await persistQualificationRunState()
    return fetch(...args)
  }
  return runExaAuthorityLocator(target, { ...locatorOptions, fetchImpl: budgetedFetch })
}
const qualificationCacheRoot = qualificationLock
  ? resolve(packageRoot, 'private-results/authority-qualification-cache', qualificationLock.id)
  : null
const cacheRoot = qualificationCacheRoot
  ? resolve(qualificationCacheRoot, 'first-pass')
  : resolve(packageRoot, 'private-results/authority-acquisition-cache')
await mkdir(cacheRoot, { recursive: true })
const retrievalCacheRoot = qualificationCacheRoot
  ? resolve(qualificationCacheRoot, 'retrieval-interpretation')
  : resolve(packageRoot, 'private-results/authority-retrieval-interpretation-cache')
if (options.retrieval) await mkdir(retrievalCacheRoot, { recursive: true })
const focusedSearchCacheRoot = qualificationCacheRoot
  ? resolve(qualificationCacheRoot, 'focused-search')
  : resolve(packageRoot, 'private-results/authority-focused-search-cache')
if (options.focusedSearch) await mkdir(focusedSearchCacheRoot, { recursive: true })
const exaFallbackCacheRoot = qualificationCacheRoot
  ? resolve(qualificationCacheRoot, 'exa-fallback')
  : resolve(packageRoot, 'private-results/authority-exa-fallback-cache')
if (options.exaFallback) await mkdir(exaFallbackCacheRoot, { recursive: true })
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

const restrictedSearchCacheKey = (target, domains, searchStrategy) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        cacheVersion: 2,
        model,
        experiment,
        promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
        target: authorityAcquisitionCacheMaterial(target),
        domains,
        searchStrategy,
      }),
    )
    .digest('hex')

const restrictedSearchWithCache = async (
  target,
  domains,
  policy,
  { cacheRoot, searchStrategy },
) => {
  const cachePath = resolve(
    cacheRoot,
    `${restrictedSearchCacheKey(target, domains, searchStrategy)}.json`,
  )
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
      apiUrl: options.apiUrl,
      model,
      reasoningEffort: experiment.reasoningEffort,
      searchContextSize: experiment.searchContextSize,
      maxToolCalls: Math.min(2, experiment.maxToolCalls),
      allowedDomains: domains,
      searchStrategy,
    })
    const { output: rawOutput, ...metadata } = acquired
    const output = canonicalizeAuthorityAcquisition(rawOutput, acquired.consultedUrls, policy)
    const validation = validateAuthorityAcquisition(target, output, acquired.consultedUrls, policy)
    const cacheRecord = { ...metadata, rawOutput, modelCallCount: 1 }
    await writeFile(cachePath, `${JSON.stringify(cacheRecord, null, 2)}\n`, { mode: 0o600 })
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
      infrastructureFailure: error?.infrastructureFailure === true,
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
  const focusedPass = await restrictedSearchWithCache(target, domains, policy, {
    cacheRoot: focusedSearchCacheRoot,
    searchStrategy: 'discovered-origin-focus',
  })
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
  const policy = authorityPolicyForCase(
    testCase,
    qualificationLock ? qualificationPlan : samplePlan,
  )
  const finalize = async (firstPass) => {
    let searched = options.focusedSearch
      ? await augmentWithFocusedSearch(target, firstPass, policy)
      : firstPass
    if (options.exaFallback) {
      searched = await augmentWithExaAuthorityFallback(target, searched, {
        apiKey: process.env.EXA_API_KEY,
        locate: qualificationExaLocator,
        searchDomains: (restrictedTarget, domains) =>
          restrictedSearchWithCache(restrictedTarget, domains, policy, {
            cacheRoot: exaFallbackCacheRoot,
            searchStrategy: 'exa-discovered-origin-focus',
          }),
      })
    }
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
      apiUrl: options.apiUrl,
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
        apiUrl: options.apiUrl,
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
    await writeFile(cachePath, `${JSON.stringify(cacheRecord, null, 2)}\n`, { mode: 0o600 })
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
      infrastructureFailure: error?.infrastructureFailure === true,
      cached: false,
      latencyMs: null,
      webSearchCalls: 0,
    }
  }
}

const concurrency = options.concurrency
const results = Array(cases.length)
let nextIndex = 0
let completed = 0
async function worker() {
  while (nextIndex < cases.length) {
    const index = nextIndex
    nextIndex += 1
    results[index] = await runOne(cases[index])
    completed += 1
    if (qualificationRunState) {
      qualificationRunState.completedCases = completed
      qualificationRunState.heartbeatAt = new Date().toISOString()
      await persistQualificationRunState()
    }
    console.log(`authority acquisition ${completed}/${cases.length}`)
  }
}
try {
  await Promise.all(Array.from({ length: concurrency }, () => worker()))
} finally {
  if (qualificationHeartbeat) clearInterval(qualificationHeartbeat)
}

const selectedCaseSet = { ...caseSet, cases }
const score = {
  ...scoreAuthorityAcquisition(selectedCaseSet, results, model),
  experiment,
  evaluationPartition: qualificationLock ? 'qualification' : 'development',
}
if (qualificationLock) score.qualification = evaluateQualificationScore(score, evaluationPolicy)
const qualificationErrorResults = results.filter((result) => result.status === 'error')
const qualificationErrors = qualificationErrorResults.length
const isResumableExaError = (code) =>
  code === 'timeout' ||
  code === 'network_error' ||
  code === 'http_408' ||
  code === 'http_429' ||
  /^http_5\d\d$/.test(code)
const qualificationExaFailureResults = results.filter((result) => {
  const fallback = result.exaFallback
  if (!fallback || fallback.status === 'skipped') return false
  if (fallback.status === 'error' && !fallback.locator) return true
  if (fallback.locator && fallback.locator.status !== 'completed') return true
  return fallback.search?.status === 'error'
})
const qualificationExaInfrastructureFailures = qualificationExaFailureResults.filter((result) => {
  const fallback = result.exaFallback
  if (fallback.status === 'error' && !fallback.locator) return false
  const codes = fallback.locator?.errorCodes ?? []
  const locatorResumable =
    fallback.locator?.status === 'completed' ||
    (codes.length > 0 && codes.every(isResumableExaError))
  const searchResumable =
    fallback.search?.status !== 'error' || fallback.search.infrastructureFailure === true
  return locatorResumable && searchResumable
}).length
const qualificationHasFailures =
  qualificationErrors > 0 || qualificationExaFailureResults.length > 0
const qualificationInfrastructureFailure =
  qualificationLock &&
  !qualificationBudgetExhausted &&
  qualificationHasFailures &&
  qualificationErrorResults.every((result) => result.infrastructureFailure) &&
  qualificationExaInfrastructureFailures === qualificationExaFailureResults.length
const qualificationUnrecoverableFailure =
  qualificationLock && qualificationHasFailures && !qualificationInfrastructureFailure
const qualificationResponseModels = [
  ...new Set(
    results
      .filter((result) => result.status === 'completed')
      .map((result) => result.responseModel)
      .filter(Boolean),
  ),
]
const qualificationModelDrift =
  qualificationLock && qualificationErrors === 0 && qualificationResponseModels.length !== 1
const basePath = resolve(
  repositoryRoot,
  qualificationLock
    ? `packages/series-source-trial/private-results/authority-qualification-runs/${qualificationLock.id}`
    : (options.out ??
        `packages/series-source-trial/private-results/authority-acquisition/${holdout?.id ?? options.scope}_${timestamp()}`),
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
        holdoutId: qualificationLock?.id ?? holdout?.id ?? null,
        evaluationPartition: qualificationLock ? 'qualification' : 'development',
        qualificationLockSha256: qualificationLock?.sha256 ?? null,
        retrievalEnabled: options.retrieval,
        focusedSearchEnabled: options.focusedSearch,
        exaFallbackEnabled: options.exaFallback,
        retrievalProfilesVersion: AUTHORITY_RETRIEVAL_PROFILES_VERSION,
        targets: cases.map(buildAuthorityTarget),
        results,
        score,
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  ),
  writeFile(`${basePath}.md`, renderMarkdown(score), { mode: 0o600 }),
])

if (qualificationRunStatePath) {
  qualificationRunState = {
    ...qualificationRunState,
    status:
      qualificationBudgetExhausted || qualificationModelDrift || qualificationUnrecoverableFailure
        ? 'burned'
        : qualificationInfrastructureFailure
          ? 'incomplete'
          : 'completed',
    completedAt:
      qualificationHasFailures || qualificationBudgetExhausted || qualificationModelDrift
        ? null
        : new Date().toISOString(),
    qualificationPassed: score.qualification?.passed ?? null,
    errorCases: qualificationErrors,
    exaFailureCases: qualificationExaFailureResults.length,
    exaInfrastructureFailureCases: qualificationExaInfrastructureFailures,
    resumableInfrastructureFailure: qualificationInfrastructureFailure,
    exaReservedUsd: Number(reservedExaSpendUsd.toFixed(6)),
    exaBudgetExhausted: qualificationBudgetExhausted,
    responseModelDrift: qualificationModelDrift,
    responseModels: qualificationResponseModels,
  }
  await persistQualificationRunState()
}

console.log(renderMarkdown(score))
console.log(`Wrote ${basePath}.json and ${basePath}.md`)
if (
  qualificationBudgetExhausted ||
  qualificationModelDrift ||
  qualificationUnrecoverableFailure ||
  qualificationInfrastructureFailure
) {
  throw new Error(
    qualificationBudgetExhausted
      ? 'Qualification burned because the frozen Exa budget was exhausted'
      : qualificationModelDrift
        ? 'Qualification burned because the response model changed during the run'
        : qualificationUnrecoverableFailure
          ? 'Qualification burned because a non-infrastructure acquisition failure occurred'
          : 'Qualification incomplete because of a resumable infrastructure failure',
  )
}
