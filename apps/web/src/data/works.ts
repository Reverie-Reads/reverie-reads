import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { normalizeIsbn, type Contributor } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { DISCOVER_BATCH, type DiscoverHit } from '../lib/discover'

/**
 * The corpus browse — a plain client select from `works`.
 *
 * No edge function on purpose: the works table's RLS is read-all-authenticated (its whole read
 * model), so PostgREST + .range() IS the pagination server, and adding a fn here would be a hop
 * that caches nothing and gates nothing. Contrast with the external shelf, which proxies Google
 * through the `releases` fn precisely because THAT source needs a shared cache and a key fence.
 */

export interface WorksFilters {
  /** canonical lowercased genre token, '' = all */
  genre: string
  /** exact tag membership (works.tags is lowercased at import), '' = all */
  tag: string
  /** title/author substring or ISBN-10/13 exact lookup, '' = none */
  q: string
}

export interface WorkRow {
  id: string
  work_key: string
  title: string
  contributors: Contributor[]
  isbns: string[]
  series: string | null
  position: number | null
  cover_url: string | null
  description?: string | null
  genre: string | null
  tags: string[]
  pub_y: number | null
  pub_m: number | null
  pub_d: number | null
}

// Ordinary reads ask for `isbns` so post-migration corpus picks keep edition metadata. If the web
// deploy precedes the owner-run migration, text reads retry with BASE_COLS and remain functional;
// ISBN-specific reads safely return no matches until the column exists.
const BASE_COLS =
  'id, work_key, title, contributors, series, position, cover_url, genre, tags, pub_y, pub_m, pub_d'
const ISBN_COLS = `${BASE_COLS}, isbns`

/** Page N's inclusive row range — pure, so the paging arithmetic is testable without a client. */
export const worksPageRange = (page: number): { from: number; to: number } => ({
  from: page * DISCOVER_BATCH,
  to: page * DISCOVER_BATCH + DISCOVER_BATCH - 1,
})

/**
 * Apply the browse filters to any works query builder. Generic over the builder so the unit test
 * hands in a recorder and asserts the CALLS — the composition logic is what can rot (a dropped
 * branch, a swapped operator), and it is testable without a database. fetchWorksPage below runs
 * THROUGH this function; a second copy of the filter logic is exactly the drift this shape exists
 * to prevent.
 *
 * A usable ISBN-10/13 is canonicalized to ISBN-13 and uses exact array containment. Everything
 * else matches title OR author_text — the denormalized column the migration carries precisely
 * because PostgREST cannot substring-search the contributors jsonb. `%` and `,` are stripped from
 * text terms rather than escaped: PostgREST's .or() syntax treats commas as separators, and a
 * literal % in a reader's search is noise, not a wildcard request.
 */
export function applyWorksFilters<
  T extends {
    eq(col: string, v: string): T
    contains(col: string, v: string[]): T
    or(expr: string): T
  },
>(query: T, f: WorksFilters): T {
  let q = query
  if (f.genre) q = q.eq('genre', f.genre)
  if (f.tag) q = q.contains('tags', [f.tag.toLowerCase()])
  const raw = f.q.trim()
  const isbn = normalizeIsbn(raw)
  if (isbn) q = q.contains('isbns', [isbn])
  else {
    const term = raw.replace(/[%,]/g, '')
    if (term) q = q.or(`title.ilike.%${term}%,author_text.ilike.%${term}%`)
  }
  return q
}

/** works row → the Discover card contract. A corpus pick IS an Add prefill, same as an external
 *  hit — authors from contributors, the first canonical ISBN when known, pub from pub_y so the
 *  card's year renders. cover may be '' for months; CoverPlaceholder is the designed common case
 *  at launch, not an error state. */
export function workToHit(w: WorkRow, preferredIsbn = ''): DiscoverHit {
  const pub = [w.pub_y, w.pub_m, w.pub_d]
    .filter((x): x is number => x != null)
    .map((x, i) => (i === 0 ? String(x) : String(x).padStart(2, '0')))
    .join('-')
  return {
    corpusWorkId: w.id,
    title: w.title,
    authors: (w.contributors ?? []).filter(c => c.role === 'author' || c.role === 'co_author').map((c) => c.name).filter(Boolean),
    cover: w.cover_url ?? '',
    genre: w.genre ?? '',
    tags: w.tags ?? [],
    description: w.description ?? undefined,
    catalogSource: 'corpus',
    // A work may describe several editions. When this pick began as a catalog result, preserve
    // that result's edition instead of silently replacing it with the work array's first member.
    isbn: normalizeIsbn(preferredIsbn) || w.isbns[0] || '',
    pub,
  }
}

type Filterable = {
  eq(col: string, v: string): Filterable
  contains(col: string, v: string[]): Filterable
  or(expr: string): Filterable
}

type QueryError = { code?: string; message?: string; details?: string; hint?: string }

/** PostgREST can report a not-yet-migrated column as PostgreSQL 42703 or as a schema-cache miss. */
export function isMissingWorksIsbns(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as QueryError
  if (e.code === '42703') return true
  const text = [e.message, e.details, e.hint].filter(Boolean).join(' ').toLowerCase()
  return text.includes('isbns') && (text.includes('does not exist') || text.includes('schema cache'))
}

const workRows = (data: unknown[] | null): WorkRow[] =>
  (data ?? []).map((row) => ({ ...(row as WorkRow), isbns: (row as Partial<WorkRow>).isbns ?? [] }))

/**
 * ONE ranged read of `works`, filtered. Every corpus select in the app goes through here, and the
 * `.range()` is not optional: an un-ranged PostgREST select stops at 1,000 rows WITHOUT SAYING SO,
 * which is the defect class this project has already paid for in `buildBackup`, `useBooks`,
 * `fetchLibrary` and the works promotion. The corpus is past 1,100 rows, so it is live here.
 */
async function fetchWorks(f: WorksFilters, from: number, to: number): Promise<WorkRow[]> {
  const isbn = normalizeIsbn(f.q.trim())
  const execute = async (cols: string) => {
    const base = supabase.from('works').select(cols)
    // One logic path: the same applyWorksFilters the unit tests drive. The structural cast exists
    // because supabase's builder generics recurse past tsc's instantiation depth when fed through a
    // generic constraint (TS2589); the runtime object is unchanged either side of it.
    const query = applyWorksFilters(base as unknown as Filterable, f) as unknown as typeof base
    return query.order('title', { ascending: true }).range(from, to)
  }
  let { data, error } = await execute(ISBN_COLS)
  if (error && isMissingWorksIsbns(error)) {
    if (isbn) return []
    const fallback = await execute(BASE_COLS)
    data = fallback.data
    error = fallback.error
  }
  if (error) {
    throw error
  }
  return workRows(data as unknown[] | null)
}

/** Canonical, stable set used both in the query key and the array-overlap lookup. */
export const canonicalLookupIsbns = (values: readonly string[]): string[] =>
  [...new Set(values.map(normalizeIsbn).filter(Boolean))].sort()

/** Merge the term and edition reads without allowing the same work to render/classify twice. */
export function mergeWorkRows(...groups: readonly (readonly WorkRow[] | undefined)[]): WorkRow[] {
  const byKey = new Map<string, WorkRow>()
  for (const rows of groups) {
    for (const row of rows ?? []) {
      const prior = byKey.get(row.work_key)
      byKey.set(row.work_key, prior ? { ...prior, ...row, isbns: row.isbns.length ? row.isbns : prior.isbns } : row)
    }
  }
  return [...byKey.values()]
}

/** One batched edition read for every catalog result, never one request per result. */
async function fetchWorksByIsbns(values: readonly string[]): Promise<WorkRow[]> {
  const isbns = canonicalLookupIsbns(values)
  if (!isbns.length) return []
  const { data, error } = await supabase
    .from('works')
    .select(ISBN_COLS)
    .overlaps('isbns', isbns)
    .order('title', { ascending: true })
    .range(0, WORKS_LOOKUP_LIMIT - 1)
  if (error) {
    // Backward-compatible rollout: before 20260828010000 is owner-applied, text lookup still
    // works and edition lookup simply contributes no rows. Every other error remains visible.
    if (isMissingWorksIsbns(error)) return []
    throw error
  }
  return workRows(data as unknown[] | null)
}

const fetchWorksPage = (f: WorksFilters, page: number): Promise<WorkRow[]> => {
  const { from, to } = worksPageRange(page)
  return fetchWorks(f, from, to)
}

/**
 * ACCUMULATES, deliberately unlike the external shelf's batchOf() CYCLING one section down.
 * The external shelf pages a FIXED pool of ~60 cached hits, so "new batch" REPLACES twenty with
 * the next twenty and wraps. The corpus browse walks a GROWING table, so "show more" APPENDS the
 * next DISCOVER_BATCH and the reader scrolls an ever-longer shelf. Same page size, opposite
 * accumulation — the comment exists because the two sit near each other in DiscoverRoute and the
 * difference is a decision, not an accident.
 */
export function useWorksBrowse(filters: WorksFilters) {
  return useInfiniteQuery({
    queryKey: ['works-browse', filters.genre, filters.tag, filters.q],
    queryFn: ({ pageParam }) => fetchWorksPage(filters, pageParam),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === DISCOVER_BATCH ? pages.length : undefined,
    staleTime: 1000 * 60 * 10,
  })
}

/**
 * How many corpus rows one add-search lookup will consider. A CAP, stated rather than implied: a
 * reader's term that matches more works than this leaves the tail unlabelled, and an unlabelled
 * corpus row reads as "New to your library" — the mild direction of the error (an extra add
 * control), never the severe one (a withheld add control for a book they do not have).
 *
 * 200 against a ~1.1k-row corpus, because the term is one a person typed at Add: a title or an
 * author, not a browse filter. Raise it against a measurement — a term that legitimately saturates
 * — not against a guess.
 */
export const WORKS_LOOKUP_LIMIT = 200

/**
 * The corpus half of Add's search triage: one ranged TERM query starts beside catalog search, then
 * one batched ISBN-overlap query covers the WHOLE catalog result set — never one query per result.
 *
 * Runs through the same `applyWorksFilters`/`fetchWorks` path as the browse, so an ISBN uses exact
 * containment and the text leg is literally the browse's text leg (`title.ilike` OR
 * `author_text.ilike`, over the denormalized column that exists because PostgREST cannot
 * substring-search the `contributors` jsonb). A second copy of the filter composition is exactly
 * the drift `applyWorksFilters` exists to prevent.
 *
 * DELIBERATELY SEPARATE from the search itself, and never awaited before results render: the hits
 * paint as soon as the catalog answers, and the corpus labels arrive when this resolves. Blocking
 * the list on a second round trip is a regression that is invisible on a fast connection.
 *
 * ISBN-10 input is promoted to canonical ISBN-13 before the corpus query, matching the same
 * normalization used by library matching and the owner-run importer.
 */
export function useWorksLookup(term: string, catalogIsbns: readonly string[] = []) {
  const q = term.trim()
  const editions = canonicalLookupIsbns(catalogIsbns)
  const byTerm = useQuery({
    queryKey: ['works-lookup', q],
    // Same floor as searchEverywhere's — below it the term matches most of the corpus and means
    // nothing, and the catalog would not have searched either.
    enabled: q.length >= 3,
    queryFn: () => fetchWorks({ genre: '', tag: '', q }, 0, WORKS_LOOKUP_LIMIT - 1),
    staleTime: 1000 * 60 * 10,
  })
  const byEdition = useQuery({
    queryKey: ['works-lookup-isbns', editions],
    enabled: editions.length > 0,
    queryFn: () => fetchWorksByIsbns(editions),
    staleTime: 1000 * 60 * 10,
  })
  return {
    data: mergeWorkRows(byTerm.data, byEdition.data),
    isPending: byTerm.isPending || (editions.length > 0 && byEdition.isPending),
    error: byTerm.error ?? byEdition.error,
    isFetching: byTerm.isFetching || byEdition.isFetching,
    refetch: () => Promise.all([byTerm.refetch(), ...(editions.length ? [byEdition.refetch()] : [])]),
  }
}
