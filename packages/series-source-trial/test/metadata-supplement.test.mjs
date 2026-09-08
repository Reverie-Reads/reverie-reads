import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  canonicalIsbn,
  validateInput,
  planSupplement,
  assessSupplement,
  runSupplement,
} from '../src/metadata/supplement.mjs'
import { createIsbndbClient } from '../src/metadata/isbndb-client.mjs'

// Synthetic metadata, never a provider response or production/qualification identity.
const identity = { isbn: '9780316565202', title: 'The Example Book', authors: ['Ada Example'] }
const base = {
  source: 'google',
  isbns: [identity.isbn],
  title: identity.title,
  authors: identity.authors,
}
const example = () => ({
  identity: structuredClone(identity),
  baseline: [structuredClone(base)],
  current: { pages: null, editionFormat: null },
})
const input = (c = example()) => ({ version: 1, purpose: 'development', cases: [c] })
const response = (patch = {}) => ({
  book: {
    isbn13: identity.isbn,
    title: identity.title,
    authors: identity.authors,
    pages: 300,
    binding: 'Paperback',
    ...patch,
  },
})
const client = (fetcher, options = {}) =>
  createIsbndbClient({ key: 'synthetic-only', fetcher, sleeper: async () => {}, ...options })

test('checksum-valid equivalent ISBNs only; no URLs, prefixes, invalid checksums', () => {
  assert.equal(canonicalIsbn('0316565202'), identity.isbn)
  assert.equal(canonicalIsbn('978-0-316-56520-2'), identity.isbn)
  for (const v of ['9780316565203', 'ISBN:9780316565202', 'https://x/9780316565202', '../x', null])
    assert.equal(canonicalIsbn(v), null)
})
test('input refuses private fields, unsupported providers, duplicated records and unbounded budgets', () => {
  assert.equal(validateInput(input()).cases.length, 1)
  for (const change of [
    (c) => {
      c.notes = 'private'
    },
    (c) => {
      c.baseline[0].source = 'isbndb'
    },
    (c) => {
      c.current.pages = 0
    },
    (c) => {
      c.baseline.push(c.baseline[0])
    },
    (c) => {
      c.identity.authors = ['!!!']
    },
  ]) {
    const c = example()
    change(c)
    assert.throws(() => validateInput(input(c)))
  }
  assert.throws(
    () => validateInput({ ...input(), cases: [example(), example()] }),
    /duplicate_isbn/,
  )
  assert.throws(() => validateInput({ ...input(), cases: Array.from({ length: 21 }, example) }))
  assert.throws(() => createIsbndbClient({ maxRequests: 21 }), /invalid_budget/)
})
test('no baseline, mismatched edition, author initials, title suffix, or mixed ISBNs cannot trigger paid lookup', () => {
  for (const change of [
    (c) => {
      c.baseline = []
    },
    (c) => {
      c.baseline[0].title += ' (Adaptation)'
    },
    (c) => {
      c.baseline[0].authors = ['A. Example']
    },
    (c) => {
      c.baseline[0].isbns.push('9781250890313')
    },
  ]) {
    const c = example()
    change(c)
    assert.equal(planSupplement(c).status, 'identity_review')
  }
})
test('Unicode identities do not collapse into equal empty ASCII strings', () => {
  const c = example()
  c.identity.title = '星の本'
  c.baseline[0].title = '別の本'
  assert.equal(planSupplement(c).status, 'identity_review')
  c.baseline[0].title = c.identity.title
  assert.equal(planSupplement(c).status, 'lookup')
})
test('current or baseline-complete metadata makes zero paid calls', async () => {
  for (const where of ['current', 'baseline']) {
    const c = example()
    Object.assign(where === 'current' ? c.current : c.baseline[0], {
      pages: 300,
      editionFormat: 'paperback',
    })
    let calls = 0
    const result = await runSupplement(input(c), {
      live: true,
      client: client(async () => {
        calls++
        throw new Error('must not call')
      }),
    })
    assert.equal(result.requests, 0)
    assert.equal(calls, 0)
    assert.equal(result.plans.skip, 1)
  }
})
test('conflicting baseline formats stop all supplementation, not an arbitrary winner', () => {
  const c = example()
  c.baseline[0].editionFormat = 'paperback'
  c.baseline.push({ ...base, source: 'openlibrary', editionFormat: 'audiobook' })
  assert.equal(planSupplement(c).status, 'edition_review')
})
test('audiobook pages are not a gap', () => {
  const c = example()
  c.current.editionFormat = 'audiobook'
  assert.equal(planSupplement(c).status, 'skip')
  assert.equal(planSupplement(c).fields.pages, 'not_applicable')
})
test('dry run performs no client access', async () => {
  const result = await runSupplement(input(), {
    client: new Proxy(
      {},
      {
        get() {
          throw new Error('access forbidden')
        },
      },
    ),
  })
  assert.equal(result.plans.lookup, 1)
  assert.equal(result.requests, 0)
})
test('returned identity and contributor differences are review-only without values', () => {
  const c = example()
  for (const patch of [
    { isbn13: '9781250890313' },
    { isbn: 'bad' },
    { title: identity.title + ' (Series)' },
    { authors: ['A. Example'] },
    { authors: [...identity.authors, 'Narrator Person'] },
  ]) {
    const result = assessSupplement(c, planSupplement(c), response(patch))
    assert.equal(result.status, 'review')
    assert.deepEqual(result.proposals, [])
  }
})
test('comma-inverted full author and equivalent ISBN-10 match', () => {
  const c = example()
  const result = assessSupplement(
    c,
    planSupplement(c),
    response({ isbn: '0316565202', authors: ['Example, Ada'] }),
  )
  assert.equal(result.proposals.length, 2)
})

test('a conflicting longer title cannot hide edition qualifiers behind the exact short title', () => {
  const c = example()
  for (const title_long of [
    identity.title + ': Abridged Edition',
    identity.title + ' (Graphic Novel)',
    { malformed: true },
  ]) {
    const result = assessSupplement(c, planSupplement(c), response({ title_long }))
    assert.equal(result.reason, 'qualified_title_review')
    assert.deepEqual(result.proposals, [])
  }
  assert.equal(
    assessSupplement(c, planSupplement(c), response({ title_long: identity.title })).proposals
      .length,
    2,
  )
})
test('only missing pages and editionFormat are ephemeral candidates; forbidden source fields cannot leak', () => {
  const c = example()
  const result = assessSupplement(
    c,
    planSupplement(c),
    response({
      series: 'Forbidden series',
      synopsis: 'Forbidden description',
      publisher: 'Forbidden publisher',
      image: 'https://forbidden.example',
      date_published: '2025',
    }),
  )
  assert.deepEqual(
    result.proposals.map((p) => [p.field, p.value]),
    [
      ['pages', 300],
      ['editionFormat', 'paperback'],
    ],
  )
  assert.ok(
    result.proposals.every(
      (p) => p.reviewOnly && p.retention === 'memory_only' && p.source === 'isbndb',
    ),
  )
  assert.equal(JSON.stringify(result).includes('Forbidden'), false)
})
test('existing values are never overwritten; differences are reported', () => {
  const c = example()
  c.current.pages = 400
  const result = assessSupplement(c, planSupplement(c), response())
  assert.deepEqual(result.conflicts, ['pages'])
  assert.deepEqual(
    result.proposals.map((p) => p.field),
    ['editionFormat'],
  )
  assert.equal(c.current.pages, 400)
})
test('baseline available values cannot be turned into a paid candidate', () => {
  const c = example()
  c.baseline[0].pages = 300
  assert.deepEqual(
    assessSupplement(c, planSupplement(c), response()).proposals.map((p) => p.field),
    ['editionFormat'],
  )
})
test('format and language conflicts block all candidate fields', () => {
  const c = example()
  c.current.editionFormat = 'paperback'
  c.identity.language = 'en'
  for (const patch of [
    { binding: 'Hardcover' },
    { binding: 'unknown carrier' },
    { language: 'spa' },
  ])
    assert.deepEqual(assessSupplement(c, planSupplement(c), response(patch)).proposals, [])
})
test('zero, oversized, fractional and string pages do not become valid counts', () => {
  const c = example()
  for (const value of [0, -1, 20001, 3.5, '300'])
    assert.equal(
      assessSupplement(c, planSupplement(c), response({ pages: value })).proposals.some(
        (p) => p.field === 'pages',
      ),
      false,
    )
})
test('aggregate runner never exposes identities, provider values, descriptions, or credentials', async () => {
  const result = await runSupplement(input(), {
    live: true,
    client: client(
      async () => new Response(JSON.stringify(response({ synopsis: 'sensitive-prose' }))),
    ),
  })
  const serialized = JSON.stringify(result)
  for (const value of [
    identity.isbn,
    identity.title,
    identity.authors[0],
    'sensitive-prose',
    'synthetic-only',
    '300',
  ])
    assert.equal(serialized.includes(value), false)
  assert.equal(result.fields.pages.candidate, 1)
  assert.equal(result.requests, 1)
  assert.equal(result.productionWrites, 0)
})
test('fixed host, header-only key, manual redirects, signal and pacing survive concurrent callers', async () => {
  const starts = [],
    waits = []
  let time = 0
  const c = client(
    async (url, options) => {
      assert.equal(url, 'https://api2.isbndb.com/book/' + identity.isbn)
      assert.equal(options.headers.Authorization, 'synthetic-only')
      assert.equal(options.redirect, 'manual')
      assert.ok(options.signal)
      starts.push(time)
      return new Response('{}')
    },
    {
      now: () => time,
      sleeper: async (ms) => {
        waits.push(ms)
        time += ms
      },
    },
  )
  await Promise.all([c.lookup(identity.isbn), c.lookup(identity.isbn), c.lookup(identity.isbn)])
  assert.deepEqual(starts, [0, 1100, 2200])
  assert.deepEqual(waits, [0, 1100, 1100])
})
test('missing key and invalid ISBN make zero requests', async () => {
  const c = createIsbndbClient({
    fetcher: async () => {
      throw new Error('must not call')
    },
  })
  assert.equal((await c.lookup('invalid')).status, 'invalid_isbn')
  assert.equal((await c.lookup(identity.isbn)).status, 'missing_key')
  assert.equal(c.stats.requests, 0)
})
test('HTML auth/quota errors preserve status and stop rather than retry', async () => {
  for (const [status, reason] of [
    [401, 'authentication'],
    [403, 'authentication'],
    [429, 'rate_limited'],
  ]) {
    const c = client(async () => new Response('<html>private</html>', { status }))
    assert.equal((await c.lookup(identity.isbn)).status, reason)
    assert.equal((await c.lookup(identity.isbn)).status, 'not_attempted')
    assert.equal(c.stats.requests, 1)
  }
})
test('redirects are refused without forwarding the credential', async () => {
  const c = client(
    async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }),
  )
  assert.equal((await c.lookup(identity.isbn)).status, 'redirect_refused')
  assert.equal(c.stats.requests, 1)
})
test('404 is distinct from infrastructure failure; two consecutive failures stop', async () => {
  const missing = client(async () => new Response(null, { status: 404 }))
  assert.equal((await missing.lookup(identity.isbn)).status, 'not_found')
  assert.equal(missing.stats.stopped, null)
  const failed = client(async () => {
    throw new Error('credential-or-provider-text')
  })
  assert.equal((await failed.lookup(identity.isbn)).status, 'network_error')
  assert.equal((await failed.lookup(identity.isbn)).status, 'network_error')
  assert.equal((await failed.lookup(identity.isbn)).status, 'not_attempted')
  assert.equal(failed.stats.requests, 2)
})
test('response size, malformed JSON, and request budget are bounded', async () => {
  assert.equal(
    (await client(async () => new Response('x'.repeat(262145))).lookup(identity.isbn)).status,
    'response_too_large',
  )
  assert.equal(
    (await client(async () => new Response('{')).lookup(identity.isbn)).status,
    'invalid_json',
  )
  const c = client(async () => new Response('{}'), { maxRequests: 1 })
  await c.lookup(identity.isbn)
  assert.equal((await c.lookup(identity.isbn)).status, 'not_attempted')
  assert.equal(c.stats.requests, 1)
})
test('CLI help is runnable; failures redact untrusted arguments and filenames', () => {
  const entry = fileURLToPath(new URL('../src/supplement-metadata.mjs', import.meta.url))
  const help = spawnSync(process.execPath, [entry, '--help'], { encoding: 'utf8' })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /aggregate counts/)
  const bad = spawnSync(process.execPath, [entry, '--sensitive-secret'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.equal((bad.stdout + bad.stderr).includes('sensitive-secret'), false)
})

test('CLI executes the committed dry-run fixture without reading an invalid credential path', () => {
  const entry = fileURLToPath(new URL('../src/supplement-metadata.mjs', import.meta.url))
  const fixture = fileURLToPath(
    new URL('../data/metadata-supplement.example.json', import.meta.url),
  )
  const envDirectory = fileURLToPath(new URL('../data/', import.meta.url))
  const result = spawnSync(process.execPath, [entry, '--input', fixture, '--env', envDirectory], {
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)
  assert.equal(report.mode, 'dry_run')
  assert.equal(report.requests, 0)
  assert.equal(report.plans.lookup, 1)
  assert.equal(result.stdout.includes('Ada Example'), false)
})

test('infrastructure counter resets after a successful request and timeouts are redacted', async () => {
  let attempt = 0
  const c = client(async () => {
    attempt++
    if (attempt === 2) return new Response('{}')
    throw new DOMException('sensitive timeout details', 'TimeoutError')
  })
  assert.equal((await c.lookup(identity.isbn)).status, 'timeout')
  assert.equal((await c.lookup(identity.isbn)).status, 'ok')
  assert.equal((await c.lookup(identity.isbn)).status, 'timeout')
  assert.equal(c.stats.stopped, null)
  assert.equal((await c.lookup(identity.isbn)).status, 'timeout')
  assert.equal(c.stats.stopped, 'infrastructure_failures')
})
