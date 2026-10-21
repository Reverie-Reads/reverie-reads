import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const workFields = ['description', 'pages', 'publication', 'publisher', 'language', 'cover']
const editionFields = ['pages', 'publication', 'publisher', 'language', 'format']
const identityReasons = [
  'missing_title',
  'missing_creator',
  'invalid_isbn',
  'isbn_conflict',
  'duplicate_identity',
  'unresolved_isbn_report',
]
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/
const object = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k))
const count = (v) => Number.isSafeInteger(v) && v >= 0
const fail = () => {
  throw new Error('Invalid scoped inventory; only the bibliography-free projection is accepted')
}
const tally = (values) =>
  values.reduce((out, value) => {
    out[value] = (out[value] ?? 0) + 1
    return out
  }, {})

/** Aggregate only. Missing scalars do not select editions or establish evidence quality. */
export function summarizeScopedInventory(rows) {
  if (!Array.isArray(rows) || rows.length > 100000) fail()
  const workIds = new Set()
  const editionIds = new Set()
  for (const row of rows) {
    if (
      !object(row, [
        'id',
        'fingerprint',
        'reader_linked',
        'work_fields',
        'identity_state',
        'identity_reasons',
        'contributor_state',
        'saved_review_state',
        'review_current',
        'series_state',
        'editions',
      ]) ||
      !uuid.test(row.id) ||
      workIds.has(row.id) ||
      !/^[a-f0-9]{32}$/.test(row.fingerprint) ||
      typeof row.reader_linked !== 'boolean' ||
      typeof row.review_current !== 'boolean' ||
      !object(row.work_fields, workFields) ||
      Object.values(row.work_fields).some((v) => !['present', 'missing'].includes(v)) ||
      !['unknown', 'review_required'].includes(row.identity_state) ||
      !Array.isArray(row.identity_reasons) ||
      new Set(row.identity_reasons).size !== row.identity_reasons.length ||
      row.identity_reasons.some((v) => !identityReasons.includes(v)) ||
      (row.identity_state === 'review_required') !== row.identity_reasons.length > 0 ||
      !['missing', 'review_required', 'structured_unverified', 'not_observed'].includes(
        row.contributor_state,
      ) ||
      !['open', 'reviewed', 'deferred'].includes(row.saved_review_state) ||
      !['found', 'review', 'unknown', 'no_series', 'unresolved'].includes(row.series_state) ||
      !Array.isArray(row.editions) ||
      row.editions.length > 10000
    )
      fail()
    workIds.add(row.id)
    for (const edition of row.editions) {
      if (
        !object(edition, [
          'id',
          'reviewed',
          'fields',
          'credit_state',
          'credit_count',
          'held_credit_count',
        ]) ||
        !uuid.test(edition.id) ||
        editionIds.has(edition.id) ||
        typeof edition.reviewed !== 'boolean' ||
        !object(edition.fields, editionFields) ||
        editionFields.some(
          (field) =>
            !(
              field === 'pages'
                ? ['present', 'missing', 'unknown', 'not_applicable']
                : field === 'format'
                  ? ['present', 'unknown']
                  : ['present', 'missing']
            ).includes(edition.fields[field]),
        ) ||
        !['recorded', 'review_required', 'unknown', 'not_observed'].includes(edition.credit_state)
      )
        fail()
      const { credit_count: total, held_credit_count: held, credit_state: state } = edition
      if (
        state === 'not_observed'
          ? total !== null || held !== null
          : !count(total) ||
            !count(held) ||
            held > total ||
            (state === 'unknown' && (total !== 0 || held !== 0)) ||
            (state === 'recorded' && (total < 1 || held !== 0)) ||
            (state === 'review_required' && held < 1)
      )
        fail()
      editionIds.add(edition.id)
    }
  }
  const editions = rows.flatMap((row) => row.editions)
  return {
    version: 1,
    purpose: 'scoped_catalog_baseline',
    inventorySha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    productionWrites: 0,
    modelCalls: 0,
    works: rows.length,
    readerLinkedWorks: rows.filter((r) => r.reader_linked).length,
    readerLinkedWorkScalarPresence: Object.fromEntries(
      workFields.map((f) => [
        f,
        tally(rows.filter((r) => r.reader_linked).map((r) => r.work_fields[f])),
      ]),
    ),
    workScalarPresence: Object.fromEntries(
      workFields.map((f) => [f, tally(rows.map((r) => r.work_fields[f]))]),
    ),
    identityStates: tally(rows.map((r) => r.identity_state)),
    identityReasons: tally(rows.flatMap((r) => r.identity_reasons)),
    contributorStates: tally(rows.map((r) => r.contributor_state)),
    reviews: {
      states: tally(rows.map((r) => r.saved_review_state)),
      current: rows.filter((r) => r.review_current).length,
      staleOrAbsent: rows.filter((r) => !r.review_current).length,
      deferredStillHeld: rows.filter((r) => r.saved_review_state === 'deferred').length,
    },
    seriesStates: tally(rows.map((r) => r.series_state)),
    editions: {
      registered: editions.length,
      worksWithoutRegisteredEdition: rows.filter((r) => !r.editions.length).length,
      reviewedFlag: editions.filter((e) => e.reviewed).length,
      referenceOnly: editions.filter((e) =>
        Object.values(e.fields).every((state) => ['missing', 'unknown'].includes(state)),
      ).length,
      fields: Object.fromEntries(
        editionFields.map((f) => [f, tally(editions.map((e) => e.fields[f]))]),
      ),
      creditStates: tally(editions.map((e) => e.credit_state)),
      recordedCredits: editions.reduce((n, e) => n + (e.credit_count ?? 0), 0),
      heldCredits: editions.reduce((n, e) => n + (e.held_credit_count ?? 0), 0),
      creditStorageUnobserved: editions.filter((e) => e.credit_state === 'not_observed').length,
    },
    evidenceCoverage: {
      workFacts: 'unknown',
      editionFacts: 'unknown',
      coverUsage: 'unknown',
      meaning:
        'Presence and review flags are not per-field support, rights, or identity certification',
    },
  }
}

async function main(args) {
  if (args.length !== 2)
    throw new Error(
      'Usage: node scripts/corpus-scoped-inventory.mjs PRIVATE_INPUT.json PRIVATE_SUMMARY.json',
    )
  const [input, output] = args.map((p) => resolve(p))
  if (input === output) throw new Error('Input and output must be different files')
  const bytes = await readFile(input)
  if (bytes.length > 50 * 1024 * 1024) fail()
  const summary = summarizeScopedInventory(JSON.parse(bytes.toString('utf8')))
  await writeFile(output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  console.log(
    JSON.stringify({
      works: summary.works,
      editions: summary.editions.registered,
      productionWrites: 0,
      modelCalls: 0,
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(() => {
    console.error(
      'Scoped inventory failed. Check the input shape and use a new output path; no records were written to a database.',
    )
    process.exitCode = 1
  })
}
