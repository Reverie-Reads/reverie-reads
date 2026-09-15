import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  POST_RECOVERY_AUTHORITY_PURPOSE,
  postRecoveryFrameSha256,
  validatePostRecoveryAuthorityFrame,
} from './authority/post-recovery-frame.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PROJECT_RE = /^[a-z0-9]{20}$/

const parseArgs = (argv) => {
  const options = { project: '', run: '', out: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--project') options.project = argv[++index] ?? ''
    else if (value === '--run') options.run = argv[++index] ?? ''
    else if (value === '--out') options.out = argv[++index] ?? ''
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!PROJECT_RE.test(options.project)) throw new Error('A valid --project is required')
  if (!UUID_RE.test(options.run)) throw new Error('A valid --run is required')
  return options
}

const options = parseArgs(process.argv.slice(2))
const outputPath = resolve(
  repositoryRoot,
  options.out ||
    `packages/series-source-trial/private-results/post-recovery-authority/${options.run}.json`,
)
const privateRoot = resolve(packageRoot, 'private-results')
const privateRelative = relative(privateRoot, outputPath)
if (!privateRelative || privateRelative.startsWith('..') || isAbsolute(privateRelative)) {
  throw new Error('Post-recovery authority output must remain under private-results')
}

// The query returns shared catalog identity only. Existing/proposed series labels and evidence are
// deliberately absent so the authority scout cannot be steered toward the current guess.
const sql = `
with source_run as (
  select id,status,phase,total_count,confirmed_count,review_count,deferred_count,uncertain_count,completed_at
  from public.corpus_sweep_runs
  where id='${options.run}'::uuid and purpose='series_recovery'
), backlog as (
  select w.id,w.title,w.contributors,w.pub_y,'review'::text queue,
         'pending_series_review'::text reason_code
  from source_run r
  join public.corpus_sweep_run_items i on i.run_id=r.id and i.status='completed'
  join public.work_series_suggestions s on s.work_id=i.work_id and s.status='pending'
  join public.works w on w.id=i.work_id
  where i.outcome->'series'->>'outcome'='review'
  union all
  select w.id,w.title,w.contributors,w.pub_y,'deferred'::text queue,
         coalesce(nullif(i.outcome->>'code',''),nullif(i.error_message,''),'unresolved') reason_code
  from source_run r
  join public.corpus_sweep_run_items i on i.run_id=r.id and i.status='deferred'
  join public.works w on w.id=i.work_id
), shaped as (
  select b.*,
    (select jsonb_agg(trim(c->>'name') order by
       case when c->>'position' ~ '^[0-9]+$' then (c->>'position')::integer else 2147483647 end,
       trim(c->>'name'))
     from jsonb_array_elements(b.contributors) c
     where c->>'role' in ('author','co_author') and nullif(trim(c->>'name'),'') is not null) authors,
    md5(jsonb_build_object('id',b.id,'title',b.title,'contributors',b.contributors,'pubY',b.pub_y)::text)
      identity_fingerprint
  from backlog b
)
select jsonb_build_object(
  'schemaVersion',1,
  'purpose','${POST_RECOVERY_AUTHORITY_PURPOSE}',
  'project','${options.project}',
  'sourceRunId','${options.run}',
  'frozenAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'run',(select jsonb_build_object(
    'status',status,'phase',phase,'total',total_count,'confirmed',confirmed_count,
    'review',review_count,'deferred',deferred_count,'uncertain',uncertain_count,
    'completedAt',completed_at) from source_run),
  'counts',jsonb_build_object(
    'total',(select count(*) from shaped),
    'review',(select count(*) from shaped where queue='review'),
    'deferred',(select count(*) from shaped where queue='deferred')),
  'cases',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'title',title,'authors',authors,'publicationYear',pub_y,'queue',queue,
    'reasonCode',reason_code,'identityFingerprint',identity_fingerprint)
    order by case queue when 'review' then 0 else 1 end,id),'[]'::jsonb) from shaped)
) frame
from source_run;
`.replace(/\s+/g, ' ')

const raw = execFileSync(
  'supabase',
  ['db', 'query', '--linked', '--project-ref', options.project, '--output-format', 'json', sql],
  { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
)
const response = JSON.parse(raw)
const frame = response?.rows?.[0]?.frame
if (!frame) throw new Error('Completed series recovery run was not found')
validatePostRecoveryAuthorityFrame(frame)

await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(frame, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(
  JSON.stringify({
    output: outputPath,
    sha256: postRecoveryFrameSha256(frame),
    total: frame.counts.total,
    review: frame.counts.review,
    deferred: frame.counts.deferred,
    writes: 'local_ignored_frame_only',
  }),
)
