// The cached external-data layer (owner-approved releases run). One upstream lookup serves every
// reader via the global releases_cache (enrichment_cache's sibling; 24h TTL). Two modes:
//
//   { mode: 'authors', names: string[] }  per-author recent + upcoming books (Google Books
//       inauthor). Cached names return instantly; at most a few upstream fetches per request —
//       the client accumulates across calls exactly like the embed fn's rank mode.
//       → { authors: { [name]: Hit[] }, pending: string[] }
//   { mode: 'discover', genre, query }    a genre shelf (newest + relevance, quality-filtered
//       server-side), cached per genre per day. → { hits: Hit[] }
//
// Google quirks absorbed here so clients stay dumb: orderBy=newest sorts by messy edition dates
// (a 1927 reprint can outrank this year's release), so we fetch BOTH orderings, normalize via the
// enrich mirror, dedupe, and sort/filter by real dates ourselves. The key is a fn secret
// (GOOGLE_BOOKS_KEY) sent with the app's Referer (the key is referrer-restricted); keyless works
// as a degraded fallback. Caller auth: any signed-in user (their token, verified) — cache access
// itself is service-role.

import { captureEdgeError } from '../_shared/observe.ts'
import { mapGenre, normalizeGoogle } from '../enrich/merge.ts'
import { blendCuratedPool, tierDiscoverShelf } from './curated.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const BOOKS_KEY = Deno.env.get('GOOGLE_BOOKS_KEY') ?? ''
const REFERER = Deno.env.get('BOOKS_KEY_REFERER') ?? 'https://reveriereads.app/'

/** Ceiling on the discover pool cached + returned per genre. Mirrors DISCOVER_POOL in
 *  apps/web/src/lib/discover.ts; the client pages it into batches of DISCOVER_BATCH.
 *  The two deploy independently (Vercel vs Supabase), so neither side may ASSUME the other's
 *  number — the client pages whatever length it receives, and this only ever caps. */
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

/* eslint-disable @typescript-eslint/no-explicit-any */
function toHit(rec: any): Hit {
  const pub = [rec.pubY, rec.pubM, rec.pubD]
    .filter((x: unknown) => x != null)
    .map((x: number, i: number) => (i === 0 ? String(x) : String(x).padStart(2, '0')))
    .join('-')
  return {
    title: rec.title ?? '',
    authors: rec.authors ?? [],
    cover: rec.cover ?? '',
    isbn: rec.isbn13 || rec.isbn10 || '',
    pub,
    ...mapGenre(Array.isArray(rec.categories) ? rec.categories : []),
    description: typeof rec.description === 'string' ? rec.description.slice(0, 2500) : '',
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function googleVolumes(q: string, orderBy: 'newest' | 'relevance', max = 20): Promise<Hit[]> {
  const key = BOOKS_KEY ? `&key=${BOOKS_KEY}` : ''
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&orderBy=${orderBy}&printType=books&langRestrict=en&maxResults=${max}${key}`
  const res = await fetch(url, { headers: BOOKS_KEY ? { Referer: REFERER } : {} })
  if (!res.ok) throw new Error(`google ${res.status}`)
  const body = (await res.json()) as { items?: unknown[] }
  return (body.items ?? []).map((v) => toHit(normalizeGoogle(v)))
}

function dedupe(hits: Hit[]): Hit[] {
  const seen = new Set<string>()
  const out: Hit[] = []
  for (const h of hits) {
    const k = h.isbn.replace(/[^0-9Xx]/g, '') || `${norm(h.title)}|${norm(h.authors[0] ?? '')}`
    if (!h.title || seen.has(k)) continue
    seen.add(k)
    out.push(h)
  }
  return out
}

/** An author's shelf, both orderings merged, sorted newest-first by REAL date (orderBy lies). */
async function fetchAuthor(name: string): Promise<Hit[]> {
  const q = `inauthor:"${name}"`
  const [newest, relevant] = await Promise.all([
    googleVolumes(q, 'newest'),
    googleVolumes(q, 'relevance'),
  ])
  // keep hits that actually list the author (inauthor matches loosely) and carry a date
  const own = dedupe([...newest, ...relevant]).filter(
    (h) => h.pub && h.authors.some((a) => norm(a) === norm(name)),
  )
  return own.sort((a, b) => b.pub.localeCompare(a.pub)).slice(0, 25)
}

/** A genre shelf that actually reads "new & notable": both orderings pulled wide, quality-gated,
 *  then tiered by REAL year — last 2 years first (newest-first), the last 8 as filler, and only
 *  then anything older. Google's own orderings can't be trusted for this (edition-date noise puts
 *  1927 reprints on top of "newest", and raw relevance is dominated by decades-old staples). */
async function fetchDiscoverShelf(query: string, genre: string): Promise<Hit[]> {
  const [newest, relevant] = await Promise.all([
    googleVolumes(query, 'newest', 40),
    googleVolumes(query, 'relevance', 40),
  ])
  const quality = (h: Hit) => h.title && h.cover && h.authors.length > 0
  const all = dedupe([...newest, ...relevant].filter(quality))
  // Curated injection for the four starved categories (docs/tasks/task-discover-curated-candidates.md)
  // — additional candidates into the pool BEFORE ranking; a passthrough for every other genre. The
  // tiering below is the same function that always ranked this shelf, now shared with the client
  // fallback via the core module this file mirrors.
  const pool = blendCuratedPool(genre, all)
  const injected = pool.length - all.length
  if (injected > 0)
    console.log(`[discover] ${genre}: injected ${injected} curated of ${pool.length} pool`)
  // Returns a POOL, not a shelf. The client shows DISCOVER_BATCH (20) at a time and cycles through
  // the rest locally, so "new batch" costs ZERO extra calls — this payload is what the 24h
  // per-genre cache already holds, and re-invoking with an offset would only hand back the same
  // cached array. Cheaper than re-fetching by exactly one upstream round trip per batch.
  //
  // 60 = three batches, and it is a ceiling rather than a promise: ~80 raw come back from the two
  // orderings, and quality-gating plus dedupe routinely leave fewer, so a genre that yields 34
  // simply has two batches. Ordering still matters inside it — tierDiscoverShelf puts the last two
  // years first, so later batches are progressively older, which is the right shape for "show me
  // more" and the reason this is not a random sample.
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
        const key = `author:${norm(name)}`
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
      const query = (body.query ?? '').trim()
      const genre = norm(body.genre ?? '')
      if (!query || !genre) return json({ error: 'missing genre/query' }, 400)
      const key = `discover:v2:${genre}`
      const cached = (await cacheGet(key)) as Hit[] | null
      if (cached) return json({ hits: cached })
      const hits = await fetchDiscoverShelf(query, genre)
      await cacheSet(key, hits)
      return json({ hits })
    }

    return json({ error: 'unknown mode' }, 400)
  } catch (e) {
    captureEdgeError('releases', e)
    return json({ error: 'releases failed' }, 500)
  }
})
