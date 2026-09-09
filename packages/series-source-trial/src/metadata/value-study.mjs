import { createHash } from 'node:crypto'
import { mkdir, open, readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalIsbn } from './supplement.mjs'
import { runSubscriptionValue, validateSubscriptionValue } from './subscription-value.mjs'

const providers = ['google', 'openlibrary', 'isbndb']
const policies = ['free', 'selective', 'isbndb_first']
const statuses = new Set([
  'matched',
  'review',
  'identity_review',
  'edition_review',
  'incomplete_authors',
  'not_found',
  'no_exact_isbn',
  'not_attempted',
  'missing_key',
  'authentication',
  'authentication_or_access',
  'rate_limited',
  'server_error',
  'redirect_refused',
  'http_error',
  'invalid_json',
  'timeout',
  'response_too_large',
  'network_error',
  'invalid_shape',
  'unknown_status',
])
const fail = () => {
  throw new Error('invalid_value_study')
}
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const keys = (v, names) =>
  v && typeof v === 'object' && !Array.isArray(v) && equal(Object.keys(v).sort(), [...names].sort())
const count = (v, max) => Number.isSafeInteger(v) && v >= 0 && v <= max
const canonical = (v) =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v
export const studyHash = (v) =>
  createHash('sha256')
    .update(JSON.stringify(canonical(v)))
    .digest('hex')
const rawHash = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
const hashPattern = /^[a-f0-9]{64}$/
const textKey = (v) => v.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()

/** Reviewed grouping is authoritative; exact title/full-author duplicates cannot use two groups. */
export function partitionValueStudy(input) {
  if (
    !keys(input, ['version', 'purpose', 'requiredFields', 'economics', 'cases']) ||
    !Array.isArray(input.cases) ||
    input.cases.length < 1 ||
    input.cases.length > 200
  )
    fail()
  const frame = canonical(structuredClone(input))
  const groups = new Map(),
    isbns = new Set(),
    identities = new Map()
  for (const c of frame.cases) {
    validateSubscriptionValue({ ...frame, cases: [c] })
    const isbn = canonicalIsbn(c.identity.isbn)
    if (isbns.has(isbn)) fail()
    isbns.add(isbn)
    const identity = JSON.stringify([
      textKey(c.identity.title),
      c.identity.authors.map(textKey).sort(),
    ])
    if (identities.has(identity) && identities.get(identity) !== c.workGroup) fail()
    identities.set(identity, c.workGroup)
    const group = groups.get(c.workGroup) ?? []
    group.push(c)
    groups.set(c.workGroup, group)
  }
  const cohorts = []
  let cases = []
  for (const name of [...groups.keys()].sort()) {
    const group = groups
      .get(name)
      .sort((a, b) => canonicalIsbn(a.identity.isbn).localeCompare(canonicalIsbn(b.identity.isbn)))
    if (group.length > 20) fail()
    if (cases.length + group.length > 20) {
      cohorts.push({ ...frame, cases })
      cases = []
    }
    cases.push(...group)
  }
  if (cases.length) cohorts.push({ ...frame, cases })
  return cohorts
}

export function createValueStudyLock(input, systemSha256, maxOpenLibraryRequests = 80) {
  if (
    !hashPattern.test(systemSha256) ||
    !count(maxOpenLibraryRequests, 200) ||
    !maxOpenLibraryRequests
  )
    fail()
  const cohorts = partitionValueStudy(input)
  const frame = { ...cohorts[0], cases: cohorts.flatMap((c) => c.cases) }
  const body = {
    version: 1,
    experiment: 'subscription_value_study',
    systemSha256,
    identityFrameSha256: studyHash(frame.cases.map((c) => canonicalIsbn(c.identity.isbn)).sort()),
    frameSha256: studyHash(frame),
    requiredFields: frame.requiredFields,
    economics: frame.economics,
    cases: frame.cases.length,
    distinctWorks: new Set(frame.cases.map((c) => c.workGroup)).size,
    cohorts: cohorts.map((c, index) => ({
      index: index + 1,
      frameSha256: rawHash(c),
      cases: c.cases.length,
      distinctWorks: new Set(c.cases.map((v) => v.workGroup)).size,
      budgets: {
        google: c.cases.length,
        openlibrary: maxOpenLibraryRequests,
        isbndb: c.cases.length,
      },
    })),
  }
  return { ...body, sha256: studyHash(body) }
}

export function verifyValueStudyLock(input, lock, systemSha256) {
  const expected = createValueStudyLock(
    input,
    systemSha256,
    lock?.cohorts?.[0]?.budgets?.openlibrary,
  )
  if (!equal(canonical(expected), canonical(lock))) fail()
  return partitionValueStudy(input)
}

function economics(policy, distinctWorks, e) {
  const rate = policy.additionalCorrectWorks / distinctWorks
  const expected = e.monthlyDistinctWorks != null ? e.monthlyDistinctWorks * rate : null
  const cost =
    expected > 0 && e.monthlySubscriptionUsd != null ? e.monthlySubscriptionUsd / expected : null
  return {
    observedAdditionalWorkRate: rate,
    assumedMonthlyDistinctWorks: e.monthlyDistinctWorks ?? null,
    monthlySubscriptionUsd: e.monthlySubscriptionUsd ?? null,
    projectedAdditionalWorks: expected,
    projectedUsdPerAdditionalWork: cost,
    configuredMaxUsdPerAdditionalWork: e.maxUsdPerAdditionalWork ?? null,
    meetsConfiguredCostOnly:
      cost != null && e.maxUsdPerAdditionalWork != null ? cost <= e.maxUsdPerAdditionalWork : null,
    extrapolationOnly: true,
  }
}

/** Validate every retained property before combining. Unknown strings/keys are never forwarded. */
async function validateSummary(summary, cohort, descriptor, e) {
  const template = await runSubscriptionValue(cohort)
  const n = descriptor.cases,
    w = descriptor.distinctWorks
  if (!keys(summary, Object.keys(template)) || summary.mode !== 'live') fail()
  for (const key of [
    'version',
    'experiment',
    'cases',
    'distinctWorks',
    'frameSha256',
    'requiredFields',
    'referenceCoverage',
    'identityLanguageContextCases',
    'decision',
    'reasons',
    'productionWrites',
    'modelCalls',
    'retention',
  ]) {
    if (!equal(summary[key], template[key])) fail()
  }
  const fields = (actual, expected) => {
    if (!keys(actual, Object.keys(expected))) fail()
    for (const f of Object.keys(expected)) {
      if (
        !keys(actual[f], Object.keys(expected[f])) ||
        Object.values(actual[f]).some((v) => !count(v, n)) ||
        Object.values(actual[f]).reduce((a, b) => a + b, 0) !== n
      )
        fail()
    }
  }
  if (!keys(summary.providers, providers) || !keys(summary.policies, policies)) fail()
  for (const p of providers) {
    const s = summary.providers[p],
      t = template.providers[p]
    if (
      !keys(s, Object.keys(t)) ||
      !s.outcomes ||
      typeof s.outcomes !== 'object' ||
      Array.isArray(s.outcomes) ||
      Object.entries(s.outcomes).some(([k, v]) => !statuses.has(k) || !count(v, n)) ||
      Object.values(s.outcomes).reduce((a, b) => a + b, 0) !== n ||
      !keys(s.availabilityOnly, Object.keys(t.availabilityOnly)) ||
      Object.values(s.availabilityOnly).some((v) => !count(v, s.outcomes.matched ?? 0))
    )
      fail()
    fields(s.fields, t.fields)
  }
  for (const p of policies) {
    const s = summary.policies[p],
      t = template.policies[p]
    if (
      !keys(s, Object.keys(t)) ||
      !count(s.matchedEditions, n) ||
      !keys(s.modeledProviderLookups, providers) ||
      Object.values(s.modeledProviderLookups).some((v) => !count(v, n)) ||
      ['additionalCorrectWorks', 'regressedWorks', 'wrongValueWorks'].some(
        (k) => !count(s[k], w),
      ) ||
      s.additionalCorrectWorks + s.regressedWorks > w ||
      s.additionalCorrectWorks + s.wrongValueWorks > w
    )
      fail()
    if (
      p === 'free' &&
      (s.additionalCorrectWorks !== 0 ||
        s.regressedWorks !== 0 ||
        s.modeledProviderLookups.isbndb !== 0)
    )
      fail()
    fields(s.fields, t.fields)
  }
  for (const k of [
    'independentIsbndbMatchesWithoutFreeMatch',
    'independentIsbndbMatchesDuringFreeOutage',
    'independentIsbndbMatchesAfterCompletedFreeMiss',
  ])
    if (!count(summary[k], n)) fail()
  if (
    summary.independentIsbndbMatchesWithoutFreeMatch !==
    summary.independentIsbndbMatchesDuringFreeOutage +
      summary.independentIsbndbMatchesAfterCompletedFreeMiss
  )
    fail()
  if (
    !keys(summary.observedAcquisitionMs, ['baseline', 'isbndb']) ||
    Object.values(summary.observedAcquisitionMs).some(
      (v) => !Number.isFinite(v) || v < 0 || v > 86400000,
    )
  )
    fail()
  if (!keys(summary.transport, providers)) fail()
  for (const p of providers) {
    const t = summary.transport[p]
    if (
      !keys(t, ['requests', 'stopped']) ||
      !count(t.requests, descriptor.budgets[p]) ||
      (t.stopped !== null &&
        !statuses.has(t.stopped) &&
        !['budget', 'infrastructure_failures'].includes(t.stopped))
    )
      fail()
  }
  const expectedEconomics = Object.fromEntries(
    ['selective', 'isbndb_first'].map((p) => [p, economics(summary.policies[p], w, e)]),
  )
  if (!equal(canonical(summary.economicScenarios), canonical(expectedEconomics))) fail()
}

const addTree = (a, b) => {
  for (const [k, v] of Object.entries(b)) {
    if (typeof v === 'number') a[k] = (a[k] ?? 0) + v
    else addTree((a[k] ??= {}), v)
  }
}

/** Only a complete, unique set of lock-bound envelopes is eligible for cost projection. */
export async function mergeValueStudy(input, lock, systemSha256, results) {
  const cohorts = verifyValueStudyLock(input, lock, systemSha256)
  if (!Array.isArray(results) || results.length !== cohorts.length) fail()
  const seen = new Set(),
    byIndex = new Map()
  for (const r of results) {
    if (
      !keys(r, ['version', 'lockSha256', 'cohortIndex', 'status', 'summary']) ||
      r.version !== 1 ||
      r.lockSha256 !== lock.sha256 ||
      r.status !== 'completed' ||
      !count(r.cohortIndex, cohorts.length) ||
      r.cohortIndex === 0 ||
      seen.has(r.cohortIndex)
    )
      fail()
    seen.add(r.cohortIndex)
    const i = r.cohortIndex - 1
    await validateSummary(r.summary, cohorts[i], lock.cohorts[i], lock.economics)
    byIndex.set(r.cohortIndex, r.summary)
  }
  const aggregate = {
    version: 1,
    experiment: 'subscription_value_study',
    lockSha256: lock.sha256,
    frameSha256: lock.frameSha256,
    systemSha256: lock.systemSha256,
    mode: 'complete',
    cohorts: cohorts.length,
    cases: lock.cases,
    distinctWorks: lock.distinctWorks,
    requiredFields: lock.requiredFields,
    referenceCoverage: {},
    providers: {},
    policies: {},
    identityLanguageContextCases: 0,
    independentIsbndbMatchesWithoutFreeMatch: 0,
    independentIsbndbMatchesDuringFreeOutage: 0,
    independentIsbndbMatchesAfterCompletedFreeMiss: 0,
    observedAcquisitionMs: {},
    transport: Object.fromEntries(providers.map((p) => [p, { requests: 0, stoppedCohorts: {} }])),
    economicScenarios: {},
    decision: 'not_qualified',
    reasons: [
      'development_sample_not_production_qualification',
      'source_use_rights_unverified',
      'review_time_not_measured',
    ],
    productionWrites: 0,
    modelCalls: 0,
    retention: 'aggregate_only',
  }
  for (const s of byIndex.values()) {
    for (const k of ['referenceCoverage', 'providers', 'policies', 'observedAcquisitionMs'])
      addTree(aggregate[k], s[k])
    for (const k of [
      'identityLanguageContextCases',
      'independentIsbndbMatchesWithoutFreeMatch',
      'independentIsbndbMatchesDuringFreeOutage',
      'independentIsbndbMatchesAfterCompletedFreeMiss',
    ])
      aggregate[k] += s[k]
    for (const p of providers) {
      aggregate.transport[p].requests += s.transport[p].requests
      const stop = s.transport[p].stopped
      if (stop)
        aggregate.transport[p].stoppedCohorts[stop] =
          (aggregate.transport[p].stoppedCohorts[stop] ?? 0) + 1
    }
  }
  for (const p of ['selective', 'isbndb_first'])
    aggregate.economicScenarios[p] = economics(
      aggregate.policies[p],
      lock.distinctWorks,
      lock.economics,
    )
  return aggregate
}

export async function readStudyJson(path) {
  const handle = await open(path, 'r')
  try {
    if (!(await handle.stat()).isFile()) fail()
    const bytes = Buffer.alloc(2097153)
    let size = 0
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, null)
      if (!bytesRead) break
      size += bytesRead
    }
    if (size > 2097152) fail()
    return JSON.parse(bytes.subarray(0, size).toString('utf8'))
  } finally {
    await handle.close()
  }
}

/** State root is the repository common Git directory in the CLI, shared across its worktrees. */
export async function runValueStudyCohort({
  input,
  lock,
  systemSha256,
  index,
  stateRoot,
  acquire,
}) {
  const cohorts = verifyValueStudyLock(input, lock, systemSha256)
  if (
    lock.distinctWorks < 100 ||
    !count(index, cohorts.length) ||
    index === 0 ||
    input.cases.some((c) =>
      /(^|\.)(example|test|invalid|localhost)$/.test(new URL(c.reference.source).hostname),
    )
  )
    fail()
  const dir = join(stateRoot, lock.sha256)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const active = join(stateRoot, 'active')
  // Global to this repository, not just one cohort: separate clients must not multiply request rate.
  await writeFile(active, JSON.stringify({ lockSha256: lock.sha256, cohortIndex: index }), {
    flag: 'wx',
    mode: 0o600,
  })
  try {
    // Repricing, relabelling or a runtime change cannot buy another attempt on the same ISBN set.
    const owner = join(stateRoot, `frame-${lock.identityFrameSha256}.json`)
    try {
      await writeFile(owner, JSON.stringify({ lockSha256: lock.sha256 }), {
        flag: 'wx',
        mode: 0o600,
      })
    } catch (error) {
      if (error.code !== 'EEXIST' || (await readStudyJson(owner)).lockSha256 !== lock.sha256) fail()
    }
    const prefix = join(dir, `cohort-${index}`)
    await writeFile(
      `${prefix}.started`,
      JSON.stringify({ lockSha256: lock.sha256, cohortIndex: index }),
      { flag: 'wx', mode: 0o600 },
    )
    const resultFile = await open(`${prefix}.json`, 'wx', 0o600)
    try {
      await resultFile.writeFile(JSON.stringify({ status: 'incomplete' }))
      await resultFile.sync()
      let envelope
      try {
        const summary = await acquire(
          structuredClone(cohorts[index - 1]),
          lock.cohorts[index - 1].budgets,
        )
        await validateSummary(summary, cohorts[index - 1], lock.cohorts[index - 1], lock.economics)
        envelope = {
          version: 1,
          lockSha256: lock.sha256,
          cohortIndex: index,
          status: 'completed',
          summary,
        }
      } catch {
        envelope = {
          version: 1,
          lockSha256: lock.sha256,
          cohortIndex: index,
          status: 'failed',
          reason: 'cohort_execution_failed',
        }
      }
      const encoded = JSON.stringify(envelope)
      await resultFile.truncate(0)
      await resultFile.write(encoded, 0, 'utf8')
      await resultFile.sync()
      return envelope
    } finally {
      await resultFile.close()
    }
  } finally {
    await unlink(active)
  }
}

export async function studyProgress(lock, stateRoot) {
  const results = [],
    missing = [],
    failed = []
  for (const c of lock.cohorts) {
    try {
      const r = await readStudyJson(join(stateRoot, lock.sha256, `cohort-${c.index}.json`))
      if (r.status !== 'completed') failed.push(c.index)
      else results.push(r)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      // A started marker without a result remains a failed/interrupted attempt, never a retry.
      try {
        await readFile(join(stateRoot, lock.sha256, `cohort-${c.index}.started`))
        failed.push(c.index)
      } catch (markerError) {
        if (markerError.code !== 'ENOENT') throw markerError
        missing.push(c.index)
      }
    }
  }
  return { results, missing, failed }
}
