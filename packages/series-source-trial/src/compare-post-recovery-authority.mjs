import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  compareAuthorityResultToDeferredWork,
  compareAuthorityResultToSuggestion,
} from './authority/post-recovery-compare.mjs'

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
with selected_items as (
  select i.work_id,i.status,i.outcome,i.error_message,w.series,w.position
  from public.corpus_sweep_run_items i
  join public.works w on w.id=i.work_id
  where i.run_id='${report.postRecoveryFrame.sourceRunId}'::uuid
    and i.work_id=any(array[${uuidList}]::uuid[])
), review_targets as (
  select s.id,s.work_id,'review'::text queue,null::text reason_code,
    s.proposed_series,s.proposed_position,s.proposed_count,
    s.identity_confidence,s.confidence membership_confidence,s.checked_at
  from selected_items i
  join public.work_series_suggestions s on s.work_id=i.work_id and s.status='pending'
  where i.status='completed' and i.outcome->'series'->>'outcome'='review'
), deferred_targets as (
  select null::uuid id,i.work_id,'deferred'::text queue,
    coalesce(nullif(i.outcome->>'code',''),nullif(i.error_message,''),'unresolved') reason_code,
    nullif(trim(i.series),'') proposed_series,i.position proposed_position,null::integer proposed_count,
    null::text identity_confidence,null::text membership_confidence,null::timestamptz checked_at
  from selected_items i where i.status='deferred'
), targets as (
  select * from review_targets union all select * from deferred_targets
)
select coalesce(jsonb_agg(jsonb_build_object(
  'id',id,'work_id',work_id,'queue',queue,'reason_code',reason_code,
  'proposed_series',proposed_series,'proposed_position',proposed_position,
  'proposed_count',proposed_count,'identity_confidence',identity_confidence,
  'membership_confidence',membership_confidence,'checked_at',checked_at)
  order by work_id),'[]'::jsonb) targets from targets;
`.replace(/\s+/g, ' ')
const response = JSON.parse(
  execFileSync(
    'supabase',
    ['db', 'query', '--linked', '--project-ref', options.project, '--output-format', 'json', sql],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
  ),
)
const targets = response?.rows?.[0]?.targets
if (!Array.isArray(targets)) throw new Error('Post-recovery comparison query returned no rows')
const targetByWork = new Map(targets.map((target) => [target.work_id, target]))

const comparisons = report.results.map((result) => {
  const target = targetByWork.get(result.caseId)
  if (!target) return { workId: result.caseId, disposition: 'not_in_reviewable_source_run' }
  const comparison =
    target.queue === 'deferred'
      ? compareAuthorityResultToDeferredWork(result, {
          current_series: target.proposed_series,
          current_position: target.proposed_position,
        })
      : compareAuthorityResultToSuggestion(result, target)
  const membership = Array.isArray(result.output?.memberships) ? result.output.memberships[0] : null
  return {
    workId: result.caseId,
    suggestionId: target.id,
    queue: target.queue,
    reasonCode: target.reason_code,
    disposition: comparison.disposition,
    proposedSeries: target.proposed_series,
    proposedPosition: target.proposed_position === null ? null : Number(target.proposed_position),
    proposedCount: target.proposed_count,
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
    pendingReview: targets.filter((target) => target.queue === 'review').length,
    deferred: targets.filter((target) => target.queue === 'deferred').length,
    dispositions: dispositionCounts,
  },
  writes: 'local_ignored_comparison_only',
  comparisons,
}
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify({ output: outputPath, ...output.counts, writes: output.writes }))
