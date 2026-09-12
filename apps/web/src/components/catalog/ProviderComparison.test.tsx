import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider, dehydrate } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as core from '@reverie/core'
import { providerComparisonFixture } from '../../../../../packages/core/src/providerComparison.fixture'
import { ProviderComparison } from './ProviderComparison'
import { CatalogMetadataEditor } from './CatalogMetadataEditor'
import { supabase } from '../../lib/supabase'
import { isOfflinePersistableQueryKey } from '../../lib/offlineCache'
import type { CatalogMetadataWork } from '../../data/corpusMetadataReview'

vi.mock('../../data/corpusMetadataReview', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../data/corpusMetadataReview')>()
  return {
    ...original,
    useCatalogMetadataHistory: () => ({ data: [], isPending: false, isError: false }),
    // Keep the real RPC-writing function as the mutation boundary; don't just spy on a button.
    useSaveCatalogMetadataReview: () => ({
      isPending: false,
      mutateAsync: original.saveCatalogMetadataReview,
    }),
  }
})

const NOW = Date.parse('2026-09-09T12:00:00.000Z')
function setup() {
  const { context, dto } = providerComparisonFixture(NOW)
  const load = vi.fn(
    async (_context: core.ProviderComparisonContext, _signal: AbortSignal): Promise<unknown> =>
      structuredClone(dto),
  )
  const props = {
    context,
    load,
    accountId: 'synthetic-account',
    permission: 'confirmed' as const,
    permissionEpoch: 'checked-1',
    online: true,
    sharedPages: 999,
  }
  return { dto, props, load }
}
async function compare() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Compare selected edition' }))
  })
}
const observations = () => screen.queryByRole('list', { name: 'Provider observations' })

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  vi.spyOn(supabase, 'rpc').mockImplementation(() => {
    throw new Error('unexpected RPC')
  })
  vi.spyOn(supabase, 'from').mockImplementation(() => {
    throw new Error('unexpected table access')
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('unexpected network')
    }),
  )
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('offline provider comparison component', () => {
  it('makes no calls on mount; Compare is explicit and results have no save/apply controls', async () => {
    const { props, load } = setup()
    render(<ProviderComparison {...props} />)
    expect(screen.getByRole('status')).toHaveTextContent('No comparison requested')
    expect(load).not.toHaveBeenCalled()
    await compare()
    expect(load).toHaveBeenCalledTimes(1)
    expect(load.mock.calls[0]![0]).toEqual(props.context)
    const list = observations()!
    expect(within(list).getAllByText('Pages: 312')).toHaveLength(2)
    expect(within(list).getAllByText('Language check: Unknown')).toHaveLength(2)
    expect(screen.getByRole('status')).toHaveTextContent('Sources agree; independence')
    expect(
      screen.getByText('Shared record pages: 999. Edition not established.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /save|apply|accept/i })).not.toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('displays a valid peer alongside title rejection without reconstructing the title', async () => {
    const { props, dto } = setup()
    dto.results[1] = {
      provider: 'openlibrary',
      endpoint: 'isbn_edition',
      status: 'identity_review',
      reason: 'title_mismatch',
      observedAt: dto.acquiredAt,
    }
    dto.joint = 'identity_review'
    render(<ProviderComparison {...props} />)
    await compare()
    expect(screen.getByText('Pages: 312')).toBeInTheDocument()
    expect(screen.getByText('Pages: Withheld')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Identity review needed')
    expect(screen.getByText(/cannot explain the cause/)).toBeInTheDocument()
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })
  it('shares an in-flight request, times it out, and ignores its eventual response', async () => {
    const { props, dto, load } = setup()
    let resolve!: (v: unknown) => void
    load.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    render(<ProviderComparison {...props} />)
    await compare()
    fireEvent.click(screen.getByRole('button', { name: 'Comparing edition…' }))
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(30000)
    })
    expect(load.mock.calls[0]![1].aborted).toBe(true)
    expect(screen.getByRole('status')).toHaveTextContent('Comparison unavailable')
    await act(async () => {
      resolve(dto)
    })
    expect(observations()).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })
  it('expires data without polling or a provider refresh', async () => {
    const { props, load } = setup()
    render(<ProviderComparison {...props} />)
    await compare()
    expect(observations()).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(60000)
    })
    expect(screen.getByRole('status')).toHaveTextContent('Comparison expired')
    expect(observations()).not.toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
  })
  it.each(['blur', 'pagehide', 'offline'])(
    'clears on %s; focus/reconnect cannot restore or refetch',
    async (event) => {
      const { props, load } = setup()
      const ui = render(<ProviderComparison {...props} />)
      await compare()
      expect(observations()).toBeInTheDocument()
      act(() => {
        window.dispatchEvent(new Event(event))
      })
      expect(observations()).not.toBeInTheDocument()
      act(() => {
        window.dispatchEvent(new Event('focus'))
        window.dispatchEvent(new Event('online'))
      })
      expect(screen.getByRole('button')).toBeDisabled()
      expect(load).toHaveBeenCalledTimes(1)
      // A new caller-verified context/permission epoch is needed, with no automatic request.
      ui.rerender(<ProviderComparison {...props} permissionEpoch="checked-2" />)
      expect(screen.getByRole('button')).toBeEnabled()
      expect(observations()).not.toBeInTheDocument()
      expect(load).toHaveBeenCalledTimes(1)
    },
  )
  it.each(['account', 'work', 'isbn', 'fingerprint', 'revision', 'permissionEpoch', 'sharedPages'])(
    'clears delivered values on %s change and rejects late data for the old context',
    async (field) => {
      const { props, dto, load } = setup()
      const ui = render(<ProviderComparison {...props} />)
      await compare()
      expect(observations()).toBeInTheDocument()
      let resolve!: (v: unknown) => void
      load.mockImplementation(
        () =>
          new Promise((r) => {
            resolve = r
          }),
      )
      await compare()
      const changed = { ...props, context: { ...props.context } }
      if (field === 'account') changed.accountId = 'other-account'
      if (field === 'work') changed.context.workId = '00000000-0000-4000-8000-000000000002'
      if (field === 'isbn') changed.context.isbn = '9780140328721'
      if (field === 'fingerprint') changed.context.fingerprint = 'c'.repeat(64)
      if (field === 'revision') changed.context.revision = 2
      if (field === 'permissionEpoch') changed.permissionEpoch = 'checked-2'
      if (field === 'sharedPages') changed.sharedPages = 111
      ui.rerender(<ProviderComparison {...changed} />)
      expect(observations()).not.toBeInTheDocument()
      expect(load.mock.calls[1]![1].aborted).toBe(true)
      await act(async () => {
        resolve(dto)
      })
      expect(observations()).not.toBeInTheDocument()
      expect(screen.getByRole('status')).toHaveTextContent('No comparison requested')
      expect(load).toHaveBeenCalledTimes(2)
    },
  )
  it.each(['offline', 'unknown', 'denied', 'signout', 'unmount'])(
    'removes observations on %s',
    async (reason) => {
      const { props } = setup()
      const ui = render(<ProviderComparison {...props} />)
      await compare()
      expect(observations()).toBeInTheDocument()
      if (reason === 'unmount') ui.unmount()
      else
        ui.rerender(
          <ProviderComparison
            {...props}
            online={reason !== 'offline'}
            accountId={reason === 'signout' ? null : props.accountId}
            permission={reason === 'unknown' || reason === 'denied' ? reason : 'confirmed'}
          />,
        )
      expect(observations()).not.toBeInTheDocument()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    },
  )
  it('clears on tab hiding, including a pending request', async () => {
    const { props, dto, load } = setup()
    let resolve!: (v: unknown) => void
    load.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )
    render(<ProviderComparison {...props} />)
    await compare()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      resolve(dto)
    })
    expect(observations()).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Comparison cleared')
  })
  it('has no implicit first-ISBN or incomplete-identity fallback', () => {
    const { props, load } = setup()
    const ui = render(<ProviderComparison {...props} context={null} />)
    expect(screen.getByText(/Choose a valid, uniquely assigned ISBN/)).toBeInTheDocument()
    ui.rerender(<ProviderComparison {...props} context={{ ...props.context, isbn: 'invalid' }} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(load).not.toHaveBeenCalled()
  })
  it('does not persist, report, log, fetch, or write synthetic payloads and thrown raw errors', async () => {
    const { props, dto, load } = setup()
    const storage = vi.spyOn(window.localStorage, 'setItem')
    const errors = vi.spyOn(core, 'captureError')
    const messages = vi.spyOn(core, 'captureMessage')
    const log = vi.spyOn(console, 'log')
    const errorLog = vi.spyOn(console, 'error')
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <ProviderComparison {...props} />
      </QueryClientProvider>,
    )
    await compare()
    expect(screen.getByRole('link', { name: 'Open Google Books record' })).toHaveAttribute(
      'href',
      expect.stringContaining('synthetic_volume'),
    )
    expect(client.getQueryCache().getAll()).toEqual([])
    expect(client.getMutationCache().getAll()).toEqual([])
    // Exercise the real offline-dehydration filter with a positive control and sensitive sentinel.
    client.setQueryData(['books', 'synthetic-account'], { sentinel: 'allowed-reader-cache' })
    client.setQueryData(
      ['catalog-metadata-review', 'synthetic-account', 'provider-comparison'],
      dto,
    )
    const persisted = JSON.stringify(
      dehydrate(client, { shouldDehydrateQuery: (q) => isOfflinePersistableQueryKey(q.queryKey) }),
    )
    expect(persisted).toContain('allowed-reader-cache')
    expect(persisted).not.toContain('synthetic_volume')
    load.mockRejectedValue(new Error('SECRET_PROVIDER_BODY_AND_TOKEN'))
    await compare()
    expect(screen.getByRole('status')).toHaveTextContent('Comparison unavailable')
    expect(document.body.textContent).not.toContain('SECRET_PROVIDER_BODY_AND_TOKEN')
    expect(storage).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    expect(messages).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    expect(errorLog).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
    client.clear()
  })
  it('cannot prefill an existing description draft, source, note, or confirmation', async () => {
    const { props } = setup()
    const work: CatalogMetadataWork = {
      id: props.context.workId,
      title: 'Synthetic catalog work',
      author: 'Synthetic Author',
      isbns: [props.context.isbn],
      description: 'Original description',
      descriptionSource: null,
      cover: null,
      year: null,
      publisher: null,
      language: null,
      issues: [],
      related: [],
      relatedTotal: 0,
      fingerprint: 'existing-review-fingerprint',
      revision: 1,
      state: 'open',
      note: '',
      sourceUrl: '',
    }
    render(
      <>
        <CatalogMetadataEditor work={work} onSaved={vi.fn()} onRefresh={vi.fn()} />
        <ProviderComparison {...props} />
      </>,
    )
    fireEvent.change(screen.getByLabelText('Catalog description'), {
      target: { value: 'My unsaved draft' },
    })
    await compare()
    expect(observations()).toBeInTheDocument()
    expect(screen.getByLabelText('Catalog description')).toHaveValue('My unsaved draft')
    expect(screen.getByLabelText('Evidence source link')).toHaveValue('')
    expect(screen.getByLabelText('Assessment note')).toHaveValue('')
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: 'Save description' })).toBeDisabled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
