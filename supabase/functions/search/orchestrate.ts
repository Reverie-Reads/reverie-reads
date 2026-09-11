export type SearchProviderName = 'hardcover' | 'google'

export interface SearchProviderAttempt<T> {
  provider: SearchProviderName
  status: 'disabled' | 'ok' | 'failed'
  results: T[]
  error?: unknown
}

export interface SearchProviderOutcome<T> {
  results: T[]
  failures: SearchProviderAttempt<T>[]
  degraded: boolean
  unavailable: boolean
}

interface SearchProviderOptions<T> {
  hardcoverEnabled: boolean
  runHardcover: () => Promise<T[]>
  runGoogle: () => Promise<T[]>
  hardcoverFillThreshold: number
  resultLimit: number
  dedupe: (results: T[]) => T[]
}

async function attempt<T>(
  provider: SearchProviderName,
  enabled: boolean,
  run: () => Promise<T[]>,
): Promise<SearchProviderAttempt<T>> {
  if (!enabled) return { provider, status: 'disabled', results: [] }
  try {
    return { provider, status: 'ok', results: await run() }
  } catch (error) {
    return { provider, status: 'failed', results: [], error }
  }
}

/**
 * Run the production search provider chain without converting an upstream refusal into a genuine
 * empty catalog result. Partial results remain useful, but when the final result is empty and any
 * attempted provider failed, the caller must surface an unavailable response to the reader.
 */
export async function runSearchProviders<T>(
  options: SearchProviderOptions<T>,
): Promise<SearchProviderOutcome<T>> {
  const hardcover = await attempt('hardcover', options.hardcoverEnabled, options.runHardcover)
  const google =
    hardcover.results.length < options.hardcoverFillThreshold
      ? await attempt('google', true, options.runGoogle)
      : ({ provider: 'google', status: 'disabled', results: [] } satisfies SearchProviderAttempt<T>)

  // Keep the Google result set in the provider's original order and do not remove entries merely
  // because Hardcover returned the same work. Google Books' display rules prohibit reordering or
  // altering its search results and require them to remain visually separate from another search
  // provider. The caller renders these contiguous provider blocks as separate sections.
  const hardcoverResults = options.dedupe(hardcover.results).slice(0, options.resultLimit)
  const googleResults = google.results.slice(0, options.resultLimit)
  const results = [...hardcoverResults, ...googleResults]
  const failures = [hardcover, google].filter(
    (provider): provider is SearchProviderAttempt<T> & { status: 'failed' } =>
      provider.status === 'failed',
  )

  return {
    results,
    failures,
    degraded: failures.length > 0,
    unavailable: results.length === 0 && failures.length > 0,
  }
}
