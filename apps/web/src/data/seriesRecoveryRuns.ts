import { useQuery } from '@tanstack/react-query'

export type SeriesRecoveryStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface SeriesRecoveryRun {
  id: string
  status: SeriesRecoveryStatus
  total: number
  eligible: number
  excluded: number
  checked: number
  confirmed: number
  review: number
  deferred: number
  uncertain: number
  batches: number
  errorMessage: string | null
  cancelRequestedAt: string | null
  createdAt: string
  completedAt: string | null
}

interface SeriesRecoveryRow {
  id: string
  status: SeriesRecoveryStatus
  total_count: number
  eligible_count: number
  excluded_count: number
  scanned_count: number
  confirmed_count: number
  review_count: number
  deferred_count: number
  uncertain_count: number
  recovery_batch_count: number
  error_message: string | null
  cancel_requested_at: string | null
  created_at: string
  completed_at: string | null
}

const key = ['series-recovery-run'] as const

const fromRow = (row: SeriesRecoveryRow): SeriesRecoveryRun => ({
  id: row.id,
  status: row.status,
  total: row.total_count,
  eligible: row.eligible_count,
  excluded: row.excluded_count,
  checked: row.scanned_count,
  confirmed: row.confirmed_count,
  review: row.review_count,
  deferred: row.deferred_count,
  uncertain: row.uncertain_count,
  batches: row.recovery_batch_count,
  errorMessage: row.error_message,
  cancelRequestedAt: row.cancel_requested_at,
  createdAt: row.created_at,
  completedAt: row.completed_at,
})

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { statusMessage?: string } | null
    throw new Error(body?.statusMessage || `Series recovery request failed (${response.status})`)
  }
  return (await response.json()) as T
}

export async function fetchCurrentSeriesRecovery(token: string): Promise<SeriesRecoveryRun | null> {
  const result = await request<{ run: SeriesRecoveryRow | null }>('/api/series-recovery/current', token)
  return result.run ? fromRow(result.run) : null
}

export async function startSeriesRecovery(token: string, manifest: unknown): Promise<string> {
  const result = await request<{ runId: string }>('/api/series-recovery', token, {
    method: 'POST',
    body: JSON.stringify({ manifest }),
  })
  return result.runId
}

export async function cancelSeriesRecovery(token: string, runId: string): Promise<void> {
  await request('/api/series-recovery/cancel', token, {
    method: 'POST',
    body: JSON.stringify({ runId }),
  })
}

export async function resumeSeriesRecovery(token: string, runId: string): Promise<void> {
  await request('/api/series-recovery/resume', token, {
    method: 'POST',
    body: JSON.stringify({ runId }),
  })
}

export function useCurrentSeriesRecovery(enabled: boolean, token?: string) {
  return useQuery({
    queryKey: key,
    enabled: enabled && !!token,
    queryFn: () => fetchCurrentSeriesRecovery(token ?? ''),
    refetchInterval: (query) => {
      const run = query.state.data
      return run?.status === 'queued' || run?.status === 'running' ? 2_000 : false
    },
    staleTime: 1_000,
  })
}

export function seriesRecoveryStatusText(run: SeriesRecoveryRun): string {
  const detail = `${run.checked} of ${run.total} saved · ${run.confirmed} confirmed · ${run.review} sent to Review · ${run.deferred} deferred · ${run.excluded} protected exclusions`
  if (run.status === 'completed') return `Historical series recovery complete — ${detail}.`
  if (run.status === 'cancelled') return `Historical series recovery stopped — ${detail}.`
  if (run.status === 'failed') {
    return `Historical series recovery paused safely — ${detail}${run.uncertain ? ` · ${run.uncertain} uncertain save requires inspection` : ''}${run.errorMessage ? ` · ${run.errorMessage}` : ''}.`
  }
  return run.cancelRequestedAt
    ? `Stopping safely — ${detail}.`
    : `Historical series recovery running — ${detail} · batch ${run.batches}. You can leave this page.`
}
