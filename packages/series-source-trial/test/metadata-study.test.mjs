import test from 'node:test'
import assert from 'node:assert/strict'
import {
  readFile,
  mkdtemp,
  rm,
  writeFile,
  mkdir,
  cp,
  stat,
  realpath,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { runSubscriptionValue } from '../src/metadata/subscription-value.mjs'
import {
  createValueStudyLock,
  verifyValueStudyLock,
  partitionValueStudy,
  mergeValueStudy,
  runValueStudyCohort,
  studyProgress,
  readStudyJson,
} from '../src/metadata/value-study.mjs'
import { main } from '../src/study-metadata.mjs'
import {
  assertEvaluationFrame,
  assertNextEvaluationCohort,
} from '../src/metadata/study-authorization.mjs'

const system = 'a'.repeat(64)
const example = JSON.parse(
  await readFile(new URL('../data/metadata-value.example.json', import.meta.url), 'utf8'),
)
const isbn = (i) => {
  const base = String(978000000000 + i)
  const sum = [...base].reduce((s, d, n) => s + Number(d) * (n % 2 ? 3 : 1), 0)
  return base + String((10 - (sum % 10)) % 10)
}
const frame = (n = 21) => ({
  ...structuredClone(example),
  economics: {
    monthlySubscriptionUsd: 14.99,
    monthlyDistinctWorks: 100,
    maxUsdPerAdditionalWork: 0.25,
  },
  cases: Array.from({ length: n }, (_, i) => ({
    ...structuredClone(example.cases[0]),
    workGroup: `work-${String(i).padStart(3, '0')}`,
    identity: { isbn: isbn(i), title: `Synthetic work ${i}`, authors: ['Ada Example'] },
    reference: {
      ...structuredClone(example.cases[0].reference),
      source: 'https://www.penguinrandomhouse.com/books/synthetic-unit-test',
    },
  })),
})
const score = (cohort, good = true) =>
  runSubscriptionValue(cohort, {
    live: true,
    now: () => 1,
    baselineClient: {
      stats: {
        google: { requests: cohort.cases.length },
        openlibrary: { requests: cohort.cases.length },
      },
      acquire: async () => ({
        google: { status: 'not_found' },
        openlibrary: { status: 'not_found' },
      }),
    },
    isbndbClient: {
      stats: { requests: cohort.cases.length },
      lookup: async (isbn13) => {
        const c = cohort.cases.find((c) => c.identity.isbn === isbn13)
        return {
          status: 'ok',
          body: {
            book: {
              isbn13,
              title: c.identity.title,
              authors: c.identity.authors,
              pages: good ? 300 : 999,
              binding: 'paperback',
              publisher: 'Example Press',
              date_published: '2026-02-28',
              language: 'en',
            },
          },
        }
      },
    },
  })
const envelopes = async (input, lock) =>
  Promise.all(
    partitionValueStudy(input).map(async (c, i) => ({
      version: 1,
      lockSha256: lock.sha256,
      cohortIndex: i + 1,
      status: 'completed',
      summary: await score(c, i === 0),
    })),
  )
const temp = async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'reverie-value-study-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return realpath(dir)
}

test('partition is deterministic, bounded, and never splits editions of a work', () => {
  const input = frame(22)
  input.cases[19].workGroup = input.cases[20].workGroup
  input.cases[19].identity.title = input.cases[20].identity.title
  const lock = createValueStudyLock(input, system)
  assert.deepEqual(
    lock.cohorts.map((c) => [c.cases, c.distinctWorks]),
    [
      [19, 19],
      [3, 2],
    ],
  )
  input.cases.reverse()
  assert.deepEqual(createValueStudyLock(input, system), lock)
  assert.equal(verifyValueStudyLock(input, lock, system).length, 2)
  const output = JSON.stringify(lock)
  for (const v of [
    input.cases[0].identity.isbn,
    'Synthetic work',
    'Ada Example',
    'penguinrandomhouse',
    'work-000',
  ])
    assert.ok(!output.includes(v))
})

test('duplicates, invalid frames, oversized groups and split exact work identities fail', () => {
  for (const mutate of [
    (f) => {
      f.cases[1].identity.isbn = f.cases[0].identity.isbn
    },
    (f) => {
      f.cases[1].identity.title = f.cases[0].identity.title
    },
    (f) => {
      f.cases.forEach((c) => {
        c.workGroup = 'all'
      })
    },
    (f) => {
      f.cases[0].reference.readerNote = 'private'
    },
    (f) => {
      f.economics.monthlySubscriptionUsd = -1
    },
  ]) {
    const f = frame()
    mutate(f)
    assert.throws(() => createValueStudyLock(f, system))
  }
  assert.throws(() => createValueStudyLock(frame(201), system))
  assert.throws(() => createValueStudyLock(frame(0), system))
})

test('lock rejects altered references, budgets, economics, grouping and runtime', () => {
  const input = frame(),
    lock = createValueStudyLock(input, system)
  for (const mutate of [
    (f) => {
      f.cases[0].reference.pages = 400
    },
    (f) => {
      f.economics.monthlySubscriptionUsd = 10
    },
    (f) => {
      f.cases[0].workGroup = 'changed'
    },
  ]) {
    const f = structuredClone(input)
    mutate(f)
    assert.throws(() => verifyValueStudyLock(f, lock, system))
  }
  const changed = structuredClone(lock)
  changed.cohorts[1].budgets.isbndb++
  assert.throws(() => verifyValueStudyLock(input, changed, system))
  assert.throws(() => verifyValueStudyLock(input, lock, 'b'.repeat(64)))
})

test('combiner recomputes weighted work-level economics, never averages cohort costs', async () => {
  const input = frame(),
    lock = createValueStudyLock(input, system)
  const reports = await envelopes(input, lock)
  const merged = await mergeValueStudy(input, lock, system, reports.reverse())
  assert.equal(merged.distinctWorks, 21)
  assert.equal(merged.policies.selective.additionalCorrectWorks, 20)
  assert.equal(merged.policies.selective.wrongValueWorks, 1)
  assert.equal(merged.economicScenarios.selective.observedAdditionalWorkRate, 20 / 21)
  assert.ok(
    Math.abs(merged.economicScenarios.selective.projectedUsdPerAdditionalWork - 0.157395) < 1e-12,
  )
  assert.equal(merged.providers.isbndb.fields.pages.agrees, 20)
  assert.equal(merged.providers.isbndb.fields.pages.differs, 1)
  assert.equal(merged.transport.isbndb.requests, 21)
  assert.equal(merged.decision, 'not_qualified')
  assert.equal(merged.productionWrites, 0)
})

test('one work sampled in two editions counts once, including across cohort boundaries', async () => {
  const input = frame(22)
  input.cases[0].workGroup = input.cases[1].workGroup
  input.cases[0].identity.title = input.cases[1].identity.title
  const lock = createValueStudyLock(input, system)
  const reports = await envelopes(input, lock)
  const merged = await mergeValueStudy(input, lock, system, reports)
  assert.equal(merged.cases, 22)
  assert.equal(merged.distinctWorks, 21)
  assert.equal(merged.policies.selective.additionalCorrectWorks, 19)
})

test('merge refuses incomplete, failed, duplicate, foreign and dry-run reports', async () => {
  const input = frame(),
    lock = createValueStudyLock(input, system),
    reports = await envelopes(input, lock)
  await assert.rejects(mergeValueStudy(input, lock, system, reports.slice(0, 1)))
  await assert.rejects(mergeValueStudy(input, lock, system, [reports[0], reports[0]]))
  for (const mutate of [
    (r) => {
      r[1].status = 'failed'
    },
    (r) => {
      r[1].lockSha256 = 'b'.repeat(64)
    },
    (r) => {
      r[1].summary.mode = 'dry_run'
    },
    (r) => {
      r[1].summary.frameSha256 = r[0].summary.frameSha256
    },
    (r) => {
      r[1].summary.economicScenarios.selective.monthlySubscriptionUsd = 1
    },
  ]) {
    const r = structuredClone(reports)
    mutate(r)
    await assert.rejects(mergeValueStudy(input, lock, system, r))
  }
})

test('aggregate validation refuses leaks, forged totals, unknown enums, and inflated benefits', async () => {
  const input = frame(),
    lock = createValueStudyLock(input, system),
    reports = await envelopes(input, lock)
  for (const mutate of [
    (s) => {
      s.secret = 'private text'
    },
    (s) => {
      s.providers.isbndb.outcomes['private text'] = 1
    },
    (s) => {
      s.providers.isbndb.fields.pages.agrees++
    },
    (s) => {
      s.providers.isbndb.availabilityOnly.cover = 21
    },
    (s) => {
      s.policies.selective.additionalCorrectWorks = 21
    },
    (s) => {
      s.observedAcquisitionMs.baseline = Infinity
    },
    (s) => {
      s.transport.isbndb.requests = 21
    },
    (s) => {
      s.transport.isbndb.stopped = 'secret error'
    },
    (s) => {
      s.modelCalls = 1
    },
  ]) {
    const r = structuredClone(reports)
    mutate(r[0].summary)
    await assert.rejects(mergeValueStudy(input, lock, system, r))
  }
})

test('zero gain and unknown usage never become a free or finite cost estimate', async () => {
  const input = frame(1)
  input.economics.monthlyDistinctWorks = null
  const lock = createValueStudyLock(input, system),
    reports = await envelopes(input, lock)
  const merged = await mergeValueStudy(input, lock, system, reports)
  assert.equal(merged.economicScenarios.selective.projectedUsdPerAdditionalWork, null)
  reports[0].summary = await score(partitionValueStudy(input)[0], false)
  assert.equal(
    (await mergeValueStudy(input, lock, system, reports)).economicScenarios.selective
      .projectedUsdPerAdditionalWork,
    null,
  )
})

test('single-use runner writes durable aggregates and blocks repeat/repriced attempts', async (t) => {
  const stateRoot = await temp(t),
    input = frame(100),
    lock = createValueStudyLock(input, system)
  let calls = 0
  const options = {
    input,
    lock,
    systemSha256: system,
    index: 1,
    stateRoot,
    acquire: async (c, budget) => {
      calls++
      assert.equal(budget.isbndb, c.cases.length)
      return score(c)
    },
  }
  const r = await runValueStudyCohort(options)
  assert.equal(r.status, 'completed')
  await assert.rejects(runValueStudyCohort(options))
  assert.equal(calls, 1)
  const changed = structuredClone(input)
  changed.economics.monthlySubscriptionUsd = 20
  await assert.rejects(
    runValueStudyCohort({
      ...options,
      input: changed,
      lock: createValueStudyLock(changed, system),
    }),
  )
  assert.equal(calls, 1)
  const progress = await studyProgress(lock, stateRoot)
  assert.equal(progress.results.length, 1)
  assert.deepEqual(progress.missing, [2, 3, 4, 5])
  const raw = await readFile(join(stateRoot, lock.sha256, 'cohort-1.json'), 'utf8')
  assert.ok(!raw.includes('Synthetic work'))
  assert.ok(!raw.includes(input.cases[0].identity.isbn))
})

test('thrown or invalid acquisition is retained as failed and cannot be retried', async (t) => {
  const stateRoot = await temp(t),
    input = frame(100),
    lock = createValueStudyLock(input, system)
  const options = {
    input,
    lock,
    systemSha256: system,
    index: 1,
    stateRoot,
    acquire: async () => {
      throw new Error('secret provider body')
    },
  }
  const r = await runValueStudyCohort(options)
  assert.equal(r.status, 'failed')
  assert.ok(!JSON.stringify(r).includes('secret'))
  await assert.rejects(runValueStudyCohort(options))
  assert.deepEqual((await studyProgress(lock, stateRoot)).failed, [1])
})

test('concurrent cohorts are refused before acquisition, and started-without-result stays failed', async (t) => {
  const stateRoot = await temp(t),
    input = frame(100),
    lock = createValueStudyLock(input, system)
  let entered, release
  const ready = new Promise((r) => {
    entered = r
  })
  const gate = new Promise((r) => {
    release = r
  })
  const opts = {
    input,
    lock,
    systemSha256: system,
    index: 1,
    stateRoot,
    acquire: async (c) => {
      entered()
      await gate
      return score(c)
    },
  }
  const first = runValueStudyCohort(opts)
  await ready
  await assert.rejects(
    runValueStudyCohort({
      ...opts,
      index: 2,
      acquire: () => assert.fail('concurrent acquisition'),
    }),
  )
  release()
  await first
  await writeFile(join(stateRoot, lock.sha256, 'cohort-2.started'), '{}')
  const progress = await studyProgress(lock, stateRoot)
  assert.deepEqual(progress.failed, [2])
  await assert.rejects(runValueStudyCohort({ ...opts, index: 2 }))
})

test('undersized and synthetic frames fail before creating attempts or calling providers', async (t) => {
  const stateRoot = await temp(t)
  for (const input of [
    frame(1),
    {
      ...frame(100),
      cases: frame(100).cases.map((c) => ({
        ...c,
        reference: { ...c.reference, source: 'https://publisher.example/synthetic' },
      })),
    },
  ]) {
    await assert.rejects(
      runValueStudyCohort({
        input,
        lock: createValueStudyLock(input, system),
        systemSha256: system,
        index: 1,
        stateRoot,
        acquire: () => assert.fail('unexpected network'),
      }),
    )
  }
})

test('JSON reader bounds file input, rejects directories and invalid JSON', async (t) => {
  const dir = await temp(t)
  await writeFile(join(dir, 'large'), 'x'.repeat(2097153))
  await writeFile(join(dir, 'bad'), 'not JSON')
  for (const name of ['large', 'bad', '']) await assert.rejects(readStudyJson(join(dir, name)))
})

test('CLI dry/help is wired, redacted and rejects refresh, state overrides and partial selectors', async () => {
  const out = []
  await main(
    ['--dry', '--input', new URL('../data/metadata-value.example.json', import.meta.url).pathname],
    (v) => out.push(v),
  )
  assert.equal(JSON.parse(out[0]).cases, 1)
  assert.ok(!out[0].includes('Synthetic'))
  for (const args of [
    ['--refresh'],
    ['--state-root', '/tmp'],
    ['--run', '--cohort', '0'],
    ['--dry', '--dry'],
    ['--help', '--run'],
  ])
    await assert.rejects(main(args))
  const child = spawnSync(
    process.execPath,
    ['src/study-metadata.mjs', '--input', 'secret-value', '--refresh'],
    { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
  )
  assert.equal(child.status, 1)
  assert.ok(!child.stderr.includes('secret-value'))
})

test('an existing result cannot be replayed even if its started marker is absent', async (t) => {
  const stateRoot = await temp(t),
    input = frame(100),
    lock = createValueStudyLock(input, system)
  const dir = join(stateRoot, lock.sha256)
  await mkdir(dir)
  await writeFile(join(dir, 'cohort-1.json'), '{}')
  await assert.rejects(
    runValueStudyCohort({
      input,
      lock,
      systemSha256: system,
      index: 1,
      stateRoot,
      acquire: () => assert.fail('replayed'),
    }),
  )
})

test('all persisted cohorts reconcile to one complete study with no repeated requests', async (t) => {
  const stateRoot = await temp(t),
    input = frame(100),
    lock = createValueStudyLock(input, system)
  for (const c of lock.cohorts)
    await runValueStudyCohort({
      input,
      lock,
      systemSha256: system,
      index: c.index,
      stateRoot,
      acquire: score,
    })
  const progress = await studyProgress(lock, stateRoot)
  assert.deepEqual(progress.missing, [])
  assert.deepEqual(progress.failed, [])
  const merged = await mergeValueStudy(input, lock, system, progress.results)
  assert.equal(merged.cases, 100)
  assert.equal(merged.policies.selective.additionalCorrectWorks, 100)
  assert.equal(merged.transport.isbndb.requests, 100)
  assert.equal(merged.economicScenarios.selective.projectedUsdPerAdditionalWork, 0.1499)
})

test('real CLI freeze/commit/merge workflow works offline and enforces committed runtime and lock', async (t) => {
  const dir = await temp(t),
    pkg = join(dir, 'packages/series-source-trial')
  await mkdir(join(pkg, 'src'), { recursive: true })
  await cp(new URL('../src/metadata', import.meta.url), join(pkg, 'src/metadata'), {
    recursive: true,
  })
  for (const f of ['study-metadata.mjs', 'env.mjs', 'benchmark-metadata.mjs', 'value-metadata.mjs'])
    await cp(new URL(`../src/${f}`, import.meta.url), join(pkg, 'src', f))
  await cp(new URL('../package.json', import.meta.url), join(pkg, 'package.json'))
  for (const f of ['package.json', 'pnpm-lock.yaml'])
    await cp(new URL(`../../../${f}`, import.meta.url), join(dir, f))
  const runGit = (...args) => {
    const r = spawnSync(
      'git',
      [
        '-c',
        'user.name=Study Test',
        '-c',
        'user.email=study@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: dir, encoding: 'utf8' },
    )
    assert.equal(r.status, 0, r.stderr)
  }
  await writeFile(join(dir, '.gitignore'), 'packages/series-source-trial/private-inputs/\n')
  runGit('init', '--quiet')
  runGit('add', '.')
  runGit('commit', '-qm', 'Synthetic runtime')
  const privateDir = join(pkg, 'private-inputs/metadata-value-studies')
  await mkdir(privateDir, { recursive: true })
  const inputPath = join(privateDir, 'frame.json'),
    lockPath = join(dir, 'study-lock.json')
  await writeFile(inputPath, JSON.stringify(frame(1)))
  const cli = (...args) =>
    spawnSync(process.execPath, [join(pkg, 'src/study-metadata.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: {
        ...process.env,
        GOOGLE_BOOKS_API_KEY: 'synthetic-test-secret',
        ISBNDB_API_KEY: 'synthetic-test-secret',
      },
    })
  const frozen = cli('--freeze', '--input', inputPath, '--lock', lockPath)
  assert.equal(frozen.status, 0, frozen.stderr)
  assert.equal(JSON.parse(frozen.stdout).cases, 1)
  assert.equal(cli('--freeze', '--input', inputPath, '--lock', lockPath).status, 1)
  assert.equal(cli('--merge', '--input', inputPath, '--lock', lockPath).status, 1)
  runGit('add', 'study-lock.json')
  runGit('commit', '-qm', 'Synthetic lock')
  const incomplete = cli('--merge', '--input', inputPath, '--lock', lockPath)
  assert.equal(incomplete.status, 0, incomplete.stderr)
  assert.deepEqual(JSON.parse(incomplete.stdout).missingCohorts, [1])
  const refused = cli('--run', '--input', inputPath, '--lock', lockPath, '--cohort', '1')
  assert.equal(refused.status, 1)
  assert.ok(!refused.stderr.includes('synthetic-test-secret'))
  await assert.rejects(stat(join(dir, '.git/metadata-value-studies')))
  await writeFile(join(pkg, 'src/metadata/uncommitted.mjs'), '// synthetic untracked runtime\n')
  assert.equal(cli('--merge', '--input', inputPath, '--lock', lockPath).status, 1)
})

test('CLI entry through a filesystem alias actually executes rather than silently succeeding', async (t) => {
  const dir = await temp(t),
    alias = join(dir, 'study.mjs')
  await symlink(new URL('../src/study-metadata.mjs', import.meta.url).pathname, alias)
  const r = spawnSync(process.execPath, [alias, '--help'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /metadata:study/)
})

test('public CLI refuses other frames before env access and cannot be overridden', async () => {
  await assert.rejects(
    main([
      '--run',
      '--input',
      new URL('../data/metadata-value.example.json', import.meta.url).pathname,
      '--lock',
      '/missing/lock',
      '--env',
      '/missing/secrets',
      '--cohort',
      '1',
    ]),
    /live_study_evaluation_scope/,
  )
  await assert.rejects(
    main([
      '--run',
      '--input',
      '/missing',
      '--lock',
      '/missing',
      '--cohort',
      '1',
      '--override-rights',
    ]),
    /invalid_arguments/,
  )
})

test('evaluation admission binds exactly 100 works and ISBNs without an environment override', () => {
  const input = frame(100)
  const allowed = createValueStudyLock(input, system).identityFrameSha256
  assert.doesNotThrow(() => assertEvaluationFrame(input, allowed))
  assert.doesNotThrow(() =>
    assertEvaluationFrame({ ...input, cases: [...input.cases].reverse() }, allowed),
  )
  assert.throws(() => assertEvaluationFrame(frame(99), allowed))
  assert.throws(() => assertEvaluationFrame(frame(101), allowed))
  assert.throws(() => assertEvaluationFrame(input), /live_study_evaluation_scope/)
  const changed = structuredClone(input)
  changed.cases[0].identity.isbn = isbn(400)
  assert.throws(() => assertEvaluationFrame(changed, allowed), /live_study_evaluation_scope/)
  changed.cases[0].identity.isbn = input.cases[0].identity.isbn
  changed.cases[0].workGroup = changed.cases[1].workGroup
  assert.throws(() => assertEvaluationFrame(changed, allowed), /live_study_evaluation_scope/)
})

test('a new cohort cannot reset authentication, quota, failure, or interruption stops', () => {
  const progress = {
    missing: [2, 3],
    failed: [],
    results: [{ summary: { transport: { isbndb: { stopped: null } } } }],
  }
  assert.doesNotThrow(() => assertNextEvaluationCohort(progress, 2))
  assert.throws(() => assertNextEvaluationCohort(progress, 1))
  assert.throws(() => assertNextEvaluationCohort(progress, 3))
  assert.throws(() => assertNextEvaluationCohort({ ...progress, failed: [1] }, 2))
  for (const stopped of ['authentication', 'rate_limited', 'infrastructure_failures']) {
    const stoppedProgress = structuredClone(progress)
    stoppedProgress.results[0].summary.transport.isbndb.stopped = stopped
    assert.throws(() => assertNextEvaluationCohort(stoppedProgress, 2))
  }
})
