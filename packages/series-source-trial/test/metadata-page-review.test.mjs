import test from 'node:test'
import assert from 'node:assert/strict'
import { buildMetadataReviewPacket } from '../src/metadata/review-packet.mjs'
import { runMetadataPageReview, validatePageReview } from '../src/metadata/page-review.mjs'
import { runMetadataBenchmark } from '../src/metadata/benchmark.mjs'
import { main } from '../src/benchmark-metadata.mjs'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const identity = {
  isbn: '9780316565202',
  title: 'Synthetic edition',
  authors: ['Ada Example'],
  language: 'en',
}
const matched = (source, patch = {}) => ({
  status: 'matched',
  record: {
    source,
    isbns: [identity.isbn],
    title: identity.title,
    authors: [...identity.authors],
    pages: 301,
    editionFormat: null,
    ...patch,
  },
})
const acquired = () => ({ google: matched('google'), openlibrary: { status: 'not_found' } })
const response = (patch = {}) => ({
  status: 'ok',
  body: {
    book: {
      isbn13: identity.isbn,
      title: identity.title,
      authors: [...identity.authors],
      pages: 401,
      binding: 'Paperback',
      language: 'English',
      ...patch,
    },
  },
})
const frame = (patch = {}) => ({
  version: 1,
  purpose: 'development-page-review',
  cases: [
    {
      identity: structuredClone(identity),
      current: {},
      reference: {
        pages: 401,
        editionFormat: 'paperback',
        source: 'https://publisher.example/exact-edition',
        reviewedOn: '2026-09-08',
      },
      ...patch,
    },
  ],
})
const packet = (observations = acquired(), reply = response(), current = {}) =>
  buildMetadataReviewPacket({ identity, current }, observations, reply)
async function run(
  input = frame(),
  observations = acquired(),
  reply = response(),
  runner = runMetadataPageReview,
) {
  const calls = []
  const result = await runner(input, {
    live: true,
    baselineClient: {
      stats: { google: {}, openlibrary: {} },
      acquire: async (value) => {
        calls.push(value)
        return observations
      },
    },
    isbndbClient: {
      stats: {},
      lookup: async (value) => {
        calls.push(value)
        return reply
      },
    },
  })
  return { result, calls }
}

test('page conflict preserves independent format fill and protects current pages', () => {
  const p = packet(acquired(), response(), { pages: 501 })
  assert.equal(p.fields.pages.state, 'conflict')
  assert.equal(p.fields.pages.proposedFill, null)
  assert.deepEqual(p.fields.pages.current, { value: 501, protected: true })
  assert.equal(p.fields.editionFormat.proposedFill.value, 'paperback')
  assert.equal(p.fields.editionFormat.state, 'single_source')
  assert.equal(p.automatic, false)
  assert.ok(Object.values(p.fields).every((f) => f.automatic === false))
})

test('separate comparison path looks up complete baselines without changing gap-only routing', async () => {
  const observations = {
    google: matched('google', { editionFormat: 'paperback' }),
    openlibrary: { status: 'not_found' },
  }
  const review = await run(frame(), observations)
  assert.equal(review.result.plans.lookup, 1)
  assert.equal(review.calls.length, 2)
  const gap = await run(
    { ...frame(), purpose: 'development-edition-benchmark' },
    observations,
    response(),
    runMetadataBenchmark,
  )
  assert.equal(gap.calls.length, 1)
})

test('paired page scoring distinguishes which observation agrees without selecting a winner', async () => {
  for (const [base, supplement, expected] of [
    [401, 401, 'both_agree'],
    [401, 301, 'baseline_only_agrees'],
    [301, 401, 'isbndb_only_agrees'],
    [301, 501, 'neither_agrees'],
  ]) {
    const observations = {
      google: matched('google', { pages: base }),
      openlibrary: matched('openlibrary', { pages: base }),
    }
    const { result } = await run(frame(), observations, response({ pages: supplement }))
    assert.deepEqual(result.pairedPages.google, { [expected]: 1 })
    assert.deepEqual(result.pairedPages.openlibrary, { [expected]: 1 })
    assert.equal(result.proposals.pages.available, 0)
    assert.equal(result.proposals.editionFormat.agrees, 1)
  }
})

test('null truth is unscored and truth changes cannot affect routing or admitted observations', async () => {
  const input = frame()
  const first = await run(input)
  input.cases[0].reference.pages = null
  input.cases[0].reference.editionFormat = null
  const second = await run(input)
  assert.deepEqual(first.calls, [identity, identity.isbn])
  assert.deepEqual(first.calls, second.calls)
  assert.deepEqual(first.result.plans, second.result.plans)
  assert.deepEqual(first.result.fieldStates, second.result.fieldStates)
  assert.deepEqual(first.result.supplementOutcomes, second.result.supplementOutcomes)
  assert.deepEqual(second.result.pairedPages.google, { unscored: 1 })
  assert.equal(second.result.observations.isbndb.pages.unscored, 1)
  assert.equal(second.result.proposals.editionFormat.unscored, 1)
})

test('incomplete, ambiguous, forged, missing, and audio baselines never trigger paid page review', async () => {
  const cases = [
    [{ ...acquired(), google: { status: 'server_error' } }, {}, 'baseline_unavailable'],
    [{ ...acquired(), openlibrary: { status: 'incomplete_authors' } }, {}, 'baseline_unavailable'],
    [{ ...acquired(), unknown: { status: 'matched' } }, {}, 'baseline_unavailable'],
    [
      { google: matched('openlibrary'), openlibrary: { status: 'not_found' } },
      {},
      'baseline_review',
    ],
    [{ ...acquired(), google: matched('google', { title: 'Wrong title' }) }, {}, 'baseline_review'],
    [{ ...acquired(), openlibrary: { status: 'identity_review' } }, {}, 'baseline_review'],
    [
      { google: { status: 'not_found' }, openlibrary: { status: 'not_found' } },
      {},
      'identity_review',
    ],
    [{ ...acquired(), google: matched('google', { pages: null }) }, {}, 'no_page_observation'],
    [acquired(), { editionFormat: 'audiobook' }, 'audio_control'],
    [
      {
        google: matched('google', { editionFormat: 'paperback' }),
        openlibrary: matched('openlibrary', { editionFormat: 'hardcover' }),
      },
      {},
      'edition_review',
    ],
  ]
  for (const [observations, current, decision] of cases) {
    const { result, calls } = await run(frame({ current }), observations)
    assert.equal(calls.length, 1, decision)
    assert.equal(result.plans[decision], 1)
    assert.equal(result.observations.isbndb.pages.available, 0)
  }
})

test('strict ISBNdb identity, long title, language and binding guards apply before either field is admitted', () => {
  for (const patch of [
    { isbn13: '9780306406157' },
    { title: 'Wrong title' },
    { authors: ['A. Example'] },
    { title_long: 'Synthetic edition: another edition' },
    { language: 'French' },
    { binding: 'unrecognized' },
  ]) {
    const p = packet(acquired(), response(patch))
    assert.equal(p.supplement.status, 'review')
    for (const f of Object.values(p.fields)) {
      assert.equal(f.proposedFill, null)
      assert.ok(f.observations.every((o) => o.source !== 'isbndb'))
    }
  }
  assert.equal(
    packet(acquired(), response(), { editionFormat: 'hardcover' }).supplement.reason,
    'edition_format_review',
  )
})

test('late audio binding cannot turn a Google print page observation into a scored page claim', async () => {
  const { result } = await run(frame(), acquired(), response({ binding: 'Audiobook' }))
  assert.equal(result.fieldStates.pages.not_applicable, 1)
  assert.equal(result.observations.google.pages.available, 0)
  assert.deepEqual(result.pairedPages.google, {})
})

test('agreement is descriptive and current fields remain protected, not proposed replacements', () => {
  const p = packet(
    {
      google: matched('google', { editionFormat: 'paperback' }),
      openlibrary: matched('openlibrary', { editionFormat: 'paperback' }),
    },
    response({ pages: 301 }),
    { pages: 301, editionFormat: 'paperback' },
  )
  for (const f of Object.values(p.fields)) {
    assert.equal(f.state, 'source_agreement')
    assert.equal(f.current.protected, true)
    assert.equal(f.proposedFill, null)
    assert.equal(f.automatic, false)
  }
})

test('review packets omit raw prose and fail accidental JSON export; aggregate output omits case data', async () => {
  const reply = response({
    synopsis: 'PRIVATE RAW TEXT',
    image: 'https://secret.example/cover',
    unexpected: 'PRIVATE EXTRA',
  })
  const p = packet(acquired(), reply)
  assert.throws(() => JSON.stringify(p), /memory_only/)
  assert.equal(JSON.stringify({ ...p }).includes('PRIVATE'), false)
  assert.deepEqual(Object.keys(p.supplement), ['status'])
  const { result } = await run(frame(), acquired(), reply)
  const serialized = JSON.stringify(result)
  for (const value of [
    identity.isbn,
    identity.title,
    identity.authors[0],
    'publisher.example',
    'PRIVATE',
    '401',
    'paperback',
  ])
    // The hash is not a provider value; test the report's remaining fields for numeric value leakage.
    assert.equal(JSON.stringify({ ...result, frameSha256: null }).includes(value), false)
  assert.equal(result.productionWrites, 0)
  assert.equal(result.modelCalls, 0)
  assert.ok(serialized.length > 0)
})

test('untrusted statuses and reasons cannot leak into aggregate keys', async () => {
  const { result } = await run(frame(), acquired(), { status: 'PRIVATE_STATUS' })
  assert.deepEqual(result.supplementReasons, { unknown_status: 1 })
  const blocked = await run(frame(), {
    ...acquired(),
    google: { status: 'identity_review', reason: 'PRIVATE_REASON' },
  })
  assert.deepEqual(blocked.result.baselineReviewReasons.google, { unspecified_reason: 1 })
  assert.equal(JSON.stringify(blocked).includes('PRIVATE_REASON'), false)
  assert.equal(packet(acquired(), null).supplement.reason, 'unknown_status')
  const missing = await run(frame(), null)
  assert.equal(missing.calls.length, 1)
  assert.equal(missing.result.plans.baseline_unavailable, 1)
})

test('review construction does not mutate provider data, current fields, or input identities', async () => {
  const input = frame(),
    observations = acquired(),
    reply = response()
  const before = structuredClone({ input, observations, reply })
  await run(input, observations, reply)
  assert.deepEqual({ input, observations, reply }, before)
  const p = packet(observations, reply)
  p.identity.authors[0] = 'Changed'
  assert.equal(identity.authors[0], 'Ada Example')
})

test('a distinct purpose prevents completed gap benchmark inputs from silently entering paid page review', () => {
  assert.throws(() => validatePageReview({ ...frame(), purpose: 'development-edition-benchmark' }))
  assert.throws(() => validatePageReview({ ...frame(), unexpected: true }))
  assert.equal(validatePageReview(frame()).purpose, 'development-page-review')
})

test('dry run uses no clients and the separate CLI loads no credentials', async () => {
  const result = await runMetadataPageReview(frame(), {
    baselineClient: {
      acquire() {
        throw Error('network')
      },
    },
  })
  assert.equal(result.mode, 'dry_run')
  assert.deepEqual(result.plans, {})
  const dir = await mkdtemp(join(tmpdir(), 'metadata-page-review-'))
  try {
    const inputPath = join(dir, 'frame.json')
    await writeFile(inputPath, JSON.stringify(frame()))
    const output = []
    await main(
      ['--input', inputPath, '--env', join(dir, 'missing.env')],
      (v) => output.push(v),
      'page-review',
    )
    assert.equal(JSON.parse(output[0]).experiment, 'page_review')
    await main(['--help'], (v) => assert.match(v, /^metadata:review /), 'page-review')
    await assert.rejects(main(['--input', inputPath], () => {}, 'gap'))
    await assert.rejects(main([], () => {}, 'unknown'))
  } finally {
    await rm(dir, { recursive: true })
  }
})
