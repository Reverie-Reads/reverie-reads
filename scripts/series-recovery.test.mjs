import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classify,
  lookupBody,
  hash,
  validatePlan,
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
console.log(
  `${checks} recovery checks passed; no network or database calls. Local journal fixtures: ${directory}`,
)
