import {
  EXA_AUTHORITY_CANDIDATE_DOMAIN_LIMIT,
  EXA_SEARCH_REQUEST_USD,
  runExaAuthorityLocator,
} from './exa-locator.mjs'
import {
  shouldAttemptFocusedAuthoritySearch,
  shouldSelectFocusedAuthoritySearch,
} from './focused-search.mjs'
import { reviewAuthorityPassTransition } from './evidence.mjs'

const asArray = (value) => (Array.isArray(value) ? value : [])

const emptyBilling = () => ({
  modelCalls: 0,
  webSearchCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
})

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

const locatorSummary = (locator) => ({
  status: locator?.status ?? 'error',
  errorCodes: asArray(locator?.errorCodes),
  operations: {
    queriesPlanned: Number(locator?.operations?.queriesPlanned ?? 0),
    queriesCompleted: Number(locator?.operations?.queriesCompleted ?? 0),
    requests: Number(locator?.operations?.requests ?? 0),
    urlsInspected: Number(locator?.operations?.urlsInspected ?? 0),
    latencyMs: Number(locator?.operations?.latencyMs ?? 0),
    estimatedCostUsd: Number(
      (Number(locator?.operations?.requests ?? 0) * EXA_SEARCH_REQUEST_USD).toFixed(6),
    ),
  },
})

export async function augmentWithExaAuthorityFallback(
  target,
  firstPass,
  { apiKey, locate = runExaAuthorityLocator, searchDomains, policy = {} } = {},
) {
  if (!shouldAttemptFocusedAuthoritySearch(firstPass)) {
    return {
      ...firstPass,
      exaFallback: { status: 'skipped', reason: 'first_pass_resolved', selected: false },
    }
  }
  if (typeof searchDomains !== 'function') {
    throw new Error('Exa authority fallback requires a restricted search function')
  }

  let locator
  try {
    locator = await locate(target, { apiKey })
  } catch {
    return {
      ...firstPass,
      exaFallback: { status: 'error', reason: 'locator_error', selected: false },
    }
  }

  const summary = locatorSummary(locator)
  const candidateDomains = [
    ...new Set(
      asArray(locator?.candidateDomains).filter(
        (domain) => typeof domain === 'string' && domain.trim(),
      ),
    ),
  ].slice(0, EXA_AUTHORITY_CANDIDATE_DOMAIN_LIMIT)
  if (!candidateDomains.length) {
    return {
      ...firstPass,
      latencyMs: Number(firstPass.latencyMs ?? 0) + summary.operations.latencyMs,
      exaFallback: {
        status: 'unresolved',
        reason: 'no_candidate_domains',
        candidateDomainCount: 0,
        locator: summary,
        selected: false,
      },
    }
  }

  let restrictedPass
  try {
    restrictedPass = await searchDomains(target, candidateDomains)
  } catch {
    restrictedPass = {
      status: 'error',
      cached: false,
      billing: emptyBilling(),
      webSearchCalls: 0,
      usage: usageFor(),
    }
  }
  const review = reviewAuthorityPassTransition(firstPass, restrictedPass, policy)
  const selected = shouldSelectFocusedAuthoritySearch(firstPass, restrictedPass, policy)
  const billing = addBilling(firstPass.billing, restrictedPass.billing)

  return {
    ...firstPass,
    authorityPassHistory: review.history,
    ...(selected ? { output: restrictedPass.output, validation: restrictedPass.validation } : {}),
    consultedUrls: [
      ...new Set([...(firstPass.consultedUrls ?? []), ...(restrictedPass.consultedUrls ?? [])]),
    ],
    searchedQueries: [
      ...new Set([...(firstPass.searchedQueries ?? []), ...(restrictedPass.searchedQueries ?? [])]),
    ],
    webSearchCalls:
      Number(firstPass.webSearchCalls ?? 0) + Number(restrictedPass.webSearchCalls ?? 0),
    usage: addUsage(firstPass.usage, restrictedPass.usage),
    modelCallCount:
      Number(firstPass.modelCallCount ?? 1) + Number(restrictedPass.modelCallCount ?? 0),
    latencyMs:
      Number(firstPass.latencyMs ?? 0) +
      summary.operations.latencyMs +
      Number(restrictedPass.latencyMs ?? 0),
    selectedPass: selected ? 'exa_fallback' : (firstPass.selectedPass ?? 'first'),
    billing,
    cached: billing.modelCalls === 0,
    exaFallback: {
      status: restrictedPass.status ?? 'error',
      reviewReasons: review.reasons,
      candidateDomainCount: candidateDomains.length,
      locator: summary,
      selected,
      search: restrictedPass,
      baseline: {
        output: firstPass.output,
        validation: firstPass.validation,
        consultedUrls: firstPass.consultedUrls ?? [],
      },
    },
  }
}
