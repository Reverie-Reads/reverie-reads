import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compareAuthorityResultToSuggestion } from './authority/post-recovery-compare.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECT_RE = /^[a-z0-9]{20}$/

const parseArgs = (argv) => {
  const options = { project: '', input: '', out: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--project') options.project = argv[++index] ?? ''
    else if (value === '--input') options.input = argv[++index] ?? ''
    else if (value === '--out') options.out = argv[++index] ?? ''
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!PROJECT_RE.test(options.project)) throw new Error('A valid --project is required')
  if (!options.input) throw new Error('--input is required')
  return options
}

const requirePrivatePath = (path, label) => {
  const rel = relative(privateRoot, path)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`${label} must remain under private-results`)
  }
}

const options = parseArgs(process.argv.slice(2))
const inputPath = resolve(repositoryRoot, options.input)
requirePrivatePath(inputPath, 'Post-recovery authority report')
const outputPath = resolve(
  repositoryRoot,
  options.out || `${relative(repositoryRoot, inputPath).replace(/\.json$/i, '')}.comparison.json`,
)
requirePrivatePath(outputPath, 'Post-recovery comparison')

const report = JSON.parse(await readFile(inputPath, 'utf8'))
if (
  report.evaluationPartition !== 'post_recovery_review' ||
  !report.postRecoveryFrame?.sourceRunId
) {
  throw new Error('Input is not a post-recovery authority report')
}
if (!UUID_RE.test(report.postRecoveryFrame.sourceRunId)) {
  throw new Error('Post-recovery authority report has an invalid source run id')
}
if (!Array.isArray(report.results) || !report.results.length || report.results.length > 1000) {
  throw new Error('Post-recovery authority report has invalid results')
}
const ids = report.results.map((result) => result.caseId)
if (ids.some((id) => !UUID_RE.test(id ?? '')) || new Set(ids).size !== ids.length) {
  throw new Error('Post-recovery authority report has invalid or duplicate case ids')
}

const uuidList = ids.map((id) => `'${id}'::uuid`).join(',')
const sql = `
select coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'work_id',s.work_id,'proposed_series',s.proposed_series,
  'proposed_position',s.proposed_position,'proposed_count',s.proposed_count,
  'identity_confidence',s.identity_confidence,'membership_confidence',s.confidence,
  'checked_at',s.checked_at) order by s.work_id),'[]'::jsonb) suggestions
from public.work_series_suggestions s
where s.status='pending' and s.work_id=any(array[${uuidList}]::uuid[])
  and exists(select 1 from public.corpus_sweep_run_items i
    where i.run_id='${report.postRecoveryFrame.sourceRunId}'::uuid
      and i.work_id=s.work_id and i.status='completed'
      and i.outcome->'series'->>'outcome'='review');
`.replace(/\s+/g, ' ')
const response = JSON.parse(
  execFileSync(
    'supabase',
    ['db', 'query', '--linked', '--project-ref', options.project, '--output-format', 'json', sql],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
  ),
)
const suggestions = response?.rows?.[0]?.suggestions
if (!Array.isArray(suggestions)) throw new Error('Pending series review query returned no rows')
const suggestionByWork = new Map(suggestions.map((suggestion) => [suggestion.work_id, suggestion]))

const comparisons = report.results.map((result) => {
  const suggestion = suggestionByWork.get(result.caseId)
  if (!suggestion) return { workId: result.caseId, disposition: 'not_pending_review' }
  const comparison = compareAuthorityResultToSuggestion(result, suggestion)
  const membership = Array.isArray(result.output?.memberships) ? result.output.memberships[0] : null
  return {
    workId: result.caseId,
    suggestionId: suggestion.id,
    disposition: comparison.disposition,
    proposedSeries: suggestion.proposed_series,
    proposedPosition:
      suggestion.proposed_position === null ? null : Number(suggestion.proposed_position),
    proposedCount: suggestion.proposed_count,
    authoritySeries: membership?.series ?? null,
    authorityPosition: membership?.position ?? null,
    evidenceUrls: Array.isArray(membership?.evidenceUrls) ? membership.evidenceUrls : [],
  }
})
const dispositionCounts = Object.fromEntries(
  [...new Set(comparisons.map((item) => item.disposition))]
    .sort()
    .map((disposition) => [
      disposition,
      comparisons.filter((item) => item.disposition === disposition).length,
    ]),
)
const output = {
  schemaVersion: 1,
  purpose: 'post-recovery-authority-comparison',
  sourceReport: basename(inputPath),
  sourceRunId: report.postRecoveryFrame.sourceRunId,
  comparedAt: new Date().toISOString(),
  counts: {
    total: comparisons.length,
    pendingReview: suggestions.length,
    dispositions: dispositionCounts,
  },
  writes: 'local_ignored_comparison_only',
  comparisons,
}
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output: outputPath, ...output.counts, writes: output.writes }))
