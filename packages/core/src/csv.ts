import type { Book, ReadStatus } from './types'
import { snapHalfRating } from './rating'
import { norm } from './normalize'
import { uid } from './id'
import { cleanIsbn, type Incoming } from './match'
import { emptyOwned, possessionPatch } from './ownership'
import { fromFirstLast } from './contributors'
import { parseSeriesFromTitle } from './seriesTitle'
import { emptyDate } from './partialDate'

/** Quote-aware CSV parser (escaped quotes, CRLF, blank-line skipping). Ported verbatim. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        cur += c
      }
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(cur)
      cur = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur)
      if (row.length > 1 || row[0]?.trim() !== '') rows.push(row)
      row = []
      cur = ''
    } else {
      cur += c
    }
  }
  row.push(cur)
  if (row.length > 1 || row[0]?.trim() !== '') rows.push(row)
  return rows
}

/** Map a Goodreads Binding cell onto the app's format vocabulary; unknown/blank stays absent (''). */
export function formatFromBinding(binding: string): string {
  const s = (binding ?? '').trim().toLowerCase()
  if (!s) return ''
  if (/kindle|e-?book|nook|digital/.test(s)) return 'eBook'
  if (/audio/.test(s)) return 'Audiobook'
  if (/hardcover|hardback|library binding/.test(s)) return 'Hardcover'
  if (/paperback|softcover|mass market/.test(s)) return 'Paperback'
  return '' // never guess a format the source didn't name
}

// Exclusive-shelf values sometimes leak into the custom Bookshelves column — never shelf-ify them.
const EXCLUSIVE_SHELF_VALUES = new Set(['read', 'currently-reading', 'to-read', 'to read', 'dnf'])

/** One parsed Goodreads/StoryGraph row: the book record + row-level extras the intake layer places
 *  (custom shelves → Reverie shelves; notes that had no honest home on the book). */
export interface CsvParsedRow {
  incoming: Incoming
  /** custom Bookshelves values (exclusive-shelf leakage removed), original slug spelling */
  shelves: string[]
  /** My Review / Private Notes existed but the row had no read entry to carry them (to-read rows) */
  unplacedNotes: boolean
}

/**
 * Parse a Goodreads/StoryGraph CSV into rows: an incoming book record (no matching/merging here —
 * the caller matches against the library via match.ts) plus the row extras. Field discipline
 * (docs/archive/task-import-quality.md): series parsed OUT of the title; the `Author l-f` column preferred
 * for an exact first/last split; Binding → format (never a fabricated 'Paperback'); Date Added →
 * addedTs; Read Count tops up the read log with undated entries; My Review / Private Notes land as
 * read-log notes; My Rating 0 = unrated; ISBNs survive the `="..."` Excel wrapper via cleanIsbn.
 * Average Rating is deliberately NOT read — Reverie is anti-consensus (one reader, one voice).
 */
export function parseCsvRows(text: string): CsvParsedRow[] {
  const rows = parseCSV(text)
  if (rows.length < 2) return []
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = head.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const cT = col('title')
  const cA = col('author', 'authors')
  const cAlf = col('author l-f')
  const cAdd = col('additional authors')
  const cR = col('my rating', 'star rating', 'rating')
  const cD = col('date read', 'last date read', 'dates read', 'read dates')
  const cS = col('exclusive shelf', 'read status', 'bookshelves', 'shelves')
  const cY = col('year published', 'publication year')
  const cI13 = col('isbn13', 'isbn-13')
  const cI10 = col('isbn', 'isbn-10')
  const cB = col('binding')
  const cPages = col('number of pages', 'page count', 'pages')
  const cDA = col('date added')
  const cRev = col('my review')
  const cPN = col('private notes')
  const cRC = col('read count')
  // Custom shelves only when Bookshelves ISN'T already serving as the status column.
  const cShelves = col('bookshelves')
  const shelvesCol = cShelves >= 0 && cShelves !== cS ? cShelves : -1
  if (cT < 0) return []

  const cell = (r: string[], i: number): string => (i >= 0 ? (r[i] ?? '') : '')
  const out: CsvParsedRow[] = []
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const rawTitle = cell(r, cT).trim()
    if (!rawTitle) continue
    // Series lives in the title on Goodreads — parse it out; the junk never reaches the display
    // title (and a clean title is what makes duplicate matching against the library actually fire).
    const { title, series, position } = parseSeriesFromTitle(rawTitle)

    // Author: `Author l-f` ("Maas, Sarah J.") gives the exact split; the display column is the
    // fallback, splitting on the LAST word ("Sarah J Maas" → first "Sarah J", last "Maas") — the
    // old first-word split garbled middle names into the surname and broke title+author matching.
    let first = ''
    let last = ''
    const lf = cell(r, cAlf).trim()
    if (lf.includes(',')) {
      last = (lf.split(',')[0] ?? '').trim()
      first = lf.slice(lf.indexOf(',') + 1).trim()
    } else {
      const authorRaw = cA >= 0 ? (cell(r, cA).split(/[,;]/)[0]?.trim() ?? '') : ''
      const parts = authorRaw.split(/\s+/)
      last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : authorRaw
      first = parts.length > 1 ? parts.slice(0, -1).join(' ') : ''
    }
    // Additional Authors → co-author contributors, order preserved after the primary.
    const contributors = fromFirstLast(first, last)
    const extras = cell(r, cAdd)
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    for (const name of extras)
      contributors.push({ name, role: 'co_author', position: contributors.length })

    // Goodreads: rating 0 means UNRATED, not zero stars (app-wide, 0 carries "no rating yet";
    // the merge never writes a falsy rating over an existing one).
    // snapHalfRating, not Math.round: StoryGraph exports quarter stars and the app is half-star
    const rating = cR >= 0 ? snapHalfRating(parseFloat(cell(r, cR)) || 0) : 0
    const shelf = cS >= 0 ? cell(r, cS).toLowerCase() : ''
    let readStatus: ReadStatus = 'Read'
    if (/to-read|to read/.test(shelf)) readStatus = 'Unread'
    else if (/currently/.test(shelf)) readStatus = 'Reading'
    else if (/dnf|did.not/.test(shelf)) readStatus = 'DNF'

    // Dates parse as pure strings (Y/M/D, zero-padded) — no Date() round-trip, so no timezone
    // can shift a read off its calendar day.
    const dates =
      cD >= 0
        ? [...cell(r, cD).matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)].map((m) => {
            const y = m[1] ?? ''
            const mo = (m[2] ?? '').padStart(2, '0')
            const da = (m[3] ?? '').padStart(2, '0')
            return `${y}-${mo}-${da}`
          })
        : []
    const py = cY >= 0 ? parseInt(cell(r, cY)) || null : null
    const isbn = cleanIsbn(cell(r, cI13)) || cleanIsbn(cell(r, cI10))
    const format = formatFromBinding(cell(r, cB))

    // Read log: the dated reads, topped up to Read Count with undated entries (the source says the
    // book was read N times — that's real data, not a fabricated date). Only for finished books.
    const reads = dates.map((d) => ({ date: d, format, rating: 0, notes: '' }))
    const readCount = cRC >= 0 ? parseInt(cell(r, cRC)) || 0 : 0
    if (readStatus === 'Read' || readStatus === 'DNF') {
      while (reads.length < readCount) reads.push({ date: '', format, rating: 0, notes: '' })
    }
    // My Review + Private Notes ride on the most recent read entry (the read log is the app's
    // note surface). Rows with notes but no read entry (to-read) are counted for the summary.
    const review = cell(r, cRev).trim()
    const privateNotes = cell(r, cPN).trim()
    const notes = [review, privateNotes].filter(Boolean).join('\n\n')
    let unplacedNotes = false
    if (notes) {
      const target = reads[reads.length - 1]
      if (target) target.notes = notes
      else unplacedNotes = true
    }

    // Date Added → addedTs (noon UTC — date-only, timezone-proof), keeping shelf-history order.
    const da = cDA >= 0 ? /(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(cell(r, cDA)) : null
    const addedTs = da ? Date.UTC(Number(da[1]), Number(da[2]) - 1, Number(da[3]), 12) : undefined

    // Custom shelves (exclusive-shelf leakage skipped) → Reverie shelves, created by the intake layer.
    const shelves =
      shelvesCol >= 0
        ? cell(r, shelvesCol)
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s && !EXCLUSIVE_SHELF_VALUES.has(s.toLowerCase()))
        : []

    const incoming: Incoming = {
      title,
      first,
      last,
      contributors,
      isbn,
      rating,
      readStatus,
      reads,
      pub: { y: py && py > 0 && py <= 9999 ? py : null, m: null, d: null },
      pages:
        /^\d+$/.test(cell(r, cPages).trim()) &&
        Number(cell(r, cPages)) > 0 &&
        Number(cell(r, cPages)) <= 20000
          ? Number(cell(r, cPages))
          : null,
      source: 'Imported',
      // Goodreads shelf → possession: `to-read` is a want; a `borrowed`/`loan` shelf is borrowed;
      // read / currently-reading rows are books that passed through the reader's hands (owned).
      // One shelf yields one word, so the four-state adapter is the right shape here — it expands
      // to the flags the model stores (docs/archive/task-shelf-model.md).
      ...possessionPatch(
        /to-read|to read/.test(shelf)
          ? 'wishlist'
          : /borrow|on loan|library loan/.test(shelf)
            ? 'borrowed'
            : 'owned',
      ),
      owned: emptyOwned(),
    }
    if (series) {
      incoming.series = series
      incoming.position = position
    }
    if (format) incoming.format = format
    if (addedTs != null) incoming.addedTs = addedTs
    out.push({ incoming, shelves, unplacedNotes })
  }
  return out
}

/**
 * Parse a Goodreads/StoryGraph CSV into incoming book records — the row extras dropped.
 * Kept for callers that only need the books; the web intake path uses parseCsvRows.
 */
export interface CsvImportResult {
  books: Book[]
  added: number
  updated: number
}

/** Thrown when the CSV is empty or isn't a recognizable Goodreads/StoryGraph export. */
export class CsvImportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CsvImportError'
  }
}

/**
 * Merge a Goodreads/StoryGraph CSV export into a library by title+author: brings ratings,
 * shelves→read status, real read dates, and publication year. Pure port of importCsv —
 * returns the new books array and counts; throws CsvImportError on empty/unrecognized input.
 */
export function importCsv(existing: readonly Book[], text: string): CsvImportResult {
  const rows = parseCSV(text)
  if (rows.length < 2) throw new CsvImportError('That CSV looks empty')

  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase())
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = head.indexOf(n)
      if (i >= 0) return i
    }
    return -1
  }
  const cT = col('title')
  const cA = col('author', 'authors')
  const cR = col('my rating', 'star rating', 'rating')
  const cD = col('date read', 'last date read', 'dates read', 'read dates')
  const cS = col('exclusive shelf', 'read status', 'bookshelves', 'shelves')
  const cY = col('year published', 'publication year')
  if (cT < 0)
    throw new CsvImportError('No Title column found — is this a Goodreads/StoryGraph export?')

  // Index existing books by title+author and by title alone (the prototype's two keys).
  const books = existing.map((b) => ({ ...b }))
  const have = new Map<string, Book>()
  for (const b of books) {
    have.set(norm(b.title) + '|' + norm(b.last), b)
    const titleKey = 't:' + norm(b.title)
    if (!have.has(titleKey)) have.set(titleKey, b)
  }

  const cell = (r: string[], i: number): string => (i >= 0 ? (r[i] ?? '') : '')
  let added = 0
  let updated = 0

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i] ?? []
    const title = cell(r, cT).trim()
    if (!title) continue

    const authorRaw = cA >= 0 ? (cell(r, cA).split(/[,;]/)[0]?.trim() ?? '') : ''
    const parts = authorRaw.split(/\s+/)
    // last word = surname (parity with parseCsvRows — the old first-word split garbled middles)
    const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : authorRaw
    const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : ''
    // snapHalfRating, not Math.round: StoryGraph exports quarter stars and the app is half-star
    const rating = cR >= 0 ? snapHalfRating(parseFloat(cell(r, cR)) || 0) : 0
    const shelf = cS >= 0 ? cell(r, cS).toLowerCase() : ''
    let rs: ReadStatus = 'Read'
    if (/to-read|to read/.test(shelf)) rs = 'Unread'
    else if (/currently/.test(shelf)) rs = 'Reading'
    else if (/dnf|did.not/.test(shelf)) rs = 'DNF'
    const dates =
      cD >= 0
        ? [...cell(r, cD).matchAll(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/g)].map((m) => {
            const y = m[1] ?? ''
            const mo = (m[2] ?? '').padStart(2, '0')
            const da = (m[3] ?? '').padStart(2, '0')
            return `${y}-${mo}-${da}`
          })
        : []
    const py = cY >= 0 ? parseInt(cell(r, cY)) || null : null

    // Series junk parsed off the title BEFORE matching — "(ACOTAR, #1)" must never block a merge.
    const parsed = parseSeriesFromTitle(title)
    const cleanTitle = parsed.title

    const match = have.get(norm(cleanTitle) + '|' + norm(last)) ?? have.get('t:' + norm(cleanTitle))
    if (match) {
      let changed = false
      if (!match.rating && rating) {
        match.rating = rating
        changed = true
      }
      if (match.readStatus === 'Unread' && rs === 'Read') {
        match.readStatus = 'Read'
        changed = true
      }
      for (const d of dates) {
        if (!match.reads.some((x) => x.date === d)) {
          match.reads.push({ date: d, format: match.format, rating: 0, notes: '' })
          match.readStatus = 'Read'
          changed = true
        }
      }
      if ((!match.pub || !match.pub.y) && py) {
        match.pub = { y: py, m: null, d: null }
        changed = true
      }
      if (changed) updated++
    } else {
      // Absent source data imports as absent — no fabricated genre/format/intensity
      // (docs/archive/task-import-quality.md §3). 'Imported' pseudo-genre retired; source records provenance.
      const nb: Book = {
        id: uid(),
        title: cleanTitle,
        first,
        last,
        contributors: fromFirstLast(first, last),
        series: parsed.series,
        position: parsed.position,
        seriesCount: null,
        status: 'standalone',
        genre: '',
        subgenre: '',
        subgenres: [],
        genres: [],
        tags: [],
        tropes: [],
        moods: [],
        intensity: null,
        darkness: null, // no import format describes emotional darkness — see importMap
        cover: '',
        pages: null,
        isbn: '',
        fave: false,
        // Goodreads shelf → possession (same rule as parseCsvRows): to-read = wishlist, a
        // borrow/loan shelf = borrowed, otherwise owned.
        ...possessionPatch(
          /to-read|to read/.test(shelf)
            ? 'wishlist'
            : /borrow|on loan|library loan/.test(shelf)
              ? 'borrowed'
              : 'owned',
        ),
        owned: { physical: false, ebook: false, audiobook: false },
        format: '',
        rating,
        readStatus: rs,
        source: 'Imported',
        pub: { y: py, m: null, d: null },
        reads: dates.map((d) => ({ date: d, format: '', rating: 0, notes: '' })),
        plan: emptyDate(),
        progress: 0,
        addedTs: Date.now(),
      }
      books.push(nb)
      have.set(norm(cleanTitle) + '|' + norm(last), nb)
      have.set('t:' + norm(cleanTitle), nb)
      added++
    }
  }

  return { books, added, updated }
}

/**
 * CSV WRITING. This file was parse-only until the library CSV export needed a writer; it lives here
 * so the two writers in the tree (the corpus importer's --dump, and the Settings export) are one
 * implementation with one set of tests. A second copy is the "third normalizer" mistake in a new
 * costume — book titles carry commas ("Salt, Harbour"), quotes and apostrophes, and an unescaped
 * cell silently shifts every later column, producing a file that reads plausibly and aligns wrongly.
 *
 * null/undefined render as empty rather than the strings "null"/"undefined".
 */
export const csvCell = (v: unknown): string => {
  const t = String(v ?? '')
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

/** Header cells are escaped like body cells — the library export's header contains "Author, First",
 *  whose comma would otherwise split one column into two and shift the whole row. */
export const csvFile = (header: readonly string[], rows: readonly (readonly unknown[])[]): string =>
  [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n'
