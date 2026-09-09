import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  approvedEditionRedirect,
  selectGoogleBaseline,
  createBaselineClient,
} from '../src/metadata/baseline-client.mjs'
import { validateBenchmark, runMetadataBenchmark } from '../src/metadata/benchmark.mjs'
import { createIsbndbClient } from '../src/metadata/isbndb-client.mjs'

const identity = {
  isbn: '9780316565202',
  title: 'Synthetic metadata exercise',
  authors: ['Ada Example'],
  language: 'en',
}
const book = (patch = {}) => ({
  title: identity.title,
  authors: identity.authors,
  industryIdentifiers: [{ type: 'ISBN_13', identifier: identity.isbn }],
  ...patch,
})
const google = (patch) => ({ totalItems: 1, items: [{ volumeInfo: book(patch) }] })
const olBook = (patch = {}) => ({
  title: identity.title,
  isbn_13: [identity.isbn],
  authors: [{ key: '/authors/OL1A' }],
  number_of_pages: 300,
  physical_format: 'Paperback',
  ...patch,
})
const json = (body) => new Response(JSON.stringify(body))
const make = (fetcher, options = {}) =>
  createBaselineClient({ googleKey: 'synthetic-key', fetcher, sleeper: async () => {}, ...options })
const baseline = (patch = {}) => ({
  source: 'google',
  isbns: [identity.isbn],
  title: identity.title,
  authors: identity.authors,
  pages: null,
  editionFormat: null,
  ...patch,
})
const fixture = () => ({
  version: 1,
  purpose: 'development-edition-benchmark',
  cases: [
    {
      identity: structuredClone(identity),
      current: {},
      reference: {
        pages: 300,
        editionFormat: 'paperback',
        source: 'https://publisher.example/synthetic',
        reviewedOn: '2026-09-08',
      },
    },
  ],
})
const isbnClient = (patch = {}) =>
  createIsbndbClient({
    key: 'synthetic-key',
    sleeper: async () => {},
    fetcher: async () =>
      json({
        book: {
          isbn13: identity.isbn,
          title: identity.title,
          authors: identity.authors,
          pages: 300,
          binding: 'Paperback',
          ...patch,
        },
      }),
  })
const observed = (googleStatus = 'matched', olStatus = 'not_found', record = baseline()) => ({
  stats: { google: { requests: 1 }, openlibrary: { requests: 1 } },
  async acquire(target) {
    assert.deepEqual(target, identity)
    return { google: { status: googleStatus, record }, openlibrary: { status: olStatus } }
  },
})

test('Google admits only returned exact-ISBN full-title/full-author identity, never search rank', () => {
  assert.equal(selectGoogleBaseline(google(), identity).status, 'matched')
  for (const patch of [
    { industryIdentifiers: [] },
    { industryIdentifiers: [{ type: 'ISBN_13', identifier: '9781250890313' }] },
  ])
    assert.equal(selectGoogleBaseline(google(patch), identity).status, 'no_exact_isbn')
  for (const patch of [
    { title: identity.title + ' (Adaptation)' },
    { authors: ['A. Example'] },
    { authors: [...identity.authors, 'Editor Other'] },
    { language: 'es' },
    {
      industryIdentifiers: [
        ...book().industryIdentifiers,
        { type: 'ISBN_10', identifier: 'invalid' },
      ],
    },
  ])
    assert.equal(selectGoogleBaseline(google(patch), identity).status, 'identity_review')
})
test('Google retains subtitle qualifiers, including malformed subtitles', () => {
  for (const subtitle of ['An Abridged Edition', { bad: true }])
    assert.equal(selectGoogleBaseline(google({ subtitle }), identity).status, 'identity_review')
  const expected = { ...identity, title: identity.title + ': An Abridged Edition' }
  assert.equal(
    selectGoogleBaseline(google({ subtitle: 'An Abridged Edition' }), expected).status,
    'matched',
  )
})
test('multiple exact Google records remain ambiguous even when identical', () => {
  assert.equal(
    selectGoogleBaseline({ totalItems: 2, items: [google().items[0], google().items[0]] }, identity)
      .status,
    'identity_review',
  )
  for (const body of [null, [], {}, { error: 'secret' }, { items: 'bad' }])
    assert.equal(selectGoogleBaseline(body, identity).status, 'invalid_shape')
  assert.equal(selectGoogleBaseline({ totalItems: 0 }, identity).status, 'not_found')
})
test('digital access and BOOK do not imply an ebook/print binding; invalid pages stay unknown', () => {
  for (const pageCount of [0, -1, 20001, 3.5, '300']) {
    const result = selectGoogleBaseline(
      {
        totalItems: 1,
        items: [
          {
            volumeInfo: book({ pageCount, printType: 'BOOK', description: 'private prose' }),
            saleInfo: { isEbook: true },
          },
        ],
      },
      identity,
    )
    assert.equal(result.record.pages, null)
    assert.equal(result.record.editionFormat, null)
    assert.equal(JSON.stringify(result).includes('private prose'), false)
  }
})
test('only a canonical same-origin Open Library edition redirect is approved', () => {
  assert.equal(
    approvedEditionRedirect('/books/OL123M.json'),
    'https://openlibrary.org/books/OL123M.json',
  )
  for (const url of [
    null,
    '',
    '//evil.example/books/OL123M.json',
    'http://openlibrary.org/books/OL123M.json',
    'https://user@openlibrary.org/books/OL123M.json',
    '/authors/OL1A.json',
    '/books/OL123M.json?x=1',
    '/books/OL123M.json#x',
    'https://openlibrary.org:444/books/OL123M.json',
  ])
    assert.equal(approvedEditionRedirect(url), null)
})
test('live acquisition fixes hosts, contains the Google key, resolves OL authors and paces every hop', async () => {
  let time = 0
  const starts = []
  const client = make(
    async (url, options) => {
      assert.equal(options.redirect, 'manual')
      assert.ok(options.signal)
      const u = new URL(url)
      if (u.hostname === 'www.googleapis.com') {
        assert.equal(u.searchParams.get('q'), `isbn:${identity.isbn}`)
        assert.equal(u.searchParams.get('key'), 'synthetic-key')
        assert.equal(options.headers.Referer, 'https://reveriereads.app')
        return json(google())
      }
      assert.equal(u.origin, 'https://openlibrary.org')
      assert.equal(options.headers.Authorization, undefined)
      assert.equal(options.headers.Referer, undefined)
      assert.equal(url.includes('synthetic-key'), false)
      starts.push(time)
      if (u.pathname.startsWith('/isbn/'))
        return new Response(null, { status: 302, headers: { Location: '/books/OL123M.json' } })
      if (u.pathname.startsWith('/books/')) return json(olBook())
      assert.equal(u.pathname, '/authors/OL1A.json')
      return json({ key: '/authors/OL1A', name: 'Ada Example' })
    },
    {
      googleReferrer: 'https://reveriereads.app',
      now: () => time,
      sleeper: async (ms) => {
        time += ms
      },
    },
  )
  const result = await client.acquire(identity)
  assert.equal(result.google.status, 'matched')
  assert.equal(result.openlibrary.status, 'matched')
  assert.equal(result.openlibrary.record.editionFormat, 'paperback')
  assert.equal(client.stats.openlibrary.requests, 3)
  assert.deepEqual(starts, [0, 1100, 2200])
})
test('Google redirects never forward keys; OL second redirects and malicious author references are refused', async () => {
  const requests = []
  const redirect = make(async (url) => {
    requests.push(url)
    return new Response(null, { status: 302, headers: { Location: '/books/OL123M.json' } })
  })
  const result = await redirect.acquire(identity)
  assert.equal(result.google.status, 'redirect_refused')
  assert.equal(result.openlibrary.status, 'redirect_refused')
  assert.equal(requests.length, 3)
  for (const key of [
    'https://evil.example/authors/OL1A',
    '/authors/OL1A?key=secret',
    '/authors/../OL1A',
  ]) {
    const c = make(async (url) =>
      url.includes('googleapis') ? json(google()) : json(olBook({ authors: [{ key }] })),
    )
    assert.equal((await c.acquire(identity)).openlibrary.status, 'identity_review')
    assert.equal(c.stats.openlibrary.requests, 1)
  }
})
test('author failure cannot silently produce a partial matched contributor list', async () => {
  const c = make(async (url) => {
    if (url.includes('googleapis')) return json(google())
    if (url.includes('/isbn/'))
      return json(olBook({ authors: [{ key: '/authors/OL1A' }, { key: '/authors/OL2A' }] }))
    if (url.includes('OL1A')) return json({ name: 'Ada Example' })
    return new Response('secret HTML', { status: 403 })
  })
  assert.equal((await c.acquire(identity)).openlibrary.status, 'incomplete_authors')
  assert.equal(c.stats.openlibrary.stopped, 'authentication_or_access')
})
test('successful author lookups are reused only in memory and duplicate edition ISBNs are not synthesized', async () => {
  const c = make(async (url) =>
    url.includes('googleapis')
      ? json(google())
      : url.includes('/authors/')
        ? json({ name: 'Ada Example' })
        : json(olBook()),
  )
  await c.acquire(identity)
  await c.acquire(identity)
  assert.equal(c.stats.openlibrary.requests, 3)
  const mixed = make(async (url) =>
    url.includes('googleapis')
      ? json(google())
      : json(olBook({ isbn_13: [identity.isbn, '9781250890313'] })),
  )
  assert.equal((await mixed.acquire(identity)).openlibrary.status, 'identity_review')
  assert.equal(mixed.stats.openlibrary.requests, 1)
})
test('OL format, language, returned author identity and missing author list fail closed', async () => {
  for (const patch of [
    { physical_format: 'unknown carrier' },
    { languages: [{ key: '/languages/spa' }] },
    { languages: [{ key: 42 }] },
    { languages: {} },
    { subtitle: 'Graphic Adaptation' },
    { authors: [] },
  ]) {
    const c = make(async (url) =>
      url.includes('googleapis')
        ? json(google())
        : url.includes('/authors/')
          ? json({ name: 'Ada Example' })
          : json(olBook(patch)),
    )
    assert.ok(
      ['identity_review', 'edition_review'].includes(
        (await c.acquire(identity)).openlibrary.status,
      ),
    )
  }
  const c = make(async (url) =>
    url.includes('googleapis')
      ? json(google())
      : url.includes('/authors/')
        ? json({ key: '/authors/OL2A', name: 'Ada Example' })
        : json(olBook()),
  )
  assert.equal((await c.acquire(identity)).openlibrary.status, 'identity_review')
})
test('status-first auth/quota failures stop only the affected provider and are redacted', async () => {
  for (const status of [401, 403, 429]) {
    const c = make(
      async (url) =>
        new Response('private secret', { status: url.includes('googleapis') ? status : 404 }),
    )
    const result = await c.acquire(identity)
    await c.acquire(identity)
    assert.equal(c.stats.google.requests, 1)
    assert.equal(c.stats.openlibrary.requests, 2)
    assert.equal(result.openlibrary.status, 'not_found')
    assert.equal(JSON.stringify(result).includes('private secret'), false)
  }
})
test('budgets, consecutive network failure, oversized bodies and malformed JSON are bounded', async () => {
  assert.throws(() => make(async () => {}, { maxGoogleRequests: 21 }))
  assert.throws(() => make(async () => {}, { maxOpenLibraryRequests: 201 }))
  const limited = make(async () => new Response(null, { status: 404 }), {
    maxGoogleRequests: 1,
    maxOpenLibraryRequests: 1,
  })
  await limited.acquire(identity)
  await limited.acquire(identity)
  assert.equal(limited.stats.google.requests, 1)
  assert.equal(limited.stats.openlibrary.requests, 1)
  const failed = make(async () => {
    throw new Error('private request URL')
  })
  await failed.acquire(identity)
  await failed.acquire(identity)
  await failed.acquire(identity)
  assert.equal(failed.stats.google.requests, 2)
  assert.equal(failed.stats.openlibrary.stopped, 'infrastructure_failures')
  for (const [body, status] of [
    ['{', 'invalid_json'],
    ['x'.repeat(524289), 'response_too_large'],
  ]) {
    const c = make(async () => new Response(body))
    assert.equal((await c.acquire(identity)).google.status, status)
  }
})
test('missing Google key and invalid identity never issue a Google request', async () => {
  const c = make(
    async (url) => {
      assert.ok(url.startsWith('https://openlibrary.org/'))
      return new Response(null, { status: 404 })
    },
    { googleKey: '' },
  )
  assert.equal((await c.acquire(identity)).google.status, 'missing_key')
  assert.equal(c.stats.google.requests, 0)
  await assert.rejects(() => c.acquire({ ...identity, isbn: 'bad' }))
  assert.equal(c.stats.openlibrary.requests, 1)
})
test('benchmark validates development-only inputs and rejects circular truth or injected baselines', () => {
  assert.equal(validateBenchmark(fixture()).cases.length, 1)
  for (const change of [
    (v) => {
      v.purpose = 'qualification'
    },
    (v) => {
      v.cases[0].baseline = [baseline()]
    },
    (v) => {
      v.cases[0].notes = 'private'
    },
    (v) => {
      v.cases[0].reference.source = 'https://api2.isbndb.com/book/1'
    },
    (v) => {
      v.cases[0].reference.pages = 0
    },
    (v) => {
      v.cases.push(v.cases[0])
    },
  ]) {
    const value = fixture()
    change(value)
    assert.throws(() => validateBenchmark(value))
  }
})
test('dry-run benchmark never touches either client', async () => {
  const forbidden = new Proxy(
    {},
    {
      get() {
        throw new Error('forbidden')
      },
    },
  )
  const result = await runMetadataBenchmark(fixture(), {
    baselineClient: forbidden,
    isbndbClient: forbidden,
  })
  assert.equal(result.transport, null)
  assert.equal(result.mode, 'dry_run')
})
test('benchmark uses identity-only acquisition and scores candidates without retaining any field values', async () => {
  const result = await runMetadataBenchmark(fixture(), {
    live: true,
    baselineClient: observed(),
    isbndbClient: isbnClient(),
  })
  assert.equal(result.candidates.pages.agrees, 1)
  assert.equal(result.candidates.editionFormat.agrees, 1)
  assert.equal(result.transport.isbndb.requests, 1)
  for (const secret of [
    identity.isbn,
    identity.title,
    'Ada Example',
    'publisher.example',
    'synthetic-key',
  ])
    assert.equal(JSON.stringify(result).includes(secret), false)
})
test('incomplete baselines and reviewed identities never turn into a paid gap', async () => {
  for (const status of [
    'timeout',
    'network_error',
    'incomplete_authors',
    'identity_review',
    'edition_review',
  ]) {
    const c = isbnClient()
    const result = await runMetadataBenchmark(fixture(), {
      live: true,
      baselineClient: observed('matched', status),
      isbndbClient: c,
    })
    assert.equal(c.stats.requests, 0)
    assert.equal(
      result.plans[
        ['identity_review', 'edition_review'].includes(status)
          ? 'baseline_review'
          : 'baseline_unavailable'
      ],
      1,
    )
  }
})
test('available baseline fields skip paid requests; field disagreements are scored honestly', async () => {
  const c = isbnClient()
  const result = await runMetadataBenchmark(fixture(), {
    live: true,
    baselineClient: observed(
      'matched',
      'not_found',
      baseline({ pages: 400, editionFormat: 'paperback' }),
    ),
    isbndbClient: c,
  })
  assert.equal(c.stats.requests, 0)
  assert.equal(result.plans.skip, 1)
  assert.equal(result.baselineFields.google.pages.differs, 1)
  const bad = await runMetadataBenchmark(fixture(), {
    live: true,
    baselineClient: observed(),
    isbndbClient: isbnClient({ pages: 400 }),
  })
  assert.equal(bad.candidates.pages.differs, 1)
  assert.equal(bad.candidates.pages.agrees, 0)
})
test('CLI example and help are executable, credential-free by default, and errors are redacted', () => {
  const entry = fileURLToPath(new URL('../src/benchmark-metadata.mjs', import.meta.url))
  const file = fileURLToPath(new URL('../data/metadata-benchmark.example.json', import.meta.url))
  const directory = fileURLToPath(new URL('../data/', import.meta.url))
  const result = spawnSync(process.execPath, [entry, '--input', file, '--env', directory], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout).mode, 'dry_run')
  assert.equal(spawnSync(process.execPath, [entry, '--help']).status, 0)
  const bad = spawnSync(process.execPath, [entry, '--private-secret'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.equal(bad.stderr.includes('private-secret'), false)
})
