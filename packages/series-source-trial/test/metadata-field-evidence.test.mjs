import test from 'node:test'
import assert from 'node:assert/strict'
import { describeBaselineFields, baselineReasonCode } from '../src/metadata/field-evidence.mjs'
import { selectGoogleBaseline, createBaselineClient } from '../src/metadata/baseline-client.mjs'
import { runMetadataBenchmark } from '../src/metadata/benchmark.mjs'

const identity = {
  isbn: '9780316565202',
  title: 'Synthetic edition',
  authors: ['Ada Example'],
  language: 'en',
}
const record = (source, patch = {}) => ({
  source,
  isbns: [identity.isbn],
  title: identity.title,
  authors: identity.authors,
  pages: 300,
  editionFormat: null,
  ...patch,
})
const matched = (source, patch) => ({ status: 'matched', record: record(source, patch) })
const acquired = () => ({
  google: matched('google'),
  openlibrary: matched('openlibrary', { editionFormat: 'paperback' }),
})
const describe = (observations = acquired(), current = {}) =>
  describeBaselineFields({ identity, current }, observations)
const volume = (patch = {}) => ({
  totalItems: 1,
  items: [
    {
      volumeInfo: {
        title: identity.title,
        authors: identity.authors,
        industryIdentifiers: [{ type: 'ISBN_13', identifier: identity.isbn }],
        ...patch,
      },
    },
  ],
})
const json = (v) => new Response(JSON.stringify(v))

test('field agreement is descriptive, format stays single-source, and no values are emitted', () => {
  const result = describe()
  assert.deepEqual(result.pages, {
    state: 'source_agreement',
    sources: ['google', 'openlibrary'],
    currentProtected: false,
    automatic: false,
  })
  assert.equal(result.editionFormat.state, 'single_source')
  assert.equal(result.editionFormat.automatic, false)
  for (const privateValue of [identity.isbn, identity.title, 'Ada Example', '300', 'paperback'])
    assert.equal(JSON.stringify(result).includes(privateValue), false)
})

test('existing fields are protected, never count as a source, and inputs remain unchanged', () => {
  const observations = { google: matched('google'), openlibrary: { status: 'not_found' } }
  const current = { pages: 300, editionFormat: 'paperback' }
  const before = structuredClone({ observations, current })
  const result = describe(observations, current)
  assert.equal(result.pages.state, 'single_source')
  assert.equal(result.editionFormat.state, 'source_missing')
  assert.equal(result.pages.currentProtected, true)
  assert.equal(result.editionFormat.currentProtected, true)
  assert.deepEqual({ observations, current }, before)
  assert.equal(describe(observations, { pages: 400 }).pages.state, 'conflict')
})

test('page conflicts and format conflicts remain distinct, including equal page counts', () => {
  const observations = acquired()
  observations.google.record.pages = 400
  assert.equal(describe(observations).pages.state, 'conflict')
  assert.equal(describe(observations).editionFormat.state, 'single_source')
  const result = describe(acquired(), { editionFormat: 'hardcover' })
  assert.equal(result.pages.state, 'edition_conflict')
  assert.equal(result.editionFormat.state, 'conflict')
})

test('audio pages are not applicable without deleting existing values', () => {
  const observations = {
    google: matched('google'),
    openlibrary: matched('openlibrary', { editionFormat: 'audiobook', pages: null }),
  }
  const result = describe(observations, { pages: 12 })
  assert.equal(result.pages.state, 'not_applicable')
  assert.equal(result.pages.currentProtected, true)
  assert.equal(result.pages.automatic, false)
})

test('unavailable, unresolved, review, and missing field observations are not interchangeable', () => {
  for (const status of ['server_error', 'incomplete_authors', 'missing_key', 'invented']) {
    const result = describe(
      { google: { status }, openlibrary: matched('openlibrary') },
      { pages: 300 },
    )
    assert.equal(result.pages.state, 'unavailable')
    assert.deepEqual(result.pages.sources, [])
    assert.equal(result.pages.currentProtected, true)
  }
  assert.equal(
    describe({ google: { status: 'not_found' }, openlibrary: { status: 'no_exact_isbn' } }).pages
      .state,
    'identity_unresolved',
  )
  assert.equal(
    describe({ google: { status: 'identity_review' }, openlibrary: matched('openlibrary') }).pages
      .state,
    'identity_review',
  )
  assert.equal(
    describe({ google: matched('google', { pages: null }), openlibrary: { status: 'not_found' } })
      .pages.state,
    'source_missing',
  )
})

test('unknown providers and forged matched identities cannot manufacture agreement', () => {
  assert.equal(describe({ ...acquired(), unknown: matched('google') }).pages.state, 'unavailable')
  assert.equal(describe({ google: matched('google') }).pages.state, 'unavailable')
  for (const patch of [
    { source: 'google' },
    { title: 'Other title' },
    { authors: ['A. Example'] },
    { pages: '300' },
  ]) {
    const observations = acquired()
    Object.assign(observations.openlibrary.record, patch)
    assert.equal(describe(observations).pages.state, 'identity_review')
    assert.deepEqual(describe(observations).pages.sources, [])
  }
})

test('Google emits finite first-guard reasons without relaxing full identity', () => {
  assert.deepEqual(
    selectGoogleBaseline(volume({ title: 123, subtitle: 'Edition' }), {
      ...identity,
      title: '123: Edition',
    }),
    { status: 'identity_review', reason: 'malformed_record' },
  )
  for (const [patch, reason] of [
    [{ title: 'Other' }, 'title_mismatch'],
    [{ authors: ['A. Example'] }, 'contributors_mismatch'],
    [{ language: 'es' }, 'language_mismatch'],
    [{ subtitle: {} }, 'malformed_subtitle'],
    [{ title: 123, subtitle: 'Edition' }, 'malformed_record'],
    [
      {
        industryIdentifiers: [
          ...volume().items[0].volumeInfo.industryIdentifiers,
          { type: 'ISBN_10', identifier: 'invalid' },
        ],
      },
      'invalid_isbn',
    ],
    [
      {
        industryIdentifiers: [
          ...volume().items[0].volumeInfo.industryIdentifiers,
          { type: 'ISBN_13', identifier: '9781250890313' },
        ],
      },
      'isbn_mismatch',
    ],
  ])
    assert.deepEqual(selectGoogleBaseline(volume(patch), identity), {
      status: 'identity_review',
      reason,
    })
  assert.equal(
    selectGoogleBaseline({ totalItems: 2, items: [...volume().items, ...volume().items] }, identity)
      .reason,
    'ambiguous_records',
  )
  assert.equal(baselineReasonCode('https://secret.example/raw-provider-text'), 'unspecified_reason')
})

test('Open Library diagnostics separate author, binding, language and identity failures', async () => {
  for (const [patch, authorResponse, reason] of [
    [{ authors: [] }, null, 'missing_contributors'],
    [{ authors: Array(9).fill({ key: '/authors/OL1A' }) }, null, 'too_many_contributors'],
    [{ authors: [{ key: 'https://untrusted.example' }] }, null, 'invalid_author_reference'],
    [{}, new Response('', { status: 503 }), 'author_lookup_unavailable'],
    [{}, json({ name: 'Ada Example', key: '/authors/OL2A' }), 'author_record_mismatch'],
    [{ physical_format: 'Unmapped' }, null, 'unknown_binding'],
    [{ languages: [{ key: 'invalid' }] }, null, 'malformed_language'],
    [{ title: 'Other title' }, null, 'title_mismatch'],
  ]) {
    const client = createBaselineClient({
      sleeper: async () => {},
      fetcher: async (url) =>
        url.includes('/authors/')
          ? (authorResponse ?? json({ name: 'Ada Example' }))
          : json({
              title: identity.title,
              isbn_13: [identity.isbn],
              authors: [{ key: '/authors/OL1A' }],
              ...patch,
            }),
    })
    assert.equal((await client.acquire(identity)).openlibrary.reason, reason)
  }
})

const benchmarkInput = () => ({
  version: 1,
  purpose: 'development-edition-benchmark',
  cases: [
    {
      identity,
      current: {},
      reference: {
        pages: 300,
        editionFormat: 'paperback',
        source: 'https://publisher.example/edition',
        reviewedOn: '2026-09-08',
      },
    },
  ],
})
const run = (input, observations) =>
  runMetadataBenchmark(input, {
    live: true,
    baselineClient: {
      stats: { google: {}, openlibrary: {} },
      acquire: async (target) => {
        assert.deepEqual(target, identity)
        return observations
      },
    },
    isbndbClient: {
      stats: {},
      lookup: () => {
        throw new Error('unexpected_paid_call')
      },
    },
  })

test('aggregate evidence ignores reference truth, preserves paid gates and excludes case data', async () => {
  const first = await run(benchmarkInput(), acquired())
  const alternate = benchmarkInput()
  alternate.cases[0].reference.pages = 999
  const second = await run(alternate, acquired())
  assert.equal(first.version, 2)
  assert.deepEqual(first.fieldEvidence, {
    pages: { source_agreement: 1 },
    editionFormat: { single_source: 1 },
  })
  assert.deepEqual(first.fieldEvidence, second.fieldEvidence)
  assert.deepEqual(first.plans, { skip: 1 })
  assert.deepEqual(first.plans, second.plans)
  assert.notDeepEqual(first.baselineFields, second.baselineFields)
  for (const value of [identity.isbn, identity.title, 'Ada Example', 'https://publisher.example'])
    assert.equal(JSON.stringify(first).includes(value), false)
})

test('only finite review reasons enter aggregates and reviews never trigger paid lookup', async () => {
  const observations = {
    google: { status: 'identity_review', reason: 'title_mismatch' },
    openlibrary: { status: 'identity_review', reason: 'raw-secret-and-provider-payload' },
  }
  const result = await run(benchmarkInput(), observations)
  assert.deepEqual(result.baselineReviewReasons, {
    google: { title_mismatch: 1 },
    openlibrary: { unspecified_reason: 1 },
  })
  assert.deepEqual(result.plans, { baseline_review: 1 })
  assert.equal(JSON.stringify(result).includes('raw-secret'), false)
})
