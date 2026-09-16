import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORPUS_SHADOW_HISTORY_PURPOSE,
  validateCorpusShadowHistoricalSnapshot,
} from './authority/corpus-shadow-history.mjs'
import {
  corpusShadowFrameSha256,
  validateCorpusShadowFrame,
} from './authority/corpus-shadow-frame.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const PROJECT_RE = /^[a-z0-9]{20}$/
const options = { project: '', frame: '', out: '' }
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]
  if (value === '--') continue
  if (value === '--project') options.project = argv[++index] ?? ''
  else if (value === '--frame') options.frame = argv[++index] ?? ''
  else if (value === '--out') options.out = argv[++index] ?? ''
  else throw new Error(`Unknown argument ${value}`)
}
if (!PROJECT_RE.test(options.project) || !options.frame) {
  throw new Error('A valid --project and private --frame are required')
}
const framePath = resolve(repositoryRoot, options.frame)
const outputPath = resolve(
  repositoryRoot,
  options.out ||
    `packages/series-source-trial/private-results/corpus-series-shadow-history/${options.project}.json`,
)
for (const [path, label] of [
  [framePath, 'frame'],
  [outputPath, 'output'],
]) {
  const nested = relative(privateRoot, path)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
}
const frame = validateCorpusShadowFrame(JSON.parse(await readFile(framePath, 'utf8')))
if (frame.project !== options.project) throw new Error('Frame belongs to a different project')
const frameSha256 = corpusShadowFrameSha256(frame)

const sql = `
with shaped as (
  select w.id,
    md5(jsonb_build_object('id',w.id,'title',w.title,'contributors',w.contributors,'pubY',w.pub_y)::text) identity_fingerprint,
    jsonb_build_object(
      'series',w.series,'position',w.position,'seriesCount',w.series_count,'status',w.status,
      'seriesCheckState',w.series_check_state,'seriesCheckedAt',w.series_checked_at,
      'seriesCheckSource',w.series_check_source,'seriesCheckReason',w.series_check_reason
    ) projection,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'seriesId',s.id,'series',s.name,'position',e.position,'isPrimary',e.is_primary,
      'seriesStatus',s.status,'declaredCount',s.declared_count,'catalogState',s.catalog_state,
      'source',e.source
    ) order by e.is_primary desc,s.name,e.position nulls last,e.id),'[]'::jsonb)
      from public.corpus_series_entries e
      join public.corpus_series s on s.id=e.series_id and s.archived_at is null
      where e.work_id=w.id and e.removed_at is null) memberships,
    (select coalesce(jsonb_agg(jsonb_build_object(
      'suggestionId',q.id,'series',q.proposed_series,'position',q.proposed_position,
      'seriesCount',q.proposed_count,'source',q.source,'confidence',q.confidence
    ) order by q.created_at,q.id),'[]'::jsonb)
      from public.work_series_suggestions q where q.work_id=w.id and q.status='pending') pending_suggestions
  from public.works w
), snapshot_works as (
  select jsonb_build_object(
    'workId',id,'identityFingerprint',identity_fingerprint,'projection',projection,
    'memberships',memberships,'pendingSuggestions',pending_suggestions
  ) work
  from shaped
)
select jsonb_build_object(
  'schemaVersion',1,'purpose','${CORPUS_SHADOW_HISTORY_PURPOSE}',
  'sourceFrame',jsonb_build_object('project','${options.project}','sha256','${frameSha256}','totalWorks',${frame.cases.length}),
  'capturedAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'counts',jsonb_build_object(
    'works',(select count(*) from shaped),
    'projectionSeries',(select count(*) from shaped where projection->>'series' is not null),
    'worksWithMemberships',(select count(*) from shaped where jsonb_array_length(memberships)>0),
    'memberships',(select coalesce(sum(jsonb_array_length(memberships)),0) from shaped),
    'pendingSuggestions',(select coalesce(sum(jsonb_array_length(pending_suggestions)),0) from shaped)
  ),
  'works',(select coalesce(jsonb_agg(work order by work->>'workId'),'[]'::jsonb) from snapshot_works)
) snapshot;
`.replace(/\s+/g, ' ')

const raw = execFileSync(
  'supabase',
  ['db', 'query', '--linked', '--project-ref', options.project, '--output-format', 'json', sql],
  { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
)
const snapshot = JSON.parse(raw)?.rows?.[0]?.snapshot
if (!snapshot) throw new Error('Historical corpus snapshot was not returned')
validateCorpusShadowHistoricalSnapshot(snapshot, frame, frameSha256)
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(
  JSON.stringify({
    output: outputPath,
    counts: snapshot.counts,
    writes: 'local_ignored_snapshot_only',
  }),
)
