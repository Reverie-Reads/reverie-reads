import { createError, defineEventHandler } from 'nitro/h3'
import { authenticatedCorpusAdmin } from '../../server/corpusSweepAuth'
import { corpusSweepWorkflowEnabled } from '../../server/corpusSweepConfig'

export default defineEventHandler(async ({ req }) => {
  // Before the owner installs the migration, avoid querying a table that intentionally does not
  // exist yet. The start route remains explicitly unavailable during that rollout window.
  if (!corpusSweepWorkflowEnabled()) return { run: null }
  const client = await authenticatedCorpusAdmin(req)
  const { data, error } = await client
    .from('corpus_sweep_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10)
  if (error) throw createError({ statusCode: 500, statusMessage: 'Could not read corpus sweep' })
  // `purpose` is absent before the incident migration and therefore means the established sweep.
  // Reading a small mixed history keeps this endpoint deployable before or after that migration.
  const run = data?.find((row) => !row.purpose || row.purpose === 'corpus_sweep')
  return { run: run ?? null }
})
