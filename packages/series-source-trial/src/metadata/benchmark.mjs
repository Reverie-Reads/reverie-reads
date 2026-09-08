import { createHash } from 'node:crypto'
import { validateInput, planSupplement, assessSupplement } from './supplement.mjs'

const fields = ['pages', 'editionFormat']
const keys = (v, allowed) =>
  v !== null &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => allowed.includes(k))
const complete = new Set([
  'matched',
  'not_found',
  'no_exact_isbn',
  'identity_review',
  'edition_review',
])
const count = (v, k) => {
  v[k] = (v[k] ?? 0) + 1
}
const tally = () => ({ available: 0, agrees: 0, differs: 0, unscored: 0 })
const score = (into, value, reference) => {
  if (value == null) return
  into.available++
  into[reference == null ? 'unscored' : value === reference ? 'agrees' : 'differs']++
}

export function validateBenchmark(input) {
  if (
    !keys(input, ['version', 'purpose', 'cases']) ||
    input.version !== 1 ||
    input.purpose !== 'development-edition-benchmark' ||
    !Array.isArray(input.cases)
  )
    throw new Error('invalid_benchmark')
  const projected = input.cases.map((c) => {
    if (
      !keys(c, ['identity', 'current', 'reference']) ||
      !keys(c.reference, ['pages', 'editionFormat', 'source', 'reviewedOn'])
    )
      throw new Error('invalid_reference')
    const url = new URL(c.reference.source)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.reference.reviewedOn ?? '')
    )
      throw new Error('invalid_reference')
    if (
      [
        'isbndb.com',
        'google.com',
        'googleapis.com',
        'openlibrary.org',
        'hardcover.app',
        'wikidata.org',
        'inventaire.io',
        'exa.ai',
        'parallel.ai',
      ].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
    )
      throw new Error('circular_reference')
    // Reuse field/identity validators without allowing truth or caller-supplied provider labels into acquisition.
    validateInput({
      version: 1,
      purpose: 'development',
      cases: [
        {
          identity: c.identity,
          current: { pages: c.reference.pages, editionFormat: c.reference.editionFormat },
          baseline: [],
        },
      ],
    })
    return { identity: c.identity, current: c.current, baseline: [] }
  })
  validateInput({ version: 1, purpose: 'development', cases: projected })
  return input
}

/** Both provider attempts must complete; network failure is never a free metadata gap. */
export async function runMetadataBenchmark(
  input,
  { live = false, baselineClient, isbndbClient } = {},
) {
  validateBenchmark(input)
  const summary = {
    version: 1,
    mode: live ? 'live' : 'dry_run',
    frameSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    cases: input.cases.length,
    baselineOutcomes: { google: {}, openlibrary: {} },
    baselineFields: Object.fromEntries(
      ['google', 'openlibrary'].map((p) => [
        p,
        Object.fromEntries(fields.map((f) => [f, tally()])),
      ]),
    ),
    completeBaselineCases: 0,
    plans: {},
    supplementOutcomes: {},
    supplementReasons: {},
    candidates: Object.fromEntries(fields.map((f) => [f, tally()])),
    conflicts: { pages: 0, editionFormat: 0 },
    transport: null,
    productionWrites: 0,
    modelCalls: 0,
    retention: 'aggregate_only',
  }
  if (!live) return summary
  for (const c of input.cases) {
    const acquired = await baselineClient.acquire(structuredClone(c.identity))
    const baseline = []
    for (const provider of ['google', 'openlibrary']) {
      const result = acquired[provider]
      count(summary.baselineOutcomes[provider], result.status)
      if (result.status === 'matched') {
        baseline.push(result.record)
        for (const f of fields)
          score(summary.baselineFields[provider][f], result.record[f], c.reference[f])
      }
    }
    if (!Object.values(acquired).every((r) => complete.has(r.status))) {
      count(summary.plans, 'baseline_unavailable')
      continue
    }
    summary.completeBaselineCases++
    if (
      Object.values(acquired).some((r) => ['identity_review', 'edition_review'].includes(r.status))
    ) {
      count(summary.plans, 'baseline_review')
      continue
    }
    const target = { identity: c.identity, current: c.current, baseline }
    const plan = planSupplement(target)
    count(summary.plans, plan.status)
    for (const f of fields) if (plan.fields[f] === 'baseline_conflict') summary.conflicts[f]++
    if (plan.status !== 'lookup') continue
    const response = await isbndbClient.lookup(c.identity.isbn)
    if (response.status !== 'ok') {
      count(summary.supplementOutcomes, response.status)
      continue
    }
    const assessment = assessSupplement(target, plan, response.body)
    count(summary.supplementOutcomes, assessment.status)
    if (assessment.reason) count(summary.supplementReasons, assessment.reason)
    for (const proposal of assessment.proposals)
      score(summary.candidates[proposal.field], proposal.value, c.reference[proposal.field])
    for (const f of assessment.conflicts)
      if (plan.fields[f] !== 'baseline_conflict') summary.conflicts[f]++
  }
  summary.transport = {
    google: structuredClone(baselineClient.stats.google),
    openlibrary: structuredClone(baselineClient.stats.openlibrary),
    isbndb: structuredClone(isbndbClient.stats),
  }
  return summary
}
