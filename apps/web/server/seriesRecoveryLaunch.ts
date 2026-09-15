import { createError } from 'nitro/h3'
import { start } from 'workflow/api'
import { serviceClient } from './corpusSweep'
import { durableSeriesRecovery } from '../workflows/series-recovery'

export async function launchSeriesRecovery(runId: string) {
  const service = serviceClient()
  const { data: launchClaimed, error: claimError } = await service.rpc(
    'service_claim_corpus_sweep_launch',
    { p_run: runId },
  )
  if (claimError) {
    await service.rpc('service_finish_corpus_sweep', { p_run: runId, p_error: claimError.message })
    throw createError({ statusCode: 500, statusMessage: 'Could not claim recovery launch' })
  }
  if (launchClaimed !== true) return { runId, reused: true }

  let workflowRun: Awaited<ReturnType<typeof start>>
  try {
    workflowRun = await start(durableSeriesRecovery, [runId])
  } catch (error) {
    await service.rpc('service_finish_corpus_sweep', {
      p_run: runId,
      p_error: error instanceof Error ? error.message : String(error),
    })
    throw createError({ statusCode: 503, statusMessage: 'Could not launch series recovery' })
  }
  const { error: bindError } = await service.rpc('service_bind_corpus_sweep_workflow', {
    p_run: runId,
    p_workflow_run_id: workflowRun.runId,
  })
  if (bindError) console.error('Could not bind series-recovery workflow id', bindError)
  return {
    runId,
    workflowRunId: workflowRun.runId,
    reused: false,
    workflowIdBound: !bindError,
  }
}
