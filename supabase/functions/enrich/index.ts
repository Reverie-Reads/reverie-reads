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
  parsePubDate,
  normalizeHardcoverSearch,
  normalizeOpenLibrary,
  type EnrichedRecord,
  type EnrichSource,
  type SourceRecord,
  type StampedSource,
} from './merge.ts'
import type { Confidence } from './resolve.ts'
import { admitSourceRecord, normalizeIsbn, sourceTitleMatches } from './admission.ts'
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
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) })
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
      const reader = r.body?.getReader()
      if (!reader) throw new Error('Missing body')
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 1_000_000) {
          await reader.cancel()
          throw new Error('Response too large')
        }
        chunks.push(value)
      }
      const bytes = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.length
      }
      return JSON.parse(new TextDecoder().decode(bytes))
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

const SEARCH_LIMIT = 5
class IdentityUnresolved extends Error {}
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : []

function chooseAdmitted(input: EnrichInput, records: SourceRecord[]): SourceRecord | null {
  if (!records.length) return null
  if (records.length >= SEARCH_LIMIT)
    throw new IdentityUnresolved('Search response reached its cap')
  const matches = records
    .map((record) => admitSourceRecord(input, record))
    .filter((r): r is SourceRecord => !!r)
  if (matches.length !== 1) throw new IdentityUnresolved('No unique full identity match')
  return matches[0]
}

async function olJson(path: string, tr?: Trace): Promise<unknown> {
  if (!(await paceSource('ol-search', tr)))
    throw new SourceHttpError(429, 'https://openlibrary.org')
  return time(tr, 'fetch.ol-edition', () =>
    fetchJson(`https://openlibrary.org${path}`, { headers: olHeaders() }),
  )
}

async function adapterOpenLibrary(input: EnrichInput, tr?: Trace): Promise<SourceRecord | null> {
  const isbn = normalizeIsbn(input.isbn ?? '')
  if (input.isbn?.trim() && !isbn) throw new IdentityUnresolved('Invalid requested ISBN')
  if (!isbn) {
    const fields = 'key,title,subtitle,author_name,subject,cover_i,isbn'
    const raw = (await olJson(
      `/search.json?title=${encodeURIComponent(input.title ?? '')}&author=${encodeURIComponent(input.author ?? '')}&fields=${fields}&limit=${SEARCH_LIMIT}`,
      tr,
    )) as { docs?: unknown[] }
    if (!Array.isArray(raw?.docs))
      throw new SourceBodyError(200, 'https://openlibrary.org/search.json')
    return chooseAdmitted(input, raw.docs.map(normalizeOpenLibrary))
  }
  let raw: unknown
  try {
    raw = await olJson(`/isbn/${isbn}.json`, tr)
  } catch (error) {
    if (error instanceof SourceHttpError && error.status === 404) return null
    throw error
  }
  if (!raw || typeof raw !== 'object')
    throw new SourceBodyError(200, 'https://openlibrary.org/isbn')
  const edition = raw as Record<string, unknown>
  const title = typeof edition.title === 'string' ? edition.title : ''
  const subtitle = typeof edition.subtitle === 'string' ? edition.subtitle : undefined
  if (
    [edition.isbn_13, edition.isbn_10].some(
      (values) =>
        values != null &&
        (!Array.isArray(values) ||
          values.some((value) => typeof value !== 'string' || !value.trim())),
    )
  )
    throw new IdentityUnresolved('Malformed edition ISBNs')
  const isbns = [...strings(edition.isbn_13), ...strings(edition.isbn_10)]
  if (
    !title.trim() ||
    !isbns.length ||
    isbns.some((value) => normalizeIsbn(value) !== isbn) ||
    typeof edition.key !== 'string' ||
    !/^\/books\/OL\d+M$/.test(edition.key) ||
    (input.title?.trim() && !sourceTitleMatches(input.title, { title, subtitle }))
  )
    throw new IdentityUnresolved('Edition identity differs')
  if (!Array.isArray(edition.authors) || !edition.authors.length || edition.authors.length > 8)
    throw new IdentityUnresolved('Edition authors incomplete')
  const authors: string[] = []
  for (const ref of edition.authors) {
    if (!ref || typeof ref.key !== 'string' || !/^\/authors\/OL\d+A$/.test(ref.key))
      throw new IdentityUnresolved('Edition author reference invalid')
    const author = (await olJson(`${ref.key}.json`, tr)) as { key?: string; name?: string }
    if (author?.key !== ref.key || typeof author.name !== 'string' || !author.name.trim())
      throw new IdentityUnresolved('Edition author unresolved')
    authors.push(author.name)
  }
  const languages = Array.isArray(edition.languages) ? edition.languages : []
  const language =
    languages.length === 1 && /^\/languages\/[a-z]{3}$/.test(languages[0]?.key ?? '')
      ? languages[0].key.slice(-3)
      : ''
  const pages = edition.number_of_pages
  const covers = Array.isArray(edition.covers) ? edition.covers : []
  const workRefs = Array.isArray(edition.works) ? edition.works : []
  const work =
    workRefs.length === 1 && /^\/works\/OL\d+W$/.test(workRefs[0]?.key ?? '')
      ? workRefs[0].key.slice(7)
      : undefined
  const record: SourceRecord = {
    scope: 'edition',
    title,
    subtitle,
    authors,
    isbns,
    isbn13: isbn,
    pageCount:
      typeof pages === 'number' && Number.isInteger(pages) && pages > 0 && pages <= 20000
        ? pages
        : null,
    publisher: strings(edition.publishers).join('; '),
    ...parsePubDate(typeof edition.publish_date === 'string' ? edition.publish_date : ''),
    binding: typeof edition.physical_format === 'string' ? edition.physical_format : '',
    language,
    categories: strings(edition.subjects).slice(0, 12),
    description:
      typeof edition.description === 'string'
        ? edition.description
        : edition.description &&
            typeof edition.description === 'object' &&
            'value' in edition.description &&
            typeof edition.description.value === 'string'
          ? edition.description.value
          : '',
    cover:
      Number.isInteger(covers[0]) && covers[0] > 0
        ? `https://covers.openlibrary.org/b/id/${covers[0]}-L.jpg`
        : '',
    ids: { edition: edition.key.slice(7), ...(work ? { work } : {}) },
  }
  const admitted = admitSourceRecord(input, record)
  if (!admitted) throw new IdentityUnresolved('Edition does not match the requested book')
  return admitted
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
  if (!(await paceSource('hardcover', tr)))
    throw new SourceHttpError(429, 'https://api.hardcover.app')
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
  )) as { errors?: unknown; data?: { search?: { results?: { hits?: { document?: unknown }[] } } } }
  if (j?.errors || !Array.isArray(j?.data?.search?.results?.hits))
    throw new SourceBodyError(200, 'https://api.hardcover.app/v1/graphql')
  const hits = j.data.search.results.hits
  if (hits.length >= limit) throw new IdentityUnresolved('Search response reached its cap')
  return hits.map((h) => normalizeHardcoverSearch(h?.document)).filter((r) => r.title)
}

async function adapterHardcover(input: EnrichInput, tr?: Trace): Promise<SourceRecord | null> {
  if (!input.title || !input.author) return null
  return chooseAdmitted(input, await hardcoverSearchRecords(input.title, SEARCH_LIMIT, tr))
}

// Keep historical EnrichSource/provenance shapes readable; only these durable adapters can make
// enrichment requests. Google Books remains available through explicit attributed search.
type ActiveSource = 'openlibrary' | 'hardcover'
const ADAPTERS: Record<ActiveSource, (i: EnrichInput, tr?: Trace) => Promise<SourceRecord | null>> =
  {
    openlibrary: adapterOpenLibrary,
    hardcover: adapterHardcover,
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
      if (
        cached &&
        cached.confidence === 'high' &&
        cached.record.admissionVersion === 2 &&
        isFresh(cached)
      ) {
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

    // Every provider must independently confirm identity, in either response mode.
    const stamped: StampedSource[] = []
    let attempted = 0
    let failed = 0
    let identityUnresolved = false
    let rateLimited = false
    for (const source of enabledSources()) {
      attempted++
      try {
        const record = await ADAPTERS[source](input, tr)
        if (record) stamped.push({ source, at: new Date().toISOString(), record })
      } catch (error) {
        failed++
        if (error instanceof IdentityUnresolved) identityUnresolved = true
        if (dispositionOf(error) === 'rate_limited') rateLimited = true
      }
      if (mode === 'fast' && stamped.length) break
    }
    const merged = mergeRecords(stamped)
    merged.admissionVersion = 2
    merged.admissionIdentity = {
      title: input.title?.trim() || merged.title,
      author: input.author?.trim() || merged.authors[0] || '',
      isbn: normalizeIsbn(input.isbn ?? ''),
    }
    const sourceList = stamped.map((s) => s.source).join('+') || null
    const confidence: Confidence = sourceList ? 'high' : 'none'
    const body = {
      ...toResponse(merged),
      source: sourceList,
      confidence,
      alternates: [],
      ...(mode === 'fast' ? { completing: true } : {}),
      ...traceOf(input, tr),
      ...(identityUnresolved ? { identityUnresolved: true } : {}),
    }
    // Partial provider failures never become a reusable completed cache entry.
    if (sourceList && !failed && mode !== 'fast')
      await tr.time('enrich.writeCache', () =>
        writeCache(key, merged, { confidence, query: '', alternates: [] }),
      )
    if (rateLimited && !sourceList) return json({ ...body, rateLimited: true })
    if (failed && !sourceList)
      return json({ ...body, sourcesFailed: true, sourcesAttempted: attempted })
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

// Response shape is a SUPERSET of the legacy EnrichResult (so existing callers keep working) plus
// genre, isbns, workId/editionId, and provenance.
function toResponse(r: EnrichedRecord) {
  return {
    admissionVersion: 2,
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
  const isbn = normalizeIsbn(input.isbn ?? '')
  // Never reuse legacy mixed-source records: unioned authors/genres/ISBNs do not retain every
  // contributor's lineage. A provenance-field filter cannot prove those records ISBNdb-free.
  // A new namespace preserves the old rows for an owner-run retention audit, without serving or
  // overwriting them. This is not deletion or certification of already persisted corpus data.
  return enrichmentCacheKey(
    isbn.length >= 10
      ? `isbn:${isbn}:${norm(input.title ?? '')}|${norm(input.author ?? '')}`
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
  return age >= 0 && age < (row.complete ? COMPLETE_DAYS : PARTIAL_DAYS) * DAY
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
    if (!r.ok) return null
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
