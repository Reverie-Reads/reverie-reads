import { describe, expect, it, vi } from 'vitest'
import { runSearchProviders } from '../../../supabase/functions/search/orchestrate'

const options = (overrides: Partial<Parameters<typeof runSearchProviders<string>>[0]> = {}) => ({
  hardcoverEnabled: true,
  runHardcover: async () => [] as string[],
  runGoogle: async () => [] as string[],
  hardcoverFillThreshold: 2,
  resultLimit: 20,
  dedupe: (results: string[]) => [...new Set(results)],
  ...overrides,
})

describe('production search provider orchestration', () => {
  it('keeps a successful all-provider miss as an ordinary empty result', async () => {
    const outcome = await runSearchProviders(options())

    expect(outcome).toMatchObject({
      results: [],
      failures: [],
      degraded: false,
      unavailable: false,
    })
  })

  it('does not misreport an upstream failure as a genuine empty search', async () => {
    const outcome = await runSearchProviders(
      options({
        runHardcover: async () => {
          throw new Error('Hardcover refused the request')
        },
        runGoogle: async () => [],
      }),
    )

    expect(outcome.results).toEqual([])
    expect(outcome.failures.map(({ provider }) => provider)).toEqual(['hardcover'])
    expect(outcome).toMatchObject({ degraded: true, unavailable: true })
  })

  it('returns useful fallback results while preserving Google order and marking degradation', async () => {
    const outcome = await runSearchProviders(
      options({
        runHardcover: async () => {
          throw new Error('Hardcover unavailable')
        },
        runGoogle: async () => ['google-book', 'google-book'],
      }),
    )

    expect(outcome.results).toEqual(['google-book', 'google-book'])
    expect(outcome).toMatchObject({ degraded: true, unavailable: false })
  })

  it('keeps provider sections contiguous without removing a Google duplicate', async () => {
    const outcome = await runSearchProviders(
      options({
        runHardcover: async () => ['shared-book'],
        runGoogle: async () => ['shared-book', 'google-second'],
      }),
    )

    expect(outcome.results).toEqual(['shared-book', 'shared-book', 'google-second'])
  })

  it('does not spend a Google request when Hardcover already filled the result set', async () => {
    const runGoogle = vi.fn(async () => ['unused'])
    const outcome = await runSearchProviders(
      options({ runHardcover: async () => ['one', 'two'], runGoogle }),
    )

    expect(runGoogle).not.toHaveBeenCalled()
    expect(outcome.results).toEqual(['one', 'two'])
    expect(outcome.degraded).toBe(false)
  })

  it('surfaces Google failure when Hardcover is not configured', async () => {
    const runHardcover = vi.fn(async () => ['unused'])
    const outcome = await runSearchProviders(
      options({
        hardcoverEnabled: false,
        runHardcover,
        runGoogle: async () => {
          throw new Error('Google refused the request')
        },
      }),
    )

    expect(runHardcover).not.toHaveBeenCalled()
    expect(outcome.failures.map(({ provider }) => provider)).toEqual(['google'])
    expect(outcome.unavailable).toBe(true)
  })
})
