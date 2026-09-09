// The PURE half of the corpus CSV import — parsing, normalization, identity, classification,
// anomaly detection. No I/O, no supabase, no env: everything here is unit-tested against a
// synthetic fixture (packages/core/src/corpusImport.test.ts), and import-corpus-csv.mjs is the
// thin shell that feeds it a real file and a real database.
//
// NORMALIZERS ARE IMPORTED, NEVER REIMPLEMENTED. `workKeyOf` — Unicode NFKD, lowercase, remove
// marks, then preserve every script's letters/numbers — is the same function the enrich fn mirrors for
// enrichment_cache's identity body; enrichmentCacheKey('ta:' + workKeyOf(...)) is the cache key. The backfill is a
// join rather than a re-match. It moved INTO core so the app's add-search triage can share it:
// apps/web cannot import from scripts/, and a corpus identity computed twice is one that drifts.
// `matchBook` is the app's own import classifier; `normalizeImportGenres` is the app's own
// genre/tag shaper. A third normalizer here would drift from all of them (the two-norms divergence
// between discover.ts and core is already on record as a hazard).

import { workKeyOf } from '../packages/core/src/normalize'
import { matchBook, isStrong, normalizeIsbn } from '../packages/core/src/match'
import { normalizeImportGenres } from '../packages/core/src/genreNormalize'
import { normalizeSeriesStatus } from '../packages/core/src/seriesStatus'
import type { Book } from '../packages/core/src/types'

/** Canonical, stable ISBN set for persistence. Invalid values disappear; ISBN-10 and ISBN-13
 * representations of the same edition collapse to one ISBN-13. First-seen order is preserved so
 * repeated owner-run imports do not churn arrays that already contain the same identifiers. */
export function canonicalIsbns(values: readonly (string | null | undefined)[]): string[] {
  return [...new Set(values.map((value) => normalizeIsbn(value ?? '')).filter(Boolean))]
}

export interface WorkIsbnSet {
  workKey: string
  isbns: readonly (string | null | undefined)[]
}

export interface IsbnCollision {
  isbn: string
  workKeys: string[]
}

/** Cross-work edition identity is invalid. Duplicate inputs for the SAME work are harmless and
 * collapse first; one canonical ISBN assigned to distinct work keys is reported deterministically. */
export function crossWorkIsbnCollisions(rows: readonly WorkIsbnSet[]): IsbnCollision[] {
  const worksByIsbn = new Map<string, Set<string>>()
  for (const row of rows) {
    for (const isbn of canonicalIsbns(row.isbns)) {
      const keys = worksByIsbn.get(isbn) ?? new Set<string>()
      keys.add(row.workKey)
      worksByIsbn.set(isbn, keys)
    }
  }
  return [...worksByIsbn]
    .filter(([, keys]) => keys.size > 1)
    .map(([isbn, keys]) => ({ isbn, workKeys: [...keys].sort() }))
    .sort((a, b) => a.isbn.localeCompare(b.isbn))
}

export function assertNoCrossWorkIsbnCollisions(rows: readonly WorkIsbnSet[]): void {
  const collisions = crossWorkIsbnCollisions(rows)
  if (!collisions.length) return
  const detail = collisions.map((c) => `${c.isbn}: ${c.workKeys.join(', ')}`).join('\n')
  throw new Error(`cross-work ISBN collision(s) — refusing to write:\n${detail}`)
}

/** RFC-4180-ish CSV: quoted fields, embedded commas, doubled quotes, CRLF-tolerant. The file is
 *  ~1.2k rows so a hand parser beats a dependency; it refuses ragged quoting loudly. */
export function parseCsv(text: string): string[][] {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') {
      inQuotes = true
    } else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.length > 1 || row[0] !== '') rows.push(row)
  }
  if (inQuotes) throw new Error('unterminated quote — the CSV is malformed, refusing to guess')
  return rows
}

/** Column positions by header name, so a reordered export fails loudly instead of silently
 *  shifting every field one to the left. */
const HEADERS = {
  title: 'Title',
  first: 'Author, First',
  last: 'Author, Last',
  series: 'Series',
  status: 'Completed / Standalones',
  genre: 'Genre',
  tags: 'Tags',
  gcRead: 'GC Read',
  tcRead: 'TC Read',
  duplicate: 'Duplicate',
}

export interface CsvRecord {
  title: string
  first: string
  last: string
  series: string
  statusRaw: string
  genreRaw: string
  tagsRaw: string
  gcRead: boolean
  tcRead: boolean
  duplicate: boolean
}

export function toRecords(rows: string[][]): CsvRecord[] {
  const header = (rows[0] ?? []).map((h) => h.trim())
  const col: Record<string, number> = {}
  for (const [k, name] of Object.entries(HEADERS)) {
    const idx = header.indexOf(name)
    if (idx === -1 && k !== 'tcRead') throw new Error(`missing expected column "${name}"`)
    col[k] = idx
  }
  const cell = (r: string[], k: string) => {
    const idx = col[k]
    return idx != null && idx >= 0 ? (r[idx] ?? '').trim() : ''
  }
  const out: CsvRecord[] = []
  for (const r of rows.slice(1)) {
    const title = cell(r, 'title')
    if (!title) continue // blank spacer rows
    out.push({
      title,
      first: cell(r, 'first'),
      last: cell(r, 'last'),
      series: cell(r, 'series'),
      statusRaw: cell(r, 'status'),
      genreRaw: cell(r, 'genre'),
      tagsRaw: cell(r, 'tags'),
      gcRead: truthyFlag(cell(r, 'gcRead')),
      // TC Read is ANOTHER PERSON'S reading data. The generic corpus importer uses it only for
      // diagnostics; the separate owner-run household reconciliation operator deliberately maps
      // it to Account A. The source file and every title-level artifact therefore stay private.
      tcRead: truthyFlag(cell(r, 'tcRead')),
      duplicate: truthyFlag(cell(r, 'duplicate')),
    })
  }
  return out
}

const truthyFlag = (v: string): boolean => {
  const s = String(v ?? '')
    .trim()
    .toLowerCase()
  return s !== '' && s !== 'false' && s !== '0' && s !== 'no'
}

/** Full author name the way the app and the enrich fn both compose it. */
export const authorOf = (rec: Pick<CsvRecord, 'first' | 'last'>): string =>
  [rec.first, rec.last].filter(Boolean).join(' ').trim()

/** THE identity. `'ta:' + workKeyOf(rec)` is the versioned enrichment cache key's body.
 *  Re-exported from core rather than defined here — the app's add-search triage needs the SAME
 *  answer and cannot import from `scripts/`, so the one definition lives in core (this file's
 *  header rule, applied to itself). Core's `authorOf` composes the full name identically, while
 *  Unicode-aware identity keeps non-Latin works from collapsing to the empty key. */
export { workKeyOf }

/** CSV status column → the app's series-status enum — core's OWN normalizer, because books.status
 *  is a CLOSED check constraint and a passthrough of unrecognized tokens violates it. The first
 *  draft here invented a mapper that let unknown values "ride through lowercased"; the local
 *  --write exercise hit books_status_check on the very first chunk. Same rule as norm/matchBook/
 *  normalizeImportGenres: the app already has this function, so this file must not have a second. */
export const seriesStatusOf = (statusRaw: string, hasSeries: boolean): string =>
  normalizeSeriesStatus(statusRaw, hasSeries)

export interface ImportRecord extends CsvRecord {
  author: string
  workKey: string
  genre: string | null
  genres: string[]
  tags: string[]
  status: string
}

export function normalizeRecord(rec: CsvRecord): ImportRecord {
  const g = normalizeImportGenres(rec.genreRaw, rec.tagsRaw)
  return {
    ...rec,
    author: authorOf(rec),
    workKey: workKeyOf(rec),
    genre: g.genre ? g.genre.toLowerCase() : null,
    genres: g.genres,
    tags: g.tags,
    status: seriesStatusOf(rec.statusRaw, !!rec.series),
  }
}

/** Rows marked Duplicate are dropped; among the rest, exact work_key collisions collapse to the
 *  first occurrence (the report lists what collapsed, so nothing disappears silently). */
export function dropAndCollapse(records: ImportRecord[]) {
  const kept: ImportRecord[] = []
  const collapsed: { kept: string; dropped: string; workKey: string }[] = []
  const seen = new Map<string, ImportRecord>()
  let duplicatesDropped = 0
  for (const r of records) {
    if (r.duplicate) {
      duplicatesDropped++
      continue
    }
    const prior = seen.get(r.workKey)
    if (prior) {
      collapsed.push({ kept: prior.title, dropped: r.title, workKey: r.workKey })
      continue
    }
    seen.set(r.workKey, r)
    kept.push(r)
  }
  return { kept, collapsed, duplicatesDropped }
}

/**
 * Classify each record against the existing library via matchBook — the app's own classifier.
 * strong (isbn / title-author / title-series-pos) → existing; 'fuzzy' → NEAR-MISS, never
 * auto-resolved (the data-integrity rule: a self-resolved guess looks identical in the diff to a
 * sourced fact, so ambiguity is surfaced, not decided); 'none' → new.
 */
export function classify(records: ImportRecord[], library: readonly Book[]) {
  const existing: { record: ImportRecord; book: Book; strength: string }[] = []
  const fresh: ImportRecord[] = []
  const nearMiss: {
    record: ImportRecord
    candidate: { title: string; last: string; id: string }
    strength: string
  }[] = []
  for (const r of records) {
    const m = matchBook(
      { title: r.title, first: r.first, last: r.last, series: r.series || undefined },
      library,
    )
    if (m.strength !== 'none' && isStrong(m.strength)) {
      existing.push({ record: r, book: m.book, strength: m.strength })
    } else if (m.strength === 'fuzzy') {
      nearMiss.push({
        record: r,
        candidate: { title: m.book.title, last: m.book.last, id: m.book.id },
        strength: m.strength,
      })
    } else {
      fresh.push(r)
    }
  }
  return { existing, fresh, nearMiss }
}

/** Omnibus suspects — multi-book volumes that would poison series data if treated as one work. */
const OMNIBUS = [
  /Books?\s+\d/i,
  /Box\s*Set/i,
  /Collection/i,
  /#\d+\s*-\s*\d+/,
  /\b\d+\s*-\s*\d+\b.*(series|trilogy|duology)/i,
  /(series|trilogy|duology).*\b\d+\s*-\s*\d+\b/i,
]
export const isOmnibusSuspect = (title: string): boolean => OMNIBUS.some((re) => re.test(title))

/** Everything the owner reviews before --write. Anomalies are surfaced, never resolved. */
/**
 * Sort key for reading two dump files SIDE BY SIDE. `new.csv` and `unmatched-library.csv` are both
 * sorted by this, so a MISSED MATCH surfaces as near-identical titles at the same place in each —
 * which is the whole point of dumping them: a counts-only report cannot tell "the CSV genuinely
 * lacks these 231 books" from "the matcher missed them", and two aligned lists can.
 */
export const normTitleKey = (t: string): string =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * LIBRARY BOOKS NO CSV ROW MATCHED — the thing the script has never computed.
 *
 * `classify` walks CSV rows and asks what each one matched; nothing ever asked the inverse. On the
 * owner's data 231 of 491 library books (47%) matched nothing, and a report of counts cannot say
 * whether that is a true absence or a matcher gap.
 *
 * A FUZZY near-miss is NOT a match and its candidate stays in this list: the row did not import and
 * the book did not pair, so a reader hunting for "why is this book not accounted for" must find it
 * here rather than have it silently excluded because something almost matched.
 */
export function unmatchedLibrary(
  library: readonly Book[],
  existing: readonly { book: Book }[],
): Book[] {
  const matched = new Set(existing.map((e) => e.book.id))
  return library
    .filter((b) => !matched.has(b.id))
    .sort((a, b) => normTitleKey(a.title).localeCompare(normTitleKey(b.title)))
}

/**
 * Rows whose author field names MORE THAN ONE person — ' & ' or a comma.
 *
 * Invisible in today's report, and consequential: `workKeyOf` concatenates the normalised author,
 * so "Guillermo del Toro & Chuck Hogan" becomes a key like `guillermochuckdeltorohogan`. Two CSVs
 * spelling the co-authors differently, or in the other order, produce different keys for one work.
 * COUNTED, NOT FIXED — the key derivation is deliberately untouched here.
 */
export const coAuthorRows = (rows: readonly ImportRecord[]): ImportRecord[] =>
  rows.filter((r) => / & |,/.test(`${r.first} ${r.last}`.trim()) || / & |,/.test(r.author))

/**
 * Rows missing a First or a Last. Their `workKey` degrades to `title|` — every such row in a given
 * title collides with every other, across authors. The existing report lists rows with NO author at
 * all; this is the wider set, where one half is present and the key is still degraded.
 */
export const partialAuthorRows = (rows: readonly ImportRecord[]): ImportRecord[] =>
  rows.filter((r) => !r.first.trim() || !r.last.trim())

/** CSV escaping now lives in core (packages/core/src/csv.ts) so the --dump writer and the Settings
 *  library export share one implementation and one set of tests. Re-exported here so this lib's
 *  callers keep importing it from the same place. */
export { csvCell, csvFile } from '../packages/core/src/csv'

export function buildReport({
  records,
  kept,
  collapsed,
  duplicatesDropped,
  existing,
  fresh,
  nearMiss,
}: {
  records: ImportRecord[]
  kept: ImportRecord[]
  collapsed: { kept: string; dropped: string; workKey: string }[]
  duplicatesDropped: number
  existing: { record: ImportRecord; book: Book; strength: string }[]
  fresh: ImportRecord[]
  nearMiss: {
    record: ImportRecord
    candidate: { title: string; last: string; id: string }
    strength: string
  }[]
}) {
  const omnibus = kept.filter((r) => isOmnibusSuspect(r.title)).map((r) => r.title)
  const emptyAuthor = kept.filter((r) => !r.author).map((r) => r.title)
  // Counts only — see coAuthorRows / partialAuthorRows for why each matters. Neither changes the
  // key derivation in this PR; they exist so the owner can see the shape before deciding.
  const coAuthored = coAuthorRows(kept)
  const partialAuthor = partialAuthorRows(kept)
  const unmappedGenre = kept
    .filter((r) => r.genreRaw && !r.genre)
    .map((r) => `${r.title} (${r.genreRaw})`)
  const tcReadCount = records.filter((r) => r.tcRead).length
  return {
    totals: {
      csvRows: records.length,
      duplicatesDropped,
      keyCollisionsCollapsed: collapsed.length,
      afterDropAndCollapse: kept.length,
      matchedExisting: existing.length,
      newWorks: fresh.length,
      nearMiss: nearMiss.length,
      // counted and then deliberately left behind — another person's data is written NOWHERE
      tcReadRowsNotImported: tcReadCount,
      gcRead: kept.filter((r) => r.gcRead).length,
    },
    collapsed,
    nearMiss: nearMiss.map((n) => ({
      csv: `${n.record.title} — ${n.record.author}`,
      library: `${n.candidate.title} — ${n.candidate.last} (${n.candidate.id})`,
    })),
    omnibusSuspects: omnibus,
    emptyAuthor,
    /** rows naming more than one author — their work_key concatenates all of them */
    coAuthorRows: coAuthored.length,
    /** rows missing First or Last — their work_key degrades to `title|` */
    partialAuthorRows: partialAuthor.length,
    unmappedGenre,
  }
}
