// OWNER-RUN ONLY. Never run `run` or `resume` against production from an agent session.
import { execFileSync } from 'node:child_process'
import {
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  appendFileSync,
  existsSync,
  unlinkSync,
  realpathSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import {
  BATCH_SIZE,
  MAX_WORKS,
  UUID,
  hash,
  stable,
  quote,
  requireThat,
  inventoryPredicate,
  validatePlan,
  snapshotSql,
  processItem,
  verifyReset,
  resumeAction,
} from './series-recovery-lib.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const runtimeFiles = [
  'scripts/series-recovery.mjs',
  'scripts/series-recovery-cli.mjs',
  'scripts/series-recovery-lib.mjs',
  'docs/queries/series-unavailable-retry.sql',
  'packages/core/src/seriesClassification.ts',
  'packages/core/src/enrichResolve.ts',
  'packages/core/src/normalize.ts',
  'packages/core/src/contributors.ts',
  'packages/core/src/match.ts',
  'packages/core/src/ownership.ts',
  'packages/core/src/genreNormalize.ts',
  'apps/web/src/lib/seriesLookup.ts',
  'pnpm-lock.yaml',
]
const git = (...args) =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 20000,
  }).trim()
const runtimeHash = () =>
  hash(runtimeFiles.map((path) => [path, readFileSync(resolve(root, path), 'utf8')]))
const clean = () =>
  requireThat(
    !git('status', '--porcelain', '--untracked-files=no'),
    'tracked_changes_block_execution',
  )
const seal = (value) => ({ ...value, digest: hash(value) })
export function seriesDeployment(functions) {
  const matches = functions.filter((fn) => fn.slug === 'series')
  const fn = matches[0]
  requireThat(
    matches.length === 1 &&
      fn.status === 'ACTIVE' &&
      fn.verify_jwt === true &&
      Number.isInteger(fn.version) &&
      /^[a-f0-9]{64}$/.test(fn.ezbr_sha256),
    'series_deployment_invalid',
  )
  return { version: fn.version, hash: fn.ezbr_sha256 }
}
function deployedSeries(project, deployment) {
  try {
    return seriesDeployment(
      JSON.parse(
        execFileSync(
          'supabase',
          ['functions', 'list', '--project-ref', project, '--output', 'json'],
          {
            cwd: deployment,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 20000,
          },
        ),
      ),
    )
  } catch {
    throw new Error('series_deployment_unavailable')
  }
}
export function durableFile(path, value) {
  const fd = openSync(path, 'wx', 0o600)
  try {
    writeFileSync(fd, stable(value) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const dir = openSync(dirname(path), 'r')
  try {
    fsyncSync(dir)
  } finally {
    closeSync(dir)
  }
}
export function readJournal(path) {
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  requireThat(text.endsWith('\n'), 'incomplete_journal_stop')
  const events = text
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  let previous = null
  for (const event of events) {
    const { digest, ...body } = event
    requireThat(body.previous === previous && digest === hash(body), 'journal_integrity_stop')
    previous = digest
  }
  return events
}
export function appendEvent(path, events, type, data = {}) {
  const event = seal({
    previous: events.at(-1)?.digest ?? null,
    at: new Date().toISOString(),
    type,
    ...data,
  })
  const fd = openSync(path, 'a', 0o600)
  try {
    appendFileSync(fd, stable(event) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const directory = openSync(dirname(path), 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
  events.push(event)
}
export function parseArgs(argv) {
  const names = new Set()
  const args = Object.fromEntries(
    argv
      .filter((x) => x !== '--')
      .map((arg) => {
        const match = /^--(mode|project|actor|deployment|app|run)=(.+)$/.exec(arg)
        requireThat(match, 'use_named_equals_arguments')
        requireThat(!names.has(match[1]), 'duplicate_argument')
        names.add(match[1])
        return [match[1], match[2]]
      }),
  )
  requireThat(['plan', 'run', 'resume', 'status'].includes(args.mode), 'mode_required')
  requireThat(/^[a-z]{20}$/.test(args.project), 'explicit_project_required')
  requireThat(args.deployment && realpathSync(args.deployment), 'deployment_checkout_required')
  requireThat(
    readFileSync(resolve(args.deployment, 'supabase/.temp/project-ref'), 'utf8').trim() ===
      args.project,
    'linked_project_mismatch',
  )
  if (args.mode === 'plan') {
    requireThat(UUID.test(args.actor), 'existing_actor_required')
    const app = new URL(args.app)
    requireThat(
      app.protocol === 'https:' &&
        !app.username &&
        !app.password &&
        app.pathname === '/' &&
        !app.search &&
        !app.hash,
      'https_app_origin_required',
    )
  } else requireThat(/^[a-f0-9]{64}$/.test(args.run), 'run_digest_required')
  return args
}
function query(sql, deployment, directory, project) {
  const path = resolve(
    directory,
    'query-' + Date.now() + '-' + Math.random().toString(16).slice(2) + '.sql',
  )
  const fd = openSync(path, 'wx', 0o600)
  writeFileSync(fd, sql)
  closeSync(fd)
  try {
    const output = execFileSync(
      'supabase',
      ['db', 'query', '--project-ref', project, '--file', path, '--output', 'json'],
      {
        cwd: deployment,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
        maxBuffer: 32 * 1024 * 1024,
      },
    )
    const parsed = JSON.parse(output.slice(output.indexOf('{')))
    requireThat(Array.isArray(parsed.rows), 'database_result_invalid')
    return parsed.rows
  } catch {
    throw new Error('database_operation_failed_or_uncertain')
  } finally {
    unlinkSync(path)
  }
}
function actorGate(actor) {
  return `do $gate$ begin
   perform 1 from public.profiles where id=${quote(actor)}::uuid for key share;
   perform 1 from public.corpus_admins where user_id=${quote(actor)}::uuid for update;
   if not found then raise exception 'existing administrator required'; end if;
   if exists(select 1 from public.corpus_sweep_runs where status in ('queued','running')) then raise exception 'active sweep'; end if;
  end; $gate$;`
}
export function resetSql(template, batch, actor, commit) {
  requireThat(batch.length > 0 && batch.length <= BATCH_SIZE, 'invalid_reset_batch')
  return template
    .replace(
      '-- Empty input deliberately refuses to run.',
      () =>
        `insert into series_retry_input values ${batch.map((w) => `(${quote(w.id)},${quote(w.fingerprint)})`).join(',')};`,
    )
    .replace(
      "-- Insert the existing corpus administrator's UUID here; never create an administrator for this.",
      () => `insert into series_retry_actor values (${quote(actor)});`,
    )
    .replace(
      'do $repair$',
      () =>
        `do $pending$ begin if exists(select 1 from public.work_series_suggestions s join series_retry_input i on i.id=s.work_id where s.status='pending') then raise exception 'pending review'; end if; end; $pending$;\ndo $repair$`,
    )
    .replace('rollback;', commit ? 'commit;' : 'rollback;')
}
export function saveSql(before, result, checkedAt, actor) {
  return `begin; set local lock_timeout='5s'; set local statement_timeout='30s';
  ${actorGate(actor)}
  select 1 from public.work_series_suggestions where work_id=${quote(before.id)}::uuid and status='pending' for update;
  select 1 from public.books where corpus_work_id=${quote(before.id)}::uuid and removed_at is null order by id for update;
  select 1 from public.works where id=${quote(before.id)}::uuid for update;
  do $guard$ begin
   if not exists(select 1 from public.works w where id=${quote(before.id)}::uuid and md5(to_jsonb(w)::text)=${quote(before.fingerprint)})
    or exists(select 1 from public.corpus_series_entries where work_id=${quote(before.id)}::uuid and removed_at is null)
    or exists(select 1 from public.work_series_suggestions where work_id=${quote(before.id)}::uuid and status='pending')
   then raise exception 'changed target'; end if;
  end; $guard$;
  select set_config('request.jwt.claim.sub',${quote(actor)},true);
  select set_config('request.jwt.claims',${quote(JSON.stringify({ sub: actor, role: 'authenticated' }))},true);
  select public.record_corpus_series_discovery(${quote(before.id)}::uuid,${quote(JSON.stringify(result))}::jsonb,${quote(checkedAt)}::timestamptz) as result;
  commit;`
}
async function secret() {
  if (process.env.REVERIE_RECOVERY_ACCESS_TOKEN)
    return process.env.REVERIE_RECOVERY_ACCESS_TOKEN.trim()
  requireThat(process.stdin.isTTY && process.stdout.isTTY, 'interactive_owner_terminal_required')
  process.stdout.write('Paste your signed-in administrator access token (hidden; not saved): ')
  return await new Promise((resolveToken, reject) => {
    let value = ''
    process.stdin.setRawMode(true)
    process.stdin.resume()
    const done = (error) => {
      process.stdin.off('data', onData)
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdout.write('\n')
      if (error) reject(error)
      else resolveToken(value.trim())
    }
    const onData = (chunk) => {
      for (const char of chunk.toString()) {
        if (char === '\u0003') {
          done(new Error('cancelled'))
          return
        }
        if (char === '\r' || char === '\n') {
          done()
          return
        }
        if (char === '\u007f') {
          value = value.slice(0, -1)
          continue
        }
        if (/[A-Za-z0-9._-]/.test(char)) value += char
      }
    }
    process.stdin.on('data', onData)
  })
}
export async function main() {
  const args = parseArgs(process.argv.slice(2)),
    common = git('rev-parse', '--path-format=absolute', '--git-common-dir')
  const base = resolve(common, 'series-recovery', args.project)
  mkdirSync(base, { recursive: true, mode: 0o700 })
  const db = (sql) => query(sql, args.deployment, base, args.project)
  if (args.mode === 'plan') {
    clean()
    const rows =
      db(`begin read only; select w.id,w.title,w.author_text,w.series,w.position,w.work_id,w.enrichment_confidence,
      md5(to_jsonb(w)::text) as fingerprint from public.works w where ${inventoryPredicate} order by w.id limit ${MAX_WORKS + 1}; commit;`)
    const gate =
      db(`select exists(select 1 from public.corpus_admins where user_id=${quote(args.actor)}::uuid) as administrator,
      (select count(*) from public.corpus_sweep_runs where status in ('queued','running')) as sweeps;`)[0]
    requireThat(gate.administrator && Number(gate.sweeps) === 0, 'owner_or_sweep_preflight_failed')
    const response = await fetch(new URL('/version.json', args.app), {
      signal: AbortSignal.timeout(20000),
      redirect: 'error',
    })
    requireThat(response.ok, 'app_version_unavailable')
    const version = await response.json()
    requireThat(
      typeof version.build === 'string' && /^[a-f0-9]{12}$/.test(version.build),
      'app_version_invalid',
    )
    const plan = seal({
      version: 1,
      project: args.project,
      actor: args.actor,
      app: args.app,
      build: version.build,
      seriesDeployment: deployedSeries(args.project, args.deployment),
      revision: git('rev-parse', 'HEAD'),
      runtime: runtimeHash(),
      node: process.version,
      works: rows,
    })
    validatePlan(plan)
    const directory = resolve(base, plan.digest)
    mkdirSync(directory, { mode: 0o700 })
    durableFile(resolve(directory, 'plan.json'), plan)
    console.log(
      JSON.stringify(
        {
          mode: 'read-only plan',
          run: plan.digest,
          works: rows.length,
          batches: Math.ceil(rows.length / BATCH_SIZE),
          plan: resolve(directory, 'plan.json'),
        },
        null,
        2,
      ),
    )
    return
  }
  const directory = resolve(base, args.run),
    plan = validatePlan(JSON.parse(readFileSync(resolve(directory, 'plan.json'), 'utf8')))
  requireThat(plan.project === args.project && plan.digest === args.run, 'plan_project_mismatch')
  const journal = resolve(directory, 'journal.jsonl'),
    events = readJournal(journal)
  const summary = () => {
    const latest = new Map(events.filter((e) => e.workId).map((e) => [e.workId, e]))
    return {
      planned: plan.works.length,
      verified: [...latest.values()].filter((e) => e.type === 'verified').length,
      confirmed: [...latest.values()].filter(
        (e) => e.type === 'verified' && e.outcome === 'confirmed',
      ).length,
      review: [...latest.values()].filter((e) => e.type === 'verified' && e.outcome === 'review')
        .length,
      deferred: [...latest.values()].filter((e) => e.type === 'deferred').length,
      untouched: plan.works.length - latest.size,
      uncertain: [...latest.values()].filter((e) =>
        ['lookup_started', 'proposal', 'save_started'].includes(e.type),
      ).length,
      last: events.at(-1)?.type ?? 'not_started',
      directory,
    }
  }
  if (args.mode === 'status') {
    console.log(JSON.stringify(summary(), null, 2))
    return
  }
  requireThat(!events.some((e) => e.type === 'complete'), 'completed_plan_do_not_repeat')
  requireThat(process.stdin.isTTY && process.stdout.isTTY, 'interactive_owner_terminal_required')
  clean()
  requireThat(git('branch', '--show-current') === 'main', 'run_from_merged_main_only')
  requireThat(
    git('ls-remote', '--exit-code', 'origin', 'refs/heads/main').split(/\s+/)[0] ===
      git('rev-parse', 'HEAD'),
    'main_not_synced_with_origin',
  )
  requireThat(
    plan.revision === git('rev-parse', 'HEAD') &&
      plan.runtime === runtimeHash() &&
      plan.node === process.version,
    'runtime_changed_stop_do_not_replan_consumed_work',
  )
  const lock = resolve(base, 'owner-run.lock')
  durableFile(lock, { pid: process.pid, run: plan.digest }) // exclusive; a stale crash lock requires owner inspection, never silent removal
  let stopping = false
  const pause = new AbortController()
  const stop = () => {
    stopping = true
    pause.abort()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  try {
    const approved = events.find((e) => e.type === 'approved')
    requireThat(args.mode === 'resume' ? !!approved : !approved, 'use_correct_run_or_resume_mode')
    const token = await secret()
    let publishable = process.env.REVERIE_RECOVERY_PUBLISHABLE_KEY
    if (!publishable) {
      const env = readFileSync(resolve(args.deployment, 'apps/web/.env.local'), 'utf8')
      publishable = /^VITE_SUPABASE_ANON_KEY\s*=\s*["']?([^\r\n"']+)["']?\s*$/m
        .exec(env)?.[1]
        ?.trim()
    }
    requireThat(publishable, 'publishable_key_required')
    const url = `https://${plan.project}.supabase.co`
    const request = async (path, body) => {
      const r = await fetch(url + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          apikey: publishable,
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      })
      requireThat(r.ok, 'endpoint_http_' + r.status)
      try {
        return await r.json()
      } catch {
        throw new Error('endpoint_invalid_json')
      }
    }
    const preflight = async (batchBoundary = false) => {
      requireThat(!stopping, 'owner_paused')
      requireThat(plan.runtime === runtimeHash(), 'runtime_changed_stop')
      requireThat((await request('/auth/v1/user')).id === plan.actor, 'signed_in_owner_mismatch')
      const r = await fetch(new URL('/version.json', plan.app), {
        signal: AbortSignal.timeout(20000),
        redirect: 'error',
      })
      requireThat(r.ok && (await r.json()).build === plan.build, 'deployment_changed_stop')
      if (batchBoundary) {
        requireThat(
          stable(deployedSeries(plan.project, args.deployment)) === stable(plan.seriesDeployment),
          'series_deployment_changed_stop',
        )
        db(`begin; ${actorGate(plan.actor)} rollback;`)
      }
    }
    await preflight(true)
    if (!approved) {
      requireThat(
        process.stdin.isTTY && process.stdout.isTTY,
        'interactive_owner_terminal_required',
      )
      console.log(
        `Frozen scope: ${plan.works.length} works, batches <=25. Resets outage flags, performs one lookup per admitted work, saves exact relational classifications, and reconciles eligible personal defaults. No retries, no review acceptance, no covers or other enrichment. Plan: ${directory}/plan.json`,
      )
      const prompt = createInterface({ input: process.stdin, output: process.stdout })
      let answer
      try {
        answer = await prompt.question(
          `Type RECOVER ${plan.digest.slice(0, 12)} to approve this entire frozen plan: `,
          { signal: pause.signal },
        )
      } finally {
        prompt.close()
      }
      requireThat(answer === `RECOVER ${plan.digest.slice(0, 12)}`, 'owner_cancelled')
      appendEvent(journal, events, 'approved', { plan: plan.digest })
    }
    const template = readFileSync(
      resolve(root, 'docs/queries/series-unavailable-retry.sql'),
      'utf8',
    )
    for (let offset = 0; offset < plan.works.length; offset += BATCH_SIZE) {
      const batch = plan.works.slice(offset, offset + BATCH_SIZE),
        batchId = hash(batch.map((w) => w.id))
      let reset = events.find((e) => e.type === 'reset_verified' && e.batch === batchId)
      if (!reset) {
        requireThat(
          !events.some((e) => e.type === 'reset_started' && e.batch === batchId),
          'uncertain_reset_stop',
        )
        await preflight(true)
        // The existing owner reset runs rollback first and independently revalidates under locks before commit.
        db(resetSql(template, batch, plan.actor, false))
        for (const work of batch)
          durableFile(resolve(base, work.id + '.attempt'), { run: plan.digest, batch: batchId })
        const before = db(snapshotSql(batch.map((w) => w.id)))
        requireThat(before.length === batch.length, 'batch_snapshot_missing')
        appendEvent(journal, events, 'reset_started', { batch: batchId, before })
        db(resetSql(template, batch, plan.actor, true))
        const snapshots = db(snapshotSql(batch.map((w) => w.id)))
        requireThat(snapshots.length === batch.length, 'reset_snapshot_missing')
        snapshots.forEach((snapshot, i) => verifyReset(before[i], snapshot))
        appendEvent(journal, events, 'reset_verified', { batch: batchId, snapshots })
        reset = events.at(-1)
      }
      for (const snapshot of reset.snapshots) {
        const latest = events.filter((e) => e.workId === snapshot.id).at(-1)
        const action = resumeAction(latest)
        if (action === 'skip') continue
        if (action === 'defer') {
          appendEvent(journal, events, 'deferred', {
            workId: snapshot.id,
            code: 'interrupted_attempt_not_retried',
          })
          continue
        }
        await processItem(
          { ...snapshot.work, fingerprint: snapshot.fingerprint },
          {
            preflight,
            snapshot: async (id) => db(snapshotSql([id]))[0],
            record: async (type, data) =>
              appendEvent(journal, events, type, { workId: snapshot.id, ...data }),
            lookup: async (body) => request('/functions/v1/series', body),
            save: async (before, result, checkedAt) => {
              const rows = db(saveSql(before, result, checkedAt, plan.actor))
              const row = rows.find((row) => row.result)
              requireThat(row, 'save_response_missing')
              return row.result
            },
          },
        )
        console.log(JSON.stringify(summary()))
        await new Promise((resolveWait) => setTimeout(resolveWait, 3100))
      }
    }
    appendEvent(journal, events, 'complete')
    console.log(JSON.stringify(summary(), null, 2))
  } catch (error) {
    appendEvent(journal, events, 'stopped', {
      code: /^[a-z][a-z0-9_]+$/.test(error?.message) ? error.message : 'unexpected_error_redacted',
    })
    throw error
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    unlinkSync(lock)
  }
}
