import { execFileSync } from 'node:child_process'
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { loadLocalEnvironment } from './env.mjs'
import { createBaselineClient } from './metadata/baseline-client.mjs'
import { createIsbndbClient } from './metadata/isbndb-client.mjs'
import { runSubscriptionValue } from './metadata/subscription-value.mjs'
import {
  assertEvaluationFrame,
  assertNextEvaluationCohort,
} from './metadata/study-authorization.mjs'
import {
  createValueStudyLock,
  verifyValueStudyLock,
  studyHash,
  readStudyJson,
  runValueStudyCohort,
  mergeValueStudy,
  studyProgress,
} from './metadata/value-study.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(packageRoot, '../..')
const git = (args) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
const within = (root, path) => {
  const r = relative(root, path)
  return r && !r.startsWith('..') && !isAbsolute(r)
}

export async function valueStudySystemHash(committed = false) {
  const files = [
    ...(await readdir(join(packageRoot, 'src/metadata')))
      .filter((p) => p.endsWith('.mjs'))
      .map((p) => `src/metadata/${p}`),
    'src/study-metadata.mjs',
    'src/env.mjs',
    'src/benchmark-metadata.mjs',
    'src/value-metadata.mjs',
    'package.json',
    '../../package.json',
    '../../pnpm-lock.yaml',
  ].sort()
  return studyHash({
    node: process.version,
    googleReferrerSha256: studyHash(process.env.GOOGLE_BOOKS_REFERRER ?? null),
    files: await Promise.all(
      files.map(async (path) => {
        const absolute = resolve(packageRoot, path)
        const content = await readFile(absolute, 'utf8')
        if (
          committed &&
          ((await realpath(absolute)) !== absolute ||
            content !==
              execFileSync('git', ['show', `HEAD:${relative(repo, absolute)}`], {
                cwd: repo,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'pipe'],
              }))
        )
          throw new Error('committed_runtime_required')
        return [path, studyHash(content)]
      }),
    ),
  })
}

export async function main(args = process.argv.slice(2), write = console.log) {
  if (args.includes('--help')) {
    if (args.filter((a) => a !== '--').length !== 1) throw new Error('invalid_arguments')
    write(
      'metadata:study --dry|--freeze|--run|--merge --input <frame.json> [--lock <lock.json>] [--cohort <1-based-index>] [--env <file>]\nLive --run admits only the committed September 9 evaluation ISBN set: 100 editions, 100 works. No override is available. Dry plans need no credentials. Freeze requires a clean committed runtime and an ignored private-inputs/metadata-value-studies frame. Execution requires a committed matching lock and both API keys. Cohorts run in order; failed/interrupted or provider-stopped studies cannot advance. Merge reads only the fixed Git-common-directory state. No refresh, retry, state override, production clearance or billing action exists.',
    )
    return
  }
  const options = {},
    modes = ['--dry', '--freeze', '--run', '--merge']
  const seen = new Set()
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--') continue
    if (seen.has(flag) || ![...modes, '--input', '--lock', '--cohort', '--env'].includes(flag))
      throw new Error('invalid_arguments')
    seen.add(flag)
    if (modes.includes(flag)) {
      if (options.mode) throw new Error('invalid_arguments')
      options.mode = flag
      continue
    }
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error('invalid_arguments')
    options[flag.slice(2)] = value
  }
  if (
    !options.mode ||
    !options.input ||
    (options.mode !== '--dry' && !options.lock) ||
    (options.mode !== '--run' && options.cohort) ||
    (options.mode === '--run' && !/^[1-9]\d*$/.test(options.cohort ?? '')) ||
    (options.mode === '--dry' && (options.lock || options.env))
  )
    throw new Error('invalid_arguments')
  const input = await readStudyJson(resolve(options.input))
  // The owner authorized one evaluation before further provider contact, not general acquisition.
  // Reject every other frame before loading credentials or constructing provider transports.
  if (options.mode === '--run') assertEvaluationFrame(input)
  if (options.mode !== '--dry')
    await loadLocalEnvironment(resolve(options.env ?? join(packageRoot, '.env.local')))
  const system = await valueStudySystemHash(options.mode !== '--dry')
  if (options.mode === '--dry') {
    write(JSON.stringify(createValueStudyLock(input, system), null, 2))
    return
  }
  const inputPath = await realpath(resolve(options.input))
  if (!within(join(packageRoot, 'private-inputs/metadata-value-studies'), inputPath))
    throw new Error('private_frame_required')
  git(['check-ignore', '--', relative(repo, inputPath)])
  if (git(['status', '--porcelain', '--untracked-files=no']))
    throw new Error('clean_runtime_required')
  const lockPath = resolve(options.lock)
  if (!within(repo, lockPath)) throw new Error('repository_lock_required')
  if ((await realpath(dirname(lockPath))) !== dirname(lockPath))
    throw new Error('direct_lock_required')
  if (options.mode === '--freeze') {
    const lock = createValueStudyLock(input, system)
    await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
    write(JSON.stringify(lock, null, 2))
    return
  }
  if ((await realpath(lockPath)) !== lockPath) throw new Error('direct_lock_required')
  const lock = await readStudyJson(lockPath)
  const committed = JSON.parse(git(['show', `HEAD:${relative(repo, lockPath)}`]))
  if (studyHash(lock) !== studyHash(committed)) throw new Error('committed_lock_required')
  verifyValueStudyLock(input, lock, system)
  const stateRoot = join(
    resolve(repo, git(['rev-parse', '--git-common-dir'])),
    'metadata-value-studies',
  )
  if (options.mode === '--merge') {
    const progress = await studyProgress(lock, stateRoot)
    if (progress.missing.length || progress.failed.length) {
      write(
        JSON.stringify(
          {
            mode: 'incomplete',
            lockSha256: lock.sha256,
            completedCohorts: progress.results.length,
            missingCohorts: progress.missing,
            failedCohorts: progress.failed,
            decision: 'not_qualified',
            economicScenarios: {},
          },
          null,
          2,
        ),
      )
      return
    }
    write(JSON.stringify(await mergeValueStudy(input, lock, system, progress.results), null, 2))
    return
  }
  const googleKey = process.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_BOOKS_KEY
  const isbnKey = process.env.ISBNDB_API_KEY ?? process.env.ISBNDB_KEY
  if (!googleKey?.trim() || !isbnKey?.trim()) throw new Error('keys_required')
  assertNextEvaluationCohort(await studyProgress(lock, stateRoot), Number(options.cohort))
  const result = await runValueStudyCohort({
    input,
    lock,
    systemSha256: system,
    index: Number(options.cohort),
    stateRoot,
    acquire: async (cohort, budgets) => {
      // A new cohort must not reset the previous client's rate-limit spacing.
      await delay(1100)
      return runSubscriptionValue(cohort, {
        live: true,
        baselineClient: createBaselineClient({
          googleKey,
          googleReferrer: process.env.GOOGLE_BOOKS_REFERRER,
          maxGoogleRequests: budgets.google,
          maxOpenLibraryRequests: budgets.openlibrary,
          includeValueMetadata: true,
        }),
        isbndbClient: createIsbndbClient({ key: isbnKey, maxRequests: budgets.isbndb }),
      })
    },
  })
  write(JSON.stringify(result, null, 2))
  if (result.status !== 'completed') throw new Error('cohort_failed')
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => null)) === fileURLToPath(import.meta.url)
)
  main().catch((error) => {
    console.error(
      error.message === 'live_study_evaluation_scope'
        ? 'Only the approved 100-work evaluation frame may run. No provider request was made. There is no override.'
        : 'Metadata study stopped. Check the committed lock, private frame, runtime, credentials and attempt state. Details are redacted; do not delete attempt markers or rerun a started cohort.',
    )
    process.exitCode = 1
  })
