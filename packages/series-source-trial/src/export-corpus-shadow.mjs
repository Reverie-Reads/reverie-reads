import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CORPUS_SHADOW_PURPOSE,
  corpusShadowFrameSha256,
  validateCorpusShadowFrame,
} from './authority/corpus-shadow-frame.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const PROJECT_RE = /^[a-z0-9]{20}$/

const parseArgs = (argv) => {
  const options = { project: '', out: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    if (value === '--project') options.project = argv[++index] ?? ''
    else if (value === '--out') options.out = argv[++index] ?? ''
    else throw new Error(`Unknown argument ${value}`)
  }
  if (!PROJECT_RE.test(options.project)) throw new Error('A valid --project is required')
  return options
}

const options = parseArgs(process.argv.slice(2))
const outputPath = resolve(
  repositoryRoot,
  options.out ||
    `packages/series-source-trial/private-results/corpus-series-shadow/${options.project}.json`,
)
const privateRoot = resolve(packageRoot, 'private-results')
const privateRelative = relative(privateRoot, outputPath)
if (!privateRelative || privateRelative.startsWith('..') || isAbsolute(privateRelative)) {
  throw new Error('Corpus shadow output must remain under private-results')
}

// Historical series labels, classifier states, suggestions, graph entries, and evidence are not
// selected. The shadow rebuild starts from shared work identity only.
const sql = `
with shaped as (
  select w.id,w.title,w.contributors,w.pub_y,
    (select jsonb_agg(trim(c->>'name') order by
       case when c->>'position' ~ '^[0-9]+$' then (c->>'position')::integer else 2147483647 end,
       trim(c->>'name'))
     from jsonb_array_elements(w.contributors) c
     where c->>'role' in ('author','co_author') and nullif(trim(c->>'name'),'') is not null) authors,
    md5(jsonb_build_object('id',w.id,'title',w.title,'contributors',w.contributors,'pubY',w.pub_y)::text)
      identity_fingerprint
  from public.works w
)
select jsonb_build_object(
  'schemaVersion',1,
  'purpose','${CORPUS_SHADOW_PURPOSE}',
  'project','${options.project}',
  'frozenAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'counts',jsonb_build_object('total',(select count(*) from shaped)),
  'cases',(select coalesce(jsonb_agg(jsonb_build_object(
    'id',id,'title',title,'authors',authors,'publicationYear',pub_y,
    'identityFingerprint',identity_fingerprint) order by id),'[]'::jsonb) from shaped)
) frame;
`.replace(/\s+/g, ' ')

const raw = execFileSync(
  'supabase',
  ['db', 'query', '--linked', '--project-ref', options.project, '--output-format', 'json', sql],
  { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
)
const response = JSON.parse(raw)
const frame = response?.rows?.[0]?.frame
if (!frame) throw new Error('Corpus identity inventory was not returned')
validateCorpusShadowFrame(frame)

await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(frame, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(
  JSON.stringify({
    output: outputPath,
    sha256: corpusShadowFrameSha256(frame),
    total: frame.counts.total,
    historicalSeriesFields: 'excluded',
    writes: 'local_ignored_frame_only',
  }),
)
