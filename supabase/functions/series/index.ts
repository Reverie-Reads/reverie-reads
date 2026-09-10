// Canonical series data (docs/archive/task-series-experience.md §2) — the releases fn's sibling.
// One mode: { name, author? } → the canonical entry list for that series, seeded from Hardcover
// (GraphQL, free Bearer token, 60 req/min) and cached per series daily in the shared
// releases_cache (key `series:<norm-name>|<norm-author>`; failures expire after five minutes),
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
/** one upstream lookup per request, wall-clock capped — an edge isolate must never hang on a
 *  slow catalog (the embed fn's lesson). */
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
interface SeriesPayload {
  name: string
  sourceRef: string | null
  /** Provider cardinality. This can exceed entries.length when unavailable/retired books are
   * filtered from the public graph, so consumers keep both values. */
  memberCount: number | null
  entries: SourceEntry[]
  unavailable?: boolean
  failureCode?:
    | 'not_configured'
    | 'http_error'
    | 'graphql_error'
    | 'invalid_response'
    | 'not_found'
    | 'empty_relationship'
    | 'timeout'
    | 'network_error'
    | 'internal_error'
  httpStatus?: number
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
async function fetchHardcoverSeries(name: string, author: string): Promise<SeriesPayload> {
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
  ): SeriesPayload => {
    logEvent('warn', 'series', 'relationship_unavailable', {
      provider: 'hardcover',
      failureCode,
      httpStatus,
    })
    return { ...empty, failureCode, ...(httpStatus ? { httpStatus } : {}) }
  }
  if (!HARDCOVER_TOKEN) return failed('not_configured')
  const query = `
    query ($name: String!) {
      series(where: { name: { _ilike: $name } }, limit: 5) {
        id
        name
        books_count
        book_series(order_by: { position: asc }, where: { book: { book_status_id: { _eq: 1 } } }) {
          position
          book {
            title
            contributions { author { name } }
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
      body: JSON.stringify({ query, variables: { name } }),
    })
    receivedResponse = true
    if (!res.ok) return failed('http_error', res.status)
    const body = (await res.json().catch(() => null)) as any
    if (ctrl.signal.aborted) return failed('timeout', res.status)
    if (body?.errors?.length) return failed('graphql_error', res.status)
    if (!Array.isArray(body?.data?.series)) return failed('invalid_response', res.status)
    const all: any[] = body.data.series
    if (!all.length) return failed('not_found', res.status)
    // Prefer the candidate whose books mention the author we know; else the fullest match.
    const scored = all
      .map((s: any) => {
        const entries: SourceEntry[] = (s.book_series ?? [])
          .map((bs: any) => ({
            position: Number(bs.position) || 0,
            title: String(bs.book?.title ?? '').trim(),
            author: String(bs.book?.contributions?.[0]?.author?.name ?? '').trim(),
          }))
          .filter((e: SourceEntry) => e.title)
        const authorHit = author && entries.some((e) => norm(e.author) === norm(author))
        return { s, entries, score: (authorHit ? 100 : 0) + entries.length }
      })
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    if (!best || !best.entries.length) return failed('empty_relationship', res.status)
    // Dedupe by title keeping the first (lowest-position) slot; drop position-0 noise when the
    // series has real positions.
    const seen = new Set<string>()
    const entries = best.entries.filter((e) => {
      const k = norm(e.title)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    const positioned = entries.some((e) => e.position > 0)
      ? entries.filter((e) => e.position > 0)
      : entries
    return {
      name: String(best.s.name ?? name),
      sourceRef: String(best.s.id ?? ''),
      memberCount: Number(best.s.books_count) || positioned.length || null,
      entries: positioned,
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

/* eslint-disable @typescript-eslint/no-explicit-any */
/** One book's community descriptor names from Hardcover (cached_tags), parsed defensively —
 *  whatever shape the field takes, only STRINGS come out, deduped, capped. */
async function fetchHardcoverBookTags(title: string, author: string): Promise<string[]> {
  if (!HARDCOVER_TOKEN) return []
  const query = `
    query ($title: String!) {
      books(where: { title: { _ilike: $title } }, order_by: { users_count: desc }, limit: 5) {
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
    const match =
      books.find(
        (b: any) =>
          author &&
          (b.contributions ?? []).some(
            (c: any) => norm(String(c?.author?.name ?? '')) === norm(author),
          ),
      ) ?? books[0]
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
      const key = `booktags:${norm(title)}|${norm(body.author ?? '')}`
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

  try {
    const key = `series:${norm(name)}|${norm(body.author ?? '')}`
    const cached = await cacheGet(key)
    if (cached) return json(cached)
    const payload = await fetchHardcoverSeries(name, (body.author ?? '').trim())
    await cacheSet(key, payload)
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
