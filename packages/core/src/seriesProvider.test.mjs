import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Execute the actual handler, with every outbound request intercepted. Not a hosted Deno test.
let handler, env, cache, upstream, requests, logs
const success = {
  data: {
    series: [
      {
        id: 7,
        name: 'The Sequence',
        books_count: 2,
        book_series: [
          {
            position: 1,
            book: { title: 'First Book', contributions: [{ author: { name: 'Ada Reader' } }] },
          },
        ],
      },
    ],
  },
}

beforeEach(() => {
  vi.resetModules()
  env = {
    SUPABASE_URL: 'https://database.invalid',
    SUPABASE_ANON_KEY: 'synthetic-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
    HARDCOVER_TOKEN: 'synthetic-token',
  }
  cache = new Map()
  requests = []
  upstream = async () => Response.json(success)
  logs = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('Deno', {
    env: { get: (key) => env[key] },
    serve: (fn) => {
      handler = fn
    },
  })
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init = {}) => {
      const u = new URL(url)
      if (u.hostname === 'api.hardcover.app') {
        requests.push(init)
        return upstream(url, init)
      }
      if (u.hostname !== 'database.invalid') throw new Error('Unexpected outbound request')
      if (u.pathname === '/auth/v1/user') return Response.json({ id: 'synthetic-reader' })
      if (u.pathname === '/rest/v1/releases_cache') {
        if (init.method === 'POST') {
          const row = JSON.parse(init.body)
          cache.set(row.cache_key, row)
          return Response.json(null)
        }
        const key = u.searchParams.get('cache_key').replace(/^eq\./, '')
        return Response.json(cache.has(key) ? [cache.get(key)] : [])
      }
      throw new Error('Unexpected database request')
    }),
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function boot() {
  await import('../../../supabase/functions/series/index.ts')
}
async function request(body = { name: 'The Sequence', author: 'Ada Reader' }) {
  const response = await handler(
    new Request('https://function.invalid/series', {
      method: 'POST',
      headers: { Authorization: 'Bearer synthetic-reader' },
      body: JSON.stringify(body),
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

describe('duplicate series names with an explicit book target', () => {
  const target = {
    name: 'The Sequence',
    author: 'Ada Reader',
    title: 'Fourth Book',
    hardcoverBookId: 42,
  }
  function duplicates() {
    const row = (id, title, position) => ({
      position,
      book: { id, title, contributions: [{ author: { name: 'Ada Reader' } }] },
    })
    // The larger, first result is deliberately NOT the right relationship.
    const graphs = [
      {
        id: 8,
        name: target.name,
        books_count: 99,
        book_series: [row(50, 'Other Book', 1), row(51, 'Another Book', 2)],
      },
      { id: 7, name: target.name, books_count: 1, book_series: [row(42, target.title, 4)] },
    ]
    upstream = async (_url, init) => {
      const { query, variables } = JSON.parse(init.body)
      expect(variables).toEqual({ name: target.name })
      expect(query).not.toMatch(/_ilike|_like|_regex/)
      return Response.json({ data: { series: graphs } })
    }
    return graphs
  }

  it('selects only the unique exact book relationship in one bounded request', async () => {
    const graphs = duplicates()
    graphs[1].book_series[0].book.contributions.unshift({ author: { name: 'Translator Person' } })
    await boot()
    const result = await request(target)
    expect(result).toMatchObject({ sourceRef: '7', name: target.name, memberCount: null })
    expect(result.unavailable).toBeUndefined()
    expect(result.membershipEntries).toEqual([
      { title: target.title, author: target.author, position: 4 },
    ])
    expect(requests).toHaveLength(1)
    const query = JSON.parse(requests[0].body).query
    expect(query).toContain('limit: 5')
    expect(query).toContain('limit: 201')
    expect(query).toContain('contributions(limit: 51)')
    expect(await request(target)).toEqual(result)
    expect(requests).toHaveLength(1)
  })

  it.each([
    [
      'competing membership',
      (g) => g[0].book_series.push(structuredClone(g[1].book_series[0])),
      'ambiguous_relationship',
    ],
    [
      'duplicate target row',
      (g) => g[1].book_series.push(structuredClone(g[1].book_series[0])),
      'identity_mismatch',
    ],
    [
      'wrong full title',
      (g) => {
        g[1].book_series[0].book.title = 'Fourth Book: A Different Work'
      },
      'identity_mismatch',
    ],
    [
      'wrong full author',
      (g) => {
        g[1].book_series[0].book.contributions = [{ author: { name: 'A. Reader' } }]
      },
      'identity_mismatch',
    ],
    [
      'missing target',
      (g) => {
        g[1].book_series[0].book.id = 43
      },
      'ambiguous_relationship',
    ],
    [
      'series limit',
      (g) =>
        g.push(...Array.from({ length: 3 }, (_, i) => ({ ...structuredClone(g[0]), id: 10 + i }))),
      'relationship_limit',
    ],
    [
      'nonselected relationship limit',
      (g) => {
        g[0].book_series = Array(201).fill(g[0].book_series[0])
      },
      'relationship_limit',
    ],
    [
      'nonselected contributor limit',
      (g) => {
        g[0].book_series[0].book.contributions = Array(51).fill({ author: { name: 'Ada Reader' } })
      },
      'relationship_limit',
    ],
    [
      'missing relationship array',
      (g) => {
        delete g[0].book_series
      },
      'invalid_response',
    ],
    [
      'missing contributors',
      (g) => {
        delete g[0].book_series[0].book.contributions
      },
      'invalid_response',
    ],
    [
      'invalid series ID',
      (g) => {
        g[1].id = 0
      },
      'invalid_response',
    ],
    [
      'repeated series ID',
      (g) => {
        g[0].id = 7
      },
      'invalid_response',
    ],
  ])('refuses %s without another provider request', async (_label, mutate, failureCode) => {
    mutate(duplicates())
    await boot()
    expect(await request(target)).toMatchObject({ unavailable: true, sourceRef: null, failureCode })
    expect(requests).toHaveLength(1)
  })

  it('isolates target successes and failures from other books and name-only requests', async () => {
    duplicates()
    await boot()
    expect((await request(target)).sourceRef).toBe('7')
    expect(await request({ name: target.name, author: target.author })).toMatchObject({
      failureCode: 'ambiguous_relationship',
    })
    expect((await request({ ...target, hardcoverBookId: 50, title: 'Other Book' })).sourceRef).toBe(
      '8',
    )
    expect(await request({ ...target, title: 'Wrong Book' })).toMatchObject({
      failureCode: 'identity_mismatch',
    })
    expect(await request({ ...target, author: 'Other Author' })).toMatchObject({
      unavailable: true,
    })
    expect((await request(target)).sourceRef).toBe('7')
    expect(requests).toHaveLength(5)
  })

  it('does not reuse old cache semantics or let a recent name ambiguity block exact identity', async () => {
    duplicates()
    for (const key of [
      'series-exact-v1:["The Sequence","Ada Reader"]',
      'series-book-v1:["The Sequence","Ada Reader",42,"Fourth Book"]',
    ])
      cache.set(key, {
        payload: { unavailable: true, failureCode: 'ambiguous_relationship', httpStatus: 200 },
        fetched_at: new Date().toISOString(),
      })
    await boot()
    expect(await request({ name: target.name, author: target.author })).toMatchObject({
      failureCode: 'ambiguous_relationship',
    })
    expect((await request(target)).sourceRef).toBe('7')
    expect(requests).toHaveLength(2)
  })
})

describe('series relationship handler diagnostics and retry cache', () => {
  const target = {
    name: 'The Sequence (Reader)',
    author: 'Ada Reader',
    title: 'Fourth Book',
    hardcoverBookId: 42,
  }
  function fallback() {
    const book = {
      id: 42,
      title: 'Fourth Book',
      contributions: [{ author: { name: 'Ada Reader' } }],
      book_series: [{ series: { id: 7, name: 'The Sequence' } }],
    }
    const graph = structuredClone(success.data.series[0])
    graph.book_series.push({
      position: 4,
      book: { id: 42, title: 'Fourth Book', contributions: book.contributions },
    })
    upstream = async (_url, init) => {
      const { query, variables } = JSON.parse(init.body)
      expect(query).not.toMatch(/_ilike|_like|_regex/)
      if ('name' in variables) return Response.json({ data: { series: [] } })
      if (query.includes('books(where:')) {
        expect(variables).toEqual({ id: 42 })
        expect(query).toContain('book_series(limit: 21)')
        return Response.json({ data: { books: [book] } })
      }
      expect(variables).toEqual({ id: 7 })
      expect(query).toContain('limit: 201')
      return Response.json({ data: { series: [graph] } })
    }
    return { book, graph }
  }

  it('recovers a stale label through an exact book and series ID without declaring a length', async () => {
    fallback()
    await boot()
    const result = await request(target)
    expect(result).toMatchObject({ name: 'The Sequence', sourceRef: '7', memberCount: null })
    expect(result.unavailable).toBeUndefined()
    expect(result.membershipEntries).toContainEqual({
      title: 'Fourth Book',
      author: 'Ada Reader',
      position: 4,
    })
    expect(requests).toHaveLength(3)
    expect(await request(target)).toEqual(result)
    expect(requests).toHaveLength(3)
    expect([...cache.keys()]).toEqual([
      'series-exact-v2:["The Sequence (Reader)","Ada Reader"]',
      'series-book-v2:["The Sequence (Reader)","Ada Reader",42,"Fourth Book"]',
    ])
  })

  it('does not share fallback results with another title, author, book ID or name-only lookup', async () => {
    fallback()
    await boot()
    await request(target)
    expect(await request({ ...target, title: 'Different Book' })).toMatchObject({
      failureCode: 'identity_mismatch',
    })
    expect(await request({ ...target, author: 'Different Author' })).toMatchObject({
      failureCode: 'identity_mismatch',
    })
    upstream = async () => Response.json({ data: { series: [] } })
    await request({ ...target, hardcoverBookId: 43 })
    expect(await request({ name: target.name, author: target.author })).toMatchObject({
      failureCode: 'not_found',
    })
    expect(cache.size).toBe(6)
  })

  it.each([
    [
      'wrong title',
      ({ book }) => {
        book.title = 'Fourth Book: A Different Story'
      },
      'identity_mismatch',
      2,
    ],
    [
      'wrong author',
      ({ book }) => {
        book.contributions = [{ author: { name: 'A. Reader' } }]
      },
      'identity_mismatch',
      2,
    ],
    [
      'wrong book ID',
      ({ book }) => {
        book.id = 99
      },
      'identity_mismatch',
      2,
    ],
    [
      'no relationship',
      ({ book }) => {
        book.book_series = []
      },
      'empty_relationship',
      2,
    ],
    [
      'multiple relationships',
      ({ book }) => {
        book.book_series.push({ series: { id: 8, name: target.name } })
      },
      'ambiguous_relationship',
      2,
    ],
    [
      'duplicate relationship',
      ({ book }) => {
        book.book_series.push(book.book_series[0])
      },
      'ambiguous_relationship',
      2,
    ],
    [
      'relationship cap',
      ({ book }) => {
        book.book_series = Array(21).fill(book.book_series[0])
      },
      'relationship_limit',
      2,
    ],
    [
      'contributor cap',
      ({ book }) => {
        book.contributions = Array(51).fill(book.contributions[0])
      },
      'relationship_limit',
      2,
    ],
    [
      'invalid series ID',
      ({ book }) => {
        book.book_series[0].series.id = '7'
      },
      'invalid_response',
      2,
    ],
    [
      'changed graph ID',
      ({ graph }) => {
        graph.id = 8
      },
      'ambiguous_relationship',
      3,
    ],
    [
      'changed graph name',
      ({ graph }) => {
        graph.name = 'Other Sequence'
      },
      'ambiguous_relationship',
      3,
    ],
    [
      'graph missing target',
      ({ graph }) => {
        graph.book_series.pop()
      },
      'identity_mismatch',
      3,
    ],
    [
      'graph wrong target title',
      ({ graph }) => {
        graph.book_series[1].book.title = 'Other Book'
      },
      'identity_mismatch',
      3,
    ],
    [
      'graph missing author',
      ({ graph }) => {
        graph.book_series[1].book.contributions = []
      },
      'identity_mismatch',
      3,
    ],
    [
      'graph duplicate target',
      ({ graph }) => {
        graph.book_series.push(graph.book_series[1])
      },
      'identity_mismatch',
      3,
    ],
    [
      'graph cap',
      ({ graph }) => {
        graph.book_series = Array(201).fill(graph.book_series[1])
      },
      'relationship_limit',
      3,
    ],
  ])('refuses fallback %s', async (_label, mutate, failureCode, calls) => {
    mutate(fallback())
    await boot()
    expect(await request(target)).toMatchObject({
      unavailable: true,
      failureCode,
      entries: [],
      sourceRef: null,
    })
    expect(requests).toHaveLength(calls)
  })

  it('validates the expected author anywhere among contributors', async () => {
    const { book } = fallback()
    book.contributions.unshift({ author: { name: 'Other Contributor' } })
    await boot()
    expect((await request(target)).membershipEntries).toContainEqual({
      title: 'Fourth Book',
      author: 'Ada Reader',
      position: 4,
    })
  })

  it.each([401, 429, 503])('does not fallback after a name HTTP %s', async (status) => {
    upstream = async () => new Response('private response', { status })
    await boot()
    expect(await request(target)).toMatchObject({
      unavailable: true,
      failureCode: 'http_error',
      httpStatus: status,
    })
    expect(requests).toHaveLength(1)
  })

  it('does not fallback after a successful name match or ambiguous name graph', async () => {
    await boot()
    await request({ ...target, name: 'The Sequence' })
    expect(requests).toHaveLength(1)
    const data = structuredClone(success)
    data.data.series[0].book_series[0].book.id = 1
    data.data.series.push({ ...data.data.series[0], id: 8 })
    cache.clear()
    upstream = async () => Response.json(data)
    expect(await request({ ...target, name: 'The Sequence', hardcoverBookId: 43 })).toMatchObject({
      failureCode: 'ambiguous_relationship',
    })
    expect(requests).toHaveLength(2)
  })

  it('reuses shared successful name lookups across book locators without extra provider calls', async () => {
    await boot()
    const ordinary = await request()
    expect(await request({ ...target, name: 'The Sequence' })).toEqual(ordinary)
    expect(
      await request({ ...target, name: 'The Sequence', hardcoverBookId: 43, title: 'Other Book' }),
    ).toEqual(ordinary)
    expect(requests).toHaveLength(1)
    expect(cache.size).toBe(1)
  })

  it.each([2, 3])('stops and redacts a failure at fallback request %s', async (call) => {
    fallback()
    const ok = upstream
    upstream = (url, init) =>
      requests.length === call ? new Response('private response', { status: 403 }) : ok(url, init)
    await boot()
    expect(await request(target)).toMatchObject({
      unavailable: true,
      failureCode: 'http_error',
      httpStatus: 403,
    })
    expect(requests).toHaveLength(call)
    expect(JSON.stringify([...cache.values()])).not.toContain('private response')
  })

  it.each([2, 3])('bounds fallback request %s by its deadline without retrying', async (call) => {
    vi.useFakeTimers()
    fallback()
    const ok = upstream
    upstream = (url, init) =>
      requests.length === call
        ? new Promise((_resolve, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('private timeout'))),
          )
        : ok(url, init)
    await boot()
    const pending = request(target)
    await vi.advanceTimersByTimeAsync(5001)
    expect(await pending).toMatchObject({ unavailable: true, failureCode: 'timeout' })
    expect(requests).toHaveLength(call)
  })

  it.each(['42', -1, 0, 1.5, 2147483648, null])(
    'rejects invalid book ID %s before provider calls',
    async (hardcoverBookId) => {
      await boot()
      const result = await handler(
        new Request('https://function.invalid/series', {
          method: 'POST',
          headers: { Authorization: 'Bearer synthetic-reader' },
          body: JSON.stringify({ ...target, hardcoverBookId }),
        }),
      )
      expect(result.status).toBe(400)
      expect(requests).toHaveLength(0)
    },
  )

  it('uses exact queries and keeps case-sensitive misses separate from successful lookups', async () => {
    cache.set('series:the sequence|ada reader', {
      fetched_at: new Date().toISOString(),
      payload: { entries: [], memberCount: 99 },
    })
    await boot()
    expect(await request({ name: 'the sequence', author: 'Ada Reader' })).toMatchObject({
      unavailable: true,
    })
    expect((await request()).entries[0].title).toBe('First Book')
    expect(requests).toHaveLength(2)
    expect(JSON.parse(requests[1].body).query).toContain('name: { _eq: $name }')
    expect(JSON.parse(requests[1].body).query).not.toMatch(/_ilike|_like|_regex/)
    expect(JSON.parse(requests[1].body).variables).toEqual({ name: 'The Sequence' })
  })

  it('matches a later contributor and withholds translation/set collisions without inventing length', async () => {
    // Synthetic shape of the owner-provided response; not a qualification/gold fixture.
    const rows = [
      [1, 'Translated First'],
      [1, 'First Book'],
      [1, 'The Sequence 2-Book Set'],
      [1, 'First Book, Second Book'],
      [2, 'Translated Second'],
      [2, 'Second Book'],
      [0, 'Unnumbered Translation'],
      [3, 'Third Book'],
      [4, 'The Sequence Omnibus'],
    ].map(([position, title]) => ({
      position,
      book: {
        title,
        contributions: [
          { author: { name: 'Other Contributor' } },
          { author: { name: 'Ada Reader' } },
        ],
      },
    }))
    upstream = async () =>
      Response.json({
        data: { series: [{ id: 7, name: 'The Sequence', books_count: 3, book_series: rows }] },
      })
    await boot()
    const result = await request()
    expect(result.memberCount).toBeNull()
    expect(result.membershipEntries).toHaveLength(9)
    expect(result.membershipEntries).toContainEqual({
      title: 'First Book',
      author: 'Ada Reader',
      position: 1,
    })
    expect(result.entries).toEqual([{ title: 'Third Book', author: 'Ada Reader', position: 3 }])
  })

  it('clears conflicting ordinals for one identity rather than choosing the first', async () => {
    const data = structuredClone(success)
    data.data.series[0].book_series.push({ ...data.data.series[0].book_series[0], position: 2 })
    upstream = async () => Response.json(data)
    await boot()
    const result = await request()
    expect(result.entries).toEqual([])
    expect(result.membershipEntries).toEqual([
      { title: 'First Book', author: 'Ada Reader', position: 0 },
    ])
  })

  it('refuses two homonymous relationships instead of preferring the largest', async () => {
    const data = structuredClone(success)
    data.data.series.push({ ...data.data.series[0], id: 8, books_count: 500 })
    upstream = async () => Response.json(data)
    await boot()
    expect(await request()).toMatchObject({
      unavailable: true,
      failureCode: 'ambiguous_relationship',
      entries: [],
    })
  })

  it('also uses exact matching for the sibling book-tags request', async () => {
    upstream = async () => Response.json({ data: { books: [] } })
    await boot()
    expect(await request({ mode: 'book-tags', title: 'First Book', author: 'Ada Reader' })).toEqual(
      { tags: [] },
    )
    expect(JSON.parse(requests[0].body).query).toContain('title: { _eq: $title }')
  })

  it.each(['synthetic-token', ' Bearer synthetic-token ', 'bearer synthetic-token'])(
    'accepts bare and dashboard-prefixed credentials (%s)',
    async (token) => {
      env.HARDCOVER_TOKEN = token
      await boot()
      const result = await request()
      expect(result.entries).toEqual([{ title: 'First Book', author: 'Ada Reader', position: 1 }])
      expect(requests[0].headers.Authorization).toBe('Bearer synthetic-token')
      expect(result.unavailable).toBeUndefined()
      expect(logs).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['http_error', () => new Response('private upstream text', { status: 401 }), 401],
    ['http_error', () => new Response('not json', { status: 429 }), 429],
    ['http_error', () => new Response('gateway', { status: 503 }), 503],
    [
      'graphql_error',
      () => Response.json({ errors: [{ message: 'private upstream text' }], ...success }),
      200,
    ],
    ['invalid_response', () => new Response('not json'), 200],
    ['invalid_response', () => Response.json({ data: {} }), 200],
    ['not_found', () => Response.json({ data: { series: [] } }), 200],
    [
      'ambiguous_relationship',
      () => Response.json({ data: { series: [{ book_series: [] }] } }),
      200,
    ],
    [
      'network_error',
      () => {
        throw new Error('private upstream text')
      },
      undefined,
    ],
  ])(
    'returns a bounded %s diagnostic, not a no-series assertion',
    async (failureCode, response, status) => {
      upstream = response
      await boot()
      const result = await request()
      expect(result).toMatchObject({ unavailable: true, entries: [], sourceRef: null, failureCode })
      expect(result.httpStatus).toBe(status)
      expect(logs).toHaveBeenCalledTimes(1)
      const log = JSON.parse(logs.mock.calls[0][0])
      expect(log).toMatchObject({ fn: 'series', event: 'relationship_unavailable', failureCode })
      const persisted = JSON.stringify([...cache.values()]) + JSON.stringify(logs.mock.calls)
      expect(persisted).not.toMatch(/private upstream text|synthetic-token|Authorization/)
    },
  )

  it('identifies missing configuration without calling Hardcover', async () => {
    delete env.HARDCOVER_TOKEN
    await boot()
    expect(await request()).toMatchObject({ unavailable: true, failureCode: 'not_configured' })
    expect(requests).toHaveLength(0)
  })

  it('distinguishes a deadline from a network failure', async () => {
    vi.useFakeTimers()
    upstream = (_url, init) =>
      new Promise((_resolve, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('private timeout detail'))),
      )
    await boot()
    const pending = request()
    await vi.advanceTimersByTimeAsync(5001)
    expect(await pending).toMatchObject({ unavailable: true, failureCode: 'timeout' })
  })

  it.each([true, false])(
    'retries an unavailable cache after five minutes (new diagnostic=%s)',
    async (diagnostic) => {
      const key = 'series-exact-v2:["The Sequence","Ada Reader"]'
      cache.set(key, {
        cache_key: key,
        fetched_at: new Date(Date.now() - 6 * 60_000).toISOString(),
        payload: {
          name: 'The Sequence',
          entries: [],
          unavailable: true,
          ...(diagnostic ? { failureCode: 'http_error', httpStatus: 503 } : {}),
        },
      })
      await boot()
      expect((await request()).entries).toHaveLength(1)
      expect(requests).toHaveLength(1)
    },
  )

  it('uses a recent failure cache to avoid immediate retry storms', async () => {
    upstream = () => new Response('', { status: 503 })
    await boot()
    const first = await request()
    expect(await request()).toEqual(first)
    expect(requests).toHaveLength(1)
  })

  it('continues to share successful relationships for 24 hours', async () => {
    await boot()
    const first = await request()
    const row = [...cache.values()][0]
    row.fetched_at = new Date(Date.now() - 60 * 60_000).toISOString()
    expect(await request()).toEqual(first)
    expect(requests).toHaveLength(1)
  })
})
