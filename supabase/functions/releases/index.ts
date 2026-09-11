// The cached external-data layer (owner-approved releases run). One upstream lookup serves every
// reader via the global releases_cache (enrichment_cache's sibling; 24h TTL). Two modes:
//
//   { mode: 'authors', names: string[] }  per-author recent + upcoming books (Hardcover edition
//       discovery, optional PRH confirmation). Cached names return instantly; at most
//       a few upstream author fetches per request —
//       the client accumulates across calls exactly like the embed fn's rank mode.
//       → { authors: { [name]: Hit[] }, pending: string[] }
//   { mode: 'discover', genre }           compatibility response for older clients; the reviewed,
//       bundled shelf only. New clients read the same shelf locally. → { hits: Hit[] }
//
// Google Books is intentionally absent: its results belong in explicit search modules that retain
// provider order, attribution, and per-result links. Releases merge providers and Discover applies
// personal ranking, so neither surface can satisfy that contract. Caller auth: any signed-in user
// (their token, verified) — cache access itself is service-role.

import { SourceBodyError, SourceHttpError } from '../_shared/httpClassify.ts'
import { captureEdgeError } from '../_shared/observe.ts'
import { envInt } from '../_shared/ratelimit.ts'
import { blendCuratedPool, tierDiscoverShelf } from './curated.ts'
import {
  hardcoverEditionToRelease,
  mergeAuthorReleases,
  prhTitleToRelease,
  type ReleaseHit,
  type ReleaseInfo,
} from './source.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const PRH_KEY = (Deno.env.get('PRH_API_KEY') ?? '').trim()

/** Ceiling on the reviewed Discover pool returned to older clients. */
const DISCOVER_POOL = 60

const svc = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
}

const TTL_MS = 24 * 60 * 60 * 1000
/** upstream author fetches per request — cached names are free, misses accumulate across calls.
 *  Count AND wall-time budgeted (edge isolates get hard wall-clock terminated; one slow upstream
 *  must never take the whole response down — the embed fn learned this the hard way). */
const FETCH_BUDGET = 2
const FETCH_WALL_MS = 4000

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

/** The client-facing hit shape (same as Discover/Add prefill). */
interface Hit {
  title: string
  authors: string[]
  cover: string
  isbn: string
  pub: string
  /** provenance: present (true) only on curated-injection hits — absent on live-query hits */
  curated?: boolean
  genre?: string
  genres?: string[]
  description?: string
  /** Release-only catalog provenance. Discover hits intentionally omit it. */
  release?: ReleaseInfo
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

async function cacheGet(key: string): Promise<unknown | null> {
  const res = await fetch(
    `${DB_URL}/rest/v1/releases_cache?cache_key=eq.${encodeURIComponent(key)}&select=payload,fetched_at`,
    { headers: svc },
  )
  if (!res.ok) return null
  const rows = (await res.json()) as { payload: unknown; fetched_at: string }[]
  const row = rows[0]
  if (!row) return null
  if (Date.now() - Date.parse(row.fetched_at) > TTL_MS) return null
  return row.payload
}

async function cacheSet(key: string, payload: unknown): Promise<void> {
  await fetch(`${DB_URL}/rest/v1/releases_cache?on_conflict=cache_key`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ cache_key: key, payload, fetched_at: new Date().toISOString() }),
  })
}

/** Consume a unit from a provider-wide budget shared by every caller and Edge Function. */
async function globalBudget(name: string, max: number, windowSecs: number): Promise<boolean> {
  if (!DB_URL || !SERVICE) return true
  try {
    const res = await fetch(`${DB_URL}/rest/v1/rpc/rate_limit_consume`, {
      method: 'POST',
      headers: svc,
      body: JSON.stringify({ p_key: `${name}:global`, p_max: max, p_window_secs: windowSecs }),
    })
    if (!res.ok) return true
    return !!((await res.json()) as { allowed?: boolean }).allowed
  } catch {
    return true
  }
}

const hardcoverAuth = (): string | null => {
  const raw = (Deno.env.get('HARDCOVER_TOKEN') ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .trim()
  return raw ? `Bearer ${raw}` : null
}

async function hardcoverAuthorReleases(
  name: string,
  after: string,
  checkedAt: string,
): Promise<ReleaseHit[]> {
  const auth = hardcoverAuth()
  if (!auth) return []
  if (!(await globalBudget('hardcover', envInt('HARDCOVER_RATE_MAX', 60), 60))) return []
  const endpoint = 'https://api.hardcover.app/v1/graphql'
  const query = `query AuthorEditions($name: String!, $after: date!) {
    editions(
      where: {
        release_date: { _gte: $after }
        book: { contributions: { author: { name: { _eq: $name } } } }
        _or: [
          { language: { code2: { _eq: "en" } } }
          { language_id: { _is_null: true } }
        ]
      }
      order_by: [{ release_date: asc }]
      limit: 50
    ) {
      id isbn_13 isbn_10 edition_format physical_format release_date release_year cached_image
      image { url }
      publisher { name }
      reading_format { format }
      country { code2 }
      book {
        id title slug release_date release_year description cached_image image { url }
        contributions(order_by: [{ id: asc }]) { author { name } }
      }
    }
  }`
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { name, after } }),
    signal: AbortSignal.timeout(3500),
  })
  if (!res.ok) throw new SourceHttpError(res.status, endpoint)
  let body: { data?: { editions?: unknown[] }; errors?: unknown[] }
  try {
    body = (await res.json()) as typeof body
  } catch {
    throw new SourceBodyError(res.status, endpoint)
  }
  if (body.errors?.length) throw new Error('Hardcover release query returned errors')
  return (body.data?.editions ?? [])
    .map((edition) => hardcoverEditionToRelease(edition, checkedAt))
    .filter((hit): hit is ReleaseHit => hit !== null)
    .filter((hit) => hit.authors.some((author) => norm(author) === norm(name)))
}

const prhEndpoint = (path: string, params: Record<string, string>): string => {
  const url = new URL(`https://api.penguinrandomhouse.com/resources/v2/title${path}`)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  url.searchParams.set('api_key', PRH_KEY)
  return url.toString()
}

async function prhJson(path: string, params: Record<string, string>): Promise<unknown> {
  if (!(await globalBudget('prh', envInt('PRH_RATE_MAX', 30), 60))) return null
  const safeEndpoint = `https://api.penguinrandomhouse.com/resources/v2/title${path}`
  let res: Response
  try {
    res = await fetch(prhEndpoint(path, params), { signal: AbortSignal.timeout(3000) })
  } catch {
    // The real request URL contains PRH_API_KEY as a query parameter.
    throw new Error(`PRH release request failed for ${safeEndpoint}`)
  }
  if (!res.ok) throw new SourceHttpError(res.status, safeEndpoint)
  try {
    return await res.json()
  } catch {
    throw new SourceBodyError(res.status, safeEndpoint)
  }
}

async function prhAuthorReleases(
  name: string,
  after: Date,
  checkedAt: string,
): Promise<ReleaseHit[]> {
  if (!PRH_KEY) return []
  const search = (await prhJson('/domains/PRH.US/search/views/search-display', {
    q: name,
    docType: 'author',
    rows: '5',
  })) as { data?: { results?: { docType?: unknown; name?: unknown; authorId?: unknown }[] } } | null
  const author = (search?.data?.results ?? []).find(
    (candidate) =>
      candidate.docType === 'author' &&
      typeof candidate.name === 'string' &&
      norm(candidate.name) === norm(name),
  )
  const authorId = String(author?.authorId ?? '')
  if (!/^\d+$/.test(authorId)) return []
  const from = `${String(after.getUTCMonth() + 1).padStart(2, '0')}/${String(after.getUTCDate()).padStart(2, '0')}/${after.getUTCFullYear()}`
  const payload = (await prhJson(`/domains/PRH.US/authors/${authorId}/titles`, {
    onSaleFrom: from,
    rows: '50',
    sort: 'onsale',
    dir: 'asc',
    returnEmptyLists: 'true',
  })) as { data?: { titles?: unknown[] } } | null
  return (payload?.data?.titles ?? [])
    .map((title) => prhTitleToRelease(title, name, checkedAt))
    .filter((hit): hit is ReleaseHit => hit !== null)
}

/** An author's useful release event per work. Hardcover discovers editions and PRH confirms its
 * own catalog when configured. One provider failure cannot erase the other. */
async function fetchAuthor(name: string): Promise<Hit[]> {
  const checkedAt = new Date().toISOString()
  const after = new Date()
  after.setUTCDate(after.getUTCDate() - 183)
  const afterIso = after.toISOString().slice(0, 10)
  const settled = await Promise.allSettled([
    hardcoverAuthorReleases(name, afterIso, checkedAt),
    prhAuthorReleases(name, after, checkedAt),
  ])
  if (settled.every((result) => result.status === 'rejected'))
    throw new Error('All release providers failed')
  const hits = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  const own = hits.filter(
    (hit): hit is ReleaseHit =>
      !!hit.release && hit.authors.some((author) => norm(author) === norm(name)),
  )
  return mergeAuthorReleases(own, Date.now())
}

/** Compatibility shelf for clients deployed before Discover became local. */
function fetchDiscoverShelf(genre: string): Hit[] {
  const pool = blendCuratedPool(genre, [])
  return tierDiscoverShelf(pool as Hit[], new Date().getFullYear()).slice(0, DISCOVER_POOL)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)
  if (!DB_URL || !ANON || !SERVICE) return json({ error: 'missing service env' }, 500)

  // any signed-in reader may query (public catalog data; the cache is shared on purpose)
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: 'not authenticated' }, 401)
  const ures = await fetch(`${DB_URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  if (!ures.ok) return json({ error: 'not authenticated' }, 401)

  let body: { mode?: string; names?: unknown[]; genre?: string; query?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad json' }, 400)
  }

  try {
    if (body.mode === 'authors') {
      const names = (Array.isArray(body.names) ? body.names : [])
        .filter((n): n is string => typeof n === 'string' && !!n.trim())
        .slice(0, 30)
      const authors: Record<string, Hit[]> = {}
      const pending: string[] = []
      let budget = FETCH_BUDGET
      const t0 = Date.now()
      for (const name of names) {
        // v4 excludes Google-backed rows cached by the former blended release pipeline.
        const key = `author:v4:${norm(name)}`
        const cached = (await cacheGet(key)) as Hit[] | null
        if (cached) {
          authors[name] = cached
          continue
        }
        if (budget <= 0 || Date.now() - t0 > FETCH_WALL_MS) {
          pending.push(name)
          continue
        }
        budget--
        try {
          const hits = await fetchAuthor(name)
          await cacheSet(key, hits)
          authors[name] = hits
        } catch {
          pending.push(name) // upstream hiccup — the next client call retries this name
        }
      }
      return json({ authors, pending })
    }

    if (body.mode === 'discover') {
      const genre = norm(body.genre ?? '')
      if (!genre) return json({ error: 'missing genre' }, 400)
      const key = `discover:v3:${genre}`
      const cached = (await cacheGet(key)) as Hit[] | null
      if (cached) return json({ hits: cached })
      const hits = fetchDiscoverShelf(genre)
      await cacheSet(key, hits)
      return json({ hits })
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    captureEdgeError('releases', e)
    return json({ error: 'releases failed' }, 500)
  }
})
