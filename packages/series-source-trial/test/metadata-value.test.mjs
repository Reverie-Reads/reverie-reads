import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  validateSubscriptionValue,
  runSubscriptionValue,
} from '../src/metadata/subscription-value.mjs'
import { valueMetadata, publicationDate } from '../src/metadata/value-fields.mjs'
import { createBaselineClient, selectGoogleBaseline } from '../src/metadata/baseline-client.mjs'
import { main } from '../src/benchmark-metadata.mjs'

const fixtureUrl = new URL('../data/metadata-value.example.json', import.meta.url)
const fixture = () => readFile(fixtureUrl, 'utf8').then(JSON.parse)
const fields = {
  pages: 300,
  editionFormat: 'paperback',
  publisher: 'example press',
  publicationDate: '2026-02-28',
  language: 'en',
}
const record = (identity, source, overrides = {}) => ({
  status: 'matched',
  record: {
    source,
    isbns: [identity.isbn],
    title: identity.title,
    authors: identity.authors,
    pages: fields.pages,
    editionFormat: fields.editionFormat,
  },
  metadata: {
    ...fields,
    availability: { cover: true, description: false, relatedEditions: false },
  },
  ...overrides,
})
const response = (identity, patch = {}) => ({
  status: 'ok',
  body: {
    book: {
      isbn13: identity.isbn,
      title: identity.title,
      authors: identity.authors,
      pages: 300,
      binding: 'paperback',
      publisher: 'Example Press',
      date_published: '2026-02-28',
      language: 'English',
      ...patch,
    },
  },
})
async function run(input, getFree, getPaid) {
  const calls = []
  let current
  let tick = 0
  const result = await runSubscriptionValue(input, {
    live: true,
    now: () => ++tick,
    baselineClient: {
      stats: {
        google: { requests: input.cases.length },
        openlibrary: { requests: input.cases.length },
      },
      acquire: async (identity) => {
        assert.deepEqual(
          Object.keys(identity).sort(),
          Object.keys(input.cases[calls.length / 2].identity).sort(),
        )
        current = identity
        calls.push({ provider: 'free', identity })
        return getFree(identity)
      },
    },
    isbndbClient: {
      stats: { requests: input.cases.length },
      lookup: async (isbn) => {
        assert.equal(isbn, current.isbn)
        calls.push({ provider: 'isbndb', isbn })
        return getPaid(current)
      },
    },
  })
  return { result, calls }
}

test('dry run is aggregate-only and performs no acquisition', async () => {
  const input = await fixture()
  const result = await runSubscriptionValue(input)
  assert.equal(result.mode, 'dry_run')
  assert.equal(result.distinctWorks, 1)
  assert.equal(result.decision, 'not_qualified')
  const output = JSON.stringify(result)
  for (const value of [
    input.cases[0].identity.isbn,
    'Ada Example',
    'publisher.example',
    'synthetic-work',
  ])
    assert.ok(!output.includes(value))
})

test('ISBNdb independently matches when both free providers fail, without reference input', async () => {
  const input = await fixture()
  input.economics = {
    monthlySubscriptionUsd: 30,
    monthlyDistinctWorks: 100,
    maxUsdPerAdditionalWork: 0.5,
  }
  const { result, calls } = await run(
    input,
    () => ({ google: { status: 'identity_review' }, openlibrary: { status: 'server_error' } }),
    response,
  )
  assert.equal(calls.length, 2)
  assert.equal(result.independentIsbndbMatchesWithoutFreeMatch, 1)
  assert.equal(result.independentIsbndbMatchesDuringFreeOutage, 1)
  assert.equal(result.independentIsbndbMatchesAfterCompletedFreeMiss, 0)
  assert.equal(result.policies.selective.additionalCorrectWorks, 1)
  assert.equal(result.policies.isbndb_first.additionalCorrectWorks, 1)
  assert.equal(result.economicScenarios.selective.projectedUsdPerAdditionalWork, 0.3)
  assert.equal(result.economicScenarios.selective.meetsConfiguredCostOnly, true)
  assert.equal(result.decision, 'not_qualified')
  assert.ok(result.reasons.includes('review_time_not_measured'))
})

test('free completeness skips modeled selective lookup, but research acquires ISBNdb once', async () => {
  const input = await fixture()
  const { result, calls } = await run(
    input,
    (i) => ({ google: record(i, 'google'), openlibrary: { status: 'not_found' } }),
    response,
  )
  assert.equal(calls.length, 2)
  assert.equal(result.transport.isbndb.requests, 1)
  assert.equal(result.policies.selective.modeledProviderLookups.isbndb, 0)
  assert.equal(result.policies.isbndb_first.modeledProviderLookups.google, 0)
  assert.equal(result.policies.selective.additionalCorrectWorks, 0)
  assert.equal(result.economicScenarios.selective.projectedUsdPerAdditionalWork, null)
})

test('wrong complete ISBNdb-first output is counted, not silently favored by the reference', async () => {
  const input = await fixture()
  const { result } = await run(
    input,
    (i) => ({ google: record(i, 'google'), openlibrary: { status: 'not_found' } }),
    (i) => response(i, { pages: 999 }),
  )
  assert.equal(result.policies.isbndb_first.fields.pages.differs, 1)
  assert.equal(result.policies.isbndb_first.wrongValueWorks, 1)
  assert.equal(result.policies.isbndb_first.regressedWorks, 1)
  assert.equal(result.policies.isbndb_first.additionalCorrectWorks, 0)
  assert.equal(result.policies.selective.fields.pages.agrees, 1)
})

test('one provider review does not suppress the other admitted free record', async () => {
  const input = await fixture()
  const { result } = await run(
    input,
    (i) => ({ google: { status: 'identity_review' }, openlibrary: record(i, 'openlibrary') }),
    response,
  )
  assert.equal(result.policies.free.matchedEditions, 1)
  assert.equal(result.policies.free.fields.pages.agrees, 1)
  assert.equal(result.independentIsbndbMatchesWithoutFreeMatch, 0)
})

test('shared conflicts stay conflicts; a correct reference does not choose a winner', async () => {
  const input = await fixture()
  const { result } = await run(
    input,
    (i) => {
      const r = record(i, 'google')
      r.record.pages = 999
      r.metadata.publisher = null
      return { google: r, openlibrary: { status: 'not_found' } }
    },
    response,
  )
  assert.equal(result.policies.selective.fields.pages.conflict, 1)
  assert.equal(result.policies.selective.fields.publisher.agrees, 1)
  // A corroborated new publisher field is an opportunity; the page conflict is not an accepted correction.
  assert.equal(result.policies.selective.fields.pages.agrees, 0)
})

test('multiple editions and multiple useful fields count the work only once', async () => {
  const input = await fixture()
  const second = structuredClone(input.cases[0])
  second.identity.isbn = '9780061120084'
  input.cases.push(second)
  const { result } = await run(
    input,
    () => ({ google: { status: 'not_found' }, openlibrary: { status: 'not_found' } }),
    response,
  )
  assert.equal(result.cases, 2)
  assert.equal(result.distinctWorks, 1)
  assert.equal(result.policies.selective.additionalCorrectWorks, 1)
  assert.equal(result.policies.selective.fields.pages.agrees, 2)
})

test('harm on another edition of a work disqualifies the apparent work-level gain', async () => {
  const input = await fixture()
  const second = structuredClone(input.cases[0])
  second.identity.isbn = '9780061120084'
  input.cases.push(second)
  const { result } = await run(
    input,
    () => ({ google: { status: 'not_found' }, openlibrary: { status: 'not_found' } }),
    (i) => response(i, { pages: i.isbn === second.identity.isbn ? 999 : 300 }),
  )
  assert.equal(result.policies.selective.additionalCorrectWorks, 0)
  assert.equal(result.policies.selective.wrongValueWorks, 1)
})

for (const patch of [
  { title: 'Different work' },
  { title_long: 'Synthetic subscription exercise abridged' },
  { authors: ['A. Example'] },
  { isbn13: '9780061120084' },
  { binding: 'unknown binding' },
]) {
  test(`independent paid admission retains strict guard: ${Object.keys(patch)[0]}`, async () => {
    const input = await fixture()
    const { result } = await run(
      input,
      () => ({ google: { status: 'not_found' }, openlibrary: { status: 'not_found' } }),
      (i) => response(i, patch),
    )
    assert.equal(result.providers.isbndb.outcomes.review, 1)
    assert.equal(result.policies.selective.additionalCorrectWorks, 0)
  })
}

test('raw errors, restricted text, identifiers and unknown statuses never enter aggregates', async () => {
  const input = await fixture()
  const { result } = await run(
    input,
    () => ({ google: { status: 'SECRET_PROVIDER_MESSAGE' }, openlibrary: { status: 'not_found' } }),
    (i) =>
      response(i, {
        synopsis: 'RESTRICTED_TEXT',
        image: 'https://private.example/cover',
        other_isbns: [{ isbn: '9780061120084', binding: 'Hardcover' }],
      }),
  )
  assert.equal(result.providers.google.outcomes.unknown_status, 1)
  assert.deepEqual(result.providers.isbndb.availabilityOnly, {
    cover: 1,
    description: 1,
    relatedEditions: 1,
  })
  for (const s of [
    'SECRET_PROVIDER_MESSAGE',
    'RESTRICTED_TEXT',
    'private.example',
    '9780061120084',
    input.cases[0].identity.title,
  ])
    assert.ok(!JSON.stringify(result).includes(s))
})

test('audiobooks never receive scored page observations', async () => {
  const input = await fixture()
  input.cases[0].reference.editionFormat = 'audiobook'
  input.cases[0].reference.pages = null
  const { result } = await run(
    input,
    () => ({ google: { status: 'not_found' }, openlibrary: { status: 'not_found' } }),
    (i) => response(i, { binding: 'Audio CD', pages: 300 }),
  )
  assert.equal(result.providers.isbndb.fields.pages.notApplicable, 1)
  assert.equal(result.policies.selective.fields.pages.agrees, 0)
})

test('unreviewed returned values cannot produce an economic success', async () => {
  const input = await fixture()
  input.cases[0].reference.publisher = null
  const { result } = await run(
    input,
    () => ({ google: { status: 'not_found' }, openlibrary: { status: 'not_found' } }),
    response,
  )
  assert.equal(result.policies.selective.fields.publisher.unscored, 1)
  assert.equal(result.policies.selective.additionalCorrectWorks, 0)
})

test('date normalization preserves precision and rejects invented calendar dates', () => {
  for (const v of ['2026', '2026-02', '2024-02-29']) assert.equal(publicationDate(v), v)
  for (const v of ['2026-02-29', '2026-13', '2026-04-31', 'February 2026', '2026-2-01', '2026-00'])
    assert.equal(publicationDate(v), null)
  assert.equal(
    valueMetadata('openlibrary', {
      publishers: ['One', 'Two'],
      publish_date: '2026',
      languages: [{ key: '/languages/eng' }],
    }).publisher,
    null,
  )
  assert.equal(valueMetadata('openlibrary', { publishers: 'x' }).publisher, null)
  assert.deepEqual(
    valueMetadata('openlibrary', { publish_date: 'February 28, 2026' }).unparsedFields,
    ['publicationDate'],
  )
})

test('ISBNdb is not credited economically for overcoming only our date parser limitation', async () => {
  const input = await fixture()
  const { result } = await run(
    input,
    (i) => {
      const r = record(i, 'google')
      r.metadata.publicationDate = null
      r.metadata.unparsedFields = ['publicationDate']
      return { google: r, openlibrary: { status: 'not_found' } }
    },
    response,
  )
  assert.equal(result.policies.free.fields.publicationDate.unparsed, 1)
  assert.equal(result.policies.selective.fields.publicationDate.agrees, 1)
  assert.equal(result.policies.selective.additionalCorrectWorks, 0)
})

test('compatible partial dates are not mislabeled as wrong metadata', async () => {
  const input = await fixture()
  const { result } = await run(
    input,
    () => ({ google: { status: 'not_found' }, openlibrary: { status: 'not_found' } }),
    (i) => response(i, { date_published: '2026' }),
  )
  assert.equal(result.providers.isbndb.fields.publicationDate.lessPrecise, 1)
  assert.equal(result.policies.selective.wrongValueWorks, 0)
  assert.equal(result.policies.selective.additionalCorrectWorks, 0)
  input.cases[0].reference.publicationDate = '2026'
  const detailed = await run(
    input,
    () => ({ google: { status: 'not_found' }, openlibrary: { status: 'not_found' } }),
    response,
  )
  assert.equal(detailed.result.providers.isbndb.fields.publicationDate.morePreciseUnverified, 1)
})

test('joined compatible date precision retains the most specific observed fact without consulting truth', async () => {
  const input = await fixture()
  const { result } = await run(
    input,
    (i) => {
      const a = record(i, 'google'),
        b = record(i, 'openlibrary')
      a.metadata.publicationDate = '2026'
      b.metadata.publicationDate = '2026-02-28'
      return { google: a, openlibrary: b }
    },
    response,
  )
  assert.equal(result.policies.free.fields.publicationDate.agrees, 1)
  assert.equal(result.policies.free.fields.publicationDate.conflict, 0)
})

test('Google optional value projection leaves the existing baseline output unchanged', async () => {
  const input = await fixture(),
    identity = input.cases[0].identity
  const body = {
    totalItems: 1,
    items: [
      {
        volumeInfo: {
          title: identity.title,
          authors: identity.authors,
          industryIdentifiers: [{ type: 'ISBN_13', identifier: identity.isbn }],
          pageCount: 300,
          publisher: 'Example Press',
          publishedDate: '2026-02',
          language: 'en',
          imageLinks: { thumbnail: 'https://example.test/image' },
          description: 'not retained',
        },
      },
    ],
  }
  const old = selectGoogleBaseline(body, identity),
    extended = selectGoogleBaseline(body, identity, true)
  assert.equal(old.metadata, undefined)
  assert.deepEqual(extended.record, old.record)
  assert.equal(extended.metadata.publicationDate, '2026-02')
  assert.equal(extended.metadata.availability.cover, true)
  assert.ok(!JSON.stringify(extended).includes('not retained'))
  body.items[0].volumeInfo.title = 'Wrong title'
  assert.equal(selectGoogleBaseline(body, identity, true).metadata, undefined)
})

test('baseline client wires both extended projections after identity admission', async () => {
  const identity = (await fixture()).cases[0].identity
  const client = createBaselineClient({
    googleKey: 'synthetic-key',
    includeValueMetadata: true,
    sleeper: async () => {},
    fetcher: async (url) => {
      if (url.includes('googleapis')) return new Response(JSON.stringify({ totalItems: 0 }))
      if (url.includes('/authors/'))
        return new Response(JSON.stringify({ key: '/authors/OL1A', name: identity.authors[0] }))
      return new Response(
        JSON.stringify({
          title: identity.title,
          isbn_13: [identity.isbn],
          authors: [{ key: '/authors/OL1A' }],
          publishers: ['Example Press'],
          publish_date: '2026-02-28',
          physical_format: 'Paperback',
          languages: [{ key: '/languages/eng' }],
        }),
      )
    },
  })
  const result = await client.acquire(identity)
  assert.equal(result.google.status, 'not_found')
  assert.equal(result.openlibrary.status, 'matched')
  assert.equal(result.openlibrary.metadata.publisher, 'example press')
  assert.equal(result.openlibrary.metadata.publicationDate, '2026-02-28')
})

test('validation refuses old frames, extra fields, duplicate ISBNs, and circular references', async () => {
  const input = await fixture()
  for (const change of [
    (v) => {
      v.purpose = 'development-page-review'
    },
    (v) => {
      v.cases.push(structuredClone(v.cases[0]))
    },
    (v) => {
      v.cases[0].reference.source = 'https://isbndb.com/book/1'
    },
    (v) => {
      v.cases[0].privateNotes = 'do not send'
    },
    (v) => {
      v.requiredFields.push('description')
    },
    (v) => {
      v.economics.monthlySubscriptionUsd = -1
    },
    (v) => {
      v.cases[0].reference.publicationDate = '2026-02-30'
    },
  ]) {
    const bad = structuredClone(input)
    change(bad)
    assert.throws(() => validateSubscriptionValue(bad))
  }
})

test('CLI dry run and help work without keys; live needs an explicit complete paid budget before credentials', async () => {
  const cli = new URL('../src/value-metadata.mjs', import.meta.url)
  const dry = spawnSync(process.execPath, [cli.pathname, '--input', fixtureUrl.pathname], {
    encoding: 'utf8',
  })
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(JSON.parse(dry.stdout).mode, 'dry_run')
  const help = spawnSync(process.execPath, [cli.pathname, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /metadata:value/)
  await assert.rejects(
    main(
      ['--input', fixtureUrl.pathname, '--live', '--env', '/does-not-exist'],
      () => {},
      'subscription-value',
    ),
    /incomplete_value_budget/,
  )
  await assert.rejects(
    main(
      [
        '--input',
        fixtureUrl.pathname,
        '--live',
        '--max-isbndb-requests',
        '1',
        '--env',
        '/does-not-exist',
      ],
      () => {},
      'subscription-value',
    ),
    /synthetic_frame_not_live/,
  )
})

test('live CLI wiring independently requests paid data using fake transports only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'reverie-value-cli-'))
  const path = join(dir, 'frame.json')
  const input = await fixture()
  input.cases[0].reference.source = 'https://publisher.test/reviewed'
  await writeFile(path, JSON.stringify(input))
  const oldFetch = globalThis.fetch
  const names = ['ISBNDB_API_KEY', 'GOOGLE_BOOKS_API_KEY']
  const oldEnv = Object.fromEntries(names.map((n) => [n, process.env[n]]))
  let output,
    calls = []
  try {
    for (const n of names) process.env[n] = 'synthetic-value-key'
    globalThis.fetch = async (url, options) => {
      calls.push(new URL(url).hostname)
      assert.equal(options.redirect, 'manual')
      if (url.startsWith('https://www.googleapis.com/books/'))
        return new Response(JSON.stringify({ totalItems: 0 }))
      if (url.startsWith('https://openlibrary.org/isbn/')) return new Response('', { status: 404 })
      assert.ok(url.startsWith('https://api2.isbndb.com/book/'))
      assert.equal(options.headers.Authorization, 'synthetic-value-key')
      return new Response(JSON.stringify(response(input.cases[0].identity).body))
    }
    await main(
      ['--input', path, '--live', '--max-isbndb-requests', '1', '--env', join(dir, 'absent.env')],
      (v) => {
        output = JSON.parse(v)
      },
      'subscription-value',
    )
    assert.deepEqual(calls, ['www.googleapis.com', 'openlibrary.org', 'api2.isbndb.com'])
    assert.equal(output.providers.isbndb.fields.publisher.agrees, 1)
    assert.equal(output.independentIsbndbMatchesAfterCompletedFreeMiss, 1)
    assert.equal(output.transport.isbndb.requests, 1)
    assert.equal(output.referenceCoverage.publisher.reviewed, 1)
    assert.ok(!JSON.stringify(output).includes('synthetic-value-key'))
  } finally {
    globalThis.fetch = oldFetch
    for (const n of names) {
      if (oldEnv[n] === undefined) delete process.env[n]
      else process.env[n] = oldEnv[n]
    }
    await rm(dir, { recursive: true, force: true })
  }
})
