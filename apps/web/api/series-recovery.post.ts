import { createError, defineEventHandler, readBody } from 'nitro/h3'
import { authenticatedCorpusAdmin } from '../server/corpusSweepAuth'
import { requireCorpusSweepWorkflow } from '../server/corpusSweepConfig'
import { serviceClient } from '../server/corpusSweep'
import { launchSeriesRecovery } from '../server/seriesRecoveryLaunch'
import { parseSeriesRecoveryManifest } from '../src/lib/seriesRecoveryPolicy'

export default defineEventHandler(async (event) => {
  requireCorpusSweepWorkflow()
  serviceClient()
  const client = await authenticatedCorpusAdmin(event.req)
  const body = await readBody<{ manifest?: unknown }>(event)
  const project = new URL(process.env.VITE_SUPABASE_URL ?? '').hostname.split('.')[0] ?? ''
  let manifest
  try {
    manifest = parseSeriesRecoveryManifest(body?.manifest, project)
  } catch (error) {
    throw createError({ statusCode: 400, statusMessage: (error as Error).message })
  }
  const { data, error } = await client.rpc('start_series_recovery', {
    p_exclusions: manifest.works,
  })
  if (error || !data || typeof data !== 'object') {
    throw createError({
      statusCode: 409,
      statusMessage: error?.message ?? 'Could not start recovery',
    })
  }
  const summary = data as {
    runId?: string
    reused?: boolean
    eligible?: number
    excluded?: number
    total?: number
  }
  if (typeof summary.runId !== 'string') {
    throw createError({ statusCode: 500, statusMessage: 'Recovery returned no run id' })
  }
  return { ...summary, ...(await launchSeriesRecovery(summary.runId)) }
})
