// Deterministic local two-session regressions for household revocation and corpus ISBN resolution.
// Real writes run in explicit transactions behind controller-owned lock barriers. The harness reads
// pg_locks before releasing transactions, so lock state rather than elapsed-time delay proves each
// race was reached. Application conflicts use PT409; 40001 would ask PostgREST to retry.

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55322/postgres'
const SERVICE_ROLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const client = () =>
  createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

const admin = client()
const fixtureUserIds = []
let householdId = null

// Two-key advisory locks make the controller barrier easy to identify exactly in pg_locks.
const BARRIER_CLASS = 1_608_202_608
const BARRIER_ID = 1
const ISBN_BARRIER_ID = 2
const RECONCILIATION_INSERT_BARRIER_ID = 3
const RECONCILIATION_ROSTER_BARRIER_ID = 4
const RECONCILIATION_LATE_INSERT_BARRIER_ID = 5
const HOUSEHOLD_ADD_BARRIER_ID = 6
const HOUSEHOLD_ISBN_BARRIER_ID = 7
const CORPUS_EDIT_TAG_BARRIER_ID = 8
const CROSS_MEMBER_CORPUS_EDIT_BARRIER_ID = 9
const PERSONAL_COVER_CORPUS_EDIT_BARRIER_ID = 10
const COVER_REVIEW_IDENTITY_BARRIER_ID = 11

const sqlScalar = (statement) =>
  execFileSync('psql', [DATABASE_URL, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim()

const yieldTurn = () => new Promise((resolve) => setImmediate(resolve))

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
      if (this.pending) {
        this.#reject(new Error(`${this.name} psql exited ${code}: ${this.stderr.trim()}`))
      }
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
    const sentinel = `__reverie_${this.name}_${this.sequence++}_${randomUUID()}__`
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

const dbError = (action, error) =>
  new Error(`${action}: ${error?.message ?? JSON.stringify(error)}`)

async function fixtureAccount(label) {
  const email = `household-unlink-${label}-${randomUUID()}@reverie.local`
  const created = await admin.auth.admin.createUser({
    email,
    password: `local-${randomUUID()}`,
    email_confirm: true,
  })
  if (created.error || !created.data.user) throw dbError(`${label} account create`, created.error)
  const userId = created.data.user.id
  fixtureUserIds.push(userId)

  const profile = await admin
    .from('profiles')
    .upsert({ id: userId, display_name: `Concurrent ${label}` })
  if (profile.error) throw dbError(`${label} profile upsert`, profile.error)
  const book = await admin.from('books').insert({
    owner_id: userId,
    title: `Preserved ${label} book`,
    author_first: 'Local',
    author_last: 'Fixture',
    authors_display: 'Local Fixture',
    status: 'standalone',
    ownership: 'owned',
  })
  if (book.error) throw dbError(`${label} book insert`, book.error)
  return userId
}

async function waitForConcurrentState(workerPids, barrierId = BARRIER_ID) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const [barrierWaiters, waitingWorkers] = sqlScalar(`
      select
        count(*) filter (
          where not granted
            and locktype = 'advisory'
            and classid = ${BARRIER_CLASS}
            and objid = ${barrierId}
            and mode = 'ShareLock'
        ),
        count(distinct pid) filter (where not granted)
      from pg_catalog.pg_locks
      where pid in (${workerPids.join(', ')});
    `)
      .split('|')
      .map(Number)

    // Fixed: the first write completed behind the barrier; the second worker is waiting on its
    // serialization lock. Old: both writes completed behind the barrier without serializing.
    if (barrierWaiters === 2 || (barrierWaiters === 1 && waitingWorkers === 2)) {
      return { barrierWaiters, waitingWorkers }
    }
    await yieldTurn()
  }
  throw new Error('timed out waiting for both unlink transactions to reach a proven lock state')
}

async function waitForBlockedWorker(workerPid, action) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const blocked = Number(
      sqlScalar(`
        select count(*) from pg_catalog.pg_locks
        where pid = ${workerPid} and not granted;
      `),
    )
    if (blocked > 0) return
    await yieldTurn()
  }
  throw new Error(`timed out waiting for ${action} to block behind the revocation lock`)
}

const authenticatedCall = (userId, statement) => `
  begin;
  set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"${userId}","role":"authenticated"}',
    true
  );
  do $race$
  declare
    rejected boolean := false;
  begin
    begin
      ${statement};
    exception when sqlstate 'PT409' or sqlstate 'P0002' then
      rejected := true;
    end;
    if not rejected then
      raise exception 'expected safe refusal after concurrent membership revocation';
    end if;
  end;
  $race$;
  commit;
  select 'rejected-after-serialization';
`

const authenticatedPersonalWrite = (userId, statement) => `
  begin;
  set local role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"${userId}","role":"authenticated"}',
    true
  );
  ${statement};
  commit;
  select 'personal-write-committed';
`

async function runRevocationRace({ action, userId, statement, verify }) {
  const revoker = new PsqlSession(`${action}-revoker`)
  const worker = new PsqlSession(`${action}-worker`)
  let workerResult = null
  let revocationOpen = false
  try {
    const workerPid = Number(await worker.command('select pg_backend_pid();'))
    assert.ok(Number.isInteger(workerPid), `${action} worker exposes a stable PID`)

    await revoker.command(`
      begin;
      set local role service_role;
      select public.unlink_household_member('${userId}'::uuid, '${householdId}'::uuid);
      reset role;
      select 'revoked-but-uncommitted';
    `)
    revocationOpen = true

    workerResult = worker.command(authenticatedCall(userId, statement))
    await waitForBlockedWorker(workerPid, action)
    await revoker.command('commit;')
    revocationOpen = false
    assert.match(await workerResult, /rejected-after-serialization/, `${action} rejects stale auth`)
    await verify()
    console.log(`✓ ${action} rechecks authorization after its serialization lock`)
  } finally {
    if (revocationOpen) await revoker.command('rollback;').catch(() => {})
    await Promise.allSettled([workerResult, worker.close(), revoker.close()])
  }
}

async function runTriggerRevocationRace({ action, userId, statement, verify }) {
  const revoker = new PsqlSession(`${action}-revoker`)
  const worker = new PsqlSession(`${action}-worker`)
  let workerResult = null
  let revocationOpen = false
  try {
    const workerPid = Number(await worker.command('select pg_backend_pid();'))
    assert.ok(Number.isInteger(workerPid), `${action} worker exposes a stable PID`)

    await revoker.command(`
      begin;
      set local role service_role;
      select public.unlink_household_member('${userId}'::uuid, '${householdId}'::uuid);
      reset role;
      select 'revoked-but-uncommitted';
    `)
    revocationOpen = true

    workerResult = worker.command(authenticatedPersonalWrite(userId, statement))
    await waitForBlockedWorker(workerPid, action)
    await revoker.command('commit;')
    revocationOpen = false
    assert.match(await workerResult, /personal-write-committed/, `${action} keeps personal edit`)
    await verify()
    console.log(`✓ ${action} keeps the personal edit but suppresses its revoked household write`)
  } finally {
    if (revocationOpen) await revoker.command('rollback;').catch(() => {})
    await Promise.allSettled([workerResult, worker.close(), revoker.close()])
  }
}

async function runPersonalBookRevocationRace({ action, userId, bookId, statement, verify }) {
  const remover = new PsqlSession(`${action}-remover`)
  const worker = new PsqlSession(`${action}-worker`)
  let workerResult = null
  let removalOpen = false
  try {
    const workerPid = Number(await worker.command('select pg_backend_pid();'))
    assert.ok(Number.isInteger(workerPid), `${action} worker exposes a stable PID`)

    await remover.command(`
      begin;
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${userId}","role":"authenticated"}',
        true
      );
      select public.remove_personal_book('${bookId}'::uuid);
      reset role;
      select 'removed-but-uncommitted';
    `)
    removalOpen = true

    workerResult = worker.command(authenticatedPersonalWrite(userId, statement))
    await waitForBlockedWorker(workerPid, action)
    await remover.command('commit;')
    removalOpen = false
    assert.match(await workerResult, /personal-write-committed/, `${action} keeps personal edit`)
    await verify()
    console.log(`✓ ${action} suppresses the household write after exact-book removal`)
  } finally {
    if (removalOpen) await remover.command('rollback;').catch(() => {})
    await Promise.allSettled([workerResult, worker.close(), remover.close()])
  }
}

async function runPersonalBookRebindRace({ action, userId, rebindStatement, statement, verify }) {
  const rebinder = new PsqlSession(`${action}-rebinder`)
  const worker = new PsqlSession(`${action}-worker`)
  let workerResult = null
  let rebindOpen = false
  try {
    const workerPid = Number(await worker.command('select pg_backend_pid();'))
    assert.ok(Number.isInteger(workerPid), `${action} worker exposes a stable PID`)

    await rebinder.command(`
      begin;
      set local role service_role;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      ${rebindStatement};
      reset role;
      select 'rebound-but-uncommitted';
    `)
    rebindOpen = true

    workerResult = worker.command(authenticatedPersonalWrite(userId, statement))
    await waitForBlockedWorker(workerPid, action)
    await rebinder.command('commit;')
    rebindOpen = false
    assert.match(await workerResult, /personal-write-committed/, `${action} keeps personal edit`)
    await verify()
    console.log(`✓ ${action} suppresses the household write after exact-work rebinding`)
  } finally {
    if (rebindOpen) await rebinder.command('rollback;').catch(() => {})
    await Promise.allSettled([workerResult, worker.close(), rebinder.close()])
  }
}

async function relinkMember(ownerId, memberId) {
  const linked = await admin.rpc('link_household', {
    p_name: 'Concurrent final unlink fixture',
    p_owner: ownerId,
    p_members: [memberId],
  })
  if (linked.error || linked.data !== householdId) {
    throw dbError('fixture member relink', linked.error)
  }
}

async function exerciseWorkerFirstHouseholdAddLockOrdering(ownerId, memberId) {
  const workId = randomUUID()
  const suffix = randomUUID()
  const controller = new PsqlSession('household-add-controller')
  const worker = new PsqlSession('household-add-worker')
  const revoker = new PsqlSession('household-add-revoker')
  let barrierHeld = false
  let workerResult = null
  let revokerResult = null

  try {
    sqlScalar(`
      drop trigger if exists household_add_barrier_fixture on public.household_works;
      drop function if exists public.household_add_barrier_fixture();
      insert into public.works (id, work_key, title, author_text, contributors, status)
      values (
        '${workId}'::uuid,
        'worker-first-household-add-${suffix}',
        'Worker first household add ${suffix}',
        'Concurrent Fixture',
        '[{"name":"Concurrent Fixture","role":"author","position":0}]'::jsonb,
        'standalone'
      );
      create function public.household_add_barrier_fixture()
      returns trigger
      language plpgsql
      set search_path = ''
      as $fixture$
      begin
        if new.work_id = '${workId}'::uuid then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${HOUSEHOLD_ADD_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger household_add_barrier_fixture
        before insert on public.household_works
        for each row execute function public.household_add_barrier_fixture();
    `)

    await controller.command(
      `select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${HOUSEHOLD_ADD_BARRIER_ID});`,
    )
    barrierHeld = true
    const workerPid = Number(await worker.command('select pg_backend_pid();'))
    const revokerPid = Number(await revoker.command('select pg_backend_pid();'))

    workerResult = worker.command(
      authenticatedPersonalWrite(
        memberId,
        `select public.add_corpus_work_to_household('${workId}'::uuid)`,
      ),
    )
    await waitForBlockedWorker(workerPid, 'worker-first household add barrier')

    revokerResult = revoker.command(`
      begin;
      set local role service_role;
      select public.unlink_household_member('${memberId}'::uuid, '${householdId}'::uuid);
      reset role;
      commit;
      select 'member-unlinked';
    `)
    await waitForBlockedWorker(revokerPid, 'worker-first household unlink')

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${HOUSEHOLD_ADD_BARRIER_ID});`,
    )
    barrierHeld = false
    assert.match(await workerResult, /personal-write-committed/, 'the earlier add commits')
    assert.match(
      await revokerResult,
      /member-unlinked/,
      'the later unlink commits without deadlock',
    )
    assert.equal(
      sqlScalar(
        `select count(*) from public.household_members where user_id = '${memberId}'::uuid;`,
      ),
      '0',
      'the serialized unlink removes the member after the add',
    )
    assert.equal(
      sqlScalar(`
        select count(*) from public.household_works
        where household_id = '${householdId}'::uuid and work_id = '${workId}'::uuid
          and removed_at is null;
      `),
      '1',
      'the completed household-only add remains collective after that member leaves',
    )
    console.log('✓ worker-first household add and unlink follow profile-first lock ordering')
    await relinkMember(ownerId, memberId)
  } finally {
    if (barrierHeld) {
      await controller
        .command(
          `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${HOUSEHOLD_ADD_BARRIER_ID});`,
        )
        .catch(() => {})
    }
    await Promise.allSettled([workerResult, revokerResult])
    await Promise.allSettled([controller.close(), worker.close(), revoker.close()])
    sqlScalar(`
      drop trigger if exists household_add_barrier_fixture on public.household_works;
      drop function if exists public.household_add_barrier_fixture();
      delete from public.household_works where work_id = '${workId}'::uuid;
      delete from public.works where id = '${workId}'::uuid;
    `)
  }
}

async function exerciseOwnerCorpusEditTagLockOrdering(ownerId, ownerBookId) {
  const workId = sqlScalar(
    `select corpus_work_id from public.books where id = '${ownerBookId}'::uuid;`,
  )
  const controller = new PsqlSession('corpus-edit-tag-controller')
  const tagger = new PsqlSession('corpus-edit-tag-worker')
  const editor = new PsqlSession('corpus-edit-owner-worker')
  let barrierHeld = false
  let triggerInstalled = false
  let tagResult = null
  let editResult = null

  try {
    sqlScalar(`
      create function public.corpus_edit_tag_barrier_fixture()
      returns trigger language plpgsql security definer set search_path = '' as $fixture$
      begin
        if new.id = '${ownerBookId}'::uuid then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${CORPUS_EDIT_TAG_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger zz_corpus_edit_tag_barrier_fixture
      before update of tags on public.books
      for each row execute function public.corpus_edit_tag_barrier_fixture();
    `)
    triggerInstalled = true
    await controller.command(
      `select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${CORPUS_EDIT_TAG_BARRIER_ID});`,
    )
    barrierHeld = true
    const taggerPid = Number(await tagger.command('select pg_backend_pid();'))
    const editorPid = Number(await editor.command('select pg_backend_pid();'))

    tagResult = tagger.command(
      authenticatedPersonalWrite(
        ownerId,
        `update public.books set tags = array['corpus-edit-lock-order']
         where id = '${ownerBookId}'::uuid`,
      ),
    )
    await waitForBlockedWorker(taggerPid, 'personal tag pre-trigger barrier')

    editResult = editor.command(
      authenticatedPersonalWrite(
        ownerId,
        `select public.edit_corpus_work_metadata(
           work.id, work.series, work.position, work.series_count, work.status,
           'fantasy', work.subgenre, array['fantasy'], work.subgenres,
           work.cover_url, work.cover_options, work.pub_y, work.pub_m, work.pub_d
         ) from public.works work where work.id = '${workId}'::uuid`,
      ),
    )
    await waitForBlockedWorker(editorPid, 'owner corpus edit book-first lock')

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${CORPUS_EDIT_TAG_BARRIER_ID});`,
    )
    barrierHeld = false
    assert.match(await tagResult, /personal-write-committed/, 'the personal tag update commits')
    tagResult = null
    assert.match(await editResult, /personal-write-committed/, 'the owner corpus edit commits')
    editResult = null
    assert.equal(
      sqlScalar(`select array_to_string(tags, ',') from public.books
        where id = '${ownerBookId}'::uuid;`),
      'corpus-edit-lock-order',
      'the serialized personal tag edit is preserved',
    )
    assert.equal(
      sqlScalar(`select genre from public.works where id = '${workId}'::uuid;`),
      'fantasy',
      'the serialized owner corpus edit is preserved',
    )
    console.log('✓ owner corpus edit prelocks personal books before household membership')
  } finally {
    if (barrierHeld) {
      await controller
        .command(
          `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${CORPUS_EDIT_TAG_BARRIER_ID});`,
        )
        .catch(() => {})
    }
    await Promise.allSettled([tagResult, editResult])
    await Promise.allSettled([controller.close(), tagger.close(), editor.close()])
    if (triggerInstalled) {
      sqlScalar(`
        drop trigger if exists zz_corpus_edit_tag_barrier_fixture on public.books;
        drop function if exists public.corpus_edit_tag_barrier_fixture();
      `)
    }
    sqlScalar(`
      delete from public.work_metadata_edits
      where work_id = '${workId}'::uuid and editor_id = '${ownerId}'::uuid;
    `)
  }
}

async function exercisePersonalCoverAdminCorpusEditLockOrdering(ownerId, memberId, ownerBookId) {
  const workId = sqlScalar(
    `select corpus_work_id from public.books where id = '${ownerBookId}'::uuid;`,
  )
  const controller = new PsqlSession('personal-cover-controller')
  const coverEditor = new PsqlSession('personal-cover-worker')
  const corpusEditor = new PsqlSession('personal-cover-corpus-worker')
  let barrierHeld = false
  let triggerInstalled = false
  let identityTriggerInstalled = false
  let identityIsbn = null
  let coverResult = null
  let corpusResult = null

  try {
    sqlScalar(`
      insert into public.corpus_admins (user_id) values ('${ownerId}'::uuid)
      on conflict (user_id) do nothing;
      create function public.personal_cover_edit_barrier_fixture()
      returns trigger language plpgsql security definer set search_path = '' as $fixture$
      begin
        if new.id = '${ownerBookId}'::uuid then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${PERSONAL_COVER_CORPUS_EDIT_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger zz_personal_cover_edit_barrier_fixture
      before update of cover_url on public.books
      for each row execute function public.personal_cover_edit_barrier_fixture();
    `)
    triggerInstalled = true
    await controller.command(
      `select pg_catalog.pg_advisory_lock(
        ${BARRIER_CLASS}, ${PERSONAL_COVER_CORPUS_EDIT_BARRIER_ID}
      );`,
    )
    barrierHeld = true
    const coverPid = Number(await coverEditor.command('select pg_backend_pid();'))
    const corpusPid = Number(await corpusEditor.command('select pg_backend_pid();'))

    coverResult = coverEditor.command(
      authenticatedPersonalWrite(
        ownerId,
        `update public.books
         set cover_url = 'https://personal-only.invalid/${ownerBookId}.jpg', cover_source = 'url'
         where id = '${ownerBookId}'::uuid`,
      ),
    )
    await waitForBlockedWorker(coverPid, 'personal cover row-lock barrier')

    corpusResult = corpusEditor.command(
      authenticatedPersonalWrite(
        ownerId,
        `select public.edit_corpus_work_metadata(
           work.id, work.series, work.position, work.series_count, work.status,
           work.genre, work.subgenre, work.genres, work.subgenres,
           work.cover_url, work.cover_options, work.pub_y, work.pub_m, work.pub_d
         ) from public.works work where work.id = '${workId}'::uuid`,
      ),
    )
    await waitForBlockedWorker(corpusPid, 'administrator corpus edit waiting on personal book')

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(
        ${BARRIER_CLASS}, ${PERSONAL_COVER_CORPUS_EDIT_BARRIER_ID}
      );`,
    )
    barrierHeld = false
    assert.match(await coverResult, /personal-write-committed/, 'the personal cover edit commits')
    coverResult = null
    assert.match(
      await corpusResult,
      /personal-write-committed/,
      'the administrator corpus edit commits without a deadlock',
    )
    corpusResult = null
    assert.equal(
      sqlScalar(`select cover_url from public.books where id = '${ownerBookId}'::uuid;`),
      `https://personal-only.invalid/${ownerBookId}.jpg`,
      'the personal cover remains personal after the serialized edits',
    )
    console.log('✓ personal cover writes do not invert administrator corpus-edit lock order')

    const displayedCover = `https://books.google.com/books/content?id=displayed-${ownerBookId}`
    const replacementCover = `https://books.google.com/books/content?id=replacement-${ownerBookId}`
    sqlScalar(`update public.books
      set cover_url = '${displayedCover}', cover_source = 'google'
      where id = '${ownerBookId}'::uuid;`)
    await controller.command(
      `select pg_catalog.pg_advisory_lock(
        ${BARRIER_CLASS}, ${PERSONAL_COVER_CORPUS_EDIT_BARRIER_ID}
      );`,
    )
    barrierHeld = true

    coverResult = coverEditor.command(
      authenticatedPersonalWrite(
        ownerId,
        `update public.books
         set cover_url = '${replacementCover}', cover_source = 'google'
         where id = '${ownerBookId}'::uuid`,
      ),
    )
    await waitForBlockedWorker(coverPid, 'personal cover replacement barrier')

    corpusResult = corpusEditor.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${ownerId}","role":"authenticated"}',
        true
      );
      do $review$
      begin
        perform public.admin_review_personal_cover_for_corpus(
          '${ownerBookId}'::uuid, '${workId}'::uuid, '${displayedCover}'
        );
        raise exception 'expected stale exact-cover review refusal';
      exception when sqlstate 'PT409' then
        null;
      end;
      $review$;
      commit;
      select 'stale-exact-cover-review-refused';
    `)
    await waitForBlockedWorker(corpusPid, 'exact-cover review waiting on personal book')

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(
        ${BARRIER_CLASS}, ${PERSONAL_COVER_CORPUS_EDIT_BARRIER_ID}
      );`,
    )
    barrierHeld = false
    assert.match(await coverResult, /personal-write-committed/, 'the newer personal cover commits')
    coverResult = null
    assert.match(
      await corpusResult,
      /stale-exact-cover-review-refused/,
      'the waiting review refuses the cover that is no longer selected',
    )
    corpusResult = null
    assert.equal(
      sqlScalar(`select exists (
        select 1 from public.works work
        cross join lateral jsonb_array_elements(work.cover_options) option
        where work.id = '${workId}'::uuid
          and option ->> 'url' in ('${displayedCover}', '${replacementCover}')
      );`),
      'f',
      'neither the stale nor replacement cover publishes without a fresh review gesture',
    )
    console.log('✓ exact-cover review waits for a personal edit and refuses stale browser context')

    identityIsbn = isbn13Fixture()
    sqlScalar(`
      update public.books
      set isbn = '${identityIsbn}', cover_url = '${replacementCover}', cover_source = 'google'
      where id = '${ownerBookId}'::uuid;
      create function public.cover_review_identity_barrier_fixture()
      returns trigger language plpgsql security definer set search_path = '' as $fixture$
      begin
        if '${identityIsbn}' = any(new.isbns) then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${COVER_REVIEW_IDENTITY_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger zz_cover_review_identity_barrier_fixture
      before insert on public.works
      for each row execute function public.cover_review_identity_barrier_fixture();
    `)
    identityTriggerInstalled = true
    await controller.command(
      `select pg_catalog.pg_advisory_lock(
        ${BARRIER_CLASS}, ${COVER_REVIEW_IDENTITY_BARRIER_ID}
      );`,
    )
    barrierHeld = true

    coverResult = coverEditor.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${memberId}","role":"authenticated"}',
        true
      );
      select public.create_household_catalog_work(
        'Competing ISBN identity ${ownerBookId}', 'Different Fixture', '${identityIsbn}', null, null
      );
      commit;
      select 'competing-isbn-work-committed';
    `)
    await waitForBlockedWorker(coverPid, 'competing ISBN work creation barrier')

    corpusResult = corpusEditor.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${ownerId}","role":"authenticated"}',
        true
      );
      do $review$
      begin
        perform public.admin_review_personal_cover_for_corpus(
          '${ownerBookId}'::uuid, '${workId}'::uuid, '${replacementCover}'
        );
        raise exception 'expected unresolved ISBN identity refusal';
      exception when sqlstate 'PT409' then
        null;
      end;
      $review$;
      commit;
      select 'competing-isbn-review-refused';
    `)
    await waitForBlockedWorker(corpusPid, 'cover review waiting on canonical ISBN identity')

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(
        ${BARRIER_CLASS}, ${COVER_REVIEW_IDENTITY_BARRIER_ID}
      );`,
    )
    barrierHeld = false
    assert.match(
      await coverResult,
      /competing-isbn-work-committed/,
      'the earlier competing ISBN identity commits',
    )
    coverResult = null
    assert.match(
      await corpusResult,
      /competing-isbn-review-refused/,
      'the waiting review refuses the now-conflicting corpus identity',
    )
    corpusResult = null
    assert.equal(
      sqlScalar(`select jsonb_array_length(cover_options)
        from public.works where id = '${workId}'::uuid;`),
      '0',
      'the identity race publishes no cover to the stale fallback work',
    )
    console.log('✓ exact-cover review serializes and refuses a competing ISBN identity claim')
  } finally {
    if (barrierHeld) {
      await controller
        .command(
          `select pg_catalog.pg_advisory_unlock(
            ${BARRIER_CLASS}, ${PERSONAL_COVER_CORPUS_EDIT_BARRIER_ID}
          );
          select pg_catalog.pg_advisory_unlock(
            ${BARRIER_CLASS}, ${COVER_REVIEW_IDENTITY_BARRIER_ID}
          );`,
        )
        .catch(() => {})
    }
    await Promise.allSettled([coverResult, corpusResult])
    await Promise.allSettled([controller.close(), coverEditor.close(), corpusEditor.close()])
    if (triggerInstalled) {
      sqlScalar(`
        drop trigger if exists zz_personal_cover_edit_barrier_fixture on public.books;
        drop function if exists public.personal_cover_edit_barrier_fixture();
      `)
    }
    if (identityTriggerInstalled) {
      sqlScalar(`
        drop trigger if exists zz_cover_review_identity_barrier_fixture on public.works;
        drop function if exists public.cover_review_identity_barrier_fixture();
      `)
    }
    sqlScalar(`
      update public.books set isbn = null, cover_url = null, cover_source = null
      where id = '${ownerBookId}'::uuid;
      delete from public.household_works household_work
      using public.works work
      where household_work.work_id = work.id and '${identityIsbn ?? ''}' = any(work.isbns);
      delete from public.work_metadata_edits metadata_edit
      using public.works work
      where metadata_edit.work_id = work.id and '${identityIsbn ?? ''}' = any(work.isbns);
      delete from public.works where '${identityIsbn ?? ''}' = any(isbns);
      delete from public.work_metadata_edits
      where work_id = '${workId}'::uuid and editor_id = '${ownerId}'::uuid;
      delete from public.corpus_admins where user_id = '${ownerId}'::uuid;
    `)
  }
}

async function exerciseCrossMemberAdminCorpusEditLockOrdering(ownerId, memberId, ownerBookId) {
  const workId = sqlScalar(
    `select corpus_work_id from public.books where id = '${ownerBookId}'::uuid;`,
  )
  const memberBookId = randomUUID()
  const tropeId = sqlScalar(
    `select id from public.tropes where owner_id is null order by id limit 1;`,
  )
  let triggerInstalled = false

  try {
    sqlScalar(`
      insert into public.corpus_admins (user_id) values ('${memberId}'::uuid)
      on conflict (user_id) do nothing;
      insert into public.books (
        id, owner_id, title, authors_display, status, ownership, corpus_work_id
      )
      select
        '${memberBookId}'::uuid, '${memberId}'::uuid, work.title, work.author_text,
        'standalone', 'owned', work.id
      from public.works work
      where work.id = '${workId}'::uuid;

      create function public.corpus_edit_cross_member_barrier_fixture()
      returns trigger language plpgsql security definer set search_path = '' as $fixture$
      begin
        if new.book_id = '${memberBookId}'::uuid then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${CROSS_MEMBER_CORPUS_EDIT_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger book_tropes_q_deadlock_barrier
      after insert on public.book_tropes
      for each row execute function public.corpus_edit_cross_member_barrier_fixture();
    `)
    triggerInstalled = true

    const operations = [
      {
        name: 'metadata',
        statement: `select public.edit_corpus_work_metadata(
          work.id, work.series, work.position, work.series_count, work.status,
          'literary', work.subgenre, array['literary'], work.subgenres,
          work.cover_url, work.cover_options, work.pub_y, work.pub_m, work.pub_d
        ) from public.works work where work.id = '${workId}'::uuid`,
        verify: () =>
          assert.equal(
            sqlScalar(`select genre from public.works where id = '${workId}'::uuid;`),
            'literary',
            'the cross-member serialized metadata edit is preserved',
          ),
      },
      {
        name: 'cover',
        statement: `select public.set_corpus_work_cover(
          '${workId}'::uuid,
          'https://books.google.com/books/content?id=cross-member-lock-order',
          'google', null, null
        )`,
        verify: () =>
          assert.equal(
            sqlScalar(`select cover_url from public.works where id = '${workId}'::uuid;`),
            'https://books.google.com/books/content?id=cross-member-lock-order',
            'the cross-member serialized cover edit is preserved',
          ),
      },
    ]

    for (const operation of operations) {
      const controller = new PsqlSession(`cross-member-${operation.name}-controller`)
      const tagger = new PsqlSession(`cross-member-${operation.name}-tagger`)
      const editor = new PsqlSession(`cross-member-${operation.name}-editor`)
      let barrierHeld = false
      let tropeResult = null
      let editResult = null
      try {
        await controller.command(
          `select pg_catalog.pg_advisory_lock(
            ${BARRIER_CLASS}, ${CROSS_MEMBER_CORPUS_EDIT_BARRIER_ID}
          );`,
        )
        barrierHeld = true
        const taggerPid = Number(await tagger.command('select pg_backend_pid();'))
        const editorPid = Number(await editor.command('select pg_backend_pid();'))

        tropeResult = tagger.command(
          authenticatedPersonalWrite(
            memberId,
            `insert into public.book_tropes (book_id, trope_id, owner_id, emphasis)
             values (
               '${memberBookId}'::uuid, '${tropeId}'::uuid, '${memberId}'::uuid, 'present'
             )`,
          ),
        )
        await waitForBlockedWorker(taggerPid, `cross-member ${operation.name} trope barrier`)

        editResult = editor.command(authenticatedPersonalWrite(ownerId, operation.statement))
        await waitForBlockedWorker(editorPid, `cross-member ${operation.name} all-book prelock`)

        // This is the defect itself, not a proxy: while the editor waits for the member's book it
        // must not yet hold the household-work row needed by the trope synchronization FK.
        assert.equal(
          sqlScalar(`
            begin;
            select work_id from public.household_works
            where household_id = '${householdId}'::uuid and work_id = '${workId}'::uuid
              and removed_at is null
            for update nowait;
            rollback;
            select 'household-work-unlocked';
          `),
          `${workId}\nhousehold-work-unlocked`,
          `${operation.name} waits on every active personal copy before household-work`,
        )

        await controller.command(
          `select pg_catalog.pg_advisory_unlock(
            ${BARRIER_CLASS}, ${CROSS_MEMBER_CORPUS_EDIT_BARRIER_ID}
          );`,
        )
        barrierHeld = false
        assert.match(
          await tropeResult,
          /personal-write-committed/,
          'the admin trope insert commits',
        )
        tropeResult = null
        assert.match(
          await editResult,
          /personal-write-committed/,
          `the owner ${operation.name} commits`,
        )
        editResult = null
        operation.verify()
        console.log(
          `✓ owner corpus ${operation.name} serializes before cross-member admin trope promotion`,
        )

        sqlScalar(`
          delete from public.book_tropes
          where book_id = '${memberBookId}'::uuid and trope_id = '${tropeId}'::uuid;
        `)
      } finally {
        if (barrierHeld) {
          await controller
            .command(
              `select pg_catalog.pg_advisory_unlock(
                ${BARRIER_CLASS}, ${CROSS_MEMBER_CORPUS_EDIT_BARRIER_ID}
              );`,
            )
            .catch(() => {})
        }
        await Promise.allSettled([tropeResult, editResult])
        await Promise.allSettled([controller.close(), tagger.close(), editor.close()])
      }
    }
  } finally {
    if (triggerInstalled) {
      sqlScalar(`
        drop trigger if exists book_tropes_q_deadlock_barrier on public.book_tropes;
        drop function if exists public.corpus_edit_cross_member_barrier_fixture();
      `)
    }
    sqlScalar(`
      delete from public.book_tropes where book_id = '${memberBookId}'::uuid;
      delete from public.work_tropes
      where work_id = '${workId}'::uuid
        and trope_id = '${tropeId}'::uuid
        and added_by = '${memberId}'::uuid
        and source_scope = 'personal';
      delete from public.books where id = '${memberBookId}'::uuid;
      delete from public.corpus_admins where user_id = '${memberId}'::uuid;
      delete from public.work_metadata_edits
      where work_id = '${workId}'::uuid and editor_id = '${ownerId}'::uuid;
    `)
  }
}

async function exerciseAuthorizationRevocations({
  ownerId,
  memberId,
  ownerBookId,
  borrowedBookId,
}) {
  const ownerWorkId = sqlScalar(
    `select corpus_work_id from public.books where id = '${ownerBookId}'::uuid;`,
  )
  const borrowedWorkId = sqlScalar(
    `select corpus_work_id from public.books where id = '${borrowedBookId}'::uuid;`,
  )

  await runRevocationRace({
    action: 'add-personal-book',
    userId: memberId,
    statement: `perform public.add_personal_book_to_household('${borrowedBookId}'::uuid)`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select count(*) from public.household_book_shares
           where book_id = '${borrowedBookId}'::uuid and removed_at is null;`,
        ),
        '0',
        'revoked add creates no borrowed share',
      )
    },
  })
  await relinkMember(ownerId, memberId)

  sqlScalar(`
    begin;
    set local role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"${memberId}","role":"authenticated"}',
      true
    );
    select public.add_personal_book_to_household('${borrowedBookId}'::uuid);
    commit;
  `)

  await runRevocationRace({
    action: 'remove-personal-share',
    userId: memberId,
    statement: `perform public.remove_personal_book_from_household('${borrowedBookId}'::uuid)`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select count(*) from public.household_book_shares
           where book_id = '${borrowedBookId}'::uuid and removed_at is null;`,
        ),
        '1',
        'revoked share removal leaves the prior share active',
      )
    },
  })
  await relinkMember(ownerId, memberId)

  await runRevocationRace({
    action: 'remove-household-work',
    userId: memberId,
    statement: `perform public.remove_household_work('${borrowedWorkId}'::uuid)`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select count(*) from public.household_works
           where household_id = '${householdId}'::uuid and work_id = '${borrowedWorkId}'::uuid
             and removed_at is null;`,
        ),
        '1',
        'revoked household removal leaves membership active',
      )
    },
  })
  await relinkMember(ownerId, memberId)

  await runRevocationRace({
    action: 'update-household-enrichment',
    userId: memberId,
    statement: `perform public.update_household_work_enrichment(
      '${ownerWorkId}'::uuid, array['unauthorized-race'], '[]'::jsonb
    )`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select count(*) from public.household_work_enrichment
           where household_id = '${householdId}'::uuid and work_id = '${ownerWorkId}'::uuid
             and 'unauthorized-race' = any(tags);`,
        ),
        '0',
        'revoked enrichment update writes no household annotation',
      )
    },
  })
  await relinkMember(ownerId, memberId)

  await runRevocationRace({
    action: 'add-existing-corpus-work',
    userId: memberId,
    statement: `perform public.add_corpus_work_to_household('${ownerWorkId}'::uuid)`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select count(*) from public.household_works
           where household_id = '${householdId}'::uuid and work_id = '${ownerWorkId}'::uuid
             and removed_at is null;`,
        ),
        '1',
        'revoked household add leaves the existing owner-backed membership unchanged',
      )
    },
  })
  await relinkMember(ownerId, memberId)

  sqlScalar(`
    insert into public.household_work_enrichment (
      household_id, work_id, tags, tropes, updated_by
    ) values (
      '${householdId}'::uuid,
      '${borrowedWorkId}'::uuid,
      array['retained-household-tag'],
      '[{"name":"retained household trope"}]'::jsonb,
      '${ownerId}'::uuid
    )
    on conflict (household_id, work_id) do update
    set tags = excluded.tags, tropes = excluded.tropes, updated_by = excluded.updated_by;
  `)
  const trope = await admin
    .from('tropes')
    .insert({
      owner_id: memberId,
      name: `Concurrent revoked trope ${randomUUID()}`,
      facet: 'vibe',
    })
    .select('id')
    .single()
  if (trope.error || !trope.data) throw dbError('trope race fixture insert', trope.error)

  await runTriggerRevocationRace({
    action: 'personal-tag-trigger',
    userId: memberId,
    statement: `update public.books set tags = array['revoked-tag-race']
      where id = '${borrowedBookId}'::uuid`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select array_to_string(tags, ',') from public.books
           where id = '${borrowedBookId}'::uuid;`,
        ),
        'revoked-tag-race',
        'revoked tag edit remains on the personal book',
      )
      assert.equal(
        sqlScalar(
          `select array_to_string(tags, ',') from public.household_work_enrichment
           where household_id = '${householdId}'::uuid and work_id = '${borrowedWorkId}'::uuid;`,
        ),
        'retained-household-tag',
        'revoked tag trigger leaves retained household tags unchanged',
      )
      assert.equal(
        sqlScalar(
          `select tropes::text from public.household_work_enrichment
           where household_id = '${householdId}'::uuid and work_id = '${borrowedWorkId}'::uuid;`,
        ),
        '[{"name": "retained household trope"}]',
        'revoked tag trigger leaves the sibling household trope field unchanged',
      )
    },
  })
  await relinkMember(ownerId, memberId)

  await runTriggerRevocationRace({
    action: 'personal-trope-trigger',
    userId: memberId,
    statement: `insert into public.book_tropes (book_id, trope_id, owner_id, emphasis)
      values (
        '${borrowedBookId}'::uuid, '${trope.data.id}'::uuid, '${memberId}'::uuid, 'pinned'
      )`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select count(*) from public.book_tropes
           where book_id = '${borrowedBookId}'::uuid and trope_id = '${trope.data.id}'::uuid;`,
        ),
        '1',
        'revoked trope edit remains on the personal book',
      )
      assert.equal(
        sqlScalar(
          `select count(*)
           from public.household_work_enrichment e
           cross join lateral jsonb_array_elements(e.tropes) trope_value
           where e.household_id = '${householdId}'::uuid
             and e.work_id = '${borrowedWorkId}'::uuid
             and trope_value ->> 'id' = '${trope.data.id}';`,
        ),
        '0',
        'revoked trope trigger writes no trope into the retained household overlay',
      )
      assert.equal(
        sqlScalar(
          `select array_to_string(tags, ',') from public.household_work_enrichment
           where household_id = '${householdId}'::uuid and work_id = '${borrowedWorkId}'::uuid;`,
        ),
        'retained-household-tag',
        'revoked trope trigger leaves the sibling household tag field unchanged',
      )
    },
  })
  await relinkMember(ownerId, memberId)

  await runPersonalBookRevocationRace({
    action: 'personal-trope-after-book-removal',
    userId: memberId,
    bookId: borrowedBookId,
    statement: `update public.book_tropes set emphasis = 'present'
      where book_id = '${borrowedBookId}'::uuid and trope_id = '${trope.data.id}'::uuid`,
    verify: async () => {
      assert.equal(
        sqlScalar(
          `select emphasis from public.book_tropes
           where book_id = '${borrowedBookId}'::uuid and trope_id = '${trope.data.id}'::uuid;`,
        ),
        'present',
        'the personal trope edit survives exact-book removal',
      )
      assert.equal(
        sqlScalar(
          `select count(*)
           from public.household_work_enrichment e
           cross join lateral jsonb_array_elements(e.tropes) trope_value
           where e.household_id = '${householdId}'::uuid
             and e.work_id = '${borrowedWorkId}'::uuid
             and trope_value ->> 'id' = '${trope.data.id}';`,
        ),
        '0',
        'the removed personal book writes no trope into the retained household overlay',
      )
    },
  })
  sqlScalar(`
    begin;
    set local role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"${memberId}","role":"authenticated"}',
      true
    );
    select public.restore_personal_book('${borrowedBookId}'::uuid);
    commit;
  `)
}

async function exerciseConcurrentRebindSuppression(userId) {
  const suffix = randomUUID()
  const sourceTitle = `Concurrent rebind source ${suffix}`
  const targetTitle = `Concurrent rebind target ${suffix}`
  let bookId = null
  let oldWorkId = null
  let targetWorkId = null
  let destinationBookId = null
  let destinationOldWorkId = null
  let destinationTargetWorkId = null
  let tropeId = null

  try {
    const sourceBook = await admin
      .from('books')
      .insert({
        owner_id: userId,
        title: sourceTitle,
        author_first: 'Concurrent',
        author_last: 'Source',
        authors_display: 'Concurrent Source',
        status: 'standalone',
        ownership: 'owned',
      })
      .select('id, corpus_work_id')
      .single()
    if (sourceBook.error || !sourceBook.data)
      throw dbError('rebind source book insert', sourceBook.error)
    bookId = sourceBook.data.id
    oldWorkId = sourceBook.data.corpus_work_id

    const targetWork = await admin
      .from('works')
      .insert({
        work_key: `concurrent:rebind-target:${suffix}`,
        title: targetTitle,
        author_text: 'Concurrent Rebind',
        contributors: [{ name: 'Concurrent Rebind', role: 'author', position: 0 }],
        creation_source: 'reconciliation',
      })
      .select('id')
      .single()
    if (targetWork.error || !targetWork.data)
      throw dbError('rebind target work insert', targetWork.error)
    targetWorkId = targetWork.data.id

    const trope = await admin
      .from('tropes')
      .insert({
        owner_id: userId,
        name: `Concurrent rebind trope ${suffix}`,
        facet: 'vibe',
      })
      .select('id')
      .single()
    if (trope.error || !trope.data) throw dbError('rebind trope insert', trope.error)
    tropeId = trope.data.id

    const joined = await admin.from('book_tropes').insert({
      book_id: bookId,
      trope_id: tropeId,
      owner_id: userId,
      emphasis: 'present',
    })
    if (joined.error) throw dbError('rebind trope join insert', joined.error)

    await runPersonalBookRebindRace({
      action: 'personal-trope-after-work-rebind',
      userId,
      rebindStatement: `update public.books
        set corpus_work_id = '${targetWorkId}'::uuid,
            title = '${targetTitle}',
            author_first = 'Concurrent',
            author_last = 'Rebind',
            authors_display = 'Concurrent Rebind',
            isbn = null
        where id = '${bookId}'::uuid`,
      statement: `update public.book_tropes set emphasis = 'pinned'
        where book_id = '${bookId}'::uuid and trope_id = '${tropeId}'::uuid`,
      verify: async () => {
        assert.equal(
          sqlScalar(
            `select emphasis from public.book_tropes
             where book_id = '${bookId}'::uuid and trope_id = '${tropeId}'::uuid;`,
          ),
          'pinned',
          'the personal trope edit survives exact-work rebinding',
        )
        assert.equal(
          sqlScalar(
            `select count(*)
             from public.household_work_enrichment e
             cross join lateral jsonb_array_elements(e.tropes) trope_value
             where e.household_id = '${householdId}'::uuid
               and e.work_id = '${oldWorkId}'::uuid
               and trope_value ->> 'id' = '${tropeId}'
               and trope_value ->> 'emphasis' = 'present';`,
          ),
          '1',
          'the previous household snapshot is not rewritten after rebinding',
        )
        assert.equal(
          sqlScalar(
            `select count(*)
             from public.household_work_enrichment e
             cross join lateral jsonb_array_elements(e.tropes) trope_value
             where e.household_id = '${householdId}'::uuid
               and e.work_id = '${targetWorkId}'::uuid
               and trope_value ->> 'id' = '${tropeId}';`,
          ),
          '0',
          'the newly rebound work receives no stale personal overlay write',
        )
      },
    })

    const destinationBook = await admin
      .from('books')
      .insert({
        owner_id: userId,
        title: `Concurrent move destination source ${suffix}`,
        author_first: 'Concurrent',
        author_last: 'Move Source',
        authors_display: 'Concurrent Move Source',
        status: 'standalone',
        ownership: 'owned',
      })
      .select('id, corpus_work_id')
      .single()
    if (destinationBook.error || !destinationBook.data)
      throw dbError('rebind move destination book insert', destinationBook.error)
    destinationBookId = destinationBook.data.id
    destinationOldWorkId = destinationBook.data.corpus_work_id

    const destinationTargetTitle = `Concurrent move destination target ${suffix}`
    const destinationTargetWork = await admin
      .from('works')
      .insert({
        work_key: `concurrent:move-rebind-target:${suffix}`,
        title: destinationTargetTitle,
        author_text: 'Concurrent Move Rebind',
        contributors: [{ name: 'Concurrent Move Rebind', role: 'author', position: 0 }],
        creation_source: 'reconciliation',
      })
      .select('id')
      .single()
    if (destinationTargetWork.error || !destinationTargetWork.data)
      throw dbError('rebind move destination target insert', destinationTargetWork.error)
    destinationTargetWorkId = destinationTargetWork.data.id

    await runPersonalBookRebindRace({
      action: 'moved-trope-after-destination-rebind',
      userId,
      rebindStatement: `update public.books
        set corpus_work_id = '${destinationTargetWorkId}'::uuid,
            title = '${destinationTargetTitle}',
            author_first = 'Concurrent',
            author_last = 'Move Rebind',
            authors_display = 'Concurrent Move Rebind',
            isbn = null
        where id = '${destinationBookId}'::uuid`,
      statement: `update public.book_tropes set book_id = '${destinationBookId}'::uuid
        where book_id = '${bookId}'::uuid and trope_id = '${tropeId}'::uuid`,
      verify: async () => {
        assert.equal(
          sqlScalar(`select book_id from public.book_tropes where trope_id = '${tropeId}'::uuid;`),
          destinationBookId,
          'the personal trope move survives destination rebinding',
        )
        assert.equal(
          sqlScalar(
            `select count(*)
             from public.household_work_enrichment e
             cross join lateral jsonb_array_elements(e.tropes) trope_value
             where e.household_id = '${householdId}'::uuid
               and e.work_id = '${targetWorkId}'::uuid
               and trope_value ->> 'id' = '${tropeId}';`,
          ),
          '0',
          'the source household snapshot reflects the completed personal move',
        )
        assert.equal(
          sqlScalar(
            `select count(*)
             from public.household_work_enrichment e
             cross join lateral jsonb_array_elements(e.tropes) trope_value
             where e.household_id = '${householdId}'::uuid
               and e.work_id = '${destinationTargetWorkId}'::uuid
               and trope_value ->> 'id' = '${tropeId}';`,
          ),
          '0',
          'the newly rebound move destination receives no stale overlay write',
        )
      },
    })
  } finally {
    if (bookId) sqlScalar(`delete from public.books where id = '${bookId}'::uuid;`)
    if (destinationBookId) {
      sqlScalar(`delete from public.books where id = '${destinationBookId}'::uuid;`)
    }
    if (oldWorkId || targetWorkId || destinationOldWorkId || destinationTargetWorkId) {
      const workIds = [oldWorkId, targetWorkId, destinationOldWorkId, destinationTargetWorkId]
        .filter(Boolean)
        .map((id) => `'${id}'::uuid`)
        .join(', ')
      sqlScalar(`
        delete from public.household_works
        where household_id = '${householdId}'::uuid and work_id in (${workIds});
        delete from public.works where id in (${workIds});
      `)
    }
    if (tropeId) sqlScalar(`delete from public.tropes where id = '${tropeId}'::uuid;`)
  }
}

async function exerciseMovedTropeLockOrdering(userId) {
  const suffix = randomUUID()
  const bookIds = [randomUUID(), randomUUID()].sort()
  const workIds = []
  let tropeId = null
  let moveResult = null
  const targetEditor = new PsqlSession('moved-trope-target-editor')
  const mover = new PsqlSession('moved-trope-mover')
  let targetEditOpen = false

  try {
    const books = await admin
      .from('books')
      .insert(
        bookIds.map((id, index) => ({
          id,
          owner_id: userId,
          title: `Moved trope lock fixture ${index + 1} ${suffix}`,
          author_first: 'Concurrent',
          author_last: 'Mover',
          authors_display: 'Concurrent Mover',
          status: 'standalone',
          ownership: 'owned',
        })),
      )
      .select('id, corpus_work_id')
    if (books.error || books.data?.length !== 2)
      throw dbError('moved trope books insert', books.error)
    const workByBook = new Map(books.data.map((book) => [book.id, book.corpus_work_id]))
    workIds.push(workByBook.get(bookIds[0]), workByBook.get(bookIds[1]))

    const trope = await admin
      .from('tropes')
      .insert({
        owner_id: userId,
        name: `Moved trope lock sentinel ${suffix}`,
        facet: 'vibe',
      })
      .select('id')
      .single()
    if (trope.error || !trope.data) throw dbError('moved trope insert', trope.error)
    tropeId = trope.data.id

    const joined = await admin.from('book_tropes').insert({
      book_id: bookIds[0],
      trope_id: tropeId,
      owner_id: userId,
      emphasis: 'present',
    })
    if (joined.error) throw dbError('moved trope join insert', joined.error)

    const moverPid = Number(await mover.command('select pg_backend_pid();'))
    assert.ok(Number.isInteger(moverPid), 'moved trope worker exposes a stable PID')
    await targetEditor.command(`
      begin;
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${userId}","role":"authenticated"}',
        true
      );
      select id from public.books where id = '${bookIds[1]}'::uuid for update;
      select 'target-book-locked';
    `)
    targetEditOpen = true

    moveResult = mover.command(
      authenticatedPersonalWrite(
        userId,
        `update public.book_tropes set book_id = '${bookIds[1]}'::uuid
         where book_id = '${bookIds[0]}'::uuid and trope_id = '${tropeId}'::uuid`,
      ),
    )
    await waitForBlockedWorker(moverPid, 'moved trope prelock')

    const targetEditResult = await targetEditor.command(`
      update public.books set tags = array['move-lock-order']
      where id = '${bookIds[1]}'::uuid;
      commit;
      select 'target-edit-committed';
    `)
    targetEditOpen = false
    assert.match(targetEditResult, /target-edit-committed/, 'target book edit avoids a lock cycle')
    assert.match(await moveResult, /personal-write-committed/, 'moved trope edit commits')

    assert.equal(
      sqlScalar(
        `select count(*)
         from public.household_work_enrichment e
         cross join lateral jsonb_array_elements(e.tropes) trope_value
         where e.household_id = '${householdId}'::uuid
           and e.work_id = '${workIds[0]}'::uuid
           and trope_value ->> 'id' = '${tropeId}';`,
      ),
      '0',
      'the moved trope leaves the source household snapshot',
    )
    assert.equal(
      sqlScalar(
        `select array_to_string(e.tags, ',') || '|' || (trope_value ->> 'id')
         from public.household_work_enrichment e
         cross join lateral jsonb_array_elements(e.tropes) trope_value
         where e.household_id = '${householdId}'::uuid
           and e.work_id = '${workIds[1]}'::uuid
           and trope_value ->> 'id' = '${tropeId}';`,
      ),
      `move-lock-order|${tropeId}`,
      'the target keeps its concurrent tag edit and receives the moved trope',
    )
    console.log('✓ moved trope joins prelock both books before either household lock')
  } finally {
    if (targetEditOpen) await targetEditor.command('rollback;').catch(() => {})
    await Promise.allSettled([moveResult, targetEditor.close(), mover.close()])
    sqlScalar(
      `delete from public.books where id in ('${bookIds[0]}'::uuid, '${bookIds[1]}'::uuid);`,
    )
    if (workIds.filter(Boolean).length > 0) {
      const reviewedWorkIds = workIds
        .filter(Boolean)
        .map((id) => `'${id}'::uuid`)
        .join(', ')
      sqlScalar(`
        delete from public.household_works
        where household_id = '${householdId}'::uuid and work_id in (${reviewedWorkIds});
        delete from public.works where id in (${reviewedWorkIds});
      `)
    }
    if (tropeId) sqlScalar(`delete from public.tropes where id = '${tropeId}'::uuid;`)
  }
}

const unlinkTransaction = (session, userId, reviewedHouseholdId) =>
  session.command(`
    begin;
    set local role service_role;
    select public.unlink_household_member('${userId}'::uuid, '${reviewedHouseholdId}'::uuid);
    reset role;
    select pg_catalog.pg_advisory_xact_lock_shared(${BARRIER_CLASS}, ${BARRIER_ID});
    commit;
  `)

const isbn13Fixture = () => {
  const payload = BigInt(`0x${randomUUID().replaceAll('-', '')}`)
    .toString()
    .padStart(9, '0')
    .slice(-9)
  const firstTwelve = `979${payload}`
  const weighted = [...firstTwelve].reduce(
    (sum, digit, index) => sum + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  )
  return `${firstTwelve}${(10 - (weighted % 10)) % 10}`
}

const concurrentBookInsert = ({ session, userId, bookId, title, isbn }) =>
  session.command(`
    begin;
    set local role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"${userId}","role":"authenticated"}',
      true
    );
    insert into public.books (
      id, owner_id, title, author_first, author_last, authors_display, status, ownership, isbn
    ) values (
      '${bookId}'::uuid, '${userId}'::uuid, '${title}', 'Concurrent', 'Resolver',
      'Concurrent Resolver', 'standalone', 'unowned', '${isbn}'
    );
    reset role;
    select pg_catalog.pg_advisory_xact_lock_shared(${BARRIER_CLASS}, ${ISBN_BARRIER_ID});
    commit;
    select 'isbn-book-committed';
  `)

const concurrentHouseholdCatalogCreate = ({ session, userId, title, isbn }) =>
  session.command(`
    begin;
    set local role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"${userId}","role":"authenticated"}',
      true
    );
    select set_config(
      'test.household_catalog_work',
      public.create_household_catalog_work('${title}', 'Concurrent Catalog', '${isbn}')::text,
      false
    );
    reset role;
    select pg_catalog.pg_advisory_xact_lock_shared(
      ${BARRIER_CLASS}, ${HOUSEHOLD_ISBN_BARRIER_ID}
    );
    commit;
    select current_setting('test.household_catalog_work') || '|household-catalog-committed';
  `)

async function exerciseConcurrentHouseholdIsbnResolution(firstUserId, secondUserId) {
  const isbn = isbn13Fixture()
  const controller = new PsqlSession('household-isbn-controller')
  const workers = [
    new PsqlSession('household-isbn-first'),
    new PsqlSession('household-isbn-second'),
  ]
  let results = []
  let barrierHeld = false
  try {
    await controller.command(
      `select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${HOUSEHOLD_ISBN_BARRIER_ID});`,
    )
    barrierHeld = true
    const workerPids = await Promise.all(
      workers.map(async (worker) => Number(await worker.command('select pg_backend_pid();'))),
    )
    results = [
      concurrentHouseholdCatalogCreate({
        session: workers[0],
        userId: firstUserId,
        title: 'Concurrent household ISBN alpha',
        isbn,
      }),
      concurrentHouseholdCatalogCreate({
        session: workers[1],
        userId: secondUserId,
        title: 'Concurrent household ISBN beta',
        isbn,
      }),
    ]
    const state = await waitForConcurrentState(workerPids, HOUSEHOLD_ISBN_BARRIER_ID)
    assert.equal(state.barrierWaiters, 1, 'the ISBN lock serializes household catalog creation')
    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${HOUSEHOLD_ISBN_BARRIER_ID});`,
    )
    barrierHeld = false
    const outputs = await Promise.all(results)
    const workIds = outputs.map(
      (output) => output.match(/([0-9a-f-]{36})\|household-catalog-committed/)?.[1],
    )
    assert.ok(workIds.every(Boolean), 'both household catalog creators return a work ID')
    assert.equal(workIds[0], workIds[1], 'both household creators reuse the same ISBN work')
    assert.equal(
      sqlScalar(`select count(*) from public.works where '${isbn}' = any(isbns);`),
      '1',
      'concurrent household creation stores one canonical ISBN identity',
    )
    assert.equal(
      sqlScalar(`
        select count(*) from public.household_works
        where household_id = '${householdId}'::uuid and work_id = '${workIds[0]}'::uuid
          and removed_at is null;
      `),
      '1',
      'concurrent household creation stores one collective membership',
    )
    console.log('✓ concurrent household catalog ISBN creation reuses one work and membership')
    sqlScalar(`
      delete from public.household_works where work_id = '${workIds[0]}'::uuid;
      delete from public.work_metadata_edits where work_id = '${workIds[0]}'::uuid;
      delete from public.works where id = '${workIds[0]}'::uuid;
    `)
  } finally {
    if (barrierHeld) {
      await controller
        .command(
          `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${HOUSEHOLD_ISBN_BARRIER_ID});`,
        )
        .catch(() => {})
    }
    await Promise.allSettled(results)
    await Promise.allSettled([...workers.map((worker) => worker.close()), controller.close()])
  }
}

const reconciliationFenceArguments = (ownerId, memberId) => `
  array['${ownerId}'::uuid, '${memberId}'::uuid],
  (
    select md5(coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]'::jsonb)::text)
    from public.books b
    where b.owner_id in ('${ownerId}'::uuid, '${memberId}'::uuid)
  ),
  (
    select md5(coalesce(jsonb_agg(to_jsonb(hw) order by hw.work_id), '[]'::jsonb)::text)
    from public.household_works hw
    where hw.household_id = '${householdId}'::uuid
  )
`

async function exerciseConcurrentIsbnResolution(firstUserId, secondUserId) {
  const isbn = isbn13Fixture()
  const bookIds = [randomUUID(), randomUUID()]
  assert.equal(
    sqlScalar(`select count(*) from public.works where '${isbn}' = any(isbns);`),
    '0',
    'concurrent ISBN fixture starts unused',
  )

  const controller = new PsqlSession('isbn-controller')
  const workers = [new PsqlSession('isbn-first'), new PsqlSession('isbn-second')]
  let insertResults = []
  let barrierHeld = false
  try {
    await controller.command(
      `select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${ISBN_BARRIER_ID});`,
    )
    barrierHeld = true
    const workerPids = await Promise.all(
      workers.map(async (worker) => Number(await worker.command('select pg_backend_pid();'))),
    )
    assert.ok(workerPids.every(Number.isInteger), 'ISBN workers expose stable PIDs')

    insertResults = [
      concurrentBookInsert({
        session: workers[0],
        userId: firstUserId,
        bookId: bookIds[0],
        title: 'Concurrent ISBN title alpha',
        isbn,
      }),
      concurrentBookInsert({
        session: workers[1],
        userId: secondUserId,
        bookId: bookIds[1],
        title: 'Concurrent ISBN title beta',
        isbn,
      }),
    ]
    const concurrentState = await waitForConcurrentState(workerPids, ISBN_BARRIER_ID)

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${ISBN_BARRIER_ID});`,
    )
    barrierHeld = false
    const outputs = await Promise.all(insertResults)
    assert.equal(
      concurrentState.barrierWaiters,
      1,
      'one first-time ISBN resolver waits while the other holds the canonical ISBN lock',
    )
    for (const [index, output] of outputs.entries()) {
      assert.match(output, /isbn-book-committed/, `concurrent ISBN add ${index + 1} committed`)
    }

    assert.equal(
      sqlScalar(
        `select count(distinct corpus_work_id) from public.books
         where id in ('${bookIds[0]}'::uuid, '${bookIds[1]}'::uuid);`,
      ),
      '1',
      'title variants with the same new ISBN receive one corpus link',
    )
    assert.equal(
      sqlScalar(`select count(*) from public.works where '${isbn}' = any(isbns);`),
      '1',
      'the concurrent ISBN adds create only one corpus work',
    )
    assert.equal(
      sqlScalar(`select creation_source from public.works where '${isbn}' = any(isbns) limit 1;`),
      'reader_add',
      'the unique concurrent result remains an ordinary reader-added work',
    )
    console.log('✓ concurrent title variants with one new ISBN resolve to one ordinary work')
  } finally {
    if (barrierHeld) {
      await controller
        .command(`select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${ISBN_BARRIER_ID});`)
        .catch(() => {})
    }
    await Promise.allSettled(insertResults)
    await Promise.allSettled([...workers.map((worker) => worker.close()), controller.close()])
    sqlScalar(`
      delete from public.books where id in ('${bookIds[0]}'::uuid, '${bookIds[1]}'::uuid);
      delete from public.works
      where '${isbn}' = any(isbns) and creation_source = 'reader_add';
    `)
  }
}

async function exerciseReconciliationLockOrdering(ownerId, memberId) {
  const inserted = await admin
    .from('books')
    .insert({
      owner_id: ownerId,
      title: `Reconciliation lock fixture ${randomUUID()}`,
      author_first: 'Local',
      author_last: 'Locksmith',
      authors_display: 'Local Locksmith',
      status: 'standalone',
      ownership: 'owned',
    })
    .select('id, corpus_work_id')
    .single()
  if (inserted.error || !inserted.data)
    throw dbError('reconciliation lock fixture insert', inserted.error)
  const bookId = inserted.data.id
  const workId = inserted.data.corpus_work_id
  const editor = new PsqlSession('reconciliation-editor')
  const reconciler = new PsqlSession('reconciliation-worker')
  let reconciliation = null

  try {
    const editorPid = Number(await editor.command('select pg_backend_pid();'))
    const reconcilerPid = Number(await reconciler.command('select pg_backend_pid();'))
    await editor.command(`
      begin;
      set local deadlock_timeout = '100ms';
      select id from public.books where id = '${bookId}'::uuid for update;
    `)

    reconciliation = reconciler.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role service_role;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      do $reconcile$
      begin
        perform public.reconcile_household_library_memberships(
          '${householdId}'::uuid,
          jsonb_build_array(
            jsonb_build_object(
              'accountId', '${ownerId}',
              'workIds', coalesce((
                select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
                from public.books b
                where b.owner_id = '${ownerId}'::uuid and b.removed_at is null
                  and b.id <> '${bookId}'::uuid
              ), '[]'::jsonb)
            ),
            jsonb_build_object(
              'accountId', '${memberId}',
              'workIds', coalesce((
                select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
                from public.books b
                where b.owner_id = '${memberId}'::uuid and b.removed_at is null
              ), '[]'::jsonb)
            )
          ),
          array(
            select hw.work_id from public.household_works hw
            where hw.household_id = '${householdId}'::uuid and hw.removed_at is null
              and hw.work_id <> '${workId}'::uuid
            order by hw.work_id
          ),
          ${reconciliationFenceArguments(ownerId, memberId)}
        );
        raise exception 'expected a changed-snapshot refusal';
      exception when sqlstate 'PT409' then
        null;
      end;
      $reconcile$;
      commit;
      select 'reconciliation-refused-after-book-edit';
    `)
    await waitForBlockedWorker(reconcilerPid, 'reconciliation book prelock')
    const blockers = sqlScalar(
      `select array_to_string(pg_catalog.pg_blocking_pids(${reconcilerPid}), ',');`,
    )
    assert.match(blockers, new RegExp(`(^|,)${editorPid}(,|$)`), 'reconciliation waits on the book')

    const editResult = await editor.command(`
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${ownerId}","role":"authenticated"}',
        true
      );
      update public.books set tags = array['reconciliation-lock-order']
      where id = '${bookId}'::uuid;
      commit;
      select 'reader-edit-committed';
    `)
    assert.match(editResult, /reader-edit-committed/, 'the reader edit commits without a deadlock')
    assert.match(
      await reconciliation,
      /reconciliation-refused-after-book-edit/,
      'reconciliation refuses the edit that differs from the reviewed snapshot',
    )
    reconciliation = null
    assert.equal(
      sqlScalar(`select removed_at is not null from public.books where id = '${bookId}'::uuid;`),
      'f',
      'the snapshot refusal preserves the reader book',
    )
    console.log('✓ reconciliation serializes a tag edit and refuses its changed snapshot')
  } finally {
    if (reconciliation) await reconciliation.catch(() => {})
    await editor.command('rollback;').catch(() => {})
    await reconciler.command('rollback;').catch(() => {})
    await Promise.allSettled([editor.close(), reconciler.close()])
    sqlScalar(`
      delete from public.books where id = '${bookId}'::uuid;
      delete from public.household_works
      where household_id = '${householdId}'::uuid and work_id = '${workId}'::uuid;
      delete from public.works where id = '${workId}'::uuid;
    `)
  }
}

async function exerciseReconciliationInsertLockOrdering(ownerId, memberId) {
  const isbn = isbn13Fixture()
  const inserted = await admin
    .from('books')
    .insert({
      owner_id: ownerId,
      title: `Reconciliation insert fixture ${randomUUID()}`,
      author_first: 'Local',
      author_last: 'Inserter',
      authors_display: 'Local Inserter',
      isbn,
      status: 'standalone',
      ownership: 'owned',
    })
    .select('id, corpus_work_id')
    .single()
  if (inserted.error || !inserted.data)
    throw dbError('reconciliation insert fixture create', inserted.error)
  const existingBookId = inserted.data.id
  const workId = inserted.data.corpus_work_id
  const concurrentBookId = randomUUID()
  const controller = new PsqlSession('reconciliation-insert-controller')
  const inserter = new PsqlSession('reconciliation-insert-reader')
  const reconciler = new PsqlSession('reconciliation-insert-worker')
  let barrierHeld = false
  let insertResult = null
  let reconciliation = null
  let triggerInstalled = false

  try {
    sqlScalar(`
      create function public.reconciliation_insert_barrier_fixture()
      returns trigger language plpgsql security definer set search_path = '' as $fixture$
      begin
        if new.id = '${concurrentBookId}'::uuid then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${RECONCILIATION_INSERT_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger zz_reconciliation_insert_barrier_fixture
      before insert on public.books
      for each row execute function public.reconciliation_insert_barrier_fixture();
    `)
    triggerInstalled = true
    await controller.command(
      `select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${RECONCILIATION_INSERT_BARRIER_ID});`,
    )
    barrierHeld = true
    const inserterPid = Number(await inserter.command('select pg_backend_pid();'))
    const reconcilerPid = Number(await reconciler.command('select pg_backend_pid();'))

    insertResult = inserter.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${ownerId}","role":"authenticated"}',
        true
      );
      insert into public.books (
        id, owner_id, title, author_first, author_last, authors_display, isbn, status, ownership
      ) values (
        '${concurrentBookId}'::uuid, '${ownerId}'::uuid, 'Concurrent reconciliation insert',
        'Local', 'Inserter', 'Local Inserter', '${isbn}', 'standalone', 'owned'
      );
      commit;
      select 'reader-insert-committed';
    `)
    await waitForBlockedWorker(inserterPid, 'ordinary insert advisory barrier')

    reconciliation = reconciler.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role service_role;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      do $reconcile$
      begin
        perform public.reconcile_household_library_memberships(
          '${householdId}'::uuid,
          jsonb_build_array(
            jsonb_build_object(
              'accountId', '${ownerId}',
              'workIds', coalesce((
                select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
                from public.books b
                where b.owner_id = '${ownerId}'::uuid and b.removed_at is null
                  and b.corpus_work_id <> '${workId}'::uuid
              ), '[]'::jsonb)
            ),
            jsonb_build_object(
              'accountId', '${memberId}',
              'workIds', coalesce((
                select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
                from public.books b
                where b.owner_id = '${memberId}'::uuid and b.removed_at is null
              ), '[]'::jsonb)
            )
          ),
          array(
            select hw.work_id from public.household_works hw
            where hw.household_id = '${householdId}'::uuid and hw.removed_at is null
              and hw.work_id <> '${workId}'::uuid
            order by hw.work_id
          ),
          ${reconciliationFenceArguments(ownerId, memberId)}
        );
        raise exception 'expected a concurrent-book serialization refusal';
      exception when sqlstate 'PT409' then
        null;
      end;
      $reconcile$;
      commit;
      select 'reconciliation-refused-after-new-book';
    `)
    await waitForBlockedWorker(reconcilerPid, 'reconciliation owner-insert fence')
    const blockers = sqlScalar(
      `select array_to_string(pg_catalog.pg_blocking_pids(${reconcilerPid}), ',');`,
    )
    assert.match(
      blockers,
      new RegExp(`(^|,)${inserterPid}(,|$)`),
      'reconciliation waits on the insert owner fence before taking any book row lock',
    )

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${RECONCILIATION_INSERT_BARRIER_ID});`,
    )
    barrierHeld = false
    assert.match(await insertResult, /reader-insert-committed/, 'the ordinary insert commits')
    insertResult = null
    assert.match(
      await reconciliation,
      /reconciliation-refused-after-new-book/,
      'reconciliation refuses the changed book set without a deadlock',
    )
    reconciliation = null
    assert.equal(
      sqlScalar(
        `select count(*) from public.books
         where id in ('${existingBookId}'::uuid, '${concurrentBookId}'::uuid)
           and removed_at is null;`,
      ),
      '2',
      'the serialization refusal preserves both reader books',
    )
    console.log(
      '✓ reconciliation waits for an earlier owner insert and refuses its changed snapshot',
    )
  } finally {
    if (barrierHeld) {
      await controller
        .command(
          `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${RECONCILIATION_INSERT_BARRIER_ID});`,
        )
        .catch(() => {})
    }
    await Promise.allSettled([insertResult, reconciliation])
    await Promise.allSettled([controller.close(), inserter.close(), reconciler.close()])
    if (triggerInstalled) {
      sqlScalar(`
        drop trigger if exists zz_reconciliation_insert_barrier_fixture on public.books;
        drop function if exists public.reconciliation_insert_barrier_fixture();
      `)
    }
    sqlScalar(`
      delete from public.books
      where id in ('${existingBookId}'::uuid, '${concurrentBookId}'::uuid);
      delete from public.household_works
      where household_id = '${householdId}'::uuid and work_id = '${workId}'::uuid;
      delete from public.works where id = '${workId}'::uuid;
    `)
  }
}

async function exerciseReconciliationLateInsertFence(ownerId, memberId) {
  const existing = await admin
    .from('books')
    .insert({
      owner_id: ownerId,
      title: `Late-insert archive fixture ${randomUUID()}`,
      author_first: 'Local',
      author_last: 'Archive',
      authors_display: 'Local Archive',
      isbn: isbn13Fixture(),
      status: 'standalone',
      ownership: 'unowned',
    })
    .select('id')
    .single()
  if (existing.error || !existing.data)
    throw dbError('late-insert archive fixture create', existing.error)

  const existingBookId = existing.data.id
  const concurrentBookId = randomUUID()
  const concurrentTitle = `Late reconciliation insert ${concurrentBookId}`
  const concurrentIsbn = isbn13Fixture()
  const controller = new PsqlSession('reconciliation-late-controller')
  const reconciler = new PsqlSession('reconciliation-late-worker')
  const inserter = new PsqlSession('reconciliation-late-reader')
  let barrierHeld = false
  let triggerInstalled = false
  let reconciliation = null
  let insertResult = null

  try {
    sqlScalar(`
      create function public.reconciliation_late_insert_barrier_fixture()
      returns trigger language plpgsql security definer set search_path = '' as $fixture$
      begin
        if new.id = '${existingBookId}'::uuid
          and old.removed_at is null and new.removed_at is not null then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${RECONCILIATION_LATE_INSERT_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger zz_reconciliation_late_insert_barrier_fixture
      before update of removed_at on public.books
      for each row execute function public.reconciliation_late_insert_barrier_fixture();
    `)
    triggerInstalled = true
    await controller.command(
      `select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${RECONCILIATION_LATE_INSERT_BARRIER_ID});`,
    )
    barrierHeld = true
    const reconcilerPid = Number(await reconciler.command('select pg_backend_pid();'))
    const inserterPid = Number(await inserter.command('select pg_backend_pid();'))

    reconciliation = reconciler.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role service_role;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      select public.reconcile_household_library_memberships(
        '${householdId}'::uuid,
        jsonb_build_array(
          jsonb_build_object(
            'accountId', '${ownerId}',
            'workIds', coalesce((
              select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
              from public.books b
              where b.owner_id = '${ownerId}'::uuid and b.removed_at is null
                and b.id <> '${existingBookId}'::uuid
            ), '[]'::jsonb)
          ),
          jsonb_build_object(
            'accountId', '${memberId}',
            'workIds', coalesce((
              select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
              from public.books b
              where b.owner_id = '${memberId}'::uuid and b.removed_at is null
            ), '[]'::jsonb)
          )
        ),
        array(
          select hw.work_id from public.household_works hw
          where hw.household_id = '${householdId}'::uuid and hw.removed_at is null
          order by hw.work_id
        ),
        ${reconciliationFenceArguments(ownerId, memberId)}
      );
      commit;
      select 'reconciliation-committed-before-late-insert';
    `)
    await waitForBlockedWorker(reconcilerPid, 'reconciliation postcheck archive barrier')

    insertResult = inserter.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role authenticated;
      select set_config(
        'request.jwt.claims',
        '{"sub":"${ownerId}","role":"authenticated"}',
        true
      );
      insert into public.books (
        id, owner_id, title, author_first, author_last, authors_display, isbn, status, ownership
      ) values (
        '${concurrentBookId}'::uuid, '${ownerId}'::uuid, '${concurrentTitle}',
        'Local', 'Later', 'Local Later', '${concurrentIsbn}', 'standalone', 'unowned'
      );
      commit;
      select 'late-reader-insert-committed';
    `)
    await waitForBlockedWorker(inserterPid, 'late insert owner fence')
    const blockers = sqlScalar(
      `select array_to_string(pg_catalog.pg_blocking_pids(${inserterPid}), ',');`,
    )
    assert.match(
      blockers,
      new RegExp(`(^|,)${reconcilerPid}(,|$)`),
      'a postcheck insert waits for the active reconciliation transaction',
    )

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${RECONCILIATION_LATE_INSERT_BARRIER_ID});`,
    )
    barrierHeld = false
    assert.match(
      await reconciliation,
      /reconciliation-committed-before-late-insert/,
      'the reviewed mutation commits first',
    )
    reconciliation = null
    assert.match(
      await insertResult,
      /late-reader-insert-committed/,
      'the later reader insert proceeds only after reconciliation commits',
    )
    insertResult = null
    assert.equal(
      sqlScalar(
        `select (select removed_at is not null from public.books where id = '${existingBookId}'::uuid)
           and (select removed_at is null from public.books where id = '${concurrentBookId}'::uuid);`,
      ),
      't',
      'the approved archive and the later reader change are serialized in commit order',
    )
    console.log(
      '✓ a book insert started after final revalidation waits until reconciliation commits',
    )
  } finally {
    if (barrierHeld) {
      await controller
        .command(
          `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${RECONCILIATION_LATE_INSERT_BARRIER_ID});`,
        )
        .catch(() => {})
    }
    await Promise.allSettled([reconciliation, insertResult])
    await Promise.allSettled([controller.close(), reconciler.close(), inserter.close()])
    if (triggerInstalled) {
      sqlScalar(`
        drop trigger if exists zz_reconciliation_late_insert_barrier_fixture on public.books;
        drop function if exists public.reconciliation_late_insert_barrier_fixture();
      `)
    }
    sqlScalar(`
      do $cleanup$
      declare
        fixture_work_ids uuid[];
      begin
        select coalesce(array_agg(distinct corpus_work_id), '{}') into fixture_work_ids
        from public.books
        where id in ('${existingBookId}'::uuid, '${concurrentBookId}'::uuid);
        delete from public.books
        where id in ('${existingBookId}'::uuid, '${concurrentBookId}'::uuid);
        delete from public.household_works
        where household_id = '${householdId}'::uuid and work_id = any(fixture_work_ids);
        delete from public.works where id = any(fixture_work_ids);
      end;
      $cleanup$;
    `)
  }
}

async function exerciseReconciliationRosterChange(ownerId, memberId) {
  const thirdEmail = `household-roster-${randomUUID()}@reverie.local`
  const created = await admin.auth.admin.createUser({
    email: thirdEmail,
    password: `local-${randomUUID()}`,
    email_confirm: true,
  })
  if (created.error || !created.data.user)
    throw dbError('reconciliation roster account create', created.error)
  const thirdUserId = created.data.user.id
  const profile = await admin
    .from('profiles')
    .upsert({ id: thirdUserId, display_name: 'Concurrent Roster Member' })
  if (profile.error) throw dbError('reconciliation roster profile upsert', profile.error)

  const controller = new PsqlSession('reconciliation-roster-controller')
  const linker = new PsqlSession('reconciliation-roster-linker')
  const reconciler = new PsqlSession('reconciliation-roster-worker')
  let barrierHeld = false
  let triggerInstalled = false
  let linkResult = null
  let reconciliation = null

  try {
    sqlScalar(`
      create function public.reconciliation_roster_barrier_fixture()
      returns trigger language plpgsql security definer set search_path = '' as $fixture$
      begin
        if new.user_id = '${thirdUserId}'::uuid then
          perform pg_catalog.pg_advisory_xact_lock_shared(
            ${BARRIER_CLASS}, ${RECONCILIATION_ROSTER_BARRIER_ID}
          );
        end if;
        return new;
      end;
      $fixture$;
      create trigger zz_reconciliation_roster_barrier_fixture
      before insert on public.household_members
      for each row execute function public.reconciliation_roster_barrier_fixture();
    `)
    triggerInstalled = true
    await controller.command(
      `select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${RECONCILIATION_ROSTER_BARRIER_ID});`,
    )
    barrierHeld = true
    const linkerPid = Number(await linker.command('select pg_backend_pid();'))
    const reconcilerPid = Number(await reconciler.command('select pg_backend_pid();'))

    linkResult = linker.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role service_role;
      select public.link_household(
        'Concurrent final unlink fixture',
        '${ownerId}'::uuid,
        array['${memberId}'::uuid, '${thirdUserId}'::uuid]
      );
      commit;
      select 'roster-link-committed';
    `)
    await waitForBlockedWorker(linkerPid, 'household roster advisory barrier')

    reconciliation = reconciler.command(`
      begin;
      set local deadlock_timeout = '100ms';
      set local role service_role;
      select set_config('request.jwt.claims', '{"role":"service_role"}', true);
      do $reconcile$
      begin
        perform public.reconcile_household_library_memberships(
          '${householdId}'::uuid,
          jsonb_build_array(
            jsonb_build_object(
              'accountId', '${ownerId}',
              'workIds', coalesce((
                select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
                from public.books b
                where b.owner_id = '${ownerId}'::uuid and b.removed_at is null
              ), '[]'::jsonb)
            ),
            jsonb_build_object(
              'accountId', '${memberId}',
              'workIds', coalesce((
                select jsonb_agg(b.corpus_work_id order by b.corpus_work_id)
                from public.books b
                where b.owner_id = '${memberId}'::uuid and b.removed_at is null
              ), '[]'::jsonb)
            )
          ),
          array(
            select hw.work_id from public.household_works hw
            where hw.household_id = '${householdId}'::uuid and hw.removed_at is null
            order by hw.work_id
          ),
          ${reconciliationFenceArguments(ownerId, memberId)}
        );
        raise exception 'expected a changed-roster refusal';
      exception when sqlstate '42501' or sqlstate 'PT409' then
        null;
      end;
      $reconcile$;
      commit;
      select 'reconciliation-refused-after-roster-change';
    `)
    await waitForBlockedWorker(reconcilerPid, 'reconciliation complete-roster lock')
    const blockers = sqlScalar(
      `select array_to_string(pg_catalog.pg_blocking_pids(${reconcilerPid}), ',');`,
    )
    assert.match(
      blockers,
      new RegExp(`(^|,)${linkerPid}(,|$)`),
      'reconciliation waits behind the in-flight complete-roster extension',
    )

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${RECONCILIATION_ROSTER_BARRIER_ID});`,
    )
    barrierHeld = false
    assert.match(await linkResult, /roster-link-committed/, 'the roster extension commits')
    linkResult = null
    assert.match(
      await reconciliation,
      /reconciliation-refused-after-roster-change/,
      'reconciliation refuses the newly expanded complete roster',
    )
    reconciliation = null
    assert.equal(
      sqlScalar(
        `select count(*) from public.household_members where household_id = '${householdId}'::uuid;`,
      ),
      '3',
      'the refusal preserves all three household memberships',
    )
    console.log('✓ reconciliation waits for and refuses a concurrent complete-roster change')
  } finally {
    if (barrierHeld) {
      await controller
        .command(
          `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${RECONCILIATION_ROSTER_BARRIER_ID});`,
        )
        .catch(() => {})
    }
    await Promise.allSettled([linkResult, reconciliation])
    await Promise.allSettled([controller.close(), linker.close(), reconciler.close()])
    if (triggerInstalled) {
      sqlScalar(`
        drop trigger if exists zz_reconciliation_roster_barrier_fixture
          on public.household_members;
        drop function if exists public.reconciliation_roster_barrier_fixture();
      `)
    }
    sqlScalar(`delete from public.household_members where user_id = '${thirdUserId}'::uuid;`)
    await admin.auth.admin.deleteUser(thirdUserId)
  }
}

async function main() {
  const firstUserId = await fixtureAccount('first')
  const secondUserId = await fixtureAccount('second')
  const linked = await admin.rpc('link_household', {
    p_name: 'Concurrent final unlink fixture',
    p_owner: firstUserId,
    p_members: [secondUserId],
  })
  if (linked.error || !linked.data) throw dbError('fixture household link', linked.error)
  householdId = linked.data

  const ownerBookId = sqlScalar(
    `select id from public.books where owner_id = '${firstUserId}'::uuid order by id limit 1;`,
  )
  const borrowed = await admin
    .from('books')
    .insert({
      owner_id: secondUserId,
      title: 'Concurrent borrowed authorization fixture',
      author_first: 'Local',
      author_last: 'Borrower',
      authors_display: 'Local Borrower',
      status: 'standalone',
      ownership: 'unowned',
      borrowed: true,
    })
    .select('id')
    .single()
  if (borrowed.error || !borrowed.data)
    throw dbError('borrowed race fixture insert', borrowed.error)

  await exerciseAuthorizationRevocations({
    ownerId: firstUserId,
    memberId: secondUserId,
    ownerBookId,
    borrowedBookId: borrowed.data.id,
  })
  await exerciseWorkerFirstHouseholdAddLockOrdering(firstUserId, secondUserId)
  await exerciseOwnerCorpusEditTagLockOrdering(firstUserId, ownerBookId)
  await exercisePersonalCoverAdminCorpusEditLockOrdering(firstUserId, secondUserId, ownerBookId)
  await exerciseCrossMemberAdminCorpusEditLockOrdering(firstUserId, secondUserId, ownerBookId)
  await exerciseConcurrentRebindSuppression(firstUserId)
  await exerciseMovedTropeLockOrdering(firstUserId)
  await exerciseConcurrentIsbnResolution(firstUserId, secondUserId)
  await exerciseConcurrentHouseholdIsbnResolution(firstUserId, secondUserId)
  await exerciseReconciliationLockOrdering(firstUserId, secondUserId)
  await exerciseReconciliationInsertLockOrdering(firstUserId, secondUserId)
  await exerciseReconciliationLateInsertFence(firstUserId, secondUserId)
  await exerciseReconciliationRosterChange(firstUserId, secondUserId)

  const controller = new PsqlSession('controller')
  const workers = [new PsqlSession('first'), new PsqlSession('second')]
  let unlinkResults = []
  let barrierHeld = false
  try {
    await controller.command(`select pg_catalog.pg_advisory_lock(${BARRIER_CLASS}, ${BARRIER_ID});`)
    barrierHeld = true
    const workerPids = await Promise.all(
      workers.map(async (worker) => Number(await worker.command('select pg_backend_pid();'))),
    )
    assert.ok(workerPids.every(Number.isInteger), 'worker database sessions expose stable PIDs')

    unlinkResults = [
      unlinkTransaction(workers[0], firstUserId, householdId),
      unlinkTransaction(workers[1], secondUserId, householdId),
    ]
    const concurrentState = await waitForConcurrentState(workerPids)

    await controller.command(
      `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${BARRIER_ID});`,
    )
    barrierHeld = false
    const outputs = await Promise.all(unlinkResults)
    assert.equal(
      concurrentState.barrierWaiters,
      1,
      'the household row serializes the second RPC before final-member cleanup',
    )
    for (const [index, output] of outputs.entries()) {
      assert.match(
        output,
        new RegExp(householdId),
        `concurrent unlink ${index + 1} returned household`,
      )
    }
  } finally {
    if (barrierHeld) {
      try {
        await controller.command(
          `select pg_catalog.pg_advisory_unlock(${BARRIER_CLASS}, ${BARRIER_ID});`,
        )
      } catch (error) {
        console.error(`barrier cleanup failed: ${String(error)}`)
      }
    }
    await Promise.allSettled(unlinkResults)
    await Promise.allSettled([...workers.map((worker) => worker.close()), controller.close()])
  }

  const [memberships, household, profiles, books, firstAuth, secondAuth] = await Promise.all([
    admin
      .from('household_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('household_id', householdId),
    admin.from('households').select('id').eq('id', householdId).maybeSingle(),
    admin.from('profiles').select('id').in('id', fixtureUserIds),
    admin.from('books').select('owner_id').in('owner_id', fixtureUserIds),
    admin.auth.admin.getUserById(firstUserId),
    admin.auth.admin.getUserById(secondUserId),
  ])
  if (memberships.error) throw dbError('remaining memberships read', memberships.error)
  if (household.error) throw dbError('household lifecycle read', household.error)
  if (profiles.error) throw dbError('preserved profiles read', profiles.error)
  if (books.error) throw dbError('preserved books read', books.error)
  if (firstAuth.error || !firstAuth.data.user)
    throw dbError('first auth preservation', firstAuth.error)
  if (secondAuth.error || !secondAuth.data.user)
    throw dbError('second auth preservation', secondAuth.error)

  assert.equal(memberships.count, 0, 'both memberships are removed')
  assert.equal(household.data, null, 'the empty household is deleted')
  assert.equal(profiles.data?.length, 2, 'both profiles remain')
  assert.equal(books.data?.length, 3, 'both owned books and the borrowed fixture remain')
  console.log(
    '✓ concurrent final unlinks preserve both accounts/libraries and delete the household',
  )
}

try {
  await main()
} finally {
  if (householdId) {
    await admin.from('households').delete().eq('id', householdId)
  }
  for (const userId of fixtureUserIds) {
    await admin.auth.admin.deleteUser(userId)
  }
}
