import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classify,
  lookupBody,
  hash,
  validatePlan,
  selectRecoveryScope,
  snapshotSql,
  processItem,
  verifySaved,
  quote,
  verifyReset,
  resumeAction,
} from './series-recovery-lib.mjs'
import {
  durableFile,
  readJournal,
  appendEvent,
  resetSql,
  saveSql,
  parseArgs,
  seriesDeployment,
  main,
} from './series-recovery.mjs'

let checks = 0
const check = (name, fn) => {
  fn()
  checks++
  return name
}
const id = 'ba200000-0000-4000-8000-000000000001',
  actor = 'ba100000-0000-4000-8000-000000000001'
const work = {
  id,
  title: 'Synthetic Book',
  author_text: 'Test Author',
  series: 'Synthetic Series',
  position: 1,
  series_count: null,
  work_id: 'hardcover:123',
  enrichment_confidence: 'high',
  fingerprint: 'a'.repeat(32),
}
const payload = {
  name: work.series,
  sourceRef: '900',
  memberCount: null,
  membershipEntries: [
    { title: work.title, author: work.author_text, position: 1 },
    { title: 'Another Book', author: work.author_text, position: 2 },
  ],
}
check('real classifier finds relationship', () =>
  assert.equal(classify(work, payload).result.outcome, 'found'),
)
check('singleton waits for review', () =>
  assert.equal(
    classify(work, { ...payload, membershipEntries: payload.membershipEntries.slice(0, 1) }).result
      .outcome,
    'review',
  ),
)
for (const code of [
  'ambiguous_relationship',
  'identity_mismatch',
  'not_found',
  'empty_relationship',
  'relationship_limit',
]) {
  check(code + ' HTTP 200 defers', () =>
    assert.equal(
      classify(work, { unavailable: true, failureCode: code, httpStatus: 200 }).deferred,
      code,
    ),
  )
  for (const httpStatus of [403, 429, 503, undefined, '200'])
    check(code + ' other status stops', () =>
      assert.throws(
        () => classify(work, { unavailable: true, failureCode: code, httpStatus }),
        /provider_unavailable_stop/,
      ),
    )
}
for (const patch of [
  { memberCount: 2 },
  { sourceRef: 'hardcover:123' },
  { membershipEntries: undefined },
  { membershipEntries: Array(201).fill(payload.membershipEntries[0]) },
  { membershipEntries: [{ title: 'X', author: 'Y', position: '1' }] },
])
  check('invalid contract stops', () =>
    assert.throws(() => classify(work, { ...payload, ...patch }), /relationship_contract_changed/),
  )
check('wrong author cannot match', () =>
  assert.equal(
    classify({ ...work, author_text: 'Wrong Author' }, payload).deferred,
    'no_exact_membership',
  ),
)
check('duplicate exact rows defer', () =>
  assert.equal(
    classify(work, {
      ...payload,
      membershipEntries: [payload.membershipEntries[0], payload.membershipEntries[0]],
    }).deferred,
    'ambiguous_exact_membership',
  ),
)
check('broader classifier match cannot supply another ordinal', () =>
  assert.equal(
    classify(work, {
      ...payload,
      membershipEntries: [
        { title: 'Synthetic Book!', author: work.author_text, position: 9 },
        ...payload.membershipEntries,
      ],
    }).deferred,
    'ambiguous_exact_membership',
  ),
)
for (const patch of [
  { work_id: 'openlibrary:123' },
  { author_text: null },
  { enrichment_confidence: 'medium' },
  { series: null },
])
  check('weak input cannot acquire', () => assert.equal(lookupBody({ ...work, ...patch }), null))
const body = {
  // Synthetic plan only; never a production execution artifact.
  version: 1,
  actor,
  project: 'abcdefghijklmnopqrst',
  revision: 'a'.repeat(40),
  runtime: 'b'.repeat(64),
  node: process.version,
  build: 'c'.repeat(12),
  seriesDeployment: { version: 12, hash: 'd'.repeat(64) },
  works: [work],
}
check('unobserved order cannot certify an old candidate position', () =>
  assert.equal(
    classify(work, {
      ...payload,
      membershipEntries: [
        { ...payload.membershipEntries[0], position: null },
        payload.membershipEntries[1],
      ],
    }).deferred,
    'missing_position_evidence',
  ),
)
check('valid frozen plan', () => validatePlan({ ...body, digest: hash(body) }))
check('tampered frozen plan', () =>
  assert.throws(() => validatePlan({ ...body, actor: 'x', digest: hash(body) })),
)
for (const works of [[], [work, work], Array.from({ length: 1001 }, () => work)])
  check('invalid plan size/set', () => {
    const b = { ...body, works }
    assert.throws(() => validatePlan({ ...b, digest: hash(b) }))
  })
check('quote cannot inject SQL', () => assert.equal(quote("O'Brien"), "'O''Brien'"))
check('snapshot refuses arbitrary ID', () =>
  assert.throws(() => snapshotSql(["'; delete from works;"])),
)
check('snapshot bounded to 25', () => assert.throws(() => snapshotSql(Array(26).fill(id))))

const directory = mkdtempSync(join(tmpdir(), 'reverie-recovery-tests-')),
  journal = join(directory, 'journal.jsonl')
const events = []
appendEvent(journal, events, 'approved', { plan: 'test' })
appendEvent(journal, events, 'lookup_started', { workId: id })
check('journal durable roundtrip', () => assert.deepEqual(readJournal(journal), events))
writeFileSync(journal, readFileSync(journal, 'utf8').replace('lookup_started', 'lookup_finished'))
check('journal tamper fails closed', () =>
  assert.throws(() => readJournal(journal), /journal_integrity_stop/),
)
writeFileSync(journal, '{"partial":')
check('partial journal fails closed', () =>
  assert.throws(() => readJournal(journal), /incomplete_journal_stop/),
)
durableFile(join(directory, 'attempt'), { id })
check('attempt is exclusive', () =>
  assert.throws(() => durableFile(join(directory, 'attempt'), { id })),
)

const before = {
  id,
  fingerprint: work.fingerprint,
  work,
  protected: 'protected',
  other_provenance: 'same',
  reads: 'reads',
  copies: [],
  shared: [],
  personal: [],
  suggestions: [],
}
const result = classify(work, payload).result,
  checkedAt = '2026-09-12T00:00:00.000Z'
function saved(at = checkedAt) {
  const evidence = result.evidence.map((e) =>
    Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null)),
  )
  return {
    ...structuredClone(before),
    work: {
      ...work,
      series_check_state: 'found',
      series_checked_at: at,
      series_check_source: result.source,
      metadata_provenance: {
        series: {
          source: result.source,
          sourceRef: result.sourceRef,
          identityConfidence: result.identityConfidence,
          membershipConfidence: result.membershipConfidence,
          confidence: result.membershipConfidence,
          at,
          evidence,
        },
      },
      series_check_reason: result.reason,
      series_check_evidence: result.evidence.map((e) =>
        Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null)),
      ),
    },
    shared: [
      {
        removed_at: null,
        is_primary: true,
        source_ref: '900',
        position: 1,
        membership_claim: { sourceRef: '900' },
        position_claim: { sourceRef: '900' },
      },
    ],
  }
}
check('confirmed readback', () =>
  verifySaved(before, saved(), result, checkedAt, { outcome: 'confirmed' }),
)
for (const field of ['protected', 'other_provenance', 'reads'])
  check('protected ' + field, () =>
    assert.throws(
      () =>
        verifySaved(before, { ...saved(), [field]: 'changed' }, result, checkedAt, {
          outcome: 'confirmed',
        }),
      /protected_data_changed/,
    ),
  )
check('missing shared membership', () =>
  assert.throws(() =>
    verifySaved(before, { ...saved(), shared: [] }, result, checkedAt, { outcome: 'confirmed' }),
  ),
)

async function exercise(fault) {
  const calls = []
  let snapshots = 0
  const io = {
    preflight: async () => {
      calls.push('preflight')
    },
    snapshot: async () => {
      snapshots++
      return snapshots < 3 ? before : saved(io.at)
    },
    record: async (type, data) => {
      calls.push(type)
      if (data.checkedAt) io.at = data.checkedAt
      if (fault === type) throw Error('disk_failure')
    },
    lookup: async () => {
      calls.push('lookup')
      if (fault === 'lookup') throw Error('network')
      return fault === 'limit'
        ? { unavailable: true, failureCode: 'relationship_limit', httpStatus: 200 }
        : payload
    },
    save: async () => {
      calls.push('save')
      if (fault === 'save') throw Error('uncertain')
      return { outcome: 'confirmed' }
    },
  }
  try {
    await processItem(work, io)
  } catch (error) {
    if (!fault) throw error
  }
  return calls
}
const success = await exercise()
check('write ahead lookup and save', () => {
  assert.ok(success.indexOf('lookup_started') < success.indexOf('lookup'))
  assert.ok(success.indexOf('save_started') < success.indexOf('save'))
  assert.equal(success.at(-1), 'verified')
})
for (const fault of ['lookup_started', 'lookup', 'proposal', 'save_started', 'save', 'limit']) {
  const calls = await exercise(fault)
  check('fault no retry ' + fault, () => {
    assert.ok(calls.filter((x) => x === 'lookup').length <= 1)
    assert.ok(calls.filter((x) => x === 'save').length <= 1)
    if (['lookup_started', 'lookup', 'proposal', 'save_started', 'limit'].includes(fault))
      assert.ok(!calls.includes('save'))
  })
}
const template = readFileSync(
  new URL('../docs/queries/series-unavailable-retry.sql', import.meta.url),
  'utf8',
)
const held = { ...work, id: 'ba200000-0000-4000-8000-000000000002', title: 'Review Book' }
const manifest = {
  version: 1,
  project: body.project,
  works: [{ id: held.id, fingerprint: held.fingerprint, reason: 'Identity needs review' }],
}
const scope = selectRecoveryScope([work, held], manifest, body.project)
const scopedBody = { ...body, ...scope }
const scopedPlan = validatePlan({ ...scopedBody, digest: hash(scopedBody) })
check('complete inventory partitions into frozen run and private holdout', () => {
  assert.equal(scopedPlan.eligibleCount, 2)
  assert.deepEqual(scopedPlan.works, [work])
  assert.deepEqual(scopedPlan.excluded, [{ ...held, reason: 'Identity needs review' }])
  assert.deepEqual(selectRecoveryScope([work], undefined, body.project), {
    works: [work],
    excluded: [],
    eligibleCount: 1,
  })
})
check('excluded record never enters reset SQL', () => {
  const sql = resetSql(template, scopedPlan.works, actor, true)
  assert.ok(sql.includes(work.id))
  assert.ok(!sql.includes(held.id))
})
check('exclusion metadata survives the sealed disk roundtrip', () => {
  const path = join(directory, 'excluded-plan.json')
  durableFile(path, scopedPlan)
  assert.deepEqual(validatePlan(JSON.parse(readFileSync(path, 'utf8'))), scopedPlan)
})
check('exclusion file order is canonicalized', () => {
  const another = { ...held, id: 'ba200000-0000-4000-8000-000000000003' }
  const entries = [another, held].map((w) => ({
    id: w.id,
    fingerprint: w.fingerprint,
    reason: 'Review',
  }))
  const selected = selectRecoveryScope(
    [work, held, another],
    { ...manifest, works: entries },
    body.project,
  )
  assert.deepEqual(
    selected.excluded.map((w) => w.id),
    [held.id, another.id],
  )
})
for (const [label, candidate] of [
  ['wrong project', { ...manifest, project: 'wrong' }],
  ['wrong version', { ...manifest, version: 2 }],
  ['missing list', { ...manifest, works: null }],
  ['duplicate', { ...manifest, works: [manifest.works[0], manifest.works[0]] }],
  [
    'stale fingerprint',
    { ...manifest, works: [{ ...manifest.works[0], fingerprint: 'b'.repeat(32) }] },
  ],
  ['unknown id', { ...manifest, works: [{ ...manifest.works[0], id: actor }] }],
  ['invalid id', { ...manifest, works: [{ ...manifest.works[0], id: 'not-a-uuid' }] }],
  ['missing reason', { ...manifest, works: [{ ...manifest.works[0], reason: ' ' }] }],
  ['long reason', { ...manifest, works: [{ ...manifest.works[0], reason: 'x'.repeat(241) }] }],
  ['null entry', { ...manifest, works: [null] }],
])
  check('exclusion refuses ' + label, () =>
    assert.throws(() => selectRecoveryScope([work, held], candidate, body.project)),
  )
check('excluding everything refuses', () =>
  assert.throws(() => selectRecoveryScope([held], manifest, body.project), /empty_recovery_scope/),
)
check('exclusions cannot hide an oversized inventory', () =>
  assert.throws(
    () => selectRecoveryScope(Array(1001).fill(held), manifest, body.project),
    /inventory_over_limit/,
  ),
)
check('duplicate inventory cannot be hidden', () =>
  assert.throws(
    () => selectRecoveryScope([work, work, held], manifest, body.project),
    /duplicate_targets/,
  ),
)
check('edited exclusion reason breaks original seal', () =>
  assert.throws(
    () => validatePlan({ ...scopedPlan, excluded: [{ ...held, reason: 'Changed' }] }),
    /plan_hash_mismatch/,
  ),
)
for (const patch of [
  { eligibleCount: 1 },
  { eligibleCount: 1001 },
  { excluded: null },
  { excluded: [{ ...work, reason: 'Overlaps selected work' }] },
  { excluded: [{ ...held, fingerprint: 'bad', reason: 'Review' }] },
  { excluded: [{ ...held, reason: '' }] },
])
  check('sealed exclusions retain structural gates', () => {
    const invalid = { ...scopedBody, ...patch }
    assert.throws(() => validatePlan({ ...invalid, digest: hash(invalid) }))
  })
for (const mode of ['run', 'resume', 'status'])
  check('exclusion override refused during ' + mode, () =>
    assert.throws(
      () => parseArgs([`--mode=${mode}`, '--exclude-file=private.json']),
      /exclusions_are_plan_only/,
    ),
  )
check('reset defaults rollback', () =>
  assert.match(resetSql(template, [work], actor, false), /rollback;/),
)
check('reset explicitly committed', () =>
  assert.match(resetSql(template, [work], actor, true), /commit;/),
)
check('reset refuses >25', () =>
  assert.throws(() => resetSql(template, Array(26).fill(work), actor, true)),
)
check('save guards fingerprint under lock', () => {
  const sql = saveSql(before, result, checkedAt, actor)
  assert.ok(sql.indexOf('for update') < sql.indexOf('md5(to_jsonb(w)'))
  assert.match(sql, /record_corpus_series_discovery/)
  assert.doesNotMatch(sql, /update public.books|delete from/)
})
check('duplicate arguments refused', () =>
  assert.throws(() => parseArgs(['--mode=run', '--mode=plan']), /duplicate_argument/),
)
const deployment = {
  slug: 'series',
  status: 'ACTIVE',
  verify_jwt: true,
  version: 12,
  ezbr_sha256: 'a'.repeat(64),
}
check('active authenticated deployment pins', () =>
  assert.deepEqual(seriesDeployment([deployment]), { version: 12, hash: 'a'.repeat(64) }),
)
for (const functions of [
  [],
  [deployment, deployment],
  [{ ...deployment, status: 'INACTIVE' }],
  [{ ...deployment, verify_jwt: false }],
  [{ ...deployment, ezbr_sha256: null }],
])
  check('unsafe deployment refuses', () => assert.throws(() => seriesDeployment(functions)))
for (const [type, expected] of [
  [null, 'process'],
  ['verified', 'skip'],
  ['deferred', 'skip'],
  ['lookup_started', 'defer'],
  ['proposal', 'defer'],
])
  check('resume ' + type, () => assert.equal(resumeAction(type ? { type } : null), expected))
for (const type of ['save_started', 'unknown'])
  check('uncertain resume stops ' + type, () => assert.throws(() => resumeAction({ type })))
const resetSnapshot = {
  ...before,
  work: { ...work, series_check_state: 'unresolved', series_checked_at: null },
}
check('exact reset verifies', () => verifyReset(before, resetSnapshot))
for (const field of [
  'series',
  'position',
  'metadata_provenance',
  'series_check_evidence',
  'series_check_reason',
])
  check('reset protects ' + field, () =>
    assert.throws(() =>
      verifyReset(before, {
        ...resetSnapshot,
        work: { ...resetSnapshot.work, [field]: 'changed' },
      }),
    ),
  )
for (const field of ['copies', 'reads', 'shared', 'personal', 'suggestions'])
  check('reset protects linked ' + field, () =>
    assert.throws(() => verifyReset(before, { ...resetSnapshot, [field]: 'changed' })),
  )
// Exercise the actual plan/status entry point with synthetic CLI executables and no network.
const fixture = join(directory, 'plan-fixture'),
  bin = join(fixture, 'bin')
mkdirSync(bin, { recursive: true })
mkdirSync(join(fixture, 'supabase', '.temp'), { recursive: true })
writeFileSync(join(fixture, 'supabase', '.temp', 'project-ref'), body.project)
const exclusionsFile = join(fixture, 'exclusions.json')
writeFileSync(exclusionsFile, JSON.stringify(manifest))
writeFileSync(
  join(bin, 'git'),
  `#!/usr/bin/env node
const args=process.argv.slice(2);
if(args[0]==='status') process.exit(0);
if(args[0]!=='rev-parse') process.exit(1);
console.log(args.includes('--git-common-dir')?${JSON.stringify(join(fixture, 'common'))}:${JSON.stringify(body.revision)});
`,
  { mode: 0o700 },
)
writeFileSync(
  join(bin, 'supabase'),
  `#!/usr/bin/env node
const fs=require('node:fs'),args=process.argv.slice(2);
if(args[0]==='functions') {console.log(${JSON.stringify(JSON.stringify([deployment]))});process.exit(0);}
if(args[0]!=='db'||args[1]!=='query') process.exit(1);
const sql=fs.readFileSync(args[args.indexOf('--file')+1],'utf8');
if(sql.startsWith('select exists(')) console.log(JSON.stringify({rows:[{administrator:true,sweeps:0}]}));
else if(sql.startsWith('begin read only; select w.id')) console.log(${JSON.stringify(JSON.stringify({ rows: [work, held] }))});
else process.exit(1);
`,
  { mode: 0o700 },
)
const originalArgv = process.argv,
  originalPath = process.env.PATH,
  originalFetch = globalThis.fetch,
  originalLog = console.log
const printed = [],
  requests = []
try {
  process.env.PATH = bin + ':' + originalPath
  globalThis.fetch = async (url) => {
    requests.push(String(url))
    assert.equal(String(url), 'https://example.test/version.json')
    return { ok: true, json: async () => ({ build: body.build }) }
  }
  console.log = (value) => printed.push(JSON.parse(value))
  const commonArgs = [`--project=${body.project}`, `--deployment=${fixture}`]
  process.argv = [
    'node',
    'synthetic',
    '--mode=plan',
    ...commonArgs,
    `--actor=${actor}`,
    '--app=https://example.test',
    `--exclude-file=${exclusionsFile}`,
  ]
  await main()
  const created = printed[0],
    diskPlan = validatePlan(JSON.parse(readFileSync(created.plan, 'utf8')))
  check('actual plan CLI seals only selected work for execution', () => {
    assert.equal(created.eligible, 2)
    assert.equal(created.excluded, 1)
    assert.equal(created.works, 1)
    assert.deepEqual(diskPlan.works, [work])
    assert.equal(diskPlan.excluded[0].id, held.id)
    assert.deepEqual(requests, ['https://example.test/version.json'])
  })
  writeFileSync(exclusionsFile, '{}')
  process.argv = ['node', 'synthetic', '--mode=status', ...commonArgs, `--run=${created.run}`]
  await main()
  check('status uses sealed scope, never rereads the edited source file or acquires', () => {
    assert.equal(printed[1].planned, 1)
    assert.equal(printed[1].excluded, 1)
    assert.equal(printed[1].untouched, 1)
    assert.equal(printed[1].last, 'not_started')
    assert.equal(requests.length, 1)
  })
} finally {
  process.argv = originalArgv
  process.env.PATH = originalPath
  globalThis.fetch = originalFetch
  console.log = originalLog
}
console.log(
  `${checks} recovery checks passed; no network or database calls. Local journal fixtures: ${directory}`,
)
