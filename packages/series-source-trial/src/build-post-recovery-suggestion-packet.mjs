import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildPostRecoverySuggestionPacket,
  validatePostRecoverySuggestionPacket,
} from './authority/post-recovery-suggestion-packet.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(packageRoot, '../..')
const privateRoot = resolve(packageRoot, 'private-results')
const PROJECT_RE = /^[a-z0-9]{20}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const sha256 = (value) => createHash('sha256').update(value).digest('hex')

const options = { project: '', authority: '', comparison: '', decisions: '', out: '' }
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const value = argv[index]
  if (value === '--') continue
  if (value === '--project') options.project = argv[++index] ?? ''
  else if (value === '--authority') options.authority = argv[++index] ?? ''
  else if (value === '--comparison') options.comparison = argv[++index] ?? ''
  else if (value === '--decisions') options.decisions = argv[++index] ?? ''
  else if (value === '--out') options.out = argv[++index] ?? ''
  else throw new Error(`Unknown argument ${value}`)
}
if (
  !PROJECT_RE.test(options.project) ||
  !options.authority ||
  !options.comparison ||
  !options.decisions ||
  !options.out
) {
  throw new Error(
    'Required: --project REF --authority PRIVATE.json --comparison PRIVATE.json --decisions PRIVATE.json --out PRIVATE.json',
  )
}
const privatePath = (input, label) => {
  const absolute = resolve(repositoryRoot, input)
  const nested = relative(privateRoot, absolute)
  if (!nested || nested.startsWith('..') || isAbsolute(nested)) {
    throw new Error(`${label} must remain under packages/series-source-trial/private-results`)
  }
  return absolute
}

const authorityPath = privatePath(options.authority, 'authority report')
const comparisonPath = privatePath(options.comparison, 'comparison report')
const decisionsPath = privatePath(options.decisions, 'reviewed decisions')
const outputPath = privatePath(options.out, 'output packet')
const [authorityText, comparisonText, decisionsText] = await Promise.all([
  readFile(authorityPath, 'utf8'),
  readFile(comparisonPath, 'utf8'),
  readFile(decisionsPath, 'utf8'),
])
const authority = JSON.parse(authorityText)
const comparison = JSON.parse(comparisonText)
const decisions = JSON.parse(decisionsText)
const ids = decisions.decisions?.map((decision) => decision.workId) ?? []
if (
  ids.length < 1 ||
  ids.length > 25 ||
  ids.some((id) => !UUID_RE.test(id ?? '')) ||
  new Set(ids).size !== ids.length
) {
  throw new Error('Reviewed decisions have invalid or duplicate work ids')
}

const uuidList = ids.map((id) => `'${id}'::uuid`).join(',')
const sql = `
select coalesce(jsonb_agg(jsonb_build_object(
  'work_id',work.id,
  'title',work.title,
  'author_text',work.author_text,
  'identity_fingerprint',md5(jsonb_build_object(
    'id',work.id,'title',work.title,'contributors',work.contributors,'pubY',work.pub_y
  )::text),
  'series_fingerprint',public.catalog_series_positive_suggestion_fingerprint(work),
  'review_revision',coalesce(review.revision,0),
  'pending_suggestion',case when suggestion.id is null then 'null'::jsonb else jsonb_build_object(
    'id',suggestion.id,
    'proposalAction',suggestion.proposal_action,
    'series',suggestion.proposed_series,
    'position',suggestion.proposed_position,
    'source',suggestion.source,
    'stagingManifestSha256',suggestion.staging_manifest_sha256,
    'stagingProposalSha256',suggestion.staging_proposal_sha256
  ) end
) order by work.id),'[]'::jsonb) rows
from public.works work
left join public.corpus_metadata_reviews review on review.work_id=work.id
left join public.work_series_suggestions suggestion
  on suggestion.work_id=work.id and suggestion.status='pending'
where work.id=any(array[${uuidList}]::uuid[]);
`.replace(/\s+/g, ' ')
const response = JSON.parse(
  execFileSync(
    'supabase',
    ['db', 'query', '--linked', '--project-ref', options.project, '--output-format', 'json', sql],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 5 * 1024 * 1024 },
  ),
)
const liveRows = response?.rows?.[0]?.rows
if (!Array.isArray(liveRows) || liveRows.length !== ids.length) {
  throw new Error('The live catalog baseline did not return every reviewed work')
}

const packet = validatePostRecoverySuggestionPacket(
  buildPostRecoverySuggestionPacket({
    project: options.project,
    authority,
    authoritySha256: sha256(authorityText),
    comparison,
    comparisonSha256: sha256(comparisonText),
    decisions,
    decisionsSha256: sha256(decisionsText),
    liveRows,
  }),
)
await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
await writeFile(outputPath, `${JSON.stringify(packet, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
console.log(
  JSON.stringify({
    output: outputPath,
    stageable: packet.counts.stageable,
    batches: packet.counts.batches,
    mutationBoundary: packet.mutationBoundary,
  }),
)
