import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { parseIntakeEvidence } from '../packages/core/src/intakeEvidenceValidation.ts'
import {
  resolveIntakeEvidence,
  intakeIdentityReviewReasons,
} from '../packages/core/src/intakeResolver.ts'
import { normalizeIsbn } from '../packages/core/src/match.ts'
import { intakeSourceObservation } from '../packages/core/src/intakeSourceAdapters.ts'
import { createIntakeSourceClient } from './intake-source-client.mjs'
import {
  buildIntakeReview,
  intakeReviewDiagnostics,
  compareIntakeCredits,
} from '../packages/core/src/intakeReview.ts'
import { intakeIdentityDiagnostics } from '../packages/core/src/intakeResolver.ts'
import { startIntakeReview } from './intake-review-server.mjs'
import {
  parseEditionCreditEvidence,
  reviewEditionCredits,
} from '../packages/core/src/editionCredits.ts'
import { loadLocalEnvironment } from '../packages/series-source-trial/src/env.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hash = (x) => createHash('sha256').update(x).digest('hex')
const exact = (v, ks) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === ks.length &&
  ks.every((k) => Object.hasOwn(v, k))
const safeUrl = (s) => {
  try {
    const u = new URL(s)
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      !['openlibrary.org', 'hardcover.app', 'api.hardcover.app'].includes(u.hostname)
    )
  } catch {
    return false
  }
}
const at = '2026-10-16T00:00:00Z'
const key = (t) =>
  t.title && t.contributors?.length
    ? JSON.stringify([
        t.title?.normalize('NFKC').toLowerCase(),
        t.contributors?.map((x) => x.normalize('NFKC').toLowerCase()).sort(),
      ])
    : null

export function validateShadowFrame(frame, developmentTargets = []) {
  if (
    !exact(frame, ['version', 'purpose', 'selection', 'cases']) ||
    frame.version !== 1 ||
    frame.purpose !== 'independent_shadow_pilot' ||
    typeof frame.selection !== 'string' ||
    !frame.selection.trim() ||
    frame.selection.length > 3000 ||
    !Array.isArray(frame.cases) ||
    !frame.cases.length ||
    frame.cases.length > 20
  )
    throw new Error('Invalid shadow frame')
  const ids = new Set(),
    development = new Set(developmentTargets.map(key).filter(Boolean))
  for (const c of frame.cases) {
    if (
      !exact(c, [
        'id',
        'target',
        'expectedIdentity',
        'reference',
        ...(c.reviewedEvidence === undefined ? [] : ['reviewedEvidence']),
      ]) ||
      !/^case-\d{2}$/.test(c.id) ||
      ids.has(c.id) ||
      typeof c.expectedIdentity !== 'boolean' ||
      !exact(c.reference, [
        'url',
        'checkedAt',
        'facts',
        'identity',
        ...(c.reference?.credits === undefined ? [] : ['credits']),
      ]) ||
      !safeUrl(c.reference.url) ||
      !/^\d{4}-\d\d-\d\d$/.test(c.reference.checkedAt) ||
      !exact(c.reference.facts, ['pages', 'format']) ||
      !normalizeIsbn(c.target?.isbn) ||
      normalizeIsbn(c.reference.identity?.isbn) !== normalizeIsbn(c.target.isbn) ||
      !c.reference.identity?.title ||
      !c.reference.identity?.contributors?.length ||
      development.has(key(c.reference.identity)) ||
      development.has(key(c.target)) ||
      developmentTargets.some(
        (t) => t.isbn && normalizeIsbn(t.isbn) === normalizeIsbn(c.target.isbn),
      )
    )
      throw new Error('Invalid or overlapping shadow case')
    if (c.reviewedEvidence !== undefined) parseEditionCreditEvidence(c.reviewedEvidence)
    parseIntakeEvidence({
      version: 1,
      targetFingerprint: 'a'.repeat(64),
      asOf: at,
      target: c.target,
      existing: c.reference.facts,
      observations: [],
    })
    if (c.reference.credits !== undefined)
      parseIntakeEvidence({
        version: 1,
        targetFingerprint: 'a'.repeat(64),
        asOf: at,
        target: c.reference.identity,
        existing: { contributors: c.reference.credits },
        observations: [],
      })
    parseIntakeEvidence({
      version: 1,
      targetFingerprint: 'a'.repeat(64),
      asOf: at,
      target: c.reference.identity,
      existing: {},
      observations: [],
    })
    ids.add(c.id)
  }
  return structuredClone(frame)
}

/** Receives target only. Reference values, expected decisions and source URLs never reach acquisition. */
export async function resolveShadowTarget(target, client, now = () => new Date().toISOString()) {
  const targetFingerprint = hash(JSON.stringify({ target, existing: {} }))
  const base = parseIntakeEvidence({
    version: 1,
    targetFingerprint,
    asOf: now(),
    target,
    existing: {},
    observations: [],
  })
  const acquired = await client.acquire(target.isbn, targetFingerprint)
  // A malformed provider record cannot erase a valid peer or abort an already consumed frame.
  // Keep the failure visible; do not salvage malformed identity/facts or persist exception text.
  const checked = Object.fromEntries(
    ['openlibrary', 'hardcover'].map((provider) => {
      const candidate = acquired?.[provider]
      try {
        if (
          !candidate ||
          !Array.isArray(candidate.observations) ||
          candidate.observations.length !== 1 ||
          !Array.isArray(candidate.issues) ||
          !candidate.issues.every((v) => typeof v === 'string' && /^[a-z_]+$/.test(v))
        )
          throw new Error('Invalid adapter result')
        const parsed = parseIntakeEvidence({ ...base, observations: candidate.observations })
        if (
          parsed.observations.some(
            (o) => o.source.provider !== provider || !o.id.startsWith(`${provider}:`),
          )
        )
          throw new Error('Invalid adapter provenance')
        return [provider, { ...candidate, observations: parsed.observations }]
      } catch {
        return [
          provider,
          {
            observations: [
              intakeSourceObservation(
                provider,
                { targetFingerprint, retrievedAt: base.asOf },
                'failed',
              ),
            ],
            issues: ['invalid_adapter_observation'],
          },
        ]
      }
    }),
  )
  const request = parseIntakeEvidence({
    ...base,
    asOf: now(),
    observations: Object.values(checked).flatMap((a) => a.observations),
  })
  const result = resolveIntakeEvidence(request)
  return {
    request,
    result,
    issues: Object.fromEntries(Object.entries(checked).map(([p, a]) => [p, a.issues])),
  }
}

/** No provider titles, credits, facts or raw payloads are retained. Scores are not source evidence. */
export function scoreShadowCase(c, observed) {
  const { request, result, issues } = observed
  // Separately labelled manual-source policy validation. This is not automatic acquisition or
  // independent extraction accuracy; no reference answer or provider payload grants approval.
  const manual =
    c.reviewedEvidence === undefined
      ? null
      : reviewEditionCredits(
          c.reviewedEvidence,
          {
            title: c.target.title ?? '',
            authors: c.target.contributors ?? [],
            isbn: c.target.isbn,
            format: c.target.format,
            language: c.target.language,
          },
          [],
          request.asOf,
        )
  const manualCredits = manual?.decisions.filter((d) => d.eligible).map((d) => d.credit) ?? []
  const sources = ['openlibrary', 'hardcover'].map((provider) => {
    const os = request.observations.filter((o) => o.source.provider === provider)
    const good = os.filter((o) => o.status === 'ok')
    const matches = good.filter((o) => !intakeIdentityReviewReasons(request, o).length)
    const referenceRequest = { ...request, target: c.reference.identity }
    const wrongReference = matches.some(
      (o) => intakeIdentityReviewReasons(referenceRequest, o).length > 0,
    )
    const facts = ['pages', 'format'].map((field) => {
      const values = matches
        .filter((o) => !intakeIdentityReviewReasons(referenceRequest, o).length)
        .flatMap((o) => o.claims.filter((x) => x.field === field).map((x) => x.value))
      return {
        field,
        state: !c.expectedIdentity
          ? 'not_applicable'
          : !values.length
            ? 'missing'
            : values.every((v) => v === c.reference.facts[field])
              ? 'agrees'
              : 'disagrees',
      }
    })
    return {
      provider,
      statuses: os.map((o) => o.status),
      issues: issues[provider],
      identity: !good.length ? 'unobserved' : matches.length ? 'matched' : 'held',
      falseIdentityMatch: (!c.expectedIdentity && !!matches.length) || wrongReference,
      diagnostics: intakeReviewDiagnostics({ ...request, observations: os }),
      referenceIdentityDiagnostics: good.map((o) => intakeIdentityDiagnostics(referenceRequest, o)),
      creditChecks:
        !c.expectedIdentity || !c.reference.credits
          ? []
          : c.reference.credits.map((credit) => {
              const matching = matches.filter(
                (o) => !intakeIdentityReviewReasons(referenceRequest, o).length,
              )
              if (!matching.length) return 'identity_withheld'
              return compareIntakeCredits(
                [credit],
                matching.flatMap((o) => o.identity.contributors),
              )[0]
            }),
      facts,
    }
  })
  return {
    id: c.id,
    expectedIdentity: c.expectedIdentity,
    workState: result.work.state,
    editionState: result.edition.state,
    proposedFields: result.fields.filter((f) => f.state === 'proposed').map((f) => f.field),
    heldFields: result.fields.filter((f) => f.state === 'review').map((f) => f.field),
    sources,
    ...(manual
      ? {
          manualReview: {
            eligibleCredits: manualCredits.length,
            decisions: manual.decisions.map(({ position, eligible, reasons }) => ({
              position,
              eligible,
              reasons,
            })),
            falseIdentityEligibility: !c.expectedIdentity && manualCredits.length > 0,
            referenceCreditChecks:
              c.expectedIdentity && c.reference.credits
                ? compareIntakeCredits(c.reference.credits, manualCredits)
                : [],
          },
        }
      : {}),
  }
}

export async function evaluateShadow(frame, client, onReview) {
  const cases = []
  for (const c of frame.cases) {
    const observed = await resolveShadowTarget(c.target, client)
    cases.push(scoreShadowCase(c, observed))
    // Reference answers never enter the resolver or the review view.
    onReview?.({ id: c.id, review: buildIntakeReview(observed.request) })
  }
  const sources = ['openlibrary', 'hardcover'].map((provider) => {
    const pairs = cases.map((c) => ({ c, s: c.sources.find((s) => s.provider === provider) }))
    return {
      provider,
      cases: pairs.length,
      positiveCases: pairs.filter(({ c }) => c.expectedIdentity).length,
      matchedPositive: pairs.filter(
        ({ c, s }) => c.expectedIdentity && s.identity === 'matched' && !s.falseIdentityMatch,
      ).length,
      falseIdentityMatches: pairs.filter(({ s }) => s.falseIdentityMatch).length,
      heldNegative: pairs.filter(({ c, s }) => !c.expectedIdentity && s.identity === 'held').length,
      unobserved: pairs.filter(({ s }) => s.identity === 'unobserved').length,
      credits: Object.fromEntries(
        [
          'edition_observed',
          'scope_unverified',
          'unknown_role',
          'role_or_part_conflict',
          'missing',
          'identity_withheld',
        ].map((state) => [
          state,
          pairs.flatMap(({ s }) => s.creditChecks).filter((s) => s === state).length,
        ]),
      ),
      fields: Object.fromEntries(
        ['agrees', 'disagrees', 'missing'].map((state) => [
          state,
          pairs.flatMap(({ s }) => s.facts).filter((f) => f.state === state).length,
        ]),
      ),
    }
  })
  return {
    version: 1,
    mode: 'review_only',
    basis: 'independent_shadow_pilot',
    summary: {
      cases: cases.length,
      distinctIsbns: new Set(frame.cases.map((c) => normalizeIsbn(c.target.isbn))).size,
      workResolved: cases.filter((c) => c.workState === 'resolved').length,
      editionResolved: cases.filter((c) => c.editionState === 'resolved').length,
      proposedFields: cases.reduce((n, c) => n + c.proposedFields.length, 0),
      falseIdentityMatches: sources.reduce((n, s) => n + s.falseIdentityMatches, 0),
      sources,
      writes: 0,
      modelCalls: 0,
      cutoverReady: false,
    },
    transport: client.stats,
    cases,
  }
}

async function boundedJson(path) {
  if ((await stat(path)).size > 1024 * 1024) throw new Error('Input exceeds 1 MiB')
  return JSON.parse(await readFile(path, 'utf8'))
}
async function systemFingerprint() {
  // Include imported core and edge pure helpers, trial helpers, scripts and dependency lock.
  const files = []
  async function walk(dir) {
    for (const e of await readdir(join(root, dir), { withFileTypes: true })) {
      const p = `${dir}/${e.name}`
      if (e.isDirectory()) await walk(p)
      else if (/\.(tsx?|mjs|json|sql)$/.test(e.name)) files.push(p)
    }
  }
  for (const dir of [
    'packages/core/src',
    'supabase/functions/enrich',
    'supabase/functions/_shared',
    'packages/series-source-trial/src',
    'apps/web/src/components/catalog',
    'apps/web/src/data',
    'supabase/migrations',
  ])
    await walk(dir)
  files.push(
    'scripts/intake-shadow.mjs',
    'scripts/intake-source-client.mjs',
    'scripts/intake-review-server.mjs',
    'pnpm-lock.yaml',
    'package.json',
  )
  const h = createHash('sha256')
  for (const p of files.sort()) {
    h.update(p + '\0')
    h.update(await readFile(join(root, p)))
    h.update('\0')
  }
  return h.digest('hex')
}
async function writePrivate(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
}

/** Shared across worktrees; consumed even if a run is interrupted. Never clear for a rerun. */
export async function claimShadowAttempt(common, lock) {
  if (!/^[a-f0-9]{64}$/.test(lock.frameHash) || !/^[a-f0-9]{64}$/.test(lock.systemHash))
    throw new Error('Invalid attempt lock')
  await writePrivate(join(common, 'intake-shadow-attempts', lock.frameHash + '.json'), {
    status: 'started',
    frameHash: lock.frameHash,
    systemHash: lock.systemHash,
    at: new Date().toISOString(),
  })
}

export async function shadowCommand(args) {
  const [command, framePath, lockPath, extra] = args
  if (!['freeze', 'run', 'run-review'].includes(command) || args.length !== 4)
    throw new Error(
      'Usage: intake:shadow freeze frame.json lock.json prior-replay.json | run[-review] frame.json lock.json output.json',
    )
  if ((await stat(framePath)).size > 1024 * 1024) throw new Error('Input exceeds 1 MiB')
  const frameBytes = await readFile(framePath)
  const frame = await boundedJson(framePath)
  const frameHash = hash(frameBytes),
    systemHash = await systemFingerprint()
  if (command === 'freeze') {
    const previous = await boundedJson(extra)
    if (!Array.isArray(previous.cases) || previous.cases.some((c) => !c.request?.target))
      throw new Error('Invalid prior replay exclusion manifest')
    const synthetic = await boundedJson(join(root, 'scripts/fixtures/intake-evidence.json'))
    validateShadowFrame(
      frame,
      [...previous.cases, ...synthetic.cases].map((c) => c.request.target),
    )
    const lock = {
      version: 1,
      frameHash,
      systemHash,
      priorHash: hash(await readFile(extra)),
      createdAt: new Date().toISOString(),
      cases: frame.cases.length,
    }
    await writePrivate(lockPath, lock)
    return lock
  }
  validateShadowFrame(frame)
  const lock = await boundedJson(lockPath)
  if (
    !exact(lock, ['version', 'frameHash', 'systemHash', 'priorHash', 'createdAt', 'cases']) ||
    lock.version !== 1 ||
    lock.frameHash !== frameHash ||
    lock.systemHash !== systemHash ||
    lock.cases !== frame.cases.length
  )
    throw new Error('Shadow lock changed; acquisition refused')
  // Reserve output BEFORE consuming the attempt or contacting providers.
  await writePrivate(extra, { status: 'reserved', frameHash, systemHash })
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: root,
    encoding: 'utf8',
  }).trim()
  await claimShadowAttempt(common, lock)
  // Environment is optional. It may configure the existing Hardcover account, never the source policy.
  if (process.env.INTAKE_ENV_FILE) await loadLocalEnvironment(process.env.INTAKE_ENV_FILE)
  const reviews = []
  const report = await evaluateShadow(
    frame,
    createIntakeSourceClient({ hardcoverToken: process.env.HARDCOVER_TOKEN }),
    command === 'run-review' ? (r) => reviews.push(r) : undefined,
  )
  report.lock = lock
  await writeFile(extra, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
  if (command === 'run-review') {
    const viewer = await startIntakeReview(reviews)
    reviews.length = 0
    console.log(JSON.stringify({ reviewUrl: viewer.url, expiresInSeconds: 300 }))
    await viewer.closed
  }
  // The exclusive marker is permanent, including on interruption; no resume/reacquisition command.
  return report.summary
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    console.log(
      JSON.stringify(await shadowCommand(process.argv.slice(2).filter((x) => x !== '--'))),
    )
  } catch {
    console.error(
      'Shadow operation refused or incomplete; keep its lock and attempt marker, inspect private artifacts.',
    )
    process.exitCode = 1
  }
}
