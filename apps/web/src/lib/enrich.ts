import { isGoogleContentCover, normalizeIsbn, validPublicationDate } from '@reverie/core'
import { supabase } from './supabase'

/** Per-field provenance from the aggregator (which source supplied each field, and when). */
export interface FieldProvenance {
  source: 'openlibrary' | 'google' | 'hardcover' | 'isbndb' | 'manual'
  at: string
}

/** How sure the title+author resolution is (E1); an exact-ISBN scan is always 'high'. */
export type EnrichConfidence = 'high' | 'medium' | 'low' | 'none'

/** An alternate edition candidate for the Cover Studio picker (E1 alternates). */
export interface CoverAlternate {
  source: 'openlibrary' | 'google' | 'hardcover' | 'isbndb' | 'manual'
  cover: string
  isbn13: string
  title: string
  author: string
}

/** Full normalized record returned by the enrichment aggregator (docs/reference/ENRICHMENT_STRATEGY.md). */
export interface EnrichResult {
  admissionVersion?: number
  title: string
  authors: string[]
  author: string
  series: string
  seriesPosition: number | null
  publisher: string
  pubY: number | null
  pubM: number | null
  pubD: number | null
  pageCount: number | null
  binding?: string
  isbn10: string
  isbn13: string
  isbn: string
  /** every edition ISBN the sources knew (union) */
  isbns?: string[]
  language: string
  /** primary genre mapped from categories (the C1 genre-fill) */
  genre?: string
  genres: string[]
  description: string
  cover: string
  workId?: string
  editionId?: string
  provenance?: Record<string, FieldProvenance>
  source: string | null
  /** E1: confidence of the title+author match (drives the import-review "needs a look" buckets) */
  confidence?: EnrichConfidence
  /** E1: the normalized title+author query the search used */
  query?: string
  /** E1: alternate edition candidates for the Cover Studio picker */
  alternates?: CoverAlternate[]
}

/** Defensive client boundary for staggered web/function deploys and historical cache rows. */
export function durableEnrichment(result: EnrichResult, requestedIsbn = ''): EnrichResult {
  const requested = normalizeIsbn(requestedIsbn)
  const returned = [result.isbn, result.isbn13, result.isbn10].filter(Boolean).map(normalizeIsbn)
  const edition =
    result.admissionVersion === 2 &&
    !!requested &&
    returned.length > 0 &&
    returned.every((isbn) => isbn === requested)
  const pub = { y: result.pubY, m: result.pubM, d: result.pubD }
  const date = edition && validPublicationDate(pub) ? pub : { y: null, m: null, d: null }

  const googleCover =
    result.provenance?.cover?.source === 'google' || isGoogleContentCover(result.cover)
  return {
    ...result,
    isbn: edition ? requested : '',
    isbn13: edition ? requested : '',
    isbn10: edition ? result.isbn10 : '',
    isbns: edition ? [requested] : [],
    pageCount:
      edition &&
      Number.isInteger(result.pageCount) &&
      result.pageCount! > 0 &&
      result.pageCount! <= 20000
        ? result.pageCount
        : null,
    pubY: date.y,
    pubM: date.m,
    pubD: date.d,
    publisher: edition ? result.publisher : '',
    language: edition ? result.language : '',
    binding: edition ? result.binding : undefined,
    editionId: edition ? result.editionId : undefined,
    series: '',
    seriesPosition: null,
    cover: googleCover ? '' : result.cover,
    alternates: result.alternates?.filter(
      (alternate) => alternate.source !== 'google' && !isGoogleContentCover(alternate.cover ?? ''),
    ),
  }
}

/** Ordered per-stage wall times from the Edge Function, present only when `trace` was requested. */
export interface ServerTrace {
  spans: { s: string; ms: number }[]
  totalMs: number
}

/**
 * FOUR OUTCOMES, AND THE DIFFERENCE BETWEEN TWO OF THEM IS THE WHOLE POINT.
 *
 * `empty` means the sources answered and had nothing — a real answer, worth recording, so the book
 * is stamped `enriched_at` and rests inside its recheck window.
 *
 * `failed` means nothing was ever checked: every source we asked threw, or the function itself was
 * unreachable. Recording that as a miss negative-caches a book for three days on the strength of an
 * outage. These used to be the same value.
 */
export type EnrichOutcome =
  | { status: 'ok'; data: EnrichResult; trace?: ServerTrace }
  | { status: 'empty'; trace?: ServerTrace }
  | { status: 'rate_limited' }
  | { status: 'failed'; reason: string }

/**
 * Ask the enrichment Edge Function for a record, surfacing whether the upstream sources were
 * rate-limited (so a bulk run can pause and resume rather than burning the book's retry window).
 */
export async function enrichBookOutcome(input: {
  title?: string
  author?: string
  isbn?: string
  /** 'fast' = one source by ISBN for an instant record; 'full' (default) = the multi-source merge. */
  mode?: 'fast' | 'full'
  /** Ask the function to return its per-stage timings. Off by default; the response is unchanged. */
  trace?: boolean
  /** Skip the global enrichment_cache and re-query the sources. Measurement runs only. */
  refresh?: boolean
}): Promise<EnrichOutcome> {
  try {
    const { data, error } = await supabase.functions.invoke('enrich', { body: input })
    if (error) {
      // The function itself refused or fell over. Nothing was checked, so nothing may be recorded
      // as checked — this used to return 'empty' for every status except 429.
      const status = (error as { context?: { status?: number } }).context?.status
      if (status === 429) return { status: 'rate_limited' }
      return { status: 'failed', reason: status ? `enrich ${status}` : 'enrich unreachable' }
    }
    const trace = (data as { _trace?: ServerTrace })?._trace
    if (!data) return { status: 'failed', reason: 'enrich returned no body' }
    const flags = data as {
      rateLimited?: boolean
      sourcesFailed?: boolean
      sourcesAttempted?: number
      identityUnresolved?: boolean
      admissionVersion?: number
      confidence?: string
    }
    if (flags.rateLimited) return { status: 'rate_limited' }
    // Every source we asked threw. An outage is not a miss.
    if (flags.sourcesFailed)
      return { status: 'failed', reason: `all ${flags.sourcesAttempted ?? 0} sources failed` }
    if (flags.admissionVersion !== 2)
      return {
        status: 'failed',
        reason: 'catalog identity checks need the updated enrichment service',
      }
    if (flags.confidence !== 'high')
      return flags.identityUnresolved
        ? { status: 'failed', reason: 'catalog identity is unresolved' }
        : { status: 'empty', trace }
    return { status: 'ok', data: durableEnrichment(data as EnrichResult, input.isbn), trace }
  } catch (e) {
    // A thrown invoke is a transport failure — offline, DNS, abort. Never an empty result.
    return { status: 'failed', reason: (e as Error)?.message || 'enrich threw' }
  }
}

/**
 * Ask the enrichment Edge Function for a full record (Open Library + Hardcover, cached). Returns
 * null on any failure so callers degrade gracefully — an
 * ASIN-only/no-cover title still returns a (sparse) record rather than throwing.
 */
export async function enrichBook(input: {
  title?: string
  author?: string
  isbn?: string
  mode?: 'fast' | 'full'
}): Promise<EnrichResult | null> {
  const outcome = await enrichBookOutcome(input)
  return outcome.status === 'ok' ? outcome.data : null
}
