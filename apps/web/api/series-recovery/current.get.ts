import { createError, defineEventHandler } from 'nitro/h3'
import { authenticatedCorpusAdmin } from '../../server/corpusSweepAuth'
import { corpusSweepWorkflowEnabled } from '../../server/corpusSweepConfig'

export default defineEventHandler(async ({ req }) => {
  if (!corpusSweepWorkflowEnabled()) return { run: null }
  const client = await authenticatedCorpusAdmin(req)
  const { data, error } = await client
    .from('corpus_sweep_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw createError({ statusCode: 500, statusMessage: 'Could not read series recovery' })
  const run = data?.find((row) => row.purpose === 'series_recovery')
  return { run: run ?? null }
})
