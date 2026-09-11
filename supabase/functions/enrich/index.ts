// Enrichment aggregator (docs/reference/ENRICHMENT_STRATEGY.md). SOURCE-PLUGGABLE: each adapter fetches one
// source and normalizes to a common SourceRecord (./merge.ts, mirrored from packages/core); the
// pure merge reconciles them FIELD BY FIELD by precedence, unions multi-value fields, takes the
// longest description, maps a genre, and lets user-authored fields win. The merged record is cached
// GLOBALLY in enrichment_cache keyed by ISBN-13 / work id, so the Nth user scanning a book makes
// zero external calls. Two passes: mode:'fast' (one source by ISBN → title/author/cover, instant
// "completing…") and mode:'full' (all enabled sources, the async completion). Deno Edge Function.
//
// Sources are enabled via env, like the buy-link attributionMode:
//   ENRICH_SOURCES   csv, default "openlibrary"; Google is explicit-search-only
//   HARDCOVER_TOKEN  present → Hardcover on (backend-only beta, best-effort, low-volume)
// ISBNdb is retired: neither legacy flags nor ENRICH_SOURCES can enable paid acquisition.

import {
  mergeRecords,
  withholdByConfidence,
  normalizeHardcoverSearch,
  normalizeOpenLibrary,
  type EnrichedRecord,
  type EnrichSource,
  type SourceRecord,
  type StampedSource,
} from './merge.ts'
import { selectBestMatch, selfIsbn13, type Confidence, type ResolveCandidate } from './resolve.ts'
import { envInt, rateLimit, tooMany } from '../_shared/ratelimit.ts'
import { paceSource } from '../_shared/sourcePace.ts'
import { Trace, wantsTrace } from '../_shared/trace.ts'
import {
  classifyHttp,
  dispositionOf,
  retryAfterMs,
  SourceBodyError,
  SourceHttpError,
} from '../_shared/httpClassify.ts'
import { captureEdgeError } from '../_shared/observe.ts'
import { olHeaders } from '../_shared/olIdentity.ts'
import { workIdentityPart } from '../_shared/workIdentity.ts'
import { enrichmentCacheKey } from './cacheKey.ts'

/** A cover edition choice surfaced to the import review + Cover Studio (distilled E1 alternate). */
interface CoverAlternate {
  source: EnrichSource
  cover: string
  isbn13: string
  title: string
  author: string
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface EnrichInput {
  title?: string
  author?: string
  isbn?: string
  mode?: 'fast' | 'full'
  refresh?: boolean
}

const cleanIsbn = (s: string) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase()
const norm = workIdentityPart
// The old local UA ('Reverie/1.0 (personal book library; enrichment aggregator)') identified the app
// but carried NO contact address, which is the half OL's identified tier actually requires — so it
// bought nothing. OL calls now use the shared olHeaders() (name + contact, one home, guard-tested).

// Hardcover bearer header — tolerate a token pasted WITH a leading "Bearer " (the common gotcha that
// otherwise yields "Bearer Bearer …" → 401). Returns null when no token is set.
const hardcoverAuth = (): string | null => {
  const raw = (Deno.env.get('HARDCOVER_TOKEN') ?? '').trim()
  if (!raw) return null
  const t = raw.replace(/^Bearer\s+/i, '').trim()
  return t ? `Bearer ${t}` : null
}

/**
 * Fetch JSON, classifying by STATUS BEFORE BODY. One backoff retry for 5xx only.
 *
 * The body is never touched on a non-OK response. That is the fix: a 4xx used to fall through to
 * `return await r.json()`, and Open Library answers a 404 with 29KB of text/html, so the parse threw
 * a SyntaxError whose message carried no status at all. The caller's `String(e).includes('429')`
 * then read a refusal as "this source had nothing" and the book was stamped as genuinely checked.
 *
 * A 429 is thrown immediately and never retried: it is not retryable on this timescale, and a
 * second attempt only spends another unit of quota to be refused again.
 */
async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, init)
    const disposition = classifyHttp(r.status)

    if (disposition === 'rate_limited') {
      throw new SourceHttpError(
        r.status,
        url,
        retryAfterMs(r.headers.get('retry-after'), Date.now()),
      )
    }
    if (disposition === 'retry') {
      if (attempt === 1) throw new SourceHttpError(r.status, url)
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)))
      continue
    }
    // Non-retryable 4xx: throw WITH the status, and never read the body.
    if (disposition === 'failed') throw new SourceHttpError(r.status, url)

    // Only an OK response's body is parsed, and a malformed one is its own failure — not a
    // silently-empty success that would stamp the book as checked.
    try {
      return await r.json()
    } catch {
      throw new SourceBodyError(r.status, url)
    }
  }
  return null
}

/** Time a stage when tracing, run it untouched when not — one helper so no call site branches. */
const time = <T>(tr: Trace | undefined, stage: string, fn: () => Promise<T>): Promise<T> =>
  tr ? tr.time(stage, fn) : fn()

// ── Source adapters: fetch one source, return a normalized SourceRecord (or null). Pure parsing
//    lives in ./merge.ts normalizers; adapters only know how to query. ──

async function adapterOpenLibrary(input: EnrichInput, tr?: Trace): Promise<SourceRecord | null> {
  // search.json, NOT the covers endpoint — separate budgets, separate documented limits.
  if (!(await paceSource('ol-search', tr))) throw new Error('status 429')
  const fields =
    'key,edition_key,title,author_name,first_publish_year,isbn,number_of_pages_median,subject,language,cover_i,series'
  const url = input.isbn
    ? `https://openlibrary.org/search.json?q=isbn:${cleanIsbn(input.isbn)}&fields=${fields}&limit=1`
    : `https://openlibrary.org/search.json?title=${encodeURIComponent(input.title ?? '')}&author=${encodeURIComponent(input.author ?? '')}&fields=${fields}&limit=1`
  const j = (await time(tr, 'fetch.ol-search.adapter', () =>
    fetchJson(url, { headers: olHeaders() }),
  )) as { docs?: unknown[] }
  const doc = j?.docs?.[0]
  return doc ? normalizeOpenLibrary(doc) : null
}

// Hardcover text search. Their API BLOCKS `_ilike` filters ("not permitted on this server"), so a
// title search must go through the `search` query (Typesense-backed); each hit's `document` is the
// search-doc shape → normalizeHardcoverSearch. Shared by the single-fetch adapter + the multi-candidate
// search adapter. Best romance/indie cover coverage in this catalog.
async function hardcoverSearchRecords(
  title: string | undefined,
  limit: number,
  tr?: Trace,
): Promise<SourceRecord[]> {
  if (!(await paceSource('hardcover', tr))) throw new Error('status 429')
  const auth = hardcoverAuth()
  if (!auth || !title) return []
  const j = (await time(tr, 'fetch.hardcover', () =>
    fetchJson('https://api.hardcover.app/v1/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        query:
          'query($q:String!,$n:Int!){ search(query:$q, query_type:"Book", per_page:$n){ results } }',
        variables: { q: title, n: limit },
      }),
    }),
  )) as { data?: { search?: { results?: { hits?: { document?: unknown }[] } } } }
  const hits = j?.data?.search?.results?.hits ?? []
  return hits.map((h) => normalizeHardcoverSearch(h?.document)).filter((r) => r.title)
}

async function adapterHardcover(input: EnrichInput, tr?: Trace): Promise<SourceRecord | null> {
  const [first] = await hardcoverSearchRecords(input.title, 1, tr)
  return first ?? null
}

// Keep historical EnrichSource/provenance shapes readable; only these durable adapters can make
// enrichment requests. Google Books remains available through explicit attributed search.
type ActiveSource = 'openlibrary' | 'hardcover'
const ADAPTERS: Record<ActiveSource, (i: EnrichInput, tr?: Trace) => Promise<SourceRecord | null>> =
  {
    openlibrary: adapterOpenLibrary,
    hardcover: adapterHardcover,
  }

// ── Search adapters: title+author → up to SEARCH_LIMIT candidates. The real catalog has NO ISBNs,
//    so resolution starts from a title+author SEARCH (not an ISBN lookup). Parsing stays in the
//    ./merge.ts normalizers; these only know how to query each source's search endpoint. ──
const SEARCH_LIMIT = 5

async function searchOpenLibrary(input: EnrichInput, tr?: Trace): Promise<ResolveCandidate[]> {
  if (!input.title) return []
  if (!(await paceSource('ol-search', tr))) throw new Error('status 429')
  const fields =
    'key,edition_key,title,author_name,first_publish_year,isbn,number_of_pages_median,subject,language,cover_i,series'
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(input.title)}&author=${encodeURIComponent(input.author ?? '')}&fields=${fields}&limit=${SEARCH_LIMIT}`
  const j = (await time(tr, 'fetch.ol-search.search', () =>
    fetchJson(url, { headers: olHeaders() }),
  )) as { docs?: unknown[] }
  return (j?.docs ?? [])
    .map((d): ResolveCandidate => ({ source: 'openlibrary', record: normalizeOpenLibrary(d) }))
    .filter((c) => c.record.title)
}

async function searchHardcover(input: EnrichInput, tr?: Trace): Promise<ResolveCandidate[]> {
  const records = await hardcoverSearchRecords(input.title, SEARCH_LIMIT, tr)
  return records.map((record): ResolveCandidate => ({ source: 'hardcover', record }))
}

const SEARCHERS: Partial<
  Record<EnrichSource, (i: EnrichInput, tr?: Trace) => Promise<ResolveCandidate[]>>
> = {
  hardcover: searchHardcover,
  openlibrary: searchOpenLibrary,
}

/** Search the enabled durable sources (catalog priority: Hardcover → Open Library). */
async function gatherCandidates(
  input: EnrichInput,
  tr?: Trace,
): Promise<{
  candidates: ResolveCandidate[]
  rateLimited: boolean
  attempted: number
  failed: number
}> {
  const order: ActiveSource[] = ['hardcover', 'openlibrary']
  const enabled = new Set(enabledSources())
  const candidates: ResolveCandidate[] = []
  let rateLimited = false
  let attempted = 0
  let failed = 0
  for (const s of order) {
    const fn = SEARCHERS[s]
    if (!enabled.has(s) || !fn) continue
    attempted++
    try {
      candidates.push(...(await fn(input, tr)))
    } catch (e) {
      // Classified by the error's OWN status, not by string-matching its message. A network error
      // and a 404 are both failures; only a 429 is a rate limit. Counting failures is what lets the
      // caller tell "every source refused us" from "the sources answered and had nothing".
      failed++
      if (dispositionOf(e) === 'rate_limited') rateLimited = true
    }
  }
  return { candidates, rateLimited, attempted, failed }
}

/** Distill E1 alternate candidates into the cover-picker shape (only those that carry a cover). */
function distillAlternates(alts: ResolveCandidate[]): CoverAlternate[] {
  return alts
    .filter((a) => a.source !== 'google' && a.record.cover)
    .map((a) => ({
      source: a.source,
      cover: a.record.cover ?? '',
      isbn13: selfIsbn13(a.record),
      title: a.record.title ?? '',
      author: (a.record.authors ?? [])[0] ?? '',
    }))
}

/** The enabled source roster, resolved from env (sources are pluggable like the buy-link mode). */
function enabledSources(): ActiveSource[] {
  const csv = (Deno.env.get('ENRICH_SOURCES') ?? 'openlibrary')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is ActiveSource => Object.hasOwn(ADAPTERS, s))
  const set = new Set<ActiveSource>(csv)
  if (Deno.env.get('HARDCOVER_TOKEN')) set.add('hardcover') // best-effort beta, backend-only
  return [...set]
}

// High-value fields present → "complete" (longer cache window; client recheck logic mirrors this).
const isComplete = (r: EnrichedRecord): boolean => !!r.cover && !!r.isbn13

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const tr = new Trace()
  // Per-user/IP rate limit. Generous by default (the bulk "complete missing" job legitimately runs
  // a few per second); the limit catches abusive bursts. Tune via ENRICH_RATE_MAX.
  // Timed because it is a DB round trip on every request — the same cost as one paceSource call,
  // paid before any source work begins.
  const rl = await tr.time('enrich.ratelimit', () =>
    rateLimit(req, 'enrich', envInt('ENRICH_RATE_MAX', 600), 60),
  )
  if (!rl.allowed) return tooMany(rl.retryAfter, cors)
  try {
    const input = (await req.json()) as EnrichInput

    const mode = input.mode ?? 'full'
    const key = cacheKeyFor(input)

    // 1) Cache: a fresh hit returns immediately — ZERO external calls (the main cost lever).
    if (!input.refresh) {
      const cached = await tr.time('enrich.readCache', () => readCache(key))
      if (cached && isFresh(cached)) {
        return json({
          ...toResponse(cached.record),
          source: 'cache',
          confidence: cached.confidence ?? undefined,
          query: cached.match_query ?? undefined,
          alternates: cached.alternates ?? [],
          ...traceOf(input, tr),
        })
      }
    }

    // 2) Fast pass: one source by ISBN/title for an instant "completing…" record.
    if (mode === 'fast') {
      const order = enabledSources()
      let rec: SourceRecord | null = null
      let used: EnrichSource | null = null
      // Continue when a record carries no cover. The last record remains a bibliographic fallback
      // when no durable source has art.
      let fallback: { rec: SourceRecord; used: EnrichSource } | null = null
      for (const s of order) {
        let candidate: SourceRecord | null = null
        try {
          candidate = await ADAPTERS[s](input, tr)
        } catch {
          candidate = null
        }
        if (!candidate) continue
        if (candidate.cover) {
          rec = candidate
          used = s
          break
        }
        fallback ??= { rec: candidate, used: s }
      }
      if (!rec && fallback) {
        rec = fallback.rec
        used = fallback.used
      }
      if (!rec || !used) return json(toResponse(emptyMerged(input)))
      const merged = mergeRecords([{ source: used, at: new Date().toISOString(), record: rec }])
      return json({ ...toResponse(merged), source: used, completing: true, ...traceOf(input, tr) })
    }

    // 3) Full pass: resolve identity, then merge field-by-field across sources, cache, return complete.
    const stamped: StampedSource[] = []
    let rateLimited = false
    // How many sources we ASKED, and how many threw. `attempted > 0 && failed === attempted` is the
    // difference between "nobody had this book" and "nobody would talk to us" — the distinction the
    // client needs so it does not stamp a book as checked when nothing was ever checked.
    let attempted = 0
    let failed = 0
    let confidence: Confidence = cleanIsbn(input.isbn ?? '') ? 'high' : 'none' // a real ISBN is exact
    let matchQuery = ''
    let alternates: CoverAlternate[] = []
    let fetchInput = input

    // 3a) No ISBN (the real catalog case): a title+author SEARCH → best match + confidence →
    //     SELF-RESOLVE an ISBN-13 → fetch the canonical edition + best cover by that ISBN below.
    const title = input.title
    if (!cleanIsbn(input.isbn ?? '') && title) {
      const {
        candidates,
        rateLimited: searchRL,
        attempted: searchAttempted,
        failed: searchFailed,
      } = await gatherCandidates(input, tr)
      if (searchRL) rateLimited = true
      attempted += searchAttempted
      failed += searchFailed
      const r = selectBestMatch({ title, author: input.author }, candidates)
      confidence = r.confidence
      matchQuery = r.query
      alternates = distillAlternates(r.alternates)
      if (r.best) {
        // Keep the confirmed match (title/author/series/cover) in the merge regardless of the ISBN fetch.
        stamped.push({ source: r.best.source, at: new Date().toISOString(), record: r.best.record })
        if (r.isbn13) fetchInput = { ...input, isbn: r.isbn13 }
      }
    }

    // 3b) Query enabled sources (by the self-resolved ISBN when we have one) to complete + best cover.
    for (const s of enabledSources()) {
      attempted++
      try {
        const rec = await ADAPTERS[s](fetchInput, tr)
        if (rec) stamped.push({ source: s, at: new Date().toISOString(), record: rec })
      } catch (e) {
        failed++
        if (dispositionOf(e) === 'rate_limited') rateLimited = true
        // degrade gracefully — skip this source, keep going
      }
    }
    // Withhold what the match confidence doesn't back — none: cover + series; low: series only
    // (cover has three downstream safety nets; series has none). Before writeCache, so cached
    // records are clean too, not just this response.
    const merged = withholdByConfidence(mergeRecords(stamped), confidence)
    const sourceList = stamped.map((s) => s.source).join('+') || null

    if (sourceList)
      await tr.time('enrich.writeCache', () =>
        writeCache(key, merged, { confidence, query: matchQuery, alternates }),
      )
    // Flag rate-limited only when nothing resolved, so a bulk run pauses/resumes instead of
    // stamping the book checked. A partial record is still useful → not flagged.
    const body = {
      ...toResponse(merged),
      source: sourceList,
      confidence,
      query: matchQuery || undefined,
      alternates,
      ...traceOf(input, tr),
    }
    // THREE OUTCOMES, NOT TWO. `sourcesFailed` says every source we asked threw — which is not the
    // same as an empty result and must not be recorded as one. Both flags are set only when nothing
    // resolved: a partial record is genuinely useful and is reported as a success.
    const allFailed = attempted > 0 && failed === attempted && !sourceList
    if (rateLimited && !sourceList) return json({ ...body, rateLimited: true })
    if (allFailed) return json({ ...body, sourcesFailed: true, sourcesAttempted: attempted })
    return json(body)
  } catch (e) {
    captureEdgeError('enrich', e)
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})

/** `_trace` only when the caller asked; otherwise the response shape is byte-for-byte unchanged. */
const traceOf = (input: EnrichInput, tr: Trace) =>
  wantsTrace(input) ? { _trace: { spans: tr.spans, totalMs: tr.totalMs() } } : {}

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } })

function emptyMerged(input: EnrichInput): EnrichedRecord {
  return mergeRecords([], {
    title: input.title,
    author: input.author,
    isbn: cleanIsbn(input.isbn ?? ''),
  } as unknown as Partial<EnrichedRecord>)
}

// Response shape is a SUPERSET of the legacy EnrichResult (so existing callers keep working) plus
// genre, isbns, workId/editionId, and provenance.
function toResponse(r: EnrichedRecord) {
  return {
    title: r.title,
    authors: r.authors,
    author: r.author,
    series: r.series,
    seriesPosition: r.seriesPosition,
    publisher: r.publisher,
    pubY: r.pubY,
    pubM: r.pubM,
    pubD: r.pubD,
    pageCount: r.pageCount,
    binding: r.binding,
    isbn10: r.isbn10,
    isbn13: r.isbn13,
    isbn: r.isbn,
    isbns: r.isbns,
    language: r.language,
    genre: r.genre,
    genres: r.genres,
    description: r.description,
    cover: r.cover,
    workId: r.workId,
    editionId: r.editionId,
    provenance: r.provenance,
  }
}

// ── enrichment_cache (global, service-role only) ──
function cacheKeyFor(input: EnrichInput): string {
  const isbn = cleanIsbn(input.isbn ?? '')
  // Never reuse legacy mixed-source records: unioned authors/genres/ISBNs do not retain every
  // contributor's lineage. A provenance-field filter cannot prove those records ISBNdb-free.
  // A new namespace preserves the old rows for an owner-run retention audit, without serving or
  // overwriting them. This is not deletion or certification of already persisted corpus data.
  return enrichmentCacheKey(
    isbn.length >= 10
      ? `isbn:${isbn}`
      : `ta:${norm(input.title ?? '')}|${norm(input.author ?? '')}`,
  )
}

const DAY = 86_400_000
const COMPLETE_DAYS = 30
const PARTIAL_DAYS = 3

interface CacheRow {
  record: EnrichedRecord
  complete: boolean
  fetched_at: string
  confidence?: Confidence | null
  match_query?: string | null
  alternates?: CoverAlternate[] | null
}

/** Resolution metadata stored alongside the cached record (E1) — confidence + query + cover choices. */
interface ResolveMeta {
  confidence: Confidence
  query: string
  alternates: CoverAlternate[]
}

function isFresh(row: CacheRow): boolean {
  const age = Date.now() - Date.parse(row.fetched_at)
  return age < (row.complete ? COMPLETE_DAYS : PARTIAL_DAYS) * DAY
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const dbHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
}

async function readCache(key: string): Promise<CacheRow | null> {
  if (!DB_URL) return null
  try {
    const r = await fetch(
      `${DB_URL}/rest/v1/enrichment_cache?key=eq.${encodeURIComponent(key)}&select=record,complete,fetched_at,confidence,match_query,alternates`,
      { headers: dbHeaders },
    )
    const rows = (await r.json()) as CacheRow[]
    return rows?.[0]?.record ? rows[0] : null
  } catch {
    return null
  }
}

async function writeCache(key: string, record: EnrichedRecord, meta?: ResolveMeta): Promise<void> {
  if (!DB_URL) return
  try {
    await fetch(`${DB_URL}/rest/v1/enrichment_cache`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        key,
        isbn13: record.isbn13 || null,
        work_id: record.workId || null,
        edition_id: record.editionId || null,
        record,
        provenance: record.provenance,
        complete: isComplete(record),
        confidence: meta?.confidence ?? null,
        match_query: meta?.query || null,
        alternates: meta?.alternates ?? null,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    })
  } catch {
    /* caching is best-effort */
  }
}
