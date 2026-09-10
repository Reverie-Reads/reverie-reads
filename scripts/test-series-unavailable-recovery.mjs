// Local-only executable check of the owner's actual rollback-by-default recovery SQL.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

assert.equal(process.env.RV_STACK_LOCK_HELD, '1', 'Run under scripts/stack-lock.sh')
const actor = 'ba100000-0000-4000-8000-000000000001'
const work = 'ba200000-0000-4000-8000-000000000001'
const sql = readFileSync(
  new URL('../docs/queries/series-unavailable-retry.sql', import.meta.url),
  'utf8',
)
const setup = `
insert into auth.users (id, email) values ('${actor}', 'series-retry-fixture@example.invalid');
insert into public.corpus_admins (user_id) values ('${actor}');
insert into public.works (id, work_key, title, series, position, series_check_state,
  series_checked_at, series_check_reason, series_check_evidence)
values ('${work}', 'retry-fixture', 'Retry Fixture', 'Legacy Label', 3, 'no_series',
  '2026-09-04T00:00:00Z',
  'The relational series source was unavailable; the search label was not accepted by itself.',
  '[{"source":"hardcover","kind":"provider_unavailable"}]');`
const ready = sql
  .replace('begin;', `begin;\n${setup}`)
  .replace(
    '-- Empty input deliberately refuses to run.',
    `insert into series_retry_input
    select id, md5(to_jsonb(w)::text) from public.works w where id = '${work}';`,
  )
  .replace(
    "-- Insert the existing corpus administrator's UUID here; never create an administrator for this.",
    `insert into series_retry_actor values ('${actor}');`,
  )
const checks = `do $check$ begin
  if not exists (select 1 from public.works where id = '${work}' and series_check_state = 'unresolved'
    and series_checked_at is null and series = 'Legacy Label' and position = 3) then
    raise exception 'Recovery did not preserve tuple and schedule retry'; end if;
  if not exists (select 1 from public.work_metadata_edits where work_id = '${work}' and editor_id = '${actor}'
    and previous_value ->> 'series_check_state' = 'no_series'
    and previous_value ->> 'series_checked_at' is not null
    and next_value ->> 'series_check_state' = 'unresolved') then
    raise exception 'Recovery audit missing'; end if;
end; $check$;`
function run(input) {
  return execFileSync(
    'psql',
    [
      'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      '-',
    ],
    {
      input,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PGHOSTADDR: '127.0.0.1', PGSERVICE: '', PGOPTIONS: '' },
    },
  )
}
assert.match(run(ready.replace('rollback;', `${checks}\nrollback;`)), /ROLLBACK/)
for (const [label, input, error] of [
  ['empty input', sql, /Expected 1-25 reviewed targets/],
  [
    'stale fingerprint',
    ready.replace(
      'do $repair$',
      "update series_retry_input set fingerprint = 'stale';\ndo $repair$",
    ),
    /changed, already recovered/,
  ],
  [
    'replay',
    ready.replace(
      'do $repair$',
      `update public.works set series_check_state = 'unresolved' where id = '${work}';\ndo $repair$`,
    ),
    /changed, already recovered/,
  ],
]) {
  assert.throws(
    () => run(input),
    (failure) => error.test(String(failure.stderr)),
    label,
  )
}
console.log(
  'Recovery SQL: success/audit/rollback, empty input, stale fingerprint and replay checks passed',
)
