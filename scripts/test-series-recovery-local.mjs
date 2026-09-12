// Actual generated SQL, local stack only. Every fixture/save ends in rollback.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resetSql, saveSql } from './series-recovery.mjs'
import {
  snapshotSql,
  classify,
  verifySaved,
  verifyReset,
  OUTAGE_REASON,
  quote,
} from './series-recovery-lib.mjs'
assert.equal(process.env.RV_STACK_LOCK_HELD, '1', 'Use scripts/stack-lock.sh')
const actor = 'ba100000-0000-4000-8000-000000000001',
  id = 'ba200000-0000-4000-8000-000000000001'
const work = {
  id,
  title: 'Recovery Fixture',
  author_text: 'Fixture Author',
  series: 'Recovery Fixture Series',
  position: 1,
  work_id: 'hardcover:190000001',
  enrichment_confidence: 'high',
}
const baseSetup = `insert into auth.users(id,email) values (${quote(actor)},'recovery-only@example.invalid');
 insert into public.corpus_admins(user_id) values (${quote(actor)});
 insert into public.works(id,work_key,title,author_text,series,position,work_id,enrichment_confidence,series_check_state,series_checked_at,series_check_reason,series_check_evidence)
 values (${quote(id)},public.library_work_key(${quote(work.title)},${quote(work.author_text)}),${quote(work.title)},${quote(work.author_text)},${quote(work.series)},1,${quote(work.work_id)},'high','no_series','2026-09-04T00:00:00Z',${quote(OUTAGE_REASON)},'[{"source":"hardcover","kind":"provider_unavailable"}]');`
const env = { ...process.env, PGHOSTADDR: '127.0.0.1' }
delete env.PGSERVICE
delete env.PGOPTIONS
const run = (sql) =>
  execFileSync(
    'psql',
    [
      'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
      '-X',
      '-qAt',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    { input: sql, encoding: 'utf8', env, stdio: ['pipe', 'pipe', 'pipe'] },
  )
const template = readFileSync(
  new URL('../docs/queries/series-unavailable-retry.sql', import.meta.url),
  'utf8',
)
const snapshot = `select jsonb_agg(t) from (${snapshotSql([id]).replace(/;\s*$/, '')}) t;`
let reset = resetSql(template, [{ id, fingerprint: 'PLACEHOLDER' }], actor, false)
  .replace('begin;', () => `begin; ${baseSetup} ${snapshot}`)
  .replace(
    "'PLACEHOLDER'",
    () => `(select md5(to_jsonb(w)::text) from public.works w where id=${quote(id)})`,
  )
const resetOutput = run(reset.replace('rollback;', () => `${snapshot} rollback;`))
assert.match(resetOutput, new RegExp(id + '\\|unresolved\\|'))
const resetSnapshots = resetOutput
  .split('\n')
  .filter((line) => line.startsWith('['))
  .map((line) => JSON.parse(line)[0])
verifyReset(resetSnapshots[0], resetSnapshots[1])
assert.throws(
  () => run(reset.replace('select md5(to_jsonb(w)::text)', "select 'stale'")),
  (error) => /changed, already recovered/.test(String(error.stderr)),
)
const packet = {
  name: work.series,
  sourceRef: '190000002',
  memberCount: null,
  membershipEntries: [
    { title: work.title, author: work.author_text, position: 1 },
    { title: 'Recovery Volume Two', author: work.author_text, position: 2 },
  ],
}
let count = 0
for (const [review, oldPosition, oldCount, observedPosition] of [
  [false, 1, null, 1],
  [true, 1, null, 1],
  [false, null, 5, 1],
  [true, null, 5, 1],
  [false, null, null, null],
]) {
  const entries = [
    { ...packet.membershipEntries[0], position: observedPosition },
    packet.membershipEntries[1],
    { title: 'Recovery Volume Three', author: work.author_text, position: 3 },
  ]
  const proposal = classify(
    { ...work, position: oldPosition, series_count: oldCount },
    { ...packet, membershipEntries: review ? entries.slice(0, 1) : entries },
  ).result
  const checkedAt = '2026-09-12T00:00:00Z'
  const setup = `${baseSetup}
  update public.works set series_check_state='unresolved',series_checked_at=null,metadata_provenance='{}'::jsonb,
    position=${oldPosition ?? 'null'},series_count=${oldCount ?? 'null'} where id=${quote(id)};
  insert into public.books(id,owner_id,corpus_work_id,title,authors_display,series,position,series_claim,series_user_chosen)
  values ('ba300000-0000-4000-8000-000000000001',${quote(actor)},${quote(id)},'Recovery Fixture',${quote(work.author_text)},${quote(work.series)},1,'{"origin":"unknown"}',false),
   ('ba300000-0000-4000-8000-000000000002',${quote(actor)},${quote(id)},'Recovery Fixture',${quote(work.author_text)},null,null,'{"origin":"reader"}',true),
   ('ba300000-0000-4000-8000-000000000003',${quote(actor)},${quote(id)},'Recovery Fixture',${quote(work.author_text)},'Import Choice',8,'{"origin":"import"}',false);
  insert into public.reads(id,book_id,owner_id,read_on,format,rating,notes)
  values ('ba400000-0000-4000-8000-000000000001','ba300000-0000-4000-8000-000000000001',${quote(actor)},'2026-08-01','ebook',4,'Protected synthetic reading history');
  ${snapshot}`
  const sql = saveSql({ id, fingerprint: 'PLACEHOLDER' }, proposal, checkedAt, actor)
    .replace('begin;', () => `begin; ${setup}`)
    .replace(
      "'PLACEHOLDER'",
      () => `(select md5(to_jsonb(w)::text) from public.works w where id=${quote(id)})`,
    )
    .replace('commit;', () => `${snapshot} rollback;`)
  const output = run(sql)
    .split('\n')
    .filter((line) => line.startsWith('[') || line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .filter((value) => Array.isArray(value) || value.outcome)
  const [before, response, after] = output
  assert.equal(response.outcome, review ? 'review' : 'confirmed')
  verifySaved(before[0], after[0], proposal, checkedAt, response)
  assert.equal(after[0].copies[1].full, before[0].copies[1].full, 'reader clear unchanged')
  const stale = saveSql({ id, fingerprint: 'stale' }, proposal, checkedAt, actor)
    .replace('begin;', () => `begin; ${setup}`)
    .replace('commit;', 'rollback;')
  assert.throws(
    () => run(stale),
    (error) => /changed target/.test(String(error.stderr)),
  )
  count++
}
console.log(
  `Local reset/rollback/stale guard and ${count} actual RPC save/readback paths passed; production untouched.`,
)
