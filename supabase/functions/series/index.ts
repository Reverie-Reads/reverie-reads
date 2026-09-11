// Canonical series data (docs/archive/task-series-experience.md §2) — the releases fn's sibling.
// One mode: { name, author? } → the canonical entry list for that series, seeded from Hardcover
// (GraphQL, free Bearer token, 60 req/min) and cached per series daily in the shared
// releases_cache (versioned, exact name/author key; failures expire after five minutes),
// so one upstream lookup serves every
// reader without letting two authors' identically named series share the wrong cached graph.
//
// The CLIENT owns the merge: source entries only fill gaps in series_entries and never touch a
// user_edited row — this function just returns what the catalog knows. No token configured
// (HARDCOVER_TOKEN unset) or nothing found → { entries: [], unavailable: true }: indie/KU series
// often have no source data at all, and manual creation is first-class.

import { captureEdgeError, logEvent } from '../_shared/observe.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// Match enrich: both a bare token and the dashboard's Bearer-prefixed form are accepted.
const HARDCOVER_TOKEN = (Deno.env.get('HARDCOVER_TOKEN') ?? '')
  .trim()
  .replace(/^Bearer\s+/i, '')
  .trim()

const svc = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
}

const TTL_MS = 24 * 60 * 60 * 1000
const UNAVAILABLE_TTL_MS = 5 * 60 * 1000
/** Each lookup is capped; the opt-in name-miss fallback makes at most three lookups (15s total). */
const FETCH_WALL_MS = 5000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

async function authorizeSweep(
  runId: string,
  workId: string,
  authorization: string,
): Promise<boolean> {
  try {
    const response = await fetch(`${DB_URL}/rest/v1/rpc/service_authorize_corpus_sweep_work`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_run: runId, p_work: workId }),
    })
    if (!response.ok) return false
    return typeof (await response.json()) === 'string'
  } catch {
    return false
  }
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** What the client merges from: one canonical slot per entry. */
interface SourceEntry {
  position: number
  title: string
  author: string
}
interface BookTarget {
  hardcoverBookId: number
  title: string
}
interface SeriesPayload {
  name: string
  sourceRef: string | null
  /** Unknown: Hardcover's books_count and relationship rows mix works, editions and sets. */
  memberCount: number | null
  /** Exact-work observations, NOT canonical slots or a declared series length. */
  membershipEntries?: SourceEntry[]
  /** Only unambiguous numbered slots may seed a personal shelf. */
  entries: SourceEntry[]
  unavailable?: boolean
  failureCode?:
    | 'not_configured'
    | 'http_error'
    | 'graphql_error'
    | 'invalid_response'
    | 'not_found'
    | 'empty_relationship'
    | 'ambiguous_relationship'
    | 'identity_mismatch'
    | 'relationship_limit'
    | 'timeout'
    | 'network_error'
    | 'internal_error'
  httpStatus?: number
}
interface SeriesLookup {
  payload: SeriesPayload
  /** Internal routing metadata; never exposed or persisted in a provider payload. */
  bookScoped: boolean
}

async function cacheGet(key: string): Promise<SeriesPayload | null> {
  const res = await fetch(
    `${DB_URL}/rest/v1/releases_cache?cache_key=eq.${encodeURIComponent(key)}&select=payload,fetched_at`,
    { headers: svc },
  )
  if (!res.ok) return null
  const rows = (await res.json()) as { payload: SeriesPayload; fetched_at: string }[]
  const row = rows[0]
  if (!row) return null
  const ttl = row.payload.unavailable ? UNAVAILABLE_TTL_MS : TTL_MS
  if (Date.now() - Date.parse(row.fetched_at) > ttl) return null
  return row.payload
}

async function cacheSet(key: string, payload: SeriesPayload): Promise<void> {
  await fetch(`${DB_URL}/rest/v1/releases_cache?on_conflict=cache_key`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ cache_key: key, payload, fetched_at: new Date().toISOString() }),
  })
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Hardcover GraphQL: find the series by name, pull its books in position order. Parsed
 *  defensively — the schema drifts, and a miss must degrade to "no data", never a 500. */
async function fetchHardcoverSeries(
  name: string,
  author: string,
  selected?: { seriesId: number; target: BookTarget },
  target?: BookTarget,
): Promise<SeriesLookup> {
  let bookScoped = false
  const empty: SeriesPayload = {
    name,
    sourceRef: null,
    memberCount: null,
    entries: [],
    unavailable: true,
  }
  // Only fixed codes and numeric HTTP status may reach diagnostics. Never log queries, names,
  // credentials, response bodies or GraphQL error messages (which can echo sensitive input).
  const failed = (
    failureCode: NonNullable<SeriesPayload['failureCode']>,
    httpStatus?: number,
  ): SeriesLookup => {
    logEvent('warn', 'series', 'relationship_unavailable', {
      provider: 'hardcover',
      failureCode,
      httpStatus,
    })
    return { payload: { ...empty, failureCode, ...(httpStatus ? { httpStatus } : {}) }, bookScoped }
  }
  if (!HARDCOVER_TOKEN) return failed('not_configured')
  const query = `
    query (${selected ? '$id: Int!' : '$name: String!'}) {
      series(where: { ${selected ? 'id: { _eq: $id }' : 'name: { _eq: $name }'} }, limit: 5) {
        id
        name
        books_count
        book_series(limit: 201, order_by: { position: asc }, where: { book: { book_status_id: { _eq: 1 } } }) {
          position
          book {
            id
            title
            contributions(limit: 51) { author { name } }
          }
        }
      }
    }`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_WALL_MS)
  let receivedResponse = false
  try {
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HARDCOVER_TOKEN}` },
      body: JSON.stringify({ query, variables: selected ? { id: selected.seriesId } : { name } }),
    })
    receivedResponse = true
    if (!res.ok) return failed('http_error', res.status)
    const body = (await res.json().catch(() => null)) as any
    if (ctrl.signal.aborted) return failed('timeout', res.status)
    if (body?.errors?.length) return failed('graphql_error', res.status)
    if (!Array.isArray(body?.data?.series)) return failed('invalid_response', res.status)
    const all: any[] = body.data.series
    if (!all.length) return failed('not_found', res.status)
    // A sentinel hit cannot establish uniqueness, including in a non-selected graph.
    if (all.length >= 5) return failed('relationship_limit', res.status)
    if (all.some((s) => !Array.isArray(s?.book_series)))
      return failed('invalid_response', res.status)
    if (
      all.some(
        (s) =>
          s.book_series.length >= 201 ||
          s.book_series.some((row: any) => row?.book?.contributions?.length >= 51),
      )
    )
      return failed('relationship_limit', res.status)
    if (selected) {
      if (all.length !== 1 || all[0]?.id !== selected.seriesId || all[0]?.name !== name)
        return failed('ambiguous_relationship', res.status)
      const rows = all[0].book_series
      if (!Array.isArray(rows)) return failed('invalid_response', res.status)
      if (rows.length >= 201 || rows.some((row: any) => row.book?.contributions?.length >= 51))
        return failed('relationship_limit', res.status)
      const targetRows = rows.filter((row: any) => row.book?.id === selected.target.hardcoverBookId)
      if (
        targetRows.length !== 1 ||
        norm(targetRows[0].book?.title ?? '') !== norm(selected.target.title) ||
        !targetRows[0].book?.contributions?.some(
          (c: any) => norm(c.author?.name ?? '') === norm(author),
        )
      )
        return failed('identity_mismatch', res.status)
    }
    // Never choose the largest homonymous relationship. Match the supplied contributor anywhere
    // in the list (translations often put another contributor first), then require one candidate.
    let eligible = all
    if (!selected && target && all.length > 1) {
      bookScoped = true
      // Validate the whole bounded answer before using absence in another graph as evidence.
      if (
        new Set(all.map((s) => s.id)).size !== all.length ||
        all.some(
          (s) =>
            !Number.isInteger(s.id) ||
            s.id <= 0 ||
            s.id > 2147483647 ||
            s.name !== name ||
            s.book_series.some(
              (row: any) =>
                !Number.isInteger(row?.book?.id) ||
                row.book.id <= 0 ||
                row.book.id > 2147483647 ||
                typeof row.book.title !== 'string' ||
                !row.book.title.trim() ||
                !Array.isArray(row.book.contributions) ||
                row.book.contributions.some(
                  (c: any) => typeof c?.author?.name !== 'string' || !c.author.name.trim(),
                ),
            ),
        )
      )
        return failed('invalid_response', res.status)
      const matches = all.map((s) => ({
        s,
        rows: s.book_series.filter((row: any) => row.book.id === target.hardcoverBookId),
      }))
      if (
        matches.some(
          ({ rows }) =>
            rows.length > 1 ||
            rows.some(
              (row: any) =>
                norm(row.book.title) !== norm(target.title) ||
                !row.book.contributions.some((c: any) => norm(c.author.name) === norm(author)),
            ),
        )
      )
        return failed('identity_mismatch', res.status)
      eligible = matches.filter(({ rows }) => rows.length === 1).map(({ s }) => s)
      if (eligible.length !== 1) return failed('ambiguous_relationship', res.status)
    }
    const candidates = eligible
      .filter((s: any) => s.name === name)
      .map((s: any) => {
        const entries: SourceEntry[] = (s.book_series ?? [])
          .map((bs: any) => {
            const names: string[] = (bs.book?.contributions ?? [])
              .map((c: any) => String(c?.author?.name ?? '').trim())
              .filter(Boolean)
            const matchedAuthor = author && names.find((n) => norm(n) === norm(author))
            const position = Number(bs.position)
            return {
              position: Number.isFinite(position) && position > 0 ? position : 0,
              title: String(bs.book?.title ?? '').trim(),
              // Without a known match, multiple contributors have no safe implied primary.
              author: matchedAuthor || (names.length === 1 ? names[0] : ''),
            }
          })
          .filter((e: SourceEntry) => e.title)
        const authorHit = author && entries.some((e) => norm(e.author) === norm(author))
        return { s, entries, authorHit }
      })
      .filter((candidate) => !author || candidate.authorHit)
    if (candidates.length !== 1) return failed('ambiguous_relationship', res.status)
    const best = candidates[0]
    if (!best || !best.entries.length) return failed('empty_relationship', res.status)
    // Keep identity observations separately. Duplicate editions cannot multiply a work, and
    // conflicting ordinals for the same identity must not pick the first/lowest position.
    const byIdentity = new Map<string, SourceEntry>()
    for (const entry of best.entries) {
      const key = JSON.stringify([norm(entry.title), norm(entry.author)])
      const previous = byIdentity.get(key)
      byIdentity.set(
        key,
        previous
          ? { ...previous, position: previous.position === entry.position ? entry.position : 0 }
          : entry,
      )
    }
    const membershipEntries = [...byIdentity.values()]
    // Different titles occupying one ordinal can be translations or boxed sets. Without a work
    // mapping none is the canonical winner. Withhold the entire slot rather than choose English
    // heuristically or turn duplicate/unknown ordinals into additional numbered volumes.
    const slots = new Map<number, SourceEntry[]>()
    for (const entry of membershipEntries) {
      if (!Number.isInteger(entry.position) || entry.position <= 0) continue
      slots.set(entry.position, [...(slots.get(entry.position) ?? []), entry])
    }
    const entries = [...slots.values()].flatMap((slot) => {
      if (slot.length !== 1 || !slot[0].author) return []
      const entry = slot[0]
      // Obvious collection labels are not individual volumes, even on an otherwise unique slot.
      if (
        /\b(box(?:ed)?\s*(?:set|duologia)|\d+[- ]book\s+set|omnibus|collection|boxset)\b/i.test(
          entry.title,
        )
      )
        return []
      return [entry]
    })
    return {
      bookScoped,
      payload: {
        name: String(best.s.name ?? name),
        sourceRef: String(best.s.id ?? ''),
        memberCount: null,
        membershipEntries,
        entries,
      },
    }
  } catch {
    return failed(
      ctrl.signal.aborted ? 'timeout' : receivedResponse ? 'invalid_response' : 'network_error',
    )
  } finally {
    clearTimeout(timer)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A stored book ID is a locator, not identity evidence. Revalidate before following ONE relation.
 * No aliases, fuzzy search, pagination, retries, or first/largest-series selection. */
async function fetchHardcoverBookSeries(
  target: BookTarget,
  author: string,
  name: string,
): Promise<SeriesPayload> {
  const failure = (
    failureCode: NonNullable<SeriesPayload['failureCode']>,
    httpStatus?: number,
  ): SeriesPayload => {
    logEvent('warn', 'series', 'relationship_unavailable', {
      provider: 'hardcover',
      failureCode,
      httpStatus,
    })
    return {
      name,
      sourceRef: null,
      memberCount: null,
      entries: [],
      unavailable: true,
      failureCode,
      ...(httpStatus ? { httpStatus } : {}),
    }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_WALL_MS)
  let receivedResponse = false
  let selected: { id: number; name: string } | undefined
  try {
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HARDCOVER_TOKEN}` },
      body: JSON.stringify({
        query: `query ($id: Int!) { books(where: { id: { _eq: $id } }, limit: 1) {
          id title contributions(limit: 51) { author { name } }
          book_series(limit: 21) { series { id name } }
        } }`,
        variables: { id: target.hardcoverBookId },
      }),
    })
    receivedResponse = true
    if (!res.ok) return failure('http_error', res.status)
    const body = await res.json().catch(() => null)
    if (ctrl.signal.aborted) return failure('timeout', res.status)
    if (body?.errors?.length) return failure('graphql_error', res.status)
    if (!Array.isArray(body?.data?.books)) return failure('invalid_response', res.status)
    const books = body.data.books as {
      id: number
      title: string
      contributions: { author: { name: string } }[]
      book_series: { series: { id: number; name: string } }[]
    }[]
    if (!books.length) return failure('not_found', res.status)
    const book = books[0]
    if (
      books.length !== 1 ||
      book.id !== target.hardcoverBookId ||
      typeof book.title !== 'string' ||
      norm(book.title) !== norm(target.title) ||
      !Array.isArray(book.contributions) ||
      !book.contributions.some(
        (c) => typeof c.author?.name === 'string' && norm(c.author.name) === norm(author),
      )
    )
      return failure('identity_mismatch', res.status)
    if (!Array.isArray(book.book_series)) return failure('invalid_response', res.status)
    if (book.contributions.length >= 51 || book.book_series.length >= 21)
      return failure('relationship_limit', res.status)
    if (!book.book_series.length) return failure('empty_relationship', res.status)
    // Duplicate or competing links are not silently collapsed, even if one matches the old label.
    if (book.book_series.length !== 1) return failure('ambiguous_relationship', res.status)
    selected = book.book_series[0]?.series
    if (
      !selected ||
      !Number.isInteger(selected.id) ||
      selected.id <= 0 ||
      selected.id > 2147483647 ||
      typeof selected.name !== 'string' ||
      !selected.name.trim()
    )
      return failure('invalid_response', res.status)
  } catch {
    return failure(
      ctrl.signal.aborted ? 'timeout' : receivedResponse ? 'invalid_response' : 'network_error',
    )
  } finally {
    clearTimeout(timer)
  }
  return (await fetchHardcoverSeries(selected.name, author, { seriesId: selected.id, target }))
    .payload
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** One book's community descriptor names from Hardcover (cached_tags), parsed defensively —
 *  whatever shape the field takes, only STRINGS come out, deduped, capped. */
async function fetchHardcoverBookTags(title: string, author: string): Promise<string[]> {
  if (!HARDCOVER_TOKEN) return []
  const query = `
    query ($title: String!) {
      books(where: { title: { _eq: $title } }, order_by: { users_count: desc }, limit: 5) {
        title
        cached_tags
        contributions { author { name } }
      }
    }`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_WALL_MS)
  try {
    const res = await fetch('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HARDCOVER_TOKEN}` },
      body: JSON.stringify({ query, variables: { title } }),
    })
    if (!res.ok) return []
    const bodyJson = (await res.json()) as any
    const books: any[] = bodyJson?.data?.books ?? []
    if (!books.length) return []
    const match = author
      ? books.find(
          (b: any) =>
            author &&
            (b.contributions ?? []).some(
              (c: any) => norm(String(c?.author?.name ?? '')) === norm(author),
            ),
        )
      : books[0]
    if (!match || match.title !== title) return []
    const out = new Set<string>()
    const walk = (v: any): void => {
      if (out.size >= 40) return
      if (typeof v === 'string') {
        const clean = v.trim()
        if (clean && clean.length <= 60) out.add(clean)
      } else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === 'object') {
        if (typeof v.tag === 'string') walk(v.tag)
        else if (typeof v.name === 'string') walk(v.name)
        else Object.values(v).forEach(walk)
      }
    }
    walk(match?.cached_tags)
    return [...out]
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!DB_URL || !ANON || !SERVICE) return json({ error: 'missing service env' }, 500)

  let body: {
    mode?: string
    name?: string
    author?: string
    title?: string
    sweepRunId?: string
    workId?: string
    hardcoverBookId?: number
  }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  // Any signed-in reader may query. A service-role call is accepted only for the exact work
  // currently claimed by a durable sweep; possessing the service key alone is not an actor id.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'not authenticated' }, 401)
  if (body.sweepRunId && body.workId) {
    if (!(await authorizeSweep(body.sweepRunId, body.workId, `Bearer ${token}`))) {
      return json({ error: 'corpus sweep not authorized' }, 403)
    }
  } else {
    const ures = await fetch(`${DB_URL}/auth/v1/user`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    })
    if (!ures.ok) return json({ error: 'not authenticated' }, 401)
  }

  // book-tags: Hardcover's community descriptors for one book — treated as factual metadata
  // (like page counts); ONLY names leave this function, never counts/popularity/ranking.
  if (body.mode === 'book-tags') {
    const title = (body.title ?? '').trim()
    if (!title) return json({ error: 'missing title' }, 400)
    try {
      const key = `booktags-exact-v1:${JSON.stringify([title, (body.author ?? '').trim()])}`
      const cached = (await cacheGet(key)) as unknown as { tags: string[] } | null
      if (cached) return json(cached)
      const payload = { tags: await fetchHardcoverBookTags(title, (body.author ?? '').trim()) }
      await cacheSet(key, payload as unknown as SeriesPayload)
      return json(payload)
    } catch (e) {
      captureEdgeError('series', e)
      return json({ tags: [] })
    }
  }

  const name = (body.name ?? '').trim()
  if (!name) return json({ error: 'missing name' }, 400)
  const author = (body.author ?? '').trim()
  let target: BookTarget | undefined
  if (body.hardcoverBookId !== undefined) {
    if (
      !Number.isInteger(body.hardcoverBookId) ||
      body.hardcoverBookId <= 0 ||
      body.hardcoverBookId > 2147483647 ||
      typeof body.title !== 'string' ||
      !body.title.trim() ||
      body.title.length > 500 ||
      !author ||
      author.length > 300
    )
      return json({ error: 'invalid book lookup identity' }, 400)
    target = { hardcoverBookId: body.hardcoverBookId, title: body.title.trim() }
  }

  try {
    // New semantics cannot reuse old first-contributor/count payloads. Exact queries also need
    // exact cache keys: a case-mismatched miss must not poison a later correctly cased request.
    // Book-specific results must never poison a name-only or another work's cache entry.
    const nameKey = `series-exact-v2:${JSON.stringify([name, author])}`
    const key = target
      ? `series-book-v2:${JSON.stringify([name, author, target.hardcoverBookId, target.title])}`
      : nameKey
    const cached = await cacheGet(key)
    if (cached) return json(cached)
    // Reuse ordinary shared name results: adding a book locator must not turn a cached series
    // into one upstream request per book. A cached ambiguity lacks raw book identities, so the
    // opt-in target may make one fresh bounded name lookup, not a direct-book fallback.
    let payload = target ? await cacheGet(nameKey) : null
    if (target && payload?.failureCode === 'ambiguous_relationship' && payload.httpStatus === 200)
      payload = null
    if (!payload) {
      const lookup = await fetchHardcoverSeries(name, author, undefined, target)
      payload = lookup.payload
      await cacheSet(lookup.bookScoped ? key : nameKey, payload)
    }
    // Only a successful empty name lookup admits the fallback. Never spend more requests on an
    // outage, forbidden query, ambiguous relation, or missing credential.
    if (target && payload.failureCode === 'not_found' && payload.httpStatus === 200) {
      payload = await fetchHardcoverBookSeries(target, author, name)
      await cacheSet(key, payload)
    }
    return json(payload)
  } catch {
    // Cache/infrastructure errors also stay unresolved, with no raw exception in diagnostics.
    logEvent('warn', 'series', 'relationship_unavailable', { failureCode: 'internal_error' })
    return json({
      name,
      sourceRef: null,
      memberCount: null,
      entries: [],
      unavailable: true,
      failureCode: 'internal_error',
    })
  }
})
