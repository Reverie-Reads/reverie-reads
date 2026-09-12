// E1 — enrichment resolution core (docs/reference/COVER_SOURCING_AND_STUDIO.md Part 1; docs/reference/ENRICHMENT_STRATEGY.md).
// The real import files carry NO ISBNs and NO covers — only title+author(+series). This module turns a
// title+author query plus the candidate records a source SEARCH returned into a single best match WITH
// a confidence tier, a self-resolved ISBN-13, and the alternate candidates the Cover Studio offers as
// edition choices. PURE (no network): the Edge adapters fetch + normalize to SourceRecord (enrich.ts),
// this scores + selects. Wrong-book safety: an ambiguous or common-title match is marked LOW rather
// than guessed. Mirrored by supabase/functions/enrich/resolve.ts (enrichParity.test.ts asserts parity).

import { normalizeIsbn } from './match'
import type { EnrichSource, SourceRecord } from './enrich'

export type Confidence = 'high' | 'medium' | 'low' | 'none'

const RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1, none: 0 }
/** Numeric rank so callers can compare/threshold confidence (high > medium > low > none). */
export const confidenceRank = (c: Confidence): number => RANK[c]

// Source preference for THIS catalog (romance/romantasy/fantasy/horror, indie-heavy): Hardcover →
// Google → Open Library → ISBNdb. Breaks ties between candidates that scored the SAME confidence.
const SOURCE_PRIORITY: Record<EnrichSource, number> = {
  hardcover: 4,
  google: 3,
  openlibrary: 2,
  isbndb: 1,
  manual: 0,
}

export interface MatchQuery {
  title: string
  author?: string
  series?: string
}

/** One normalized candidate a source search returned. */
export interface ResolveCandidate {
  source: EnrichSource
  record: SourceRecord
}

export interface ScoredCandidate extends ResolveCandidate {
  confidence: Confidence
  titleExact: boolean
  authorMatch: boolean
  seriesMatch: boolean
}

export interface ResolvedMatch {
  /** the chosen candidate, or null when nothing matched the title */
  best: ResolveCandidate | null
  confidence: Confidence
  /** the normalized query the search used (stored for audit + re-search) */
  query: string
  /** self-resolved ISBN-13 from the best match ('' when the match carries none) */
  isbn13: string
  /** other plausible candidates retained as edition choices for the Cover Studio */
  alternates: ResolveCandidate[]
  /** short human reason for the confidence (review surfacing / debug) */
  reason: string
}

// ── normalization ──

/** Strip diacritics (é→e) so "Céline" matches "Celine" — NFKD then drop combining marks. */
export const foldDiacritics = (s: string): string =>
  String(s ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')

/** Clean a field for a search query: fold diacritics, collapse whitespace, trim (data has "Celia "). */
export const cleanField = (s: string): string =>
  foldDiacritics(String(s ?? ''))
    .replace(/\s+/g, ' ')
    .trim()

/** Equality key for a title/author: fold diacritics, lowercase, reduce to a–z0–9 single-spaced tokens. */
export const matchKey = (s: string): string =>
  foldDiacritics(String(s ?? ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** The normalized title+author a search adapter should actually query (trimmed, diacritic-folded). */
export interface NormalizedQuery {
  title: string
  author: string
}
export function normalizeQuery(q: MatchQuery): NormalizedQuery {
  return { title: cleanField(q.title), author: q.author ? cleanField(q.author) : '' }
}

const buildQueryString = (q: MatchQuery): string => {
  const t = cleanField(q.title)
  const a = q.author ? cleanField(q.author) : ''
  return a ? `${t} — ${a}` : t
}

// Title with a trailing subtitle (after :/–/—/-) dropped, normalized — for looser comparison.
const baseTitle = (s: string): string => matchKey(String(s ?? '').replace(/\s*[:–—-]\s.*$/, ''))
const tokenSet = (s: string): Set<string> => new Set(matchKey(s).split(' ').filter(Boolean))
const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (!a.size && !b.size) return 1
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  const union = a.size + b.size - inter
  return union ? inter / union : 0
}

const titlesEqual = (a: string, b: string): boolean =>
  matchKey(a) !== '' && matchKey(a) === matchKey(b)
const titlesClose = (a: string, b: string): boolean => {
  const ka = matchKey(a)
  const kb = matchKey(b)
  if (!ka || !kb) return false
  if (ka === kb) return true
  const bta = baseTitle(a)
  if (bta && bta === baseTitle(b)) return true // subtitle-insensitive
  if (ka.includes(kb) || kb.includes(ka)) return true // "Title" vs "Title A Novel"
  return jaccard(tokenSet(a), tokenSet(b)) >= 0.6 // strong word overlap
}

const authorMatches = (
  queryAuthor: string | undefined,
  candAuthors: string[] | undefined,
): boolean => {
  const key = matchKey(queryAuthor ?? '')
  return !!key && (candAuthors ?? []).some((author) => matchKey(author) === key)
}

/** Self-resolve a candidate's ISBN-13: direct 13, else any 13 in `isbns`, else promote a 10. */
export function selfIsbn13(r: SourceRecord): string {
  if (r.scope === 'work') return ''
  return (
    normalizeIsbn(r.isbn13 ?? '') ||
    normalizeIsbn(r.isbn10 ?? '') ||
    (r.isbns ?? []).map(normalizeIsbn).find(Boolean) ||
    ''
  )
}

const completeness = (r: SourceRecord): number => (r.cover ? 2 : 0) + (selfIsbn13(r) ? 1 : 0)

// Two identities, deliberately different:
// - WORK: title + primary author. Distinct works sharing the top tier = ambiguity (wrong-book risk).
//   Different EDITIONS of the same work (same title+author, different ISBN) are ONE work, never
//   ambiguous, and corroboration from several sources collapses here too.
// - EDITION: the ISBN when known (else the work). Dedups alternates so each distinct edition appears
//   once as a Cover-Studio choice, while exact duplicates from multiple sources don't double up.
const workIdentity = (c: ResolveCandidate): string =>
  `${matchKey(c.record.title ?? '')}|${matchKey((c.record.authors ?? [])[0] ?? '')}`
const editionIdentity = (c: ResolveCandidate): string => {
  const isbn = selfIsbn13(c.record)
  return isbn ? `isbn:${isbn}` : `work:${workIdentity(c)}`
}

/**
 * Score one candidate against the query. Confidence tiers (docs Part 1):
 * - high   — exact normalized title AND author match (the safe auto-fill case);
 * - medium — exact title but NO author given to confirm, or a close title WITH author match;
 * - low    — close title only, OR an exact title whose author DISAGREES (common-title / wrong-book risk);
 * - none   — the title doesn't even loosely match.
 * A matching series corroborates an author-confirmed medium up to high.
 */
export function scoreCandidate(q: MatchQuery, c: ResolveCandidate): ScoredCandidate {
  const candTitle = c.record.title ?? ''
  const exact = titlesEqual(q.title, candTitle)
  const close = exact || titlesClose(q.title, candTitle)
  const authorGiven = !!(q.author && q.author.trim())
  const candHasAuthors = (c.record.authors ?? []).some((a) => !!a && !!a.trim())
  const authorMatch = authorMatches(q.author, c.record.authors)
  // Author can only be CONFIRMED (or refuted) when BOTH sides name one. A source that omits authors
  // (e.g. Hardcover) leaves it unconfirmed → medium, never treated as a conflict.
  const authorConflict = authorGiven && candHasAuthors && !authorMatch
  const seriesMatch = !!(
    q.series &&
    c.record.series &&
    matchKey(q.series) === matchKey(c.record.series)
  )

  let confidence: Confidence
  if (!close) confidence = 'none'
  else if (authorConflict)
    confidence = 'low' // both name an author and they disagree → wrong-book risk
  else if (exact && authorMatch)
    confidence = 'high' // exact title + confirmed author
  else if (exact)
    confidence = 'medium' // exact title, author unconfirmable on one side
  else if (authorMatch)
    confidence = 'medium' // close title + confirmed author
  else confidence = 'low' // close title only, unconfirmed

  // A search series label cannot upgrade an inexact title to confirmed identity.

  return { ...c, confidence, titleExact: exact, authorMatch, seriesMatch }
}

const reasonFor = (s: ScoredCandidate): string => {
  switch (s.confidence) {
    case 'high':
      return s.seriesMatch ? 'exact title + author + series' : 'exact title + author'
    case 'medium':
      return s.titleExact ? 'exact title, author unconfirmed' : 'close title + author'
    case 'low':
      return s.titleExact ? 'title matches but author differs' : 'fuzzy title only'
    default:
      return 'no match'
  }
}

/**
 * Pick the single best match across all source candidates, with confidence + alternates.
 * - drop non-matches; sort by confidence, then catalog source priority, then completeness;
 * - WRONG-BOOK SAFETY: if ≥2 genuinely DISTINCT works tie at the top tier (≥ medium), downgrade to
 *   low rather than guess — corroboration from multiple sources for the SAME book does NOT count;
 * - self-resolve the best match's ISBN-13;
 * - keep the other distinct candidates that have a cover or ISBN as Cover-Studio edition choices.
 */
export function selectBestMatch(
  q: MatchQuery,
  candidates: readonly ResolveCandidate[],
): ResolvedMatch {
  const query = buildQueryString(q)
  const scored = candidates.map((c) => scoreCandidate(q, c)).filter((s) => s.confidence !== 'none')
  if (!scored.length) {
    return {
      best: null,
      confidence: 'none',
      query,
      isbn13: '',
      alternates: [],
      reason: 'no candidate matched the title',
    }
  }

  const sorted = [...scored].sort((a, b) => {
    if (RANK[b.confidence] !== RANK[a.confidence]) return RANK[b.confidence] - RANK[a.confidence]
    if (SOURCE_PRIORITY[b.source] !== SOURCE_PRIORITY[a.source])
      return SOURCE_PRIORITY[b.source] - SOURCE_PRIORITY[a.source]
    return completeness(b.record) - completeness(a.record)
  })

  const top = sorted[0] as ScoredCandidate
  let confidence = top.confidence
  let reason = reasonFor(top)

  // Ambiguity: distinct WORKS sharing the top tier (only meaningful at medium+). Different editions
  // of the same work, and the same work corroborated by several sources, collapse to one work here.
  const topTier = sorted.filter((s) => s.confidence === top.confidence)
  const distinctTopWorks = new Set(topTier.map(workIdentity))
  if (RANK[confidence] >= RANK.medium && distinctTopWorks.size > 1) {
    confidence = 'low'
    reason = `ambiguous — ${distinctTopWorks.size} distinct works matched at "${top.confidence}"`
  }

  const best: ResolveCandidate = { source: top.source, record: top.record }
  const isbn13 = selfIsbn13(top.record)

  // Alternates = other distinct editions/works that carry a cover or ISBN (Cover-Studio choices).
  const seen = new Set<string>([editionIdentity(top)])
  const alternates: ResolveCandidate[] = []
  for (const s of sorted) {
    const id = editionIdentity(s)
    if (seen.has(id)) continue
    seen.add(id)
    if (s.record.cover || selfIsbn13(s.record))
      alternates.push({ source: s.source, record: s.record })
  }

  return { best, confidence, query, isbn13, alternates, reason }
}
