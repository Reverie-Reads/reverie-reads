import { validPublicationDate } from './partialDate'
// Column mapping + ingest for real library exports (Import I2). Real exports vary in column names
// and shape, so ingest is driven by a ColumnProfile (which headers map to which fields). Built-in
// profiles cover the two real shapes (Library, Chism) plus a generic Goodreads/StoryGraph fallback;
// callers can pass their own. Pure: parse → ImportedRow[] (an Incoming + import-only metadata the
// dedupe + connected-series steps use). The caller routes Incomings through match.ts / the merge
// path, so re-import is idempotent.

import type { PossessionState, PubDate, ReadStatus } from './types'
import { parseCSV } from './csv'
import { snapHalfRating } from './rating'
import { parseSeriesFromTitle } from './seriesTitle'
import { cleanIsbn, type Incoming } from './match'
import { emptyOwned, possessionPatch } from './ownership'
import { contributorsFromAuthors, fromFirstLast } from './contributors'
import { normalizeImportGenres } from './genreNormalize'
import { makeSeriesClaim } from './seriesClaim'

/** Which headers feed which field. Each entry is a list of accepted header names (case-insensitive). */
export interface ColumnProfile {
  name: string
  title: string[]
  author?: string[] // a single combined "First Last" / "Last, First" column
  authorFirst?: string[]
  authorLast?: string[]
  series?: string[]
  seriesOrder?: string[] // intrinsic position within the series (fractional ok)
  seriesNumber?: string[] // "Series #" — universe-ordering metadata (I3)
  globalOrder?: string[] // connected-universe read order (I3)
  seriesType?: string[] // e.g. "interconnected standalone" (I3)
  genre?: string[]
  tags?: string[]
  releaseDate?: string[]
  readDate?: string[] // when the reader finished it → a read entry (distinct from releaseDate)
  isbn?: string[] // ISBN-10/13 identifier column
  pages?: string[]
  rating?: string[] // the reader's own 0–5 rating
  readStatus?: string[] // generic read-status column
  owned?: string[] // ownership column (yes/no; blank = owned) — Reverie template's "Owned"
  gcRead?: string[] // Chism: "X" = read, "IP" = reading
  duplicate?: string[] // Chism: "X" flags a known duplicate
}

/** The canonical Reverie import template — the column order the generator emits and the detector keys
 *  to. One source of truth: the .xlsx generator builds these headers, REVERIE_PROFILE maps them back,
 *  and detectProfile recognizes the shape. Keep in sync with apps/web/src/data/importTemplate.ts. */
export const REVERIE_TEMPLATE_COLUMNS = [
  'Title',
  'Author',
  'ISBN',
  'Status',
  'Rating',
  'Date Read',
  'Tags',
  'Owned',
] as const

export const REVERIE_PROFILE: ColumnProfile = {
  name: 'reverie',
  title: ['title'],
  author: ['author', 'authors'],
  isbn: ['isbn', 'isbn13', 'isbn-13', 'isbn10', 'isbn-10'],
  pages: ['number of pages', 'page count', 'pages'],
  readStatus: ['status', 'read status'],
  rating: ['rating', 'my rating'],
  readDate: ['date read', 'last date read'],
  tags: ['tags', 'tag'],
  genre: ['genre', 'genres'],
  owned: ['owned', 'own', 'ownership'],
}

export const LIBRARY_PROFILE: ColumnProfile = {
  name: 'library',
  isbn: ['isbn13', 'isbn-13', 'isbn', 'isbn10', 'isbn-10'],
  pages: ['number of pages', 'page count', 'pages'],
  title: ['title'],
  authorFirst: ['author first', 'author, first', 'first', 'first name'],
  authorLast: ['author last', 'author, last', 'last', 'last name'],
  series: ['series'],
  seriesOrder: ['series order', 'order in series'],
  seriesNumber: ['series #', 'series number', 'series no'],
  // Still mapped, deliberately, though nothing consumes it any more: reading orders were dropped
  // (chore/drop-reading-orders) and series position is now the single ordering mechanism. Parsing
  // it is what lets the import SAY the column went unused instead of discarding it in silence.
  globalOrder: ['global order', 'universe order', 'read order'],
  seriesType: ['series type', 'type'],
  genre: ['genre', 'genres'],
  tags: ['tags', 'tag'],
  releaseDate: ['release date', 'release', 'published', 'publication date'],
}

export const CHISM_PROFILE: ColumnProfile = {
  name: 'chism',
  title: ['title'],
  authorFirst: ['author, first', 'author first', 'first'],
  authorLast: ['author, last', 'author last', 'last'],
  series: ['series'],
  genre: ['genre', 'genres'],
  tags: ['tags', 'tag'],
  gcRead: ['gc read'],
  duplicate: ['duplicate'],
  // "Completed / Standalones", "TC Read", and the blank/Unnamed columns are intentionally unmapped.
}

export const GENERIC_PROFILE: ColumnProfile = {
  name: 'generic',
  isbn: ['isbn13', 'isbn-13', 'isbn', 'isbn10', 'isbn-10'],
  pages: ['number of pages', 'page count', 'pages'],
  title: ['title'],
  author: ['author', 'authors'],
  authorFirst: ['first name', 'author first'],
  authorLast: ['last name', 'author last'],
  series: ['series'],
  seriesOrder: ['series order', 'series number'],
  genre: ['genre', 'genres', 'shelf', 'bookshelves'],
  tags: ['tags', 'tag'],
  releaseDate: ['release date', 'date published', 'year published', 'publication year'],
  readStatus: ['read status', 'exclusive shelf', 'status'],
  owned: ['owned', 'own', 'ownership'],
}

const BUILTIN = [REVERIE_PROFILE, LIBRARY_PROFILE, CHISM_PROFILE, GENERIC_PROFILE]

/** An imported row: the Incoming for matching/merging + import-only metadata for dedupe + I3. */
export interface ImportedRow {
  incoming: Incoming
  /** the source export flagged this as a known duplicate */
  duplicate: boolean
  /** connected-universe read order (I3), if the export provides it */
  globalOrder: number | null
  /** universe ordering metadata, e.g. "Series #" */
  seriesNumber: number | null
  /** raw series-type marker, e.g. "interconnected standalone" */
  seriesType: string | null
  /** the raw genre cell when it didn't map to a core genre (E3 import-review "odd genre" signal) */
  unmappedGenre: string | null
}

const normHeader = (h: string) => h.trim().toLowerCase()

/** Resolve a profile's fields to column indices against a header row (−1 when absent). */
export function buildColumnIndex(
  headers: string[],
  profile: ColumnProfile,
): Record<string, number> {
  const lower = headers.map(normHeader)
  const find = (cands?: string[]): number => {
    for (const c of cands ?? []) {
      const i = lower.indexOf(c)
      if (i >= 0) return i
    }
    return -1
  }
  const idx: Record<string, number> = {}
  for (const key of Object.keys(profile) as (keyof ColumnProfile)[]) {
    if (key === 'name') continue
    idx[key] = find(profile[key] as string[])
  }
  return idx
}

/** Pick the best built-in profile for a header row (Library/Chism markers, else generic). */
export function detectProfile(headers: string[]): ColumnProfile {
  const h = new Set(headers.map(normHeader))
  const has = (s: string) => h.has(s)
  // Reverie's own template: the clean Title/Author/ISBN/Status/Rating/Date Read/Tags shape. Its plain
  // "rating" + "status" headers distinguish it from a Goodreads export ("my rating"/"exclusive shelf").
  if (has('status') && has('rating') && has('date read') && (has('isbn') || has('tags')))
    return REVERIE_PROFILE
  if (has('gc read') || has('duplicate') || has('completed / standalones')) return CHISM_PROFILE
  if (has('global order') || has('series type') || has('series #')) return LIBRARY_PROFILE
  return GENERIC_PROFILE
}

const num = (s: string): number | null => {
  const v = Number(String(s).trim())
  return Number.isFinite(v) ? v : null
}

/** First YYYY-M-D / YYYY/M/D in a cell → a normalized YYYY-MM-DD read date (mirrors csv.ts). */
function parseReadDate(raw: string): string | null {
  const m = (raw ?? '').match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${(m[2] ?? '').padStart(2, '0')}-${(m[3] ?? '').padStart(2, '0')}`
}

/** Parse a release-date cell: 4-digit year, ISO/US date, or an Excel serial → PubDate. */
export function parseReleaseDate(raw: string): PubDate {
  const p = parseReleaseDateParts(raw)
  return validPublicationDate(p) ? p : { y: null, m: null, d: null }
}

function parseReleaseDateParts(raw: string): PubDate {
  const s = (raw ?? '').trim()
  if (!s) return { y: null, m: null, d: null }
  if (/^\d{4}$/.test(s)) return { y: Number(s), m: null, d: null }
  const iso = s.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/)
  if (iso)
    return { y: Number(iso[1]), m: Number(iso[2]) || null, d: iso[3] ? Number(iso[3]) : null }
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (us) return { y: Number(us[3]), m: Number(us[1]) || null, d: Number(us[2]) || null }
  // Excel serial day-number (days since 1899-12-30).
  const serial = Number(s)
  if (Number.isFinite(serial) && serial > 10000 && serial < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000)
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
  }
  return { y: null, m: null, d: null }
}

/** Chism GC-Read cell → read status ("X" read, "IP" reading, else unread). */
function gcReadStatus(cell: string): ReadStatus {
  const v = cell.trim().toLowerCase()
  if (v === 'x' || v === 'read' || v === 'yes') return 'Read'
  if (v === 'ip' || v === 'in progress' || v === 'reading') return 'Reading'
  return 'Unread'
}

/** Generic read-status cell (Goodreads/StoryGraph shelves + the Reverie template's Status). */
function genericReadStatus(cell: string): ReadStatus {
  const v = cell.toLowerCase()
  // "unread" before the read branch — it contains the substring "read".
  if (/unread|to-read|to read|wishlist|tbr/.test(v)) return 'Unread'
  if (/dnf|did.not/.test(v)) return 'DNF'
  if (/currently|reading/.test(v)) return 'Reading'
  if (/read|finished/.test(v)) return 'Read'
  return 'Unread'
}

function contributorsFor(cell: (k: string) => string): {
  first: string
  last: string
  contributors: Incoming['contributors']
} {
  const first = cell('authorFirst').trim()
  const last = cell('authorLast').trim()
  if (first || last) return { first, last, contributors: fromFirstLast(first, last) }
  // a single combined column may carry co-authors ("A & B", "A; B", "Last, First")
  const combined = cell('author').trim()
  if (!combined) return { first: '', last: '', contributors: [] }
  if (/^[^,]+,\s*\S/.test(combined) && !/[&;]/.test(combined)) {
    // "Last, First"
    const [l, f] = combined.split(',').map((x) => x.trim())
    return { first: f ?? '', last: l ?? '', contributors: fromFirstLast(f ?? '', l ?? '') }
  }
  const names = combined.split(/\s*(?:&|;|,| and )\s*/i).filter(Boolean)
  const contributors = contributorsFromAuthors(names)
  const primary = contributors[0]?.name ?? combined
  const parts = primary.split(/\s+/)
  const pLast = parts.length > 1 ? parts.slice(1).join(' ') : primary
  const pFirst = parts.length > 1 ? (parts[0] ?? '') : ''
  return { first: pFirst, last: pLast, contributors }
}

/** Map one data row to an ImportedRow per the resolved column index. Returns null for a titleless row. */
export function rowToImported(row: string[], idx: Record<string, number>): ImportedRow | null {
  const cell = (k: string): string => {
    const i = idx[k]
    return i != null && i >= 0 ? (row[i] ?? '') : ''
  }
  const rawTitle = cell('title').trim()
  if (!rawTitle) return null

  // SAME PARSER AS THE GENERIC (Goodreads/StoryGraph) PATH — parseCsvRows in csv.ts. The Library
  // and Chism profiles carry a dedicated Series column, so their real exports don't usually need
  // this; but nothing enforced that the Title column stays clean, and a Goodreads-shaped export
  // that happens to also match one of these profiles' header signature (e.g. a "Global Order" or
  // "GC Read" column bolted onto an otherwise-generic file) would have landed dirty, silently, on
  // the one path with no series parsing. parseSeriesFromTitle is a verified no-op on a title with
  // no trailing parenthetical, so running it unconditionally costs nothing on the common case.
  const parsedFromTitle = parseSeriesFromTitle(rawTitle)
  const title = parsedFromTitle.title

  const { first, last, contributors } = contributorsFor(cell)
  const { genre, genres, tags, subgenre, subgenres, intensity, unmappedGenre } =
    normalizeImportGenres(cell('genre'), cell('tags'))

  // The column is authoritative when present — a reader-maintained Series column outranks a title
  // that happens to contain a paren. Parsed-from-title fills the gap only when the column is
  // empty, the same never-overwrite shape the series-backfill migration uses for existing books.
  const seriesColumn = cell('series').trim()
  const orderRaw = cell('seriesOrder').trim()
  const columnPosition = orderRaw === '' ? '' : (num(orderRaw) ?? '')
  const seriesName = seriesColumn || parsedFromTitle.series
  const position = seriesColumn ? columnPosition : parsedFromTitle.position

  // Reader's own metadata (Reverie template + any export that carries it): identifier, rating, read date.
  const isbn = cleanIsbn(cell('isbn'))
  const ratingRaw = num(cell('rating'))
  // snapHalfRating, not Math.round: rounding predates half stars and inflated 4.5 -> 5 on import
  const rating = ratingRaw == null ? 0 : snapHalfRating(ratingRaw)
  const readDate = parseReadDate(cell('readDate'))
  const reads = readDate ? [{ date: readDate, format: 'Paperback', rating: 0, notes: '' }] : []

  let readStatus: ReadStatus = 'Unread'
  if ((idx.gcRead ?? -1) >= 0) readStatus = gcReadStatus(cell('gcRead'))
  else if ((idx.readStatus ?? -1) >= 0) readStatus = genericReadStatus(cell('readStatus'))
  // A recorded read date with no explicit status still means the book was read.
  if (readStatus === 'Unread' && reads.length) readStatus = 'Read'

  // Possession (docs/archive/task-shelf-model.md): an explicit Owned column wins (yes/blank = owned,
  // borrow/loan = borrowed, no/wish = wishlist); otherwise a Goodreads-style wishlist shelf
  // (`to-read`/`tbr`) marks the row a want. Plain "Unread" is NOT a wishlist signal — unread books
  // you own are normal. A spreadsheet cell carries one word, so it maps through the four-state
  // adapter, which expands to the flags the model stores.
  let possession: PossessionState = 'owned'
  const ownedCell = cell('owned').trim().toLowerCase()
  if (ownedCell) {
    if (/borrow|loan/.test(ownedCell)) possession = 'borrowed'
    else if (/^(n|no|false|0|unowned|wish)/.test(ownedCell)) possession = 'wishlist'
    else possession = 'owned'
  } else if (
    (idx.readStatus ?? -1) >= 0 &&
    /to-read|to read|wishlist|tbr/.test(cell('readStatus').toLowerCase())
  ) {
    possession = 'wishlist'
  }

  const incoming: Incoming = {
    title,
    first,
    last,
    contributors,
    series: seriesName,
    ...(seriesName
      ? {
          seriesClaim: makeSeriesClaim(
            'import',
            seriesColumn ? 'series_column' : 'title_parenthetical',
            { confidence: 'high' },
          ),
        }
      : {}),
    position,
    status: seriesName ? 'ongoing' : 'standalone',
    genre: genre ?? undefined,
    genres,
    // A known subgenre in the genre column now reaches the book as a subgenre, instead of being
    // demoted to a tag with nothing left naming the genre. Omitted rather than sent empty when
    // there is none, so an import never clears a subgenre a merge target already had.
    ...(subgenre ? { subgenre, subgenres } : {}),
    tags,
    intensity,
    readStatus,
    pub: parseReleaseDate(cell('releaseDate')),
    source: 'Imported',
    ...possessionPatch(possession),
    owned: emptyOwned(),
    ...(isbn ? { isbn } : {}),
    pages:
      /^\d+$/.test(cell('pages').trim()) &&
      Number(cell('pages')) > 0 &&
      Number(cell('pages')) <= 20000
        ? Number(cell('pages'))
        : null,
    ...(rating ? { rating } : {}),
    ...(reads.length ? { reads } : {}),
  }

  return {
    incoming,
    duplicate: cell('duplicate').trim().toLowerCase() === 'x',
    globalOrder: num(cell('globalOrder')),
    seriesNumber: num(cell('seriesNumber')),
    seriesType: cell('seriesType').trim() || null,
    unmappedGenre,
  }
}

export interface ParsedImport {
  profile: ColumnProfile
  rows: ImportedRow[]
}

/** Parse an export's text into ImportedRows, auto-detecting the profile unless one is given. */
export function parseImport(text: string, profileOverride?: ColumnProfile): ParsedImport {
  const grid = parseCSV(text)
  if (grid.length < 2) return { profile: profileOverride ?? GENERIC_PROFILE, rows: [] }
  const headers = grid[0] ?? []
  const profile = profileOverride ?? detectProfile(headers)
  const idx = buildColumnIndex(headers, profile)
  const rows: ImportedRow[] = []
  for (let i = 1; i < grid.length; i++) {
    const r = rowToImported(grid[i] ?? [], idx)
    if (r) rows.push(r)
  }
  return { profile, rows }
}

export { BUILTIN as IMPORT_PROFILES }
