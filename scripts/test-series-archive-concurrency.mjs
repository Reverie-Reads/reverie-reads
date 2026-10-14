// Deterministic two-session regressions for reversible series archive.
//
// Race 1 proves the global lock order: a membership writer already holding the linked book can
// still acquire the series and commit while archive waits book-first. The former series-first
// archive deadlocked in exactly this schedule (archive held series → waited book; writer held book
// → waited series).
//
// Race 2 forces the equivalent restore schedule: a writer holds a linked book, restore starts, and
// that writer attempts to update membership against the still-archived series. Restore waits on the
// book before taking the series, so the writer is refused and restore then reclaims the saved
// primary without a cycle.
//
// Race 3 pauses archive after it holds the series. A new membership writer then holds its new book
// and waits on that series. Once archive commits, the writer reaches the archived-parent trigger
// and is refused with 55000, leaving no hidden entry behind.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'

const DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
const BARRIER_CLASS = 1_609_140_001
const BARRIER_ID = 1

const ownerId = randomUUID()
const firstSeriesId = randomUUID()
const secondSeriesId = randomUUID()
const firstBookId = randomUUID()
const secondBookId = randomUUID()
const lateBookId = randomUUID()
const firstEntryId = randomUUID()
const secondEntryId = randomUUID()
const workIds = [randomUUID(), randomUUID(), randomUUID()]
const suffix = randomUUID()

const sqlScalar = (statement) =>
  execFileSync('psql', [DATABASE_URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim()

class PsqlSession {
  constructor(name) {
    this.name = name
    this.sequence = 0
    this.buffer = ''
    this.stderr = ''
    this.pending = null
    this.process = spawn('psql', [DATABASE_URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.process.stdout.setEncoding('utf8')
    this.process.stderr.setEncoding('utf8')
    this.process.stdout.on('data', (chunk) => this.#consume(chunk))
    this.process.stderr.on('data', (chunk) => {
      this.stderr += chunk
    })
    this.process.on('error', (error) => this.#reject(error))
    this.process.on('exit', (code) => {
      if (this.pending)
        this.#reject(new Error(`${this.name} exited ${code}: ${this.stderr.trim()}`))
    })
  }

  #consume(chunk) {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!this.pending) continue
      if (line === this.pending.sentinel) {
        const { resolve, output } = this.pending
        this.pending = null
        resolve(output.join('\n').trim())
      } else {
        this.pending.output.push(line)
      }
    }
  }

  #reject(error) {
    if (!this.pending) return
    const { reject } = this.pending
    this.pending = null
    reject(error)
  }

  command(statement) {
    assert.equal(this.pending, null, `${this.name} already has a command in flight`)
    const sentinel = `__series_archive_${this.name}_${this.sequence++}_${randomUUID()}__`
    return new Promise((resolve, reject) => {
      this.pending = { sentinel, output: [], resolve, reject }
      this.process.stdin.write(`${statement}\n\\echo ${sentinel}\n`)
    })
  }

  async close() {
    if (this.process.exitCode !== null) return
    const exited = once(this.process, 'exit')
    this.process.stdin.end()
    await exited
  }
}

const authPreamble = () => `
  set local deadlock_timeout = '100ms';
  set local lock_timeout = '8s';
  set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"${ownerId}","role":"authenticated"}',
    true
  );
`

async function waitForBlocked(pid, description) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const waiting = Number(
      sqlScalar(`select count(*) from pg_catalog.pg_locks where pid = ${pid} and not granted;`),
    )
    if (waiting > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${description}`)
}

async function waitForBarrier(pid) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const waiting = Number(
      sqlScalar(`
        select count(*)
        from pg_catalog.pg_locks
        where pid = ${pid}
          and locktype = 'advisory'
          and classid = ${BARRIER_CLASS}
          and objid = ${BARRIER_ID}
          and mode = 'ShareLock'
          and not granted;
      `),
    )
    if (waiting === 1) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for archive to reach the post-series-lock barrier')
}

function setupFixtures() {
  sqlScalar(`
    insert into auth.users
      (id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values
      ('${ownerId}'::uuid, 'authenticated', 'authenticated',
       'series-archive-concurrency-${suffix}@example.com', '{}'::jsonb, '{}'::jsonb, now(), now());

    insert into public.works (id, work_key, title, contributors, author_text, isbns)
    values
      ('${workIds[0]}'::uuid, 'series-archive-concurrency:${suffix}:1', 'Lock-order book', '[]'::jsonb, '', array['9780000000001']),
      ('${workIds[1]}'::uuid, 'series-archive-concurrency:${suffix}:2', 'Barrier book', '[]'::jsonb, '', array['9780000000002']),
      ('${workIds[2]}'::uuid, 'series-archive-concurrency:${suffix}:3', 'Late book', '[]'::jsonb, '', array['9780000000003']);

    insert into public.series (id, owner_id, name)
    values
      ('${firstSeriesId}'::uuid, '${ownerId}'::uuid, 'Lock-order series ${suffix}'),
      ('${secondSeriesId}'::uuid, '${ownerId}'::uuid, 'Barrier series ${suffix}');

    insert into public.books (id, owner_id, corpus_work_id, title, isbn)
    values
      ('${firstBookId}'::uuid, '${ownerId}'::uuid, '${workIds[0]}'::uuid, 'Lock-order book', '9780000000001'),
      ('${secondBookId}'::uuid, '${ownerId}'::uuid, '${workIds[1]}'::uuid, 'Barrier book', '9780000000002'),
      ('${lateBookId}'::uuid, '${ownerId}'::uuid, '${workIds[2]}'::uuid, 'Late book', '9780000000003');

    insert into public.series_entries
      (id, series_id, owner_id, position, title, book_id, is_primary,
       membership_claim, position_claim)
    values
      ('${firstEntryId}'::uuid, '${firstSeriesId}'::uuid, '${ownerId}'::uuid, 1,
       'Lock-order book', '${firstBookId}'::uuid, true,
       '{"origin":"reader","source":"concurrency_fixture"}'::jsonb,
       '{"origin":"reader","source":"concurrency_fixture"}'::jsonb),
      ('${secondEntryId}'::uuid, '${secondSeriesId}'::uuid, '${ownerId}'::uuid, 1,
       'Barrier book', '${secondBookId}'::uuid, true,
       '{"origin":"reader","source":"concurrency_fixture"}'::jsonb,
       '{"origin":"reader","source":"concurrency_fixture"}'::jsonb);
  `)
}

async function exerciseBookBeforeSeriesOrder() {
  const writer = new PsqlSession('writer-first')
  const archiver = new PsqlSession('archive-second')
  let archiveResult = null
  try {
    const archivePid = Number(await archiver.command('select pg_backend_pid();'))
    await writer.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local lock_timeout = '8s';
      select 1 from public.books where id = '${firstBookId}'::uuid for update;
      select 'book-locked';
    `)

    archiveResult = archiver.command(`
      begin;
      ${authPreamble()}
      select public.archive_personal_series('${firstSeriesId}'::uuid);
      commit;
      select 'archive-committed';
    `)
    await waitForBlocked(archivePid, 'archive to wait on the already locked book')

    const writerResult = await writer.command(`
      ${authPreamble()}
      select public.set_book_series_membership(
        '${firstBookId}'::uuid, '${firstSeriesId}'::uuid, 'Lock-order series ${suffix}',
        1, null, true,
        '{"origin":"reader","source":"concurrent_writer"}'::jsonb,
        '{"origin":"reader","source":"concurrent_writer"}'::jsonb
      );
      reset role;
      commit;
      select 'writer-committed';
    `)
    assert.match(writerResult, /writer-committed/, 'book-first membership writer commits')
    assert.match(await archiveResult, /archive-committed/, 'archive commits without deadlock')
    archiveResult = null

    assert.equal(
      sqlScalar(
        `select (archived_at is not null)::text from public.series where id = '${firstSeriesId}'::uuid;`,
      ),
      'true',
      'the series is archived after the serialized writer',
    )
    assert.equal(
      sqlScalar(`
        select (archive_primary_intent and not is_primary)::text
        from public.series_entries where id = '${firstEntryId}'::uuid;
      `),
      'true',
      'the just-committed primary is preserved as archive intent',
    )
    console.log('✓ series archive follows book → series lock order without deadlock')
  } finally {
    await Promise.allSettled([archiveResult, writer.close(), archiver.close()])
  }
}

async function exerciseRestoreBookBeforeSeriesOrder() {
  const writer = new PsqlSession('restore-writer-first')
  const restorer = new PsqlSession('restore-second')
  let restoreResult = null
  try {
    const restorePid = Number(await restorer.command('select pg_backend_pid();'))
    await writer.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local lock_timeout = '8s';
      select 1 from public.books where id = '${firstBookId}'::uuid for update;
      select 'book-locked';
    `)

    restoreResult = restorer.command(`
      begin;
      ${authPreamble()}
      select public.restore_personal_series('${firstSeriesId}'::uuid);
      commit;
      select 'restore-committed';
    `)
    await waitForBlocked(restorePid, 'restore to wait on the already locked linked book')

    const writerResult = await writer.command(`
      ${authPreamble()}
      do $writer$
      begin
        begin
          perform public.set_book_series_membership(
            '${firstBookId}'::uuid, '${firstSeriesId}'::uuid, 'Lock-order series ${suffix}',
            1, null, true,
            '{"origin":"reader","source":"restore_race_writer"}'::jsonb,
            '{"origin":"reader","source":"restore_race_writer"}'::jsonb
          );
          raise exception 'expected archived-parent refusal';
        exception when sqlstate '55000' or sqlstate 'P0001' then
          -- The active-series lookup now rejects an archived ID as unavailable. Require
          -- this exact owned archived row so another ownership failure cannot pass the race.
          if sqlerrm not in ('series is archived; restore it first', 'not owner of series') then raise; end if;
          reset role;
          if not exists (
            select 1 from public.series where id = '${firstSeriesId}'::uuid
              and owner_id = '${ownerId}'::uuid and archived_at is not null
          ) then raise; end if;
          set local role authenticated;
        end;
      end;
      $writer$;
      reset role;
      commit;
      select 'archived-membership-refused';
    `)
    assert.match(
      writerResult,
      /archived-membership-refused/,
      'membership writer is refused without deadlock',
    )
    assert.match(await restoreResult, /restore-committed/, 'restore commits without deadlock')
    restoreResult = null

    assert.equal(
      sqlScalar(
        `select (archived_at is null)::text from public.series where id = '${firstSeriesId}'::uuid;`,
      ),
      'true',
      'the series is active after restore',
    )
    assert.equal(
      sqlScalar(`
        select (is_primary and not archive_primary_intent)::text
        from public.series_entries where id = '${firstEntryId}'::uuid;
      `),
      'true',
      'restore reclaims and consumes the saved primary intent',
    )
    assert.equal(
      sqlScalar(`
        select (series = 'Lock-order series ${suffix}' and position = 1)::text
        from public.books where id = '${firstBookId}'::uuid;
      `),
      'true',
      'the restored primary projects the active membership',
    )
    console.log('✓ series restore follows book → series → entry without deadlock')
  } finally {
    await Promise.allSettled([restoreResult, writer.close(), restorer.close()])
  }
}

async function exerciseLateMembershipRefusal() {
  const controller = new PsqlSession('barrier-controller')
  const archiver = new PsqlSession('barrier-archiver')
  const writer = new PsqlSession('late-writer')
  let archiveResult = null
  let writerResult = null
  let barrierHeld = false
  let triggerInstalled = false
  try {
    sqlScalar(`
      create or replace function public.series_archive_concurrency_barrier_fixture()
      returns trigger
      language plpgsql
      set search_path = ''
      as $fixture$
      begin
        if old.series_id = '${secondSeriesId}'::uuid
           and old.is_primary and not new.is_primary and new.archive_primary_intent
        then
          perform pg_catalog.pg_advisory_xact_lock_shared(${BARRIER_CLASS}, ${BARRIER_ID});
        end if;
        return new;
      end;
      $fixture$;
      revoke all on function public.series_archive_concurrency_barrier_fixture()
        from public, anon, authenticated, service_role;
      create trigger aaa_series_archive_concurrency_barrier_fixture
      before update on public.series_entries
      for each row execute function public.series_archive_concurrency_barrier_fixture();
    `)
    triggerInstalled = true

    await controller.command(`select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${BARRIER_ID});`)
    barrierHeld = true
    const archivePid = Number(await archiver.command('select pg_backend_pid();'))
    const writerPid = Number(await writer.command('select pg_backend_pid();'))

    archiveResult = archiver.command(`
      begin;
      ${authPreamble()}
      select public.archive_personal_series('${secondSeriesId}'::uuid);
      commit;
      select 'archive-committed';
    `)
    await waitForBarrier(archivePid)

    writerResult = writer.command(`
      begin;
      ${authPreamble()}
      do $writer$
      begin
        begin
          perform public.set_book_series_membership(
            '${lateBookId}'::uuid, '${secondSeriesId}'::uuid, 'Barrier series ${suffix}',
            2, null, true,
            '{"origin":"reader","source":"late_writer"}'::jsonb,
            '{"origin":"reader","source":"late_writer"}'::jsonb
          );
          raise exception 'expected archived-parent refusal';
        exception when sqlstate '55000' or sqlstate 'P0001' then
          -- The active-series lookup now rejects an archived ID as unavailable. Require
          -- this exact owned archived row so another ownership failure cannot pass the race.
          if sqlerrm not in ('series is archived; restore it first', 'not owner of series') then raise; end if;
          reset role;
          if not exists (
            select 1 from public.series where id = '${secondSeriesId}'::uuid
              and owner_id = '${ownerId}'::uuid and archived_at is not null
          ) then raise; end if;
          set local role authenticated;
        end;
      end;
      $writer$;
      commit;
      select 'late-membership-refused';
    `)
    await waitForBlocked(writerPid, 'late membership to wait behind the archive series lock')

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${BARRIER_ID});`,
    )
    barrierHeld = false
    assert.match(await archiveResult, /archive-committed/, 'barrier archive commits')
    archiveResult = null
    assert.match(await writerResult, /late-membership-refused/, 'late membership is safely refused')
    writerResult = null

    assert.equal(
      sqlScalar(
        `select count(*) from public.series_entries where book_id = '${lateBookId}'::uuid;`,
      ),
      '0',
      'the losing writer leaves no hidden membership',
    )
    assert.equal(
      sqlScalar(
        `select (series is null and position is null)::text from public.books where id = '${lateBookId}'::uuid;`,
      ),
      'true',
      'the losing writer leaves the book projection untouched',
    )
    console.log('✓ membership losing the series-lock race is refused after archive')
  } finally {
    if (barrierHeld) {
      await controller
        .command(`select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${BARRIER_ID});`)
        .catch(() => {})
    }
    await Promise.allSettled([archiveResult, writerResult])
    await Promise.allSettled([controller.close(), archiver.close(), writer.close()])
    if (triggerInstalled) {
      sqlScalar(`
        drop trigger if exists aaa_series_archive_concurrency_barrier_fixture
          on public.series_entries;
        drop function if exists public.series_archive_concurrency_barrier_fixture();
      `)
    }
  }
}

try {
  setupFixtures()
  await exerciseBookBeforeSeriesOrder()
  await exerciseRestoreBookBeforeSeriesOrder()
  await exerciseLateMembershipRefusal()
} finally {
  sqlScalar(`
    drop trigger if exists aaa_series_archive_concurrency_barrier_fixture
      on public.series_entries;
    drop function if exists public.series_archive_concurrency_barrier_fixture();
    delete from auth.users where id = '${ownerId}'::uuid;
    delete from public.works where id in (
      '${workIds[0]}'::uuid, '${workIds[1]}'::uuid, '${workIds[2]}'::uuid
    );
  `)
}
