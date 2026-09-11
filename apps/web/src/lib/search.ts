import { matchBook, type Book, type Incoming } from '@reverie/core'
import { supabase } from './supabase'

// One search implementation, two surfaces (Discover field + the shelf picker's "search everywhere").
// ONE path: the `search` edge function — Hardcover (backend-only) + Google fill, server-cached,
// rate-limited. The reader's browser never talks to a third-party catalog.
//
// ── THE CLIENT GOOGLE FALLBACK WAS REMOVED, and this is the argument, not a footnote ────────────
// It existed for availability: "search still works with the function undeployed or down", the
// documented Google-key seam (task §1). That was a real benefit and it is genuinely being given
// up. What retired it is WHEN it fired: precisely when the backend was broken — rare, unpredictable,
// and unwatched. A privacy surface that only appears during an outage is the hardest kind to reason
// about (nobody is looking when it happens, and it cannot be reproduced on demand), and it is not
// the kind of thing a reader can consent to, because its existence is invisible until it triggers.
// Availability we can measure; a leak we cannot observe we cannot bound.
//
// SO: with the function down, search returns EMPTY and the caller shows its error state. Chosen,
// not defaulted into — the surfaces already render `isError` (DiscoverRoute:225, :391), so the
// failure is visible to the reader rather than silently empty.

/** A search hit — cover/title/author/year/series (task §1). No consensus fields (anti-consensus). */
export interface SearchResult {
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
  /** Required on Google Books results so every displayed result can link to its source page. */
  sourceUrl?: string
}

export interface SearchResultSections {
  catalog: SearchResult[]
  google: SearchResult[]
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
const isbnKey = (isbn: string): string => (isbn || '').replace(/[^0-9Xx]/g, '').toLowerCase()

/** Identity for dedupe: ISBN-13 (or any ISBN) when present, else normalized title + first author. */
export const resultKey = (r: SearchResult): string =>
  isbnKey(r.isbn13 ?? r.isbn) || `${norm(r.title)}|${norm(r.authors[0] ?? '')}`

export function dedupeResults(results: SearchResult[]): SearchResult[] {
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

/**
 * Keep Google Books search results separate and in provider order. Catalog results may still use
 * Reverie's ordinary identity dedupe; Google results must not be reordered, cross-deduplicated, or
 * displayed without their required Google Books link.
 */
export function partitionSearchResults(results: SearchResult[]): SearchResultSections {
  const catalog: SearchResult[] = []
  const google: SearchResult[] = []
  for (const result of results) {
    if (result.source === 'google') {
      if (googleBooksResultUrl(result)) google.push(result)
    } else {
      catalog.push(result)
    }
  }
  return { catalog: dedupeResults(catalog), google }
}

export function googleBooksResultUrl(result: {
  source?: SearchResult['source']
  sourceUrl?: string
}): string | null {
  if (result.source !== 'google' || !result.sourceUrl) return null
  try {
    const url = new URL(result.sourceUrl)
    return url.protocol === 'https:' && url.hostname === 'books.google.com' ? url.toString() : null
  } catch {
    return null
  }
}

/** A search result as an Incoming (for matchBook / intake). */
export function resultToIncoming(r: SearchResult): Incoming {
  const [first = '', ...rest] = (r.authors[0] ?? '').split(/\s+/)
  return {
    title: r.title,
    first,
    last: rest.join(' '),
    isbn: r.isbn13 ?? r.isbn ?? '',
    series: r.series,
    position: r.seriesPosition ?? '',
  }
}

/** The library book a result already IS, or null — reuses core's ISBN/title-author matcher, so the
 *  result shows its shelf state (and links to it) instead of add actions (task §1). */
export function libraryMatch(r: SearchResult, library: readonly Book[]): Book | null {
  const m = matchBook(resultToIncoming(r), library)
  return m.strength === 'none' ? null : m.book
}

/**
 * Search the wider catalog for a query (title / author / ISBN). ONE path: the `search` edge
 * function (Hardcover + Google fill, server-cached). Throws when the function fails, so the caller
 * renders its error state instead of an indistinguishable "no results" — see the header for why
 * there is no client-side fallback any more.
 */
export async function searchEverywhere(q: string, signal?: AbortSignal): Promise<SearchResult[]> {
  const query = q.trim()
  if (query.length < 3) return []
  const { data, error } = await supabase.functions.invoke('search', {
    body: { q: query },
    ...(signal ? { signal } : {}),
  })
  if (error) throw new Error(`search unavailable: ${error.message}`)
  const results = ((data as { results?: SearchResult[] })?.results ?? []).filter((r) => r?.title)
  const sections = partitionSearchResults(results)
  return [...sections.catalog, ...sections.google]
}
