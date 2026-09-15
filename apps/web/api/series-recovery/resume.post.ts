import { createError, defineEventHandler, readBody } from 'nitro/h3'
import { authenticatedCorpusAdmin } from '../../server/corpusSweepAuth'
import { requireCorpusSweepWorkflow } from '../../server/corpusSweepConfig'
import { serviceClient } from '../../server/corpusSweep'
import { launchSeriesRecovery } from '../../server/seriesRecoveryLaunch'

export default defineEventHandler(async (event) => {
  requireCorpusSweepWorkflow()
  serviceClient()
  const client = await authenticatedCorpusAdmin(event.req)
  const body = await readBody<{ runId?: string }>(event)
  if (!body?.runId) throw createError({ statusCode: 400, statusMessage: 'Run id is required' })
  const { data: runId, error } = await client.rpc('resume_series_recovery', { p_run: body.runId })
  if (error || typeof runId !== 'string') {
    throw createError({
      statusCode: 409,
      statusMessage: error?.message ?? 'Recovery cannot resume',
    })
  }
  return launchSeriesRecovery(runId)
})
