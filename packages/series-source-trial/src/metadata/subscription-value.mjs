import { createHash } from 'node:crypto'
import {
  canonicalIsbn,
  cleanSupplementRecord,
  validateInput,
  exactIdentity,
} from './supplement.mjs'
import { validateBenchmark } from './benchmark.mjs'
import {
  VALUE_FIELDS,
  valueMetadata,
  normalizedPublisher,
  publicationDate,
  knownLanguage,
} from './value-fields.mjs'

const providers = ['google', 'openlibrary', 'isbndb']
const policies = ['free', 'selective', 'isbndb_first']
const keys = (v, allowed) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).every((k) => allowed.includes(k))
const count = (v, key) => {
  v[key] = (v[key] ?? 0) + 1
}
const tally = () => ({
  agrees: 0,
  differs: 0,
  unscored: 0,
  missing: 0,
  conflict: 0,
  notApplicable: 0,
  unparsed: 0,
  lessPrecise: 0,
  morePreciseUnverified: 0,
})
const finiteStatus = (s) =>
  [
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
  ].includes(s)
    ? s
    : 'unknown_status'

export function validateSubscriptionValue(input) {
  if (
    !keys(input, ['version', 'purpose', 'requiredFields', 'economics', 'cases']) ||
    input.version !== 1 ||
    input.purpose !== 'development-subscription-value' ||
    !Array.isArray(input.requiredFields) ||
    !input.requiredFields.length ||
    new Set(input.requiredFields).size !== input.requiredFields.length ||
    input.requiredFields.some((f) => !VALUE_FIELDS.includes(f)) ||
    !Array.isArray(input.cases) ||
    input.cases.length < 1 ||
    input.cases.length > 20 ||
    !keys(input.economics, [
      'monthlySubscriptionUsd',
      'monthlyDistinctWorks',
      'maxUsdPerAdditionalWork',
    ]) ||
    Object.values(input.economics).some(
      (v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1000000),
    )
  )
    throw new Error('invalid_value_frame')
  const projected = input.cases.map((c) => {
    if (
      !keys(c, ['workGroup', 'identity', 'reference']) ||
      typeof c.workGroup !== 'string' ||
      !/^[a-z0-9_-]{1,80}$/.test(c.workGroup) ||
      !keys(c.reference, [...VALUE_FIELDS, 'source', 'reviewedOn']) ||
      (c.reference.publisher != null && !normalizedPublisher(c.reference.publisher)) ||
      (c.reference.publicationDate != null && !publicationDate(c.reference.publicationDate)) ||
      (c.reference.language != null && knownLanguage(c.reference.language) !== c.reference.language)
    )
      throw new Error('invalid_value_case')
    return {
      identity: c.identity,
      current: {},
      reference: {
        pages: c.reference.pages,
        editionFormat: c.reference.editionFormat,
        source: c.reference.source,
        reviewedOn: c.reference.reviewedOn,
      },
    }
  })
  validateBenchmark({ version: 1, purpose: 'development-edition-benchmark', cases: projected })
  return input
}

function baseline(result, identity, source) {
  if (result?.status !== 'matched') return { status: finiteStatus(result?.status) }
  try {
    validateInput({
      version: 1,
      purpose: 'development',
      cases: [{ identity, current: {}, baseline: [result.record] }],
    })
    if (result.record.source !== source || !exactIdentity(result.record, identity))
      return { status: 'identity_review' }
    const m = result.metadata ?? {}
    return {
      status: 'matched',
      fields: {
        pages: result.record.pages ?? null,
        editionFormat: result.record.editionFormat ?? null,
        publisher: normalizedPublisher(m.publisher),
        publicationDate: publicationDate(m.publicationDate),
        language: knownLanguage(m.language),
      },
      availability: Object.fromEntries(
        ['cover', 'description', 'relatedEditions'].map((f) => [f, m.availability?.[f] === true]),
      ),
      unparsedFields:
        Array.isArray(m.unparsedFields) && m.unparsedFields.includes('publicationDate')
          ? ['publicationDate']
          : [],
    }
  } catch {
    return { status: 'identity_review' }
  }
}

function join(records, required) {
  const admitted = records.filter((r) => r.status === 'matched')
  const formats = [...new Set(admitted.map((r) => r.fields.editionFormat).filter((v) => v != null))]
  return {
    matched: admitted.length > 0,
    fields: Object.fromEntries(
      required.map((f) => {
        if (f === 'pages' && formats.length > 1) return [f, { state: 'conflict' }]
        if (f === 'pages' && formats[0] === 'audiobook') return [f, { state: 'notApplicable' }]
        const values = [...new Set(admitted.map((r) => r.fields[f]).filter((v) => v != null))]
        if (!values.length && admitted.some((r) => r.unparsedFields?.includes(f)))
          return [f, { state: 'unparsed' }]
        if (f === 'publicationDate' && values.length > 1) {
          const longest = [...values].sort((a, b) => b.length - a.length)[0]
          if (values.every((v) => longest === v || longest.startsWith(`${v}-`)))
            return [f, { state: 'value', value: longest }]
        }
        return [
          f,
          values.length > 1
            ? { state: 'conflict' }
            : values.length
              ? { state: 'value', value: values[0] }
              : { state: 'missing' },
        ]
      }),
    ),
  }
}
const complete = (packet) =>
  packet.matched &&
  Object.values(packet.fields).every((f) => ['value', 'notApplicable'].includes(f.state))
function grade(packet, reference) {
  return Object.fromEntries(
    Object.entries(packet.fields).map(([f, observation]) => {
      if (observation.state !== 'value') return [f, observation.state]
      const expected = f === 'publisher' ? normalizedPublisher(reference[f]) : reference[f]
      // Compatible partial dates are neither exact agreement nor proven errors.
      if (f === 'publicationDate' && expected != null && observation.value !== expected) {
        if (expected.startsWith(`${observation.value}-`)) return [f, 'lessPrecise']
        if (observation.value.startsWith(`${expected}-`)) return [f, 'morePreciseUnverified']
      }
      return [
        f,
        expected == null ? 'unscored' : observation.value === expected ? 'agrees' : 'differs',
      ]
    }),
  )
}

/** Fetch once per provider; compare truth-blind policies in memory, not three live replays. */
export async function runSubscriptionValue(
  input,
  { live = false, baselineClient, isbndbClient, now = Date.now } = {},
) {
  validateSubscriptionValue(input)
  const summary = {
    version: 1,
    experiment: 'subscription_value',
    mode: live ? 'live' : 'dry_run',
    cases: input.cases.length,
    distinctWorks: new Set(input.cases.map((c) => c.workGroup)).size,
    frameSha256: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
    requiredFields: [...input.requiredFields],
    referenceCoverage: Object.fromEntries(
      input.requiredFields.map((f) => [
        f,
        {
          reviewed: input.cases.filter((c) => c.reference[f] != null).length,
          unknown: input.cases.filter((c) => c.reference[f] == null).length,
        },
      ]),
    ),
    identityLanguageContextCases: input.cases.filter((c) => c.identity.language != null).length,
    providers: Object.fromEntries(
      providers.map((p) => [
        p,
        {
          outcomes: {},
          fields: Object.fromEntries(input.requiredFields.map((f) => [f, tally()])),
          availabilityOnly: { cover: 0, description: 0, relatedEditions: 0 },
        },
      ]),
    ),
    policies: Object.fromEntries(
      policies.map((p) => [
        p,
        {
          matchedEditions: 0,
          fields: Object.fromEntries(input.requiredFields.map((f) => [f, tally()])),
          modeledProviderLookups: { google: 0, openlibrary: 0, isbndb: 0 },
          additionalCorrectWorks: 0,
          regressedWorks: 0,
          wrongValueWorks: 0,
        },
      ]),
    ),
    independentIsbndbMatchesWithoutFreeMatch: 0,
    independentIsbndbMatchesDuringFreeOutage: 0,
    independentIsbndbMatchesAfterCompletedFreeMiss: 0,
    observedAcquisitionMs: { baseline: 0, isbndb: 0 },
    economicScenarios: {},
    decision: 'not_qualified',
    reasons: [
      'small_development_cohort',
      'source_use_rights_unverified',
      'review_time_not_measured',
    ],
    transport: null,
    productionWrites: 0,
    modelCalls: 0,
    retention: 'aggregate_only',
  }
  if (!live) return summary
  const groups = Object.fromEntries(policies.map((p) => [p, new Map()]))
  for (const c of input.cases) {
    let start = now()
    const acquired = await baselineClient.acquire(structuredClone(c.identity))
    summary.observedAcquisitionMs.baseline += Math.max(0, now() - start)
    // ISBNdb does not depend on the baseline's success or any reference metadata.
    start = now()
    const response = await isbndbClient.lookup(canonicalIsbn(c.identity.isbn))
    summary.observedAcquisitionMs.isbndb += Math.max(0, now() - start)
    let paid = { status: finiteStatus(response?.status) }
    if (response?.status === 'ok') {
      const admitted = cleanSupplementRecord(c.identity, undefined, response.body)
      if (admitted.status === 'matched') {
        const { availability, unparsedFields, ...metadata } = valueMetadata(
          'isbndb',
          response.body.book,
        )
        paid = {
          status: 'matched',
          fields: { ...admitted.values, ...metadata },
          availability,
          unparsedFields,
        }
      } else paid = { status: 'review' }
    }
    const records = {
      google: baseline(acquired?.google, c.identity, 'google'),
      openlibrary: baseline(acquired?.openlibrary, c.identity, 'openlibrary'),
      isbndb: paid,
    }
    for (const p of providers) {
      const s = summary.providers[p],
        r = records[p]
      count(s.outcomes, r.status)
      for (const [f, state] of Object.entries(grade(join([r], input.requiredFields), c.reference)))
        s.fields[f][state]++
      if (r.status === 'matched')
        for (const f of Object.keys(s.availabilityOnly))
          if (r.availability[f]) s.availabilityOnly[f]++
    }
    const free = join([records.google, records.openlibrary], input.requiredFields)
    const paidOnly = join([paid], input.requiredFields)
    const combined = join(Object.values(records), input.requiredFields)
    if (paidOnly.matched && !free.matched) {
      summary.independentIsbndbMatchesWithoutFreeMatch++
      const completed = ['not_found', 'no_exact_isbn', 'identity_review', 'edition_review']
      if ([records.google, records.openlibrary].every((r) => completed.includes(r.status)))
        summary.independentIsbndbMatchesAfterCompletedFreeMiss++
      else summary.independentIsbndbMatchesDuringFreeOutage++
    }
    const packets = {
      free,
      selective: complete(free) ? free : combined,
      isbndb_first: complete(paidOnly) ? paidOnly : combined,
    }
    const baselineGrades = grade(free, c.reference)
    for (const p of policies) {
      const s = summary.policies[p],
        packet = packets[p]
      s.matchedEditions += Number(packet.matched)
      const useFree = p !== 'isbndb_first' || !complete(paidOnly)
      s.modeledProviderLookups.google += Number(useFree)
      s.modeledProviderLookups.openlibrary += Number(useFree)
      s.modeledProviderLookups.isbndb += Number(
        p === 'isbndb_first' || (p === 'selective' && !complete(free)),
      )
      const grades = grade(packet, c.reference)
      for (const [f, state] of Object.entries(grades)) s.fields[f][state]++
      const work = groups[p].get(c.workGroup) ?? {
        improved: false,
        regressed: false,
        wrong: false,
        unscored: false,
      }
      work.improved ||= input.requiredFields.some(
        (f) => grades[f] === 'agrees' && !['agrees', 'unparsed'].includes(baselineGrades[f]),
      )
      work.regressed ||= input.requiredFields.some(
        (f) => baselineGrades[f] === 'agrees' && grades[f] !== 'agrees',
      )
      work.wrong ||= Object.values(grades).includes('differs')
      work.unscored ||= Object.values(grades).some((s) =>
        ['unscored', 'unparsed', 'lessPrecise', 'morePreciseUnverified'].includes(s),
      )
      groups[p].set(c.workGroup, work)
    }
  }
  for (const p of policies) {
    const s = summary.policies[p]
    for (const work of groups[p].values()) {
      s.additionalCorrectWorks += Number(
        work.improved && !work.regressed && !work.wrong && !work.unscored,
      )
      s.regressedWorks += Number(work.regressed)
      s.wrongValueWorks += Number(work.wrong)
    }
    if (p === 'free') continue
    const rate = s.additionalCorrectWorks / summary.distinctWorks
    const e = input.economics
    const expected = e.monthlyDistinctWorks != null ? e.monthlyDistinctWorks * rate : null
    const cost =
      expected > 0 && e.monthlySubscriptionUsd != null ? e.monthlySubscriptionUsd / expected : null
    summary.economicScenarios[p] = {
      observedAdditionalWorkRate: rate,
      assumedMonthlyDistinctWorks: e.monthlyDistinctWorks ?? null,
      monthlySubscriptionUsd: e.monthlySubscriptionUsd ?? null,
      projectedAdditionalWorks: expected,
      projectedUsdPerAdditionalWork: cost,
      configuredMaxUsdPerAdditionalWork: e.maxUsdPerAdditionalWork ?? null,
      meetsConfiguredCostOnly:
        cost != null && e.maxUsdPerAdditionalWork != null
          ? cost <= e.maxUsdPerAdditionalWork
          : null,
      extrapolationOnly: true,
    }
  }
  // Client stats are reduced to finite aggregate fields, never arbitrary error/provider data.
  summary.transport = Object.fromEntries(
    providers.map((p) => {
      const stats = p === 'isbndb' ? isbndbClient.stats : baselineClient.stats[p]
      return [
        p,
        {
          requests:
            Number.isInteger(stats?.requests) && stats.requests >= 0 ? stats.requests : null,
          stopped:
            stats?.stopped == null
              ? null
              : ['budget', 'infrastructure_failures'].includes(stats.stopped)
                ? stats.stopped
                : finiteStatus(stats.stopped),
        },
      ]
    }),
  )
  return summary
}
