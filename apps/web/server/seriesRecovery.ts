import type { SeriesClassification } from '@reverie/core'
import {
  classifySeriesRecoveryPayload,
  SERIES_RECOVERY_BATCH_SIZE,
  seriesRecoveryLookupBody,
  type SeriesRecoveryPayload,
  type SeriesRecoveryWork,
} from '../src/lib/seriesRecoveryPolicy'
import { invokeFunction, serviceClient } from './corpusSweep'

export async function claimSeriesRecoveryBatch(runId: string): Promise<string[]> {
  'use step'

  const { data, error } = await serviceClient().rpc('service_claim_series_recovery_batch', {
    p_run: runId,
    p_limit: SERIES_RECOVERY_BATCH_SIZE,
  })
  if (error) throw error
  return Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string') : []
}

async function defer(runId: string, workId: string, code: string): Promise<void> {
  const { data, error } = await serviceClient().rpc('service_defer_series_recovery_item', {
    p_run: runId,
    p_work: workId,
    p_code: code,
  })
  if (error || data !== true) throw error ?? new Error('series_recovery_defer_failed')
}

export async function processSeriesRecoveryWork(runId: string, workId: string): Promise<void> {
  'use step'

  const client = serviceClient()
  const { data: prepared, error: prepareError } = await client.rpc(
    'service_prepare_series_recovery_item',
    { p_run: runId, p_work: workId },
  )
  if (prepareError || !prepared) throw prepareError ?? new Error('series_recovery_prepare_failed')
  const work = prepared as SeriesRecoveryWork
  const body = seriesRecoveryLookupBody(work)
  if (!body) {
    await defer(runId, workId, 'identity_requires_review')
    return
  }

  const payload = await invokeFunction<SeriesRecoveryPayload>('series', {
    sweepRunId: runId,
    workId,
    ...body,
  })
  const proposal = classifySeriesRecoveryPayload(work, payload)
  if ('deferred' in proposal) {
    await defer(runId, workId, proposal.deferred)
    return
  }

  const { data: marked, error: markError } = await client.rpc('service_mark_series_recovery_save', {
    p_run: runId,
    p_work: workId,
  })
  if (markError || marked !== true) throw markError ?? new Error('series_recovery_save_gate_failed')
  const checkedAt = new Date().toISOString()
  const { error: completeError } = await client.rpc('service_complete_series_recovery_item', {
    p_run: runId,
    p_work: workId,
    p_result: proposal.result as SeriesClassification,
    p_checked_at: checkedAt,
  })
  if (completeError) throw completeError
}

// A started lookup/save is never replayed. The workflow terminates on any thrown error and the
// owner may resume only after Postgres proves there is no uncertain save checkpoint.
processSeriesRecoveryWork.maxRetries = 0

export async function finishSeriesRecovery(runId: string, errorMessage?: string): Promise<void> {
  'use step'

  const { error } = await serviceClient().rpc('service_finish_corpus_sweep', {
    p_run: runId,
    p_error: errorMessage ?? null,
  })
  if (error) throw error
}
