import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  admitGoogleVolume,
  selectGoogleEdition,
  buildEditionPagePacket,
  runEditionPages,
  validateEditionPages,
} from '../src/metadata/edition-pages.mjs'
import { createEditionPageClient } from '../src/metadata/edition-page-client.mjs'
import { assertFreshEditionFrame, main } from '../src/edition-pages.mjs'
import { createValueStudyLock } from '../src/metadata/value-study.mjs'

const identity = {
  isbn: '9780316565202',
  title: 'Synthetic metadata exercise',
  authors: ['Ada Example'],
  language: 'en',
}
const otherIsbn = '9781250890313'
const at = '2026-09-09T12:00:00.000Z'
const volume = (patch = {}, id = 'safe-ID_123') => ({
  id,
  volumeInfo: {
    title: identity.title,
    authors: identity.authors,
    language: 'en',
    pageCount: 300,
    industryIdentifiers: [{ type: 'ISBN_13', identifier: identity.isbn }],
    ...patch,
  },
})
const search = (...items) => ({ totalItems: items.length, items })
const olBook = (patch = {}) => ({
  title: identity.title,
  isbn_13: [identity.isbn],
  authors: [{ key: '/authors/OL1A' }],
  number_of_pages: 300,
  physical_format: 'Paperback',
  ...patch,
})
const json = (body) => new Response(JSON.stringify(body))
const frame = () => ({
  version: 1,
  purpose: 'development-edition-pages',
  cases: [
    {
      identity: structuredClone(identity),
      current: {},
      reference: {
        pages: 300,
        editionFormat: 'paperback',
        source: 'https://publisher.example/synthetic',
        reviewedOn: '2026-09-09',
      },
    },
  ],
})
const make = (options = {}) => {
  const calls = []
  const client = createEditionPageClient({
    googleKey: 'synthetic-secret',
    googleReferrer: 'https://reveriereads.app',
    sleeper: async () => {},
    now: () => Date.parse(at),
    ...options,
    fetcher: async (url, init) => {
      calls.push({ url: new URL(url), init })
      if (options.fetcher) return options.fetcher(new URL(url), init)
      if (url.includes('googleapis.com'))
        return json(
          new URL(url).pathname.endsWith('/volumes')
            ? search(volume({ pageCount: 301 }))
            : volume(),
        )
      if (url.includes('/authors/')) return json({ key: '/authors/OL1A', name: 'Ada Example' })
      return json(olBook())
    },
  })
  return { client, calls }
}
const result = (source, pages = 300, patch = {}) => ({
  status: 'matched',
  record: {
    source,
    isbns: [identity.isbn],
    title: identity.title,
    authors: identity.authors,
    pages,
    editionFormat: 'paperback',
  },
  endpoint: source === 'google' ? 'volume_detail' : 'isbn_edition',
  sourceId: source === 'google' ? 'safe-ID_123' : identity.isbn,
  targetIsbn: identity.isbn,
  observedAt: at,
  ...patch,
})
const acquired = (g = result('google'), o = result('openlibrary')) => ({
  google: g,
  openlibrary: o,
})
const packet = (sources = acquired(), current = {}) =>
  buildEditionPagePacket({ identity, current }, sources)

test('wrong first result cannot beat one exact returned ISBN; author and full subtitle stay required', () => {
  const wrong = volume(
    { industryIdentifiers: [{ type: 'ISBN_13', identifier: otherIsbn }] },
    'wrong',
  )
  assert.equal(selectGoogleEdition(search(wrong, volume()), identity).volumeId, 'safe-ID_123')
  for (const patch of [
    { authors: ['A. Example'] },
    { authors: ['Ada Example', 'New Person'] },
    { title: identity.title + ' Adaptation' },
    { subtitle: 'Abridged' },
    { language: 'fr' },
    { subtitle: 3 },
  ])
    assert.equal(admitGoogleVolume(volume(patch), identity).status, 'identity_review')
  assert.equal(
    admitGoogleVolume(volume({ subtitle: 'A novel' }), {
      ...identity,
      title: identity.title + ': A novel',
    }).status,
    'matched',
  )
})

test('equivalent ISBN-10/13 admitted; invalid, mixed, missing and lookalike identifiers refused', () => {
  const ids = [
    { type: 'ISBN_13', identifier: identity.isbn },
    { type: 'ISBN_10', identifier: '0316565202' },
  ]
  assert.equal(admitGoogleVolume(volume({ industryIdentifiers: ids }), identity).status, 'matched')
  for (const industryIdentifiers of [
    [],
    [{ type: 'OTHER', identifier: identity.isbn }],
    [...ids, { type: 'ISBN_13', identifier: otherIsbn }],
    [...ids, { type: 'ISBN_10', identifier: '0000000001' }],
  ])
    assert.equal(
      admitGoogleVolume(volume({ industryIdentifiers }), identity).status,
      'identity_review',
    )
})

test('duplicate exact results, truncated results and malformed bodies never select a detail ID', () => {
  for (const body of [search(volume(), volume()), { ...search(volume()), totalItems: 11 }])
    assert.equal(selectGoogleEdition(body, identity).status, 'identity_review')
  for (const body of [
    null,
    {},
    { error: {} },
    { items: {} },
    ...['1', -1, 0, 1.5, undefined].map((totalItems) => ({ ...search(volume()), totalItems })),
    search(...Array(11).fill(volume())),
  ])
    assert.equal(selectGoogleEdition(body, identity).status, 'invalid_shape')
  for (const id of ['../evil', 'https://other.example', 'x?key=leak', 'x#frag', '', 12])
    assert.equal(admitGoogleVolume(volume({}, id), identity).status, 'identity_review')
})

test('detail only: search pages and undocumented printed pages do not enter the packet', async () => {
  const { client, calls } = make()
  const observed = await client.acquire(identity)
  assert.equal(observed.google.record.pages, 300)
  assert.equal(observed.google.endpoint, 'volume_detail')
  assert.equal(observed.openlibrary.endpoint, 'isbn_edition')
  assert.equal(packet(observed).state, 'cross_provider_agreement')
  assert.deepEqual(
    calls.map((c) => c.url.hostname),
    ['www.googleapis.com', 'www.googleapis.com', 'openlibrary.org', 'openlibrary.org'],
  )
  assert.equal(calls[0].url.searchParams.get('projection'), 'full')
  assert.equal(calls[0].url.searchParams.get('maxResults'), '10')
  assert.equal(calls[1].url.pathname, '/books/v1/volumes/safe-ID_123')
  for (const c of calls.slice(0, 2)) {
    assert.equal(c.init.headers.Referer, 'https://reveriereads.app')
    assert.equal(c.init.headers.Origin, 'https://reveriereads.app')
    assert.equal(c.init.redirect, 'manual')
  }
  assert.equal(client.stats.google.requests, 2)
  assert.equal(client.stats.openlibrary.requests, 2)
})

test('wrong-first/right-second selection is exercised through the real HTTP orchestration', async () => {
  const { client, calls } = make({
    fetcher: async (url) => {
      if (url.hostname === 'openlibrary.org') return new Response(null, { status: 404 })
      return json(
        url.pathname.endsWith('/volumes')
          ? search(
              volume(
                { industryIdentifiers: [{ type: 'ISBN_13', identifier: otherIsbn }] },
                'wrong',
              ),
              volume(),
            )
          : volume(),
      )
    },
  })
  const r = await client.acquire(identity)
  assert.equal(r.google.record.pages, 300)
  assert.equal(calls[1].url.pathname.endsWith('/safe-ID_123'), true)
})

test('ambiguous ISBN and unsafe ID stop before any detail request, even with a selfLink', async () => {
  for (const body of [
    search(volume(), volume()),
    search({ ...volume({}, '../unsafe'), selfLink: 'https://attacker.example' }),
  ]) {
    const { client, calls } = make({
      fetcher: async (url) =>
        url.hostname === 'openlibrary.org' ? new Response(null, { status: 404 }) : json(body),
    })
    assert.equal((await client.acquire(identity)).google.status, 'identity_review')
    assert.equal(calls.filter((c) => c.url.hostname === 'www.googleapis.com').length, 1)
  }
})

test('detail identity must still match selected ID, requested ISBN, full title, contributors and language', async () => {
  for (const detail of [
    volume({}, 'changed'),
    volume({ title: 'Another book' }),
    volume({ authors: ['Other Author'] }),
    volume({ language: 'fr' }),
    volume({ industryIdentifiers: [{ type: 'ISBN_13', identifier: otherIsbn }] }),
  ]) {
    const { client } = make({
      fetcher: async (url) =>
        url.hostname === 'openlibrary.org'
          ? new Response(null, { status: 404 })
          : json(url.pathname.endsWith('/volumes') ? search(volume()) : detail),
    })
    const r = await client.acquire(identity)
    assert.equal(r.google.status, 'identity_review')
    assert.equal(packet(r).candidateValue, null)
    assert.deepEqual(packet(r).observations, [])
  }
})

test('only positive integer pages survive; no fallback to search or printedPageCount', async () => {
  for (const pageCount of [0, -1, 1.5, 20001, '300', null, undefined]) {
    const { client } = make({
      fetcher: async (url) =>
        url.hostname === 'openlibrary.org'
          ? new Response(null, { status: 404 })
          : json(
              url.pathname.endsWith('/volumes')
                ? search(volume())
                : volume({ pageCount, printedPageCount: 300 }),
            ),
    })
    const r = await client.acquire(identity)
    assert.equal(r.google.record.pages, null)
    assert.equal(packet(r).candidateValue, null)
  }
})

for (const [http, expected] of [
  [403, 'authentication_or_access'],
  [429, 'rate_limited'],
  [404, 'not_found'],
  [503, 'server_error'],
  [302, 'redirect_refused'],
]) {
  test(`detail HTTP ${http} is a finite failure, not a search-page fallback`, async () => {
    const { client, calls } = make({
      fetcher: async (url) =>
        url.hostname === 'openlibrary.org'
          ? new Response(null, { status: 404 })
          : url.pathname.endsWith('/volumes')
            ? json(search(volume()))
            : new Response('not JSON secret body', {
                status: http,
                headers: { Location: 'https://attacker.example' },
              }),
    })
    const r = await client.acquire(identity)
    assert.equal(r.google.status, expected)
    assert.equal(packet(r).candidateValue, null)
    assert.equal(calls.filter((c) => c.url.hostname === 'www.googleapis.com').length, 2)
    if ([403, 429].includes(http)) {
      await client.acquire(identity)
      assert.equal(client.stats.google.requests, 2)
      assert.equal(client.stats.google.stopped, expected)
    }
  })
}

test('malformed JSON, oversized body, timeout and consecutive infrastructure failures stay bounded', async () => {
  for (const [response, expected] of [
    [() => new Response('{'), 'invalid_json'],
    [() => new Response('x'.repeat(524289)), 'response_too_large'],
    [
      () => {
        throw new DOMException('sensitive', 'TimeoutError')
      },
      'timeout',
    ],
  ]) {
    const { client } = make({
      fetcher: async (url) =>
        url.hostname === 'openlibrary.org' ? new Response(null, { status: 404 }) : response(),
    })
    assert.equal((await client.acquire(identity)).google.status, expected)
  }
  const { client } = make({
    fetcher: async (url) =>
      new Response(null, { status: url.hostname === 'openlibrary.org' ? 404 : 503 }),
  })
  await client.acquire(identity)
  await client.acquire(identity)
  await client.acquire(identity)
  assert.equal(client.stats.google.requests, 2)
  assert.equal(client.stats.google.stopped, 'infrastructure_failures')
})

test('budgets and concurrent acquisitions cannot multiply detail calls or mutate queued identity', async () => {
  const { client, calls } = make({ maxGoogleRequests: 1, maxOpenLibraryRequests: 1 })
  const mutable = structuredClone(identity)
  const first = client.acquire(mutable)
  mutable.isbn = otherIsbn
  const second = client.acquire(identity)
  const results = await Promise.all([first, second])
  assert.equal(calls[0].url.searchParams.get('q'), `isbn:${identity.isbn}`)
  assert.equal(client.stats.google.requests, 1)
  assert.equal(client.stats.openlibrary.requests, 1)
  assert.equal(results[0].google.status, 'not_attempted')
  assert.equal(packet(results[0]).candidateValue, null)
  for (const maxGoogleRequests of [0, 41, 1.5, NaN])
    assert.throws(() => make({ maxGoogleRequests }))
  assert.throws(() => client.acquire({ ...identity, isbn: 'invalid' }))
})

test('missing Google credentials make no keyless requests and no automatic OL-only proposal', async () => {
  const { client, calls } = make({ googleKey: '' })
  const r = await client.acquire(identity)
  assert.equal(r.google.status, 'missing_key')
  assert.equal(
    calls.every((c) => c.url.hostname === 'openlibrary.org'),
    true,
  )
  assert.equal(packet(r).state, 'unavailable')
  assert.equal(packet(r).candidateValue, null)
})

test('OL edition admission validates every ISBN and author; never replaces missing extent with work median', async () => {
  for (const patch of [
    { isbn_13: [identity.isbn, otherIsbn] },
    { authors: [{ key: '/authors/OL1A' }, { key: '/authors/OL2A' }] },
  ]) {
    const { client } = make({
      fetcher: async (url) => {
        if (url.hostname === 'www.googleapis.com')
          return json(url.pathname.endsWith('/volumes') ? search(volume()) : volume())
        if (url.pathname === '/authors/OL1A.json') return json({ name: 'Ada Example' })
        if (url.pathname.includes('/authors/')) return new Response(null, { status: 503 })
        return json(olBook(patch))
      },
    })
    const r = await client.acquire(identity)
    assert.notEqual(r.openlibrary.status, 'matched')
    assert.equal(packet(r).candidateValue, null)
  }
  const { client } = make({
    fetcher: async (url) => {
      if (url.hostname === 'www.googleapis.com')
        return json(url.pathname.endsWith('/volumes') ? search(volume()) : volume())
      if (url.pathname.includes('/authors/')) return json({ name: 'Ada Example' })
      return json(olBook({ number_of_pages: null, number_of_pages_median: 300 }))
    },
  })
  const r = await client.acquire(identity)
  assert.equal(r.openlibrary.record.pages, null)
  assert.equal(packet(r).state, 'candidate')
})

test('conflicts, audio, unavailable sources and existing values cannot produce a fill', () => {
  assert.equal(packet(acquired(result('google', 301))).state, 'conflict')
  assert.equal(packet(acquired(result('google', 301))).candidateValue, null)
  assert.equal(packet(acquired(), { pages: 299 }).state, 'conflict')
  const same = packet(acquired(), { pages: 300 })
  assert.equal(same.current.protected, true)
  assert.equal(same.candidateValue, null)
  const audio = result('openlibrary')
  audio.record.editionFormat = 'audiobook'
  assert.equal(
    packet(
      acquired(
        result('google', 300, { record: { ...result('google').record, editionFormat: null } }),
        audio,
      ),
    ).state,
    'not_applicable',
  )
  assert.equal(packet(acquired(), { editionFormat: 'audiobook' }).state, 'edition_conflict')
  assert.equal(packet(acquired({ status: 'network_error' })).state, 'unavailable')
  assert.equal(packet(acquired(result('google'), { status: 'not_found' })).state, 'candidate')
})

test('forged search endpoints, source labels, duplicate Google votes and missing provenance fail closed', () => {
  for (const patch of [
    { endpoint: 'search' },
    { sourceId: '../x' },
    { targetIsbn: otherIsbn },
    { observedAt: null },
    { record: { ...result('google').record, source: 'isbndb' } },
  ]) {
    const p = packet(acquired(result('google', 300, patch)))
    assert.equal(p.state, 'identity_review')
    assert.equal(p.candidateValue, null)
    assert.deepEqual(p.observations, [])
  }
  assert.equal(packet(acquired(result('google'), result('google'))).state, 'identity_review')
  assert.equal(packet({ ...acquired(), unknown: result('google') }).state, 'unavailable')
  const p = packet()
  assert.equal(p.automatic, false)
  assert.equal(p.independentLineageEstablished, false)
  assert.throws(() => JSON.stringify(p), /memory_only/)
  assert.equal('patch' in p, false)
})

test('aggregate evaluation excludes identities, values, URLs and credentials; reference cannot affect requests', async () => {
  const a = make(),
    b = make()
  const first = await runEditionPages(frame(), { client: a.client })
  const changed = frame()
  changed.cases[0].reference.pages = 299
  const second = await runEditionPages(changed, { client: b.client })
  assert.deepEqual(
    a.calls.map((c) => c.url.href),
    b.calls.map((c) => c.url.href),
  )
  assert.equal(first.candidates.agrees, 1)
  assert.equal(second.candidates.differs, 1)
  assert.deepEqual(first.states, second.states)
  const serialized = JSON.stringify(first)
  for (const secret of [
    identity.isbn,
    identity.title,
    identity.authors[0],
    'synthetic-secret',
    'googleapis.com',
    'safe-ID_123',
    'publisher.example',
  ])
    assert.equal(serialized.includes(secret), false)
  assert.equal(first.automaticFills, 0)
  assert.equal(first.productionWrites, 0)
  assert.equal(first.modelCalls, 0)
  assert.ok(Number.isFinite(first.acquisitionWallMs) && first.acquisitionWallMs >= 0)
})

test('candidate agreement never hides the James-shaped remaining detail discrepancy', async () => {
  const { client } = make({
    fetcher: async (url) =>
      url.hostname === 'openlibrary.org'
        ? new Response(null, { status: 404 })
        : json(
            url.pathname.endsWith('/volumes')
              ? search(volume({ pageCount: 0 }))
              : volume({ pageCount: 302 }),
          ),
  })
  const input = frame()
  input.cases[0].reference.pages = 320
  const r = await runEditionPages(input, { client })
  assert.equal(r.candidates.differs, 1)
  assert.equal(r.candidates.agrees, 0)
  assert.equal(r.automaticFills, 0)
})

test('consumed frame must match the lock; alternate ISBN of a consumed title also refuses', async () => {
  const consumed = JSON.parse(
    await readFile(new URL('../data/metadata-value.example.json', import.meta.url)),
  )
  const expected = createValueStudyLock(consumed, '0'.repeat(64)).frameSha256
  assert.throws(() => assertFreshEditionFrame(frame(), consumed), /wrong_consumed_frame/)
  const input = frame()
  input.cases[0].identity.isbn = consumed.cases[0].identity.isbn
  assert.throws(() => assertFreshEditionFrame(input, consumed, expected), /consumed_work_overlap/)
  input.cases[0].identity.isbn = otherIsbn
  input.cases[0].identity.title = consumed.cases[0].identity.title + ': New edition'
  assert.throws(() => assertFreshEditionFrame(input, consumed, expected), /consumed_work_overlap/)
  input.cases[0].identity.title = 'A different synthetic book'
  assert.doesNotThrow(() => assertFreshEditionFrame(input, consumed, expected))
})

test('CLI live preflight refuses missing or wrong consumed frame before loading an absent env file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reverie-edition-preflight-'))
  try {
    const input = frame()
    // Only exercises preflight; no client is created and this reference is never fetched.
    input.cases[0].reference.source = 'https://publisher.invalid/synthetic-preflight-only'
    const inputPath = join(directory, 'input.json')
    const consumedPath = join(directory, 'wrong-consumed.json')
    await writeFile(inputPath, JSON.stringify(input))
    await writeFile(
      consumedPath,
      await readFile(new URL('../data/metadata-value.example.json', import.meta.url)),
    )
    const args = ['--input', inputPath, '--live', '--env', join(directory, 'absent.env')]
    const noReport = () => assert.fail('refused preflight cannot emit a report')
    await assert.rejects(main(args, noReport), /consumed_frame_required/)
    await assert.rejects(
      main([...args, '--consumed-frame', consumedPath], noReport),
      /wrong_consumed_frame/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('CLI dry run and help execute without keys or network; synthetic live input refuses', () => {
  const cwd = fileURLToPath(new URL('..', import.meta.url))
  const run = (args) =>
    spawnSync(process.execPath, ['src/edition-pages.mjs', ...args], { cwd, encoding: 'utf8' })
  const dry = run(['--input', 'data/edition-pages.example.json', '--env', '/missing/file'])
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(JSON.parse(dry.stdout).mode, 'dry_run')
  assert.equal(JSON.parse(dry.stdout).transport, null)
  assert.equal(run(['--help']).status, 0)
  assert.notEqual(
    run(['--input', 'data/edition-pages.example.json', '--live', '--env', '/missing/file']).status,
    0,
  )
  assert.notEqual(run(['--input', 'data/edition-pages.example.json', '--refresh']).status, 0)
  assert.throws(() => validateEditionPages({ ...frame(), purpose: 'qualification' }))
})
