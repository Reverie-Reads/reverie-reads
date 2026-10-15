import {
  contributorsFromAuthors,
  enrichmentCoverFill,
  mergeImport,
  type Book,
  type CoverSource,
  type Incoming,
} from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { toBookRow } from './mappers'
import { enrichBookOutcome, type EnrichResult } from '../lib/enrich'
import { ingestCover } from '../lib/covers'
import { isIngestibleCoverUrl } from '@reverie/core'

// PACING LIVES SERVER-SIDE NOW — supabase/functions/_shared/sourcePace.ts. It used to be a 220ms
// sleep here, which was 4.5 req/sec under a comment quoting Open Library's 100-per-5-minutes (one
// per THREE seconds), and it only ever paced THIS loop: `importEnrich.ts` calls bulkComplete
// directly and anything can call the enrich function over HTTP. The gap is now on the far side of
// the network boundary, keyed per source, so every caller passes through it.
// Per-run ceiling: even one big library can't blow the daily Google quota in a single run.
const MAX_PER_RUN = 400
// Consecutive all-sources-failed books before the run gives up. One is a flaky book; several in a
// row is an outage, and continuing only spends the rest of the library's recheck windows on it.
const FAILURE_STREAK_LIMIT = 5
// Incomplete bibliography remains eligible for a short retry window, including missing pages.
const PARTIAL_RETRY_DAYS = 3
const DAY = 86_400_000

/** A book worth enriching: missing a cover, ISBN, pub year, page count, genres, or series position. */
export function isIncomplete(b: Book): boolean {
  if (!b.cover) return true
  if (!b.isbn) return true
  if (!b.pub?.y) return true
  if (!b.pages) return true
  if (!b.genres.length) return true
  if (b.status !== 'standalone' && (!b.series || b.position === '')) return true
  return false
}

/** Unchecked books and incomplete books last checked more than three days ago are due. */
function shouldCheck(_b: Book, enrichedAt: string | null): boolean {
  return !enrichedAt || Date.parse(enrichedAt) < Date.now() - PARTIAL_RETRY_DAYS * DAY
}

/**
 * THE candidate predicate — one home, consumed by both the sweep (`bulkComplete`) and the Settings
 * button's count. It used to exist twice in half-copies: the button counted `isIncomplete` alone
 * while the sweep additionally required `shouldCheck`, so the button could promise (112) and the
 * sweep truthfully answer "checked 0 of 0" — every one of the 112 sat inside its recheck window.
 * A control whose label and action use different predicates is the same defect as a test name that
 * overclaims. `sweepEligibility.test.ts` pins both consumers to this function by source scan.
 */
export function sweepCandidates(books: Book[], stampById: Map<string, string | null>): Book[] {
  return books.filter((b) => isIncomplete(b) && shouldCheck(b, stampById.get(b.id) ?? null))
}

/** The stamp map `sweepCandidates` needs — fetched once, shared by the button and the sweep. */
export async function fetchEnrichmentStamps(): Promise<Map<string, string | null>> {
  const data = await pageAll<{ id: string; enriched_at: string | null }>('books', (from, to) =>
    supabase.from('books').select('id, enriched_at', { count: 'exact' }).order('id').range(from, to),
  )
  return new Map(data.map((r) => [r.id, r.enriched_at]))
}

/**
 * WHERE THE COVER ACTUALLY CAME FROM. This used to be hardcoded `'openlibrary'` on every ingest,
 * which was a lie whenever the merge took its cover from Hardcover — the stored row then claimed an
 * origin the image never had, and `resharpenSource` reads `coverSource` to decide what it may
 * re-fetch, so the lie propagates into a later sweep's decisions.
 *
 * `provenance` is per FIELD, so `provenance.cover.source` is the one true answer. The other two
 * enrich sources cannot appear here: `google` covers never reach ingest (`isIngestibleCoverUrl`
 * rejects the host before this is called) and `isbndb`/`manual` are not ingestible labels — so
 * anything unexpected falls back to `'url'`, which is honest ("a direct image URL") rather than
 * naming a source we did not hear it from.
 */
function coverOriginOf(e: EnrichResult): CoverSource {
  const s = e.provenance?.cover?.source
  return s === 'openlibrary' || s === 'hardcover' || s === 'google' ? s : 'url'
}

/** Map an enrichment record to an Incoming so mergeImport fills only the existing book's blanks.
 *  genre is the mapped primary genre (the C1 fill); mergeImport fills it only when blank, so the
 *  romance seed (genre='romance') is never overwritten. */
function toIncoming(e: EnrichResult, b: Book): Incoming {
  return {
    title: b.title,
    // Generic enrichment may identify the book but does not prove its series. The corpus
    // classifier owns automatic series defaults and its work trigger seeds eligible personal rows.
    // Explicit CSV series columns and reader edits still arrive through their own trusted paths.
    isbn: e.isbn13 || e.isbn || e.isbn10 || '',
    // The non-overwrite rule: a user-chosen cover is never replaced (and never re-offered after the
    // reader clears it); otherwise fill-only, same as every other field mergeImport touches.
    cover: enrichmentCoverFill(b, e.cover),
    genre: e.genre || undefined,
    genres: e.genres,
    pages: e.pageCount,
    // Multi-author enrichment → contributor list (first author, rest co-authors); mergeImport
    // unions these into the existing book additively.
    contributors: e.authors?.length ? contributorsFromAuthors(e.authors) : undefined,
    pub: { y: e.pubY, m: e.pubM, d: e.pubD },
  }
}

export interface BulkProgress {
  scanned: number
  /** `null` until the candidate count is known — see `sweepProgress.ts`. Never a placeholder zero. */
  total: number | null
  filled: number
}

export interface BulkOptions {
  /** Request per-stage timings and persist one `sweep_traces` row per book. */
  trace?: boolean
  /** Cap this run below MAX_PER_RUN — a 10-book measurement run, not a full sweep. */
  limit?: number
  /** Group the run's rows. Generated when absent. */
  runId?: string
  /**
   * Order never-checked books first. A capped run otherwise takes whatever the library array
   * happens to hand it, which for a measurement run is a sample of unknown provenance.
   */
  unvisitedFirst?: boolean
  /**
   * Bypass the enrich function's GLOBAL enrichment_cache so the sources are actually queried.
   *
   * THE SWEEP HAS TWO INDEPENDENT CLOCKS and only one of them is ours. `shouldCheck` reads
   * `books.enriched_at` — per user, per book. The Edge Function separately reads
   * `enrichment_cache.fetched_at` — GLOBAL, keyed by ISBN or normalized title+author, fresh for
   * 30 days (complete) or 3 (partial). A book can be due by the first clock and answered from the
   * second with zero external calls, which is exactly what happened to the first traced run: all
   * ten books were selected correctly and every one of them was served from cache, so the sweep's
   * expensive path was never entered and there was nothing for the instrument to see.
   *
   * Selecting never-checked books does NOT fix that on its own — a book this reader has never
   * checked can still have a fresh global cache row, written when the library was imported or by
   * an enrichment of the same title under a different row. Bypassing the cache is the only thing
   * that guarantees the sources are hit.
   *
   * A run with this set is therefore a DELIBERATE WORST CASE, not an average sweep: it measures
   * what a book costs when nothing is cached.
   */
  refresh?: boolean
}

/** performance.now() where available (sub-ms, monotonic — immune to a clock step mid-sweep). */
const now = (): number =>
  typeof performance !== 'undefined' ? performance.now() : Date.now()

/**
 * Persist one trace row. Best-effort by construction: a failed insert is swallowed, because the
 * alternative is a measurement run that dies partway and destroys the data it already gathered.
 */
async function recordTrace(
  runId: string,
  b: Book,
  spans: { s: string; ms: number }[],
  totalMs: number,
  outcome: string,
  coverSource: string,
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser()
    const ownerId = auth?.user?.id
    if (!ownerId) return
    await supabase.from('sweep_traces').insert({
      owner_id: ownerId,
      run_id: runId,
      book_id: b.id,
      book_title: b.title,
      spans,
      total_ms: Math.round(totalMs * 10) / 10,
      outcome,
      cover_source: coverSource,
    })
  } catch {
    /* never let instrumentation break the sweep */
  }
}

/**
 * `error` is new and is the point of it: a write that failed used to `throw` out of bulkComplete,
 * which discarded every count with it — the caller could say something broke but not how far the
 * run got. A run that dies must still report its own progress, or "finished" and "died" produce the
 * same shape and the reader cannot tell them apart.
 */
export type BulkStopReason = 'done' | 'user' | 'rate_limited' | 'limit' | 'error'

export interface BulkResult {
  total: number
  scanned: number
  filled: number
  nothing: number
  /** Books where nothing was CHECKED — every source threw, or the function was unreachable. */
  failed: number
  stopReason: BulkStopReason
  /** Set when stopReason is 'error' or any book failed; the reason to show the reader. */
  errorMessage?: string
}

/**
 * Fill missing covers/info across the library, fill-only-missing (never clobbers). Throttled,
 * resumable, and negative-cached: every checked book is stamped enriched_at (found or not), and
 * reruns skip books inside their recheck window — 30 days when the high-value fields are present,
 * 3 days when something high-value is still missing (so dead-ends rest but near-misses retry).
 * Stops cleanly and resumably when the per-run ceiling is hit, the sources rate-limit, or the
 * user cancels — the unprocessed books keep their old stamp and resume next run.
 */
export async function bulkComplete(
  books: Book[],
  onProgress: (p: BulkProgress) => void,
  shouldStop: () => boolean,
  opts?: BulkOptions,
): Promise<BulkResult> {
  const runId = opts?.runId ?? crypto.randomUUID()
  const ceiling = Math.min(opts?.limit ?? MAX_PER_RUN, MAX_PER_RUN)
  const stampById = await fetchEnrichmentStamps()

  let candidates = sweepCandidates(books, stampById)
  // Stable partition, never-checked first. Array#sort is stable, but a partition says the intent
  // plainly and cannot accidentally reorder within either group.
  if (opts?.unvisitedFirst)
    candidates = [
      ...candidates.filter((b) => !stampById.get(b.id)),
      ...candidates.filter((b) => stampById.get(b.id)),
    ]
  const total = candidates.length
  let scanned = 0
  let attempted = 0
  let filled = 0
  let nothing = 0
  let failed = 0
  let stopReason: BulkStopReason = 'done'
  let errorMessage: string | undefined
  // Consecutive failures, not total: one flaky book should not stop a run, but every source failing
  // book after book means the outage is ours or theirs and continuing just burns the library's
  // recheck windows against a wall.
  let consecutiveFailures = 0

  // EMIT THE DENOMINATOR BEFORE THE FIRST REQUEST. It has been known since the line above, and the
  // next emission is at the bottom of the loop — one enrich call, one possible ingest and one update
  // away, which under server-side pacing is seconds. Withholding it is what put "0/0" on screen.
  onProgress({ scanned: 0, total, filled: 0 })

  for (const b of candidates) {
    if (shouldStop()) {
      stopReason = 'user'
      break
    }
    if (attempted >= ceiling) {
      stopReason = 'limit'
      break
    }
    const spans: { s: string; ms: number }[] = []
    const bookT0 = now()
    let coverSource = ''
    const t0 = now()
    attempted++
    const outcome = await enrichBookOutcome({
      title: b.title,
      author: [b.first, b.last].filter(Boolean).join(' '),
      isbn: b.isbn || undefined,
      trace: opts?.trace,
      refresh: opts?.refresh,
    })
    spans.push({ s: 'client.enrich', ms: now() - t0 })
    // `'trace' in outcome` rather than a status check: only 'ok' and 'empty' carry timings, and
    // narrowing on the property keeps this correct when another outcome is added.
    if ('trace' in outcome) for (const sp of outcome.trace?.spans ?? []) spans.push(sp)
    // Paused by upstream quota — stop WITHOUT stamping this book so it's retried next run.
    if (outcome.status === 'rate_limited') {
      stopReason = 'rate_limited'
      break
    }
    // NOTHING WAS CHECKED. Stamping enriched_at here would negative-cache the book for three days
    // on the strength of an outage, and the run would report it as a book that was looked at and
    // had nothing — which is what made three stalled sweeps look like completed ones.
    if (outcome.status === 'failed') {
      failed++
      consecutiveFailures++
      errorMessage ??= outcome.reason
      if (consecutiveFailures >= FAILURE_STREAK_LIMIT) {
        stopReason = 'error'
        break
      }
      onProgress({ scanned, total, filled })
      continue
    }
    consecutiveFailures = 0
    const checkedAt = new Date().toISOString()
    let didFill = false
    const partial = outcome.status === 'ok' && outcome.data.sourcesIncomplete === true
    if (outcome.status === 'ok') {
      const { patch } = mergeImport(b, toIncoming(outcome.data, b))
      // Record confidence only when THIS run actually filled the cover — so a trusted user/seed cover
      // (which merge keeps) is never mislabeled by the enrichment match's confidence (E3 review signal).
      if (patch.cover && outcome.data.confidence) patch.coverConfidence = outcome.data.confidence

      // EAGER INGEST. `useCoverBackfill` moves a hotlinked cover into our Storage only when a reader
      // opens that book's detail page, so a swept library keeps hotlinks until each book is visited
      // one by one — and a library filled in bulk is exactly the one nobody browses book by book.
      // Doing it here means the sweep that found the cover is also the thing that makes it durable.
      //
      // `isIngestibleCoverUrl` is the gate, not the source label: Google covers stay hotlinks by
      // their terms, and a Google URL can arrive wearing any label. A failed ingest is NOT fatal —
      // the hotlink still renders and the lazy path retries on first view, so the sweep never loses
      // a cover it just found because Storage had a bad minute.
      if (patch.cover && isIngestibleCoverUrl(patch.cover)) {
        const origin = coverOriginOf(outcome.data)
        const t1 = now()
        const ing = await ingestCover({
          bookId: b.id,
          source: origin,
          url: patch.cover,
          trace: opts?.trace,
        })
        spans.push({ s: 'client.covers', ms: now() - t1 })
        if (ing.status === 'ok') {
          for (const sp of ing.data._trace?.spans ?? []) spans.push(sp)
          patch.cover = ing.data.cover
          patch.coverThumb = ing.data.thumb
          patch.coverSource = origin
          if (ing.data.color) patch.coverColor = ing.data.color
        }
        coverSource = origin
      }

      if (Object.keys(patch).length || !partial) {
        const t2 = now()
        const { error: ue } = await supabase
          .from('books')
          .update({ ...toBookRow(patch), ...(partial ? {} : { enriched_at: checkedAt }) })
          .eq('id', b.id)
        spans.push({ s: 'client.update', ms: now() - t2 })
        if (ue) {
          stopReason = 'error'
          errorMessage = ue.message
          break
        }
      }
      didFill = Object.keys(patch).length > 0
    } else {
      const t2 = now()
      const { error: ue } = await supabase.from('books').update({ enriched_at: checkedAt }).eq('id', b.id)
      spans.push({ s: 'client.update', ms: now() - t2 })
      if (ue) {
        stopReason = 'error'
        errorMessage = ue.message
        break
      }
    }
    if (didFill) filled++
    else if (!partial) nothing++
    if (partial) {
      failed++
      errorMessage ??= 'Some catalog sources were unavailable. Incomplete checks remain retryable.'
    } else scanned++
    // The trace row is written LAST and never throws: a measurement must not be able to fail the
    // thing it is measuring. `bookT0` spans the whole iteration, so `total_ms` includes the gaps
    // BETWEEN the timed stages — if the spans don't add up to it, the missing time is real and is
    // exactly what this exercise is looking for.
    if (opts?.trace)
      await recordTrace(runId, b, spans, now() - bookT0, outcome.status, coverSource)
    onProgress({ scanned, total, filled })
  }

  return { total, scanned, filled, nothing, failed, stopReason, errorMessage }
}
