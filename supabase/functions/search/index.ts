// Discover Search Edge Function (docs/archive/task-discover-search.md) — one search backend, two surfaces
// (the Discover field + the shelf picker's "search everywhere" seam).
//
//   POST { q: string }  →  { results: SearchResult[], source?: 'cache', degraded?: true }
//                         or 502 { error: 'search providers unavailable' }
//
// Sources, in order:
//  · Hardcover (PRIMARY) — backend-only per architecture. Text search (query_type "Book"), scored
//    by Hardcover; global 60 req/min budget (their documented cap) shared across ALL callers.
//  · Google Books (SECONDARY FILL) — only when Hardcover is thin/absent, so a search still returns
//    something when the Hardcover token is missing or its budget is spent. Uses the server-side
//    GOOGLE_BOOKS_KEY (referrer-restricted) when set.
//
// Results are cached per normalized query in enrichment_cache under a `search:` key with a SHORT
// TTL, so rapid re-queries (and the debounce's trailing calls) cost zero upstream. Per-caller rate
// limit on top. No consensus signals are read or returned — no average rating, review count, or
// popularity (anti-consensus thesis holds in Discover too; Hardcover's users_count is never read).
//
// GOOGLE KEY SEAM: the Google leg runs server-side here when GOOGLE_BOOKS_KEY is present (it is, in
// the deployed env, shared with covers/releases). If it were ever absent, this function returns the
// Hardcover results only and the CLIENT fills the Google leg with its referrer-restricted key — see
// apps/web/src/lib/search.ts. Either way Hardcover stays backend-only.

import { envInt, rateLimit, tooMany } from '../_shared/ratelimit.ts'
import { captureEdgeError } from '../_shared/observe.ts'
import { SourceBodyError, SourceHttpError } from '../_shared/httpClassify.ts'
import { runSearchProviders } from './orchestrate.ts'
import { bestGoogleCoverLink } from '../_shared/coverUrl.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const dbHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
}

const GOOGLE_KEY = Deno.env.get('GOOGLE_BOOKS_KEY') ?? ''
const googleKey = () => (GOOGLE_KEY ? `&key=${encodeURIComponent(GOOGLE_KEY)}` : '')
const GOOGLE_REFERER = Deno.env.get('BOOKS_KEY_REFERER') ?? 'https://reveriereads.app/'
const googleHeaders = (): HeadersInit => (GOOGLE_KEY ? { Referer: GOOGLE_REFERER } : {})

const SEARCH_TTL_MIN = envInt('SEARCH_TTL_MIN', 60) // short TTL — a browse aid, not a source of truth
const RESULT_LIMIT = 20
const HC_FILL_THRESHOLD = 8 // fill with Google only when Hardcover returns fewer than this

const cleanIsbn = (s: string) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase()
const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()

/** A single search hit — cover/title/author/year/series (task §1). No consensus fields, ever. */
interface SearchResult {
  source: 'hardcover' | 'google'
  title: string
  authors: string[]
  cover: string
  isbn: string
  isbn13?: string
  isbn10?: string
  year: string
  series?: string
  seriesPosition?: number | null
  /** Google Books information page. Required for every Google result shown to a reader. */
  sourceUrl?: string
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

// ── Hardcover (primary) ──

const hardcoverAuth = (): string | null => {
  const raw = (Deno.env.get('HARDCOVER_TOKEN') ?? '').trim()
  if (!raw) return null
  const t = raw.replace(/^Bearer\s+/i, '').trim()
  return t ? `Bearer ${t}` : null
}

/** Consume one unit of Hardcover's GLOBAL 60/min budget (shared across all callers). */
async function globalBudget(name: string, max: number, windowSecs: number): Promise<boolean> {
  if (!DB_URL || !SERVICE) return true
  try {
    const r = await fetch(`${DB_URL}/rest/v1/rpc/rate_limit_consume`, {
      method: 'POST',
      headers: dbHeaders,
      body: JSON.stringify({ p_key: `${name}:global`, p_max: max, p_window_secs: windowSecs }),
    })
    if (!r.ok) return true // fail open, like the shared limiter
    return !!((await r.json()) as { allowed?: boolean }).allowed
  } catch {
    return true
  }
}

async function hardcoverGql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const auth = hardcoverAuth()
  if (!auth) return null
  if (!(await globalBudget('hardcover', envInt('HARDCOVER_RATE_MAX', 60), 60))) return null
  const url = 'https://api.hardcover.app/v1/graphql'
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ query, variables }),
  })
  if (!r.ok) throw new SourceHttpError(r.status, url)
  let payload: { data?: unknown; errors?: unknown[] }
  try {
    payload = (await r.json()) as { data?: unknown; errors?: unknown[] }
  } catch {
    throw new SourceBodyError(r.status, url)
  }
  if (payload.errors?.length) throw new Error('Hardcover GraphQL response contained errors')
  return payload.data ?? null
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Map a Hardcover search document → SearchResult. The doc carries series + featured position, so a
 *  result can show its series name (task §1) — Google can't. */
function hcDocToResult(doc: any): SearchResult | null {
  if (!doc?.title) return null
  const year = doc.release_year
    ? String(doc.release_year)
    : String(doc.release_date ?? '').slice(0, 4)
  return {
    source: 'hardcover',
    title: String(doc.title),
    authors: (doc.author_names ?? []).filter(Boolean),
    cover: String(doc.image?.url ?? '').replace(/^http:/, 'https:'),
    isbn: '',
    year: /^\d{4}$/.test(year) ? year : '',
    series: (doc.series_names ?? [])[0] || undefined,
    seriesPosition:
      typeof doc.featured_series_position === 'number' ? doc.featured_series_position : null,
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function hardcoverSearch(q: string): Promise<SearchResult[]> {
  const d = (await hardcoverGql(
    `query($q:String!,$n:Int!){ search(query:$q, query_type:"Book", per_page:$n){ results } }`,
    { q, n: RESULT_LIMIT },
  )) as { search?: { results?: { hits?: { document?: unknown }[] } } } | null
  const hits = d?.search?.results?.hits ?? []
  return hits
    .map((h) => hcDocToResult(h?.document))
    .filter((r): r is SearchResult => r !== null && !!r.cover)
}

// ── Google Books (secondary fill) ──

async function googleSearch(q: string): Promise<SearchResult[]> {
  const isbnQ = cleanIsbn(q)
  const looksIsbn = isbnQ.length >= 10 && /^[0-9Xx\- ]+$/.test(q)
  const query = looksIsbn ? `isbn:${isbnQ}` : `${encodeURIComponent(q)}`
  const endpoint = 'https://www.googleapis.com/books/v1/volumes'
  const requestUrl = `${endpoint}?q=${query}&maxResults=${RESULT_LIMIT}&printType=books&langRestrict=en${googleKey()}`
  let r: Response
  try {
    r = await fetch(requestUrl, { headers: googleHeaders() })
  } catch {
    // A runtime fetch error may repeat its full request URL. Replace it before observability sees it
    // because this URL contains the Google key.
    throw new Error(`Google Books network failure for ${endpoint}`)
  }
  // Keep the key-bearing request URL out of errors, structured logs, and Sentry payloads.
  if (!r.ok) throw new SourceHttpError(r.status, endpoint)
  let j: { items?: { id?: string; volumeInfo?: Record<string, unknown> }[] }
  try {
    j = (await r.json()) as { items?: { volumeInfo?: Record<string, unknown> }[] }
  } catch {
    throw new SourceBodyError(r.status, endpoint)
  }
  const out: SearchResult[] = []
  for (const it of j.items ?? []) {
    const v = it.volumeInfo ?? {}
    if (typeof v.title !== 'string' || !v.title) continue
    const sourceUrl = googleBooksUrl(v.infoLink ?? v.canonicalVolumeLink, it.id)
    // A displayed Google result must link prominently back to Google Books. An unexpected malformed
    // response stays out of the UI rather than producing a result the client cannot present lawfully.
    if (!sourceUrl) continue
    const cover = bestGoogleCoverLink(v.imageLinks)
    const ids =
      (v.industryIdentifiers as { type?: string; identifier?: string }[] | undefined) ?? []
    const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier
    const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier
    const year = typeof v.publishedDate === 'string' ? v.publishedDate.slice(0, 4) : ''
    out.push({
      source: 'google',
      title: v.title,
      authors: (v.authors as string[] | undefined)?.filter(Boolean) ?? [],
      cover,
      isbn: isbn13 ?? isbn10 ?? '',
      isbn13,
      isbn10,
      year: /^\d{4}$/.test(year) ? year : '',
      sourceUrl,
    })
  }
  return out
}

function googleBooksUrl(value: unknown, volumeId?: string): string | undefined {
  if (typeof value === 'string') {
    try {
      const url = new URL(value.replace(/^http:/, 'https:'))
      if (url.protocol === 'https:' && url.hostname === 'books.google.com') return url.toString()
    } catch {
      /* fall through to the stable volume id */
    }
  }
  return volumeId ? `https://books.google.com/books?id=${encodeURIComponent(volumeId)}` : undefined
}

// ── dedupe ──

const resultKey = (r: SearchResult): string =>
  cleanIsbn(r.isbn13 ?? r.isbn ?? '').toLowerCase() ||
  `${norm(r.title)}|${norm(r.authors[0] ?? '')}`

function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>()
  const out: SearchResult[] = []
  for (const r of results) {
    const k = resultKey(r)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(r)
  }
  return out
}

// ── cache (enrichment_cache, `search:` keys, short TTL) ──

// v2 excludes pre-attribution cache entries, which lack sourceUrl and used cross-provider dedupe.
const cacheKey = (q: string): string => `search:v3:${norm(q)}`

async function readCache(key: string): Promise<SearchResult[] | null> {
  if (!DB_URL) return null
  try {
    const r = await fetch(
      `${DB_URL}/rest/v1/enrichment_cache?key=eq.${encodeURIComponent(key)}&select=record,fetched_at`,
      {
        headers: dbHeaders,
      },
    )
    const rows = (await r.json()) as {
      record?: { results?: SearchResult[] }
      fetched_at?: string
    }[]
    const row = rows?.[0]
    if (!row?.record?.results || !row.fetched_at) return null
    if (Date.now() - Date.parse(row.fetched_at) > SEARCH_TTL_MIN * 60_000) return null
    return row.record.results
  } catch {
    return null
  }
}

async function writeCache(key: string, results: SearchResult[]): Promise<void> {
  if (!DB_URL) return
  try {
    await fetch(`${DB_URL}/rest/v1/enrichment_cache`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        key,
        record: { results },
        complete: true,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    })
  } catch {
    /* best-effort */
  }
}

async function handleSearch(q: string, refresh: boolean): Promise<Response> {
  const key = cacheKey(q)
  if (!refresh) {
    const cached = await readCache(key)
    if (cached) return json({ results: cached, source: 'cache' })
  }

  const outcome = await runSearchProviders({
    hardcoverEnabled: hardcoverAuth() !== null,
    runHardcover: () => hardcoverSearch(q),
    runGoogle: () => googleSearch(q),
    hardcoverFillThreshold: HC_FILL_THRESHOLD,
    resultLimit: RESULT_LIMIT,
    dedupe,
  })
  for (const failure of outcome.failures) {
    captureEdgeError('search', failure.error, { provider: failure.provider })
  }
  if (outcome.unavailable) return json({ error: 'search providers unavailable' }, 502)

  if (outcome.results.length) await writeCache(key, outcome.results)
  return json({ results: outcome.results, ...(outcome.degraded ? { degraded: true } : {}) })
}

// ── entry ──

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const rl = await rateLimit(req, 'search', envInt('SEARCH_RATE_MAX', 120), 60)
  if (!rl.allowed) return tooMany(rl.retryAfter, cors)

  try {
    const body = (await req.json()) as { q?: string; refresh?: boolean }
    const q = (body.q ?? '').trim()
    if (q.length < 3) return json({ results: [] }) // min 3 chars (task §1) — saves upstream quota
    return await handleSearch(q, !!body.refresh)
  } catch (e) {
    captureEdgeError('search', e)
    return json({ error: String(e) }, 400)
  }
})
