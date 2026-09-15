import { createError, defineEventHandler, readBody } from 'nitro/h3'
import { authenticatedCorpusAdmin } from '../../server/corpusSweepAuth'
import { requireCorpusSweepWorkflow } from '../../server/corpusSweepConfig'

export default defineEventHandler(async (event) => {
  requireCorpusSweepWorkflow()
  const client = await authenticatedCorpusAdmin(event.req)
  const body = await readBody<{ runId?: string }>(event)
  if (!body?.runId) throw createError({ statusCode: 400, statusMessage: 'Run id is required' })
  const { error } = await client.rpc('request_corpus_sweep_cancel', { p_run: body.runId })
  if (error) throw createError({ statusCode: 409, statusMessage: 'Series recovery is not active' })
  return { runId: body.runId, cancelRequested: true }
})
