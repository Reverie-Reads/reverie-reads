import {
  blendCuratedPool,
  bestGoogleCoverLink,
  tierDiscoverShelf,
  embeddingText,
  genreKey,
  type Book,
  type DiscoveryBook,
} from '@reverie/core'
import { supabase } from './supabase'

// Discover v1 (owner-approved): a genre-keyed browse of the wider catalog, one tap from Add.
// Client-side Google Books, the same source and pattern as the Add screen's search — each reader
// spends their own anonymous quota, and TanStack Query's staleTime keeps a session to a handful of
// calls. The upgrade path (deliberately out of v1): a `discover` edge function with a shared
// per-genre daily cache + Hardcover trending, and Tier-2 embeddings re-ranking these results
// toward the reader's taste. This module stays pure/fetch-thin so that swap is a one-liner.

/** Same shape as the Add screen's search hits — a Discover pick IS an add prefill. */
export interface DiscoverHit extends DiscoveryBook {
  /** Present for corpus-backed hits so Add preserves the exact shared-work identity. */
  corpusWorkId?: string
  title: string
  authors: string[]
  cover: string
  isbn: string
  pub: string
  /** Search-result provenance. Present when this preview came from live catalog search. */
  source?: 'hardcover' | 'google'
  sourceUrl?: string
  /** provenance: true only on curated-injection hits (packages/core discoverCurated) — debuggable
   *  in the network tab and the fn's cache rows, never rendered to the reader */
  curated?: boolean
}

/** Google Books subject query per core genre (keys = the canonical lowercased genres). Cozy has no
 *  BISAC top of its own — its room browses the cozy-mystery shelf; nonfiction leads with the
 *  biography/memoir bucket (the largest general-reader nonfiction shelf). */
export const GENRE_DISCOVER_QUERY: Record<string, string> = {
  romance: 'subject:romance',
  fantasy: 'subject:fantasy',
  'science fiction': 'subject:"science fiction"',
  horror: 'subject:horror',
  mystery: 'subject:mystery',
  literary: 'subject:"literary fiction"',
  cozy: 'subject:"cozy mysteries"',
  nonfiction: 'subject:"biography & autobiography"',
  'young adult': 'subject:"young adult fiction"',
}

/** The subject query for any genre spelling (resolved via genreKey); an unknown genre browses
 *  its own name as a subject — a reader's custom world is still browsable. */
export function discoverQuery(genre: string): string {
  const key = genreKey(genre)
  return GENRE_DISCOVER_QUERY[key] ?? `subject:"${key}"`
}

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Map a raw Google volume to a hit (https-forced cover, canonical ISBN-13 preferred). */
export function volumeToHit(item: any): DiscoverHit {
  const v = item?.volumeInfo ?? {}
  const ids: any[] = v.industryIdentifiers ?? []
  const ind = ids.find((x) => x.type === 'ISBN_13') ?? ids[0]
  const sourceUrl =
    typeof v.infoLink === 'string'
      ? v.infoLink.replace(/^http:/, 'https:')
      : item?.id
        ? `https://books.google.com/books?id=${encodeURIComponent(item.id)}`
        : undefined
  return {
    title: v.title ?? '',
    authors: v.authors ?? [],
    cover: bestGoogleCoverLink(v.imageLinks),
    isbn: ind?.identifier ?? '',
    pub: v.publishedDate ?? '',
    ...(sourceUrl ? { source: 'google' as const, sourceUrl } : {}),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const isbnKey = (isbn: string): string => isbn.replace(/[^0-9Xx]/g, '').toLowerCase()

/** Identity for dedupe/ownership: ISBN when present, else normalized title + first author. */
export function hitKey(h: { title: string; authors?: string[]; isbn?: string }): string {
  const isbn = isbnKey(h.isbn ?? '')
  return isbn || `${norm(h.title)}|${norm(h.authors?.[0] ?? '')}`
}

export function dedupeHits(hits: DiscoverHit[]): DiscoverHit[] {
  const seen = new Set<string>()
  const out: DiscoverHit[] = []
  for (const h of hits) {
    const byIsbn = isbnKey(h.isbn)
    const byTitle = `${norm(h.title)}|${norm(h.authors[0] ?? '')}`
    if ((byIsbn && seen.has(byIsbn)) || seen.has(byTitle)) continue
    if (byIsbn) seen.add(byIsbn)
    seen.add(byTitle)
    out.push(h)
  }
  return out
}

/** Which hits the reader already shelves — matched by ISBN or by title + first contributor. */
export function ownedKeys(books: readonly Book[]): Set<string> {
  const keys = new Set<string>()
  for (const b of books) {
    const isbn = isbnKey(b.isbn ?? '')
    if (isbn) keys.add(isbn)
    // contributors[0] when the join is loaded, else the back-compat first/last columns — the same
    // fallback order mappers.toBook uses for the primary author. Without it, a book whose row
    // carries author_first/author_last but no book_authors rows (every scripted insert: the e2e
    // fixtures, seed-dev, the corpus import) hashes as `title|` and the hide-what-I-have toggle
    // silently misses it. Caught by the corpus browse e2e; the defect predates the corpus.
    const name = b.contributors[0]?.name ?? [b.first, b.last].filter(Boolean).join(' ')
    keys.add(`${norm(b.title)}|${norm(name)}`)
  }
  return keys
}

export function isOwned(h: DiscoverHit, owned: Set<string>): boolean {
  const isbn = isbnKey(h.isbn)
  if (isbn && owned.has(isbn)) return true
  return owned.has(`${norm(h.title)}|${norm(h.authors[0] ?? '')}`)
}

/** How many hits a shelf shows at once. */
export const DISCOVER_BATCH = 20
/** Ceiling on the pool the fn caches and returns per genre — three batches' worth.
 *  Mirrored as DISCOVER_POOL in supabase/functions/releases/index.ts. */
export const DISCOVER_POOL = 60

/** The pool minus what the reader already shelves, when the toggle asks for that.
 *
 *  FILTERS THE POOL, NOT THE BATCH, and the order is the whole point. Chunk first and a reader who
 *  owns nine of the first twenty gets a batch of eleven — the "typical attrition" shape, where the
 *  shelf silently thins and the reader cannot tell a filtered batch from a short one. Filtering
 *  first means every batch is a full DISCOVER_BATCH of things they do not have, and the pool simply
 *  yields fewer batches. */
export function visibleHits(
  pool: readonly DiscoverHit[],
  owned: Set<string>,
  hideImported: boolean,
): DiscoverHit[] {
  return hideImported ? pool.filter((h) => !isOwned(h, owned)) : [...pool]
}

/** How many batches a list of hits divides into (0 for an empty list, 1 for a short one). */
export const batchCount = (hits: readonly unknown[]): number =>
  Math.ceil(hits.length / DISCOVER_BATCH)

/** The `index`-th batch, CYCLING: past the last batch it wraps to the first, so the control never
 *  dead-ends and the caller never has to bounds-check. Batches within one pass are disjoint —
 *  consecutive presses show no repeats until the pool is exhausted, which is the point at which
 *  repeating is what "cycle" means. A pool at or under DISCOVER_BATCH is a single batch, so the
 *  fn-down curated path and an old deployed fn still returning 12 both land on "one batch, no
 *  control" without a special case. */
export function batchOf(hits: readonly DiscoverHit[], index: number): DiscoverHit[] {
  const count = batchCount(hits)
  if (count === 0) return []
  const wrapped = ((index % count) + count) % count // negative-safe
  return hits.slice(wrapped * DISCOVER_BATCH, wrapped * DISCOVER_BATCH + DISCOVER_BATCH)
}

/**
 * The Discover shelf for a genre — ONE path: the `releases` fn's shared per-genre daily cache
 * (24h TTL, one upstream lookup serves every reader, recency-gated + curated server-side).
 *
 * ── THE CLIENT FALLBACK WAS REMOVED, and this site is why the PR exists ─────────────────────────
 * DiscoverRoute's useQuery has no `enabled` guard, so this runs on ROUTE MOUNT. The old fallback
 * therefore sent the reader's IP to Google on navigation alone — no typing, no click, no consent —
 * whenever the fn erred or returned an empty shelf. That is the automatic, no-action shape, and it
 * is the one that cannot be defended by "the key is referrer-restricted": the exposure is the
 * REQUEST, not the key.
 *
 * Availability cost, stated rather than waved past: with the fn down, a genre shelf is empty and
 * DiscoverRoute renders its error state (:225 / :391). That is a smaller loss than it looks — the
 * server path serves every reader from one 24h-cached lookup per genre, so an outage has to
 * outlast the cache before anyone sees an empty shelf at all.
 */
export async function fetchDiscover(genre: string, signal?: AbortSignal): Promise<DiscoverHit[]> {
  const query = discoverQuery(genre)
  try {
    const { data, error } = await supabase.functions.invoke('releases', {
      body: { mode: 'discover', genre: genreKey(genre), query },
      ...(signal ? { signal } : {}),
    })
    if (!error) {
      const hits = ((data as { hits?: DiscoverHit[] })?.hits ?? []).filter(
        (h) => h?.title && h.cover && h.authors?.length,
      )
      if (hits.length) return hits.slice(0, DISCOVER_POOL)
    }
  } catch {
    /* degrade to the LOCAL curated pool below — never to a network fetch */
  }
  // Fn down or empty: the LOCAL-ONLY degradation. blendCuratedPool draws from curated titles that
  // SHIP IN THE BUNDLE — zero network, so the no-third-party-request guarantee holds in exactly
  // the state that used to leak (the old fallback fetched Google here; the first draft of this PR
  // then threw, which discover-curated.spec.ts correctly failed: the curated shelf for the four
  // starved genres IS deliberate fn-down behavior, not a side effect of the fetch it rode with).
  // In-scope genres render their curated set, tiered so recent titles lead; out-of-scope genres
  // return [] and the route shows its empty-shelf state, same as always.
  const pool = blendCuratedPool(genreKey(genre), []) as DiscoverHit[]
  if (!pool.length) return []
  // Same ceiling as the live path, and deliberately still a no-op here: the curated sets are 8-12
  // titles, all under DISCOVER_BATCH, so this path returns exactly what it always did — one short
  // batch and no cycle control. The fallback's BEHAVIOUR is unchanged by the batching work; only
  // the constant it clamps against moved.
  return tierDiscoverShelf(pool, new Date().getFullYear()).slice(0, DISCOVER_POOL)
}

// ── Tier 2b: taste ranking (owner-approved) ──
// External finds scored against the reader's taste centroid (mean vector of loved books) by the
// embed fn's rank mode. Absence of taste (cold start, fn down, budget cut) is a fine answer —
// callers pass through to catalog order.

/** hitKey → cosine-to-centroid. The fn scores as many items as fit its per-request CPU budget
 *  (all of them on hosted; a few per call on slower runtimes), so we accumulate across a handful
 *  of calls until every hit is scored or a call stops making progress. */
export async function rankHitsByTaste(
  hits: DiscoverHit[],
  genre: string,
): Promise<Record<string, number> | null> {
  try {
    // DISCOVER_BATCH, not the old fixed 16: callers now pass ONE BATCH rather than the whole
    // shelf, and 16 would have left the last four of every batch unscored — silently downgrading
    // "closest to your taste first" to "closest first, then four strays". Ranking stays per-batch
    // so the promise holds for exactly what is on screen; the pool beyond it is not ranked and
    // does not need to be until the reader asks for it.
    let remaining = hits.slice(0, DISCOVER_BATCH).map((h) => ({
      key: hitKey(h),
      // same composition the library vectors use (title + author + world) — one semantic space
      text: embeddingText({ title: h.title, author: h.authors[0], genre }),
    }))
    const scores: Record<string, number> = {}
    for (let call = 0; call < 6 && remaining.length; call++) {
      const { data, error } = await supabase.functions.invoke('embed', {
        body: { mode: 'rank', items: remaining },
      })
      if (error) break
      const d = data as { hasTaste?: boolean; scores?: { key: string; score: number }[] }
      if (!d?.hasTaste || !d.scores?.length) break
      for (const s of d.scores) scores[s.key] = s.score
      remaining = remaining.filter((it) => scores[it.key] == null)
    }
    return Object.keys(scores).length ? scores : null
  } catch {
    return null
  }
}

/** Taste-scored hits first (closest first); unscored hits keep their catalog order behind them. */
export function sortByTaste(
  hits: readonly DiscoverHit[],
  scores: Record<string, number>,
): { hit: DiscoverHit; taste?: number }[] {
  const annotated = hits.map((hit) => {
    const taste = scores[hitKey(hit)]
    return taste == null ? { hit } : { hit, taste }
  })
  const scored = annotated
    .filter((a) => a.taste != null)
    .sort((a, b) => (b.taste ?? 0) - (a.taste ?? 0))
  const unscored = annotated.filter((a) => a.taste == null)
  return [...scored, ...unscored]
}
