// MIRROR of packages/core/src/enrich.ts for the Deno enrich Edge Function (Deno cannot import the
// workspace package). The ISBN helpers are inlined from packages/core/src/match.ts; everything below
// is copied verbatim. enrichParity.test.ts runs golden fixtures through THIS file and core and
// asserts identical output, so any drift fails CI. Edit core/enrich.ts, then re-mirror.

export const cleanIsbn = (raw: string): string => (raw || '').replace(/[^0-9Xx]/g, '').toUpperCase()

function validIsbn10(c: string): boolean {
  if (!/^\d{9}[\dX]$/.test(c)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const digit = c[i] === 'X' ? 10 : Number(c[i])
    sum += digit * (10 - i)
  }
  return sum % 11 === 0
}

function validIsbn13(c: string): boolean {
  if (!/^97[89]\d{10}$/.test(c)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(c[i]) * (i % 2 === 0 ? 1 : 3)
  return Number(c[12]) === (10 - (sum % 10)) % 10
}

export function isbn10to13(isbn10: string): string {
  const c = cleanIsbn(isbn10)
  if (!validIsbn10(c)) return ''
  const core = '978' + c.slice(0, 9)
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3)
  return core + ((10 - (sum % 10)) % 10)
}

/** Canonical ISBN-13 for matching (ISBN-10 promoted), or '' if not a usable ISBN. */
export function normalizeIsbn(raw: string): string {
  const c = cleanIsbn(raw)
  if (validIsbn13(c)) return c
  if (validIsbn10(c)) return isbn10to13(c)
  return ''
}

// Dependency-free mirror of _shared/coverUrl.ts: this file is imported directly by the core
// parity tests, whose TypeScript config deliberately does not allow Deno's `.ts` import suffixes.
function bestGoogleCoverLink(imageLinks: unknown): string {
  if (!imageLinks || typeof imageLinks !== 'object') return ''
  const links = imageLinks as Record<string, unknown>
  for (const key of ['extraLarge', 'large', 'medium', 'small', 'thumbnail', 'smallThumbnail']) {
    const value = links[key]
    if (typeof value === 'string' && value.trim()) {
      return value
        .trim()
        .replace(/^http:/, 'https:')
        .replace('&edge=curl', '')
    }
  }
  return ''
}

export type EnrichSource = 'openlibrary' | 'google' | 'hardcover' | 'isbndb' | 'manual'

/** One source's normalized contribution. Every field optional — sources fill what they have. */
export interface SourceRecord {
  scope?: 'work' | 'edition'
  subtitle?: string
  title?: string
  authors?: string[]
  series?: string
  seriesPosition?: number | null
  description?: string
  /** raw category / genre / shelf strings — unioned, then mapped to genre + genres */
  categories?: string[]
  cover?: string
  pageCount?: number | null
  publisher?: string
  pubY?: number | null
  pubM?: number | null
  pubD?: number | null
  binding?: string
  language?: string
  isbn10?: string
  isbn13?: string
  /** every edition ISBN this source knows — unioned to power per-format ownership + "other formats" */
  isbns?: string[]
  /** source-scoped identifiers, e.g. { work: 'OL123W', edition: 'OL456M', volume: 'abc' } */
  ids?: Record<string, string>
}

/** A source's record stamped with where it came from and when. */
export interface StampedSource {
  source: EnrichSource
  at: string // ISO timestamp
  record: SourceRecord
}

export interface FieldProvenance {
  source: EnrichSource
  at: string
}

/** The merged, most-complete record plus per-field provenance. */
export interface EnrichedRecord {
  admissionVersion?: 2
  admissionIdentity?: { title: string; author: string; isbn: string }
  title: string
  authors: string[]
  author: string
  series: string
  seriesPosition: number | null
  description: string
  categories: string[]
  /** primary genre mapped from categories (closes the C1 genre-fill carry-item) */
  genre: string
  /** all recognized genre labels (union) for Book.genres */
  genres: string[]
  cover: string
  pageCount: number | null
  publisher: string
  pubY: number | null
  pubM: number | null
  pubD: number | null
  binding: string
  language: string
  isbn10: string
  isbn13: string
  isbn: string
  isbns: string[]
  /** cross-referenced identifiers keyed by source, e.g. { openlibrary: 'work:OL..|edition:OL..' } */
  ids: Record<string, string>
  /** the resolved work + edition identity (first available, source-prefixed) */
  workId: string
  editionId: string
  provenance: Record<string, FieldProvenance>
}

// ── Field-level precedence (docs/reference/ENRICHMENT_STRATEGY.md Step 3) ──
// For each scalar field: the source order to prefer; first non-empty wins. Sources absent from a
// list still can't supply that field. Union + longest-description fields are handled specially.
const PRECEDENCE: Record<string, EnrichSource[]> = {
  title: ['openlibrary', 'hardcover', 'google', 'isbndb'],
  series: ['hardcover', 'openlibrary', 'google'],
  seriesPosition: ['hardcover', 'openlibrary'],
  cover: ['hardcover', 'google', 'openlibrary', 'isbndb'],
  pageCount: ['isbndb', 'openlibrary', 'google'],
  publisher: ['isbndb', 'openlibrary', 'google'],
  pubY: ['isbndb', 'openlibrary', 'google', 'hardcover'],
  pubM: ['isbndb', 'openlibrary', 'google', 'hardcover'],
  pubD: ['isbndb', 'openlibrary', 'google', 'hardcover'],
  binding: ['isbndb', 'openlibrary', 'google'],
  language: ['isbndb', 'openlibrary', 'google'],
  isbn13: ['isbndb', 'openlibrary', 'google'],
  isbn10: ['isbndb', 'openlibrary', 'google'],
}

const STR_KEYS = [
  'title',
  'series',
  'cover',
  'publisher',
  'binding',
  'language',
  'isbn13',
  'isbn10',
] as const
const NUM_KEYS = ['seriesPosition', 'pageCount'] as const

const dedupe = (a: (string | undefined | null)[]): string[] => [
  ...new Set(a.map((x) => String(x ?? '').trim()).filter(Boolean)),
]

const nonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const nonNullNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Pick the first source (by precedence) that supplies a usable value for a field; record provenance. */
function resolveScalar(
  field: string,
  stamped: StampedSource[],
  isNum: boolean,
): { value: string | number | null; prov: FieldProvenance | null } {
  const order = PRECEDENCE[field] ?? []
  for (const src of order) {
    // Most-recent stamp from this source (sources may appear once, but be defensive).
    const hit = stamped.filter((s) => s.source === src).sort((a, b) => (a.at < b.at ? 1 : -1))[0]
    if (!hit) continue
    const v = (hit.record as unknown as Record<string, unknown>)[field]
    if (isNum ? nonNullNum(v) : nonEmptyStr(v)) {
      return {
        value: isNum ? (v as number) : (v as string),
        prov: { source: hit.source, at: hit.at },
      }
    }
  }
  return { value: isNum ? null : '', prov: null }
}

// ── Genre mapping (categories → primary genre + genre labels) ──
// Keyword → canonical genre token. Order matters: more specific genres are checked before the
// broad "fiction". Primary tokens are the nine core app genres (the skin genres, lowercased) —
// the exact keys the genre-scoped subgenre/trope taxonomies look up — so an enriched book lands
// in its genre's vocabulary instead of silently missing it. Thriller/historical have no room of
// their own: they keep their labels but file under mystery/literary (the importer's collapse).
const GENRE_RULES: { genre: string; label: string; patterns: RegExp[] }[] = [
  { genre: 'romance', label: 'Romance', patterns: [/romance/i] },
  { genre: 'cozy', label: 'Cozy', patterns: [/co[sz]y/i] },
  {
    genre: 'fantasy',
    label: 'Fantasy',
    patterns: [/fantasy/i, /romantasy/i, /fae\b/i, /sword.*sorcery/i],
  },
  {
    genre: 'science fiction',
    label: 'Science fiction',
    patterns: [
      /science[\s-]*fiction/i,
      /sci[\s-]*fi/i,
      /dystopian?/i,
      /space opera/i,
      /cyberpunk/i,
    ],
  },
  { genre: 'horror', label: 'Horror', patterns: [/horror/i] },
  { genre: 'mystery', label: 'Thriller', patterns: [/thriller/i, /suspense/i] },
  {
    genre: 'mystery',
    label: 'Mystery',
    patterns: [/myster(y|ies)/i, /detective/i, /crime/i, /noir/i],
  },
  { genre: 'literary', label: 'Historical', patterns: [/historical/i] },
  {
    genre: 'young adult',
    label: 'Young adult',
    patterns: [/young adult\b/i, /\bya\b/i, /juvenile/i],
  },
  { genre: 'literary', label: 'Literary', patterns: [/literary/i] },
  {
    genre: 'nonfiction',
    label: 'Nonfiction',
    patterns: [/non[\s-]*fiction/i, /memoir/i, /biography/i, /self[\s-]*help/i, /history/i],
  },
]

/**
 * Map raw category strings to a primary genre + recognized genre labels. Primary genre is the
 * first rule (in GENRE_RULES order = specificity) that any category matches; labels are every
 * recognized genre across the categories (union). Romance is listed first so a romance-tagged
 * book stays romance even when also shelved under fantasy. No match → empty (caller keeps existing).
 */
export function mapGenre(categories: string[]): { genre: string; genres: string[] } {
  const labels: string[] = []
  let primary = ''
  for (const rule of GENRE_RULES) {
    const hit = categories.some((c) => rule.patterns.some((p) => p.test(c)))
    if (hit) {
      if (!primary) primary = rule.genre
      labels.push(rule.label)
    }
  }
  return { genre: primary, genres: dedupe(labels) }
}

// ── Pure source normalizers (raw provider JSON → SourceRecord) ──
// The Edge Function adapters fetch, then call these; tests feed captured fixtures straight in.
// Kept pure (no network) so they're shared by the mirror and unit-tested without mocking fetch.

const stripHtml = (s: string): string =>
  (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
const httpsify = (url: string): string =>
  (url || '').replace(/^http:/, 'https:').replace('&edge=curl', '')

export function parsePubDate(s: string): {
  pubY: number | null
  pubM: number | null
  pubD: number | null
} {
  const empty = { pubY: null, pubM: null, pubD: null }
  const value = String(s || '').trim()
  let parts = value.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/)
  if (!parts) {
    const named = value.match(/^([A-Za-z]+)\s+(?:(\d{1,2}),?\s+)?(\d{4})$/)
    const months = [
      'january',
      'february',
      'march',
      'april',
      'may',
      'june',
      'july',
      'august',
      'september',
      'october',
      'november',
      'december',
    ]
    const month = named
      ? months.findIndex(
          (m) => m === named[1]?.toLowerCase() || m.slice(0, 3) === named[1]?.toLowerCase(),
        ) + 1
      : 0
    if (!named || !month) return empty
    parts = [value, named[3]!, String(month), named[2] ?? '']
  }
  const y = Number(parts[1])
  const m = parts[2] ? Number(parts[2]) : null
  const d = parts[3] ? Number(parts[3]) : null
  if (!Number.isInteger(y) || y < 1 || y > 9999 || (m !== null && (m < 1 || m > 12))) return empty
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = m ? [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] : undefined
  if (d !== null && (!days || d < 1 || d > days)) return empty
  return { pubY: y, pubM: m, pubD: d }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function normalizeGoogle(volume: any): SourceRecord {
  const v = volume?.volumeInfo ?? volume
  if (!v) return {}
  const ids: any[] = v.industryIdentifiers ?? []
  const isbn13 = ids.find((x) => x.type === 'ISBN_13')?.identifier ?? ''
  const isbn10 = ids.find((x) => x.type === 'ISBN_10')?.identifier ?? ''
  const cover = bestGoogleCoverLink(v.imageLinks)
  const categories = (v.categories ?? [])
    .flatMap((c: string) => String(c).split(/\s*\/\s*/))
    .filter((g: string) => g && !/^fiction$/i.test(g))
  return {
    title: v.title ?? '',
    authors: v.authors ?? [],
    publisher: v.publisher ?? '',
    ...parsePubDate(v.publishedDate ?? ''),
    pageCount: v.pageCount ?? null,
    isbn13,
    isbn10,
    isbns: [isbn13, isbn10].filter(Boolean),
    language: v.language ?? '',
    categories,
    description: stripHtml(v.description ?? ''),
    cover: cover ? httpsify(cover) : '',
    ids: volume?.id ? { volume: String(volume.id) } : {},
  }
}

export function normalizeOpenLibrary(doc: any): SourceRecord {
  if (!doc) return {}
  const isbns: string[] = doc.isbn ?? []
  const subjects: string[] = doc.subject ?? []
  let series = Array.isArray(doc.series) ? (doc.series[0] ?? '') : (doc.series ?? '')
  if (!series) {
    const s = subjects.find((x) => /^series?:/i.test(x))
    if (s)
      series = s
        .replace(/^series?:/i, '')
        .replace(/_/g, ' ')
        .trim()
  }
  // Drop OL's coded/non-genre subjects (e.g. "nyt:...=...", awards, overly long strings).
  const categories = [...new Set(subjects.filter((x) => !/[:=]/.test(x) && x.length < 40))].slice(
    0,
    8,
  )
  const ids: Record<string, string> = {}
  if (doc.key) ids.work = String(doc.key).replace(/^\/works\//, '')
  if (Array.isArray(doc.edition_key) && doc.edition_key[0]) ids.edition = String(doc.edition_key[0])
  return {
    scope: 'work',
    subtitle: typeof doc.subtitle === 'string' ? doc.subtitle : undefined,
    title: doc.title ?? '',
    authors: doc.author_name ?? [],
    pubY: doc.first_publish_year ?? null,
    pageCount: doc.number_of_pages_median ?? null,
    isbn13: isbns.find((i) => i.length === 13) ?? '',
    isbn10: isbns.find((i) => i.length === 10) ?? '',
    isbns,
    language: (doc.language ?? [])[0] ?? '',
    categories,
    series,
    cover: doc.cover_i ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : '',
    ids,
  }
}

export function normalizeHardcover(book: any): SourceRecord {
  if (!book) return {}
  const bs = book.book_series?.[0]
  const tags: string[] = (book.taggings ?? [])
    .map((t: any) => t?.tag?.tag ?? t?.tag?.name ?? '')
    .filter(Boolean)
  // contributions[].author.name → authors (needed so a title+author search can CONFIRM the match).
  const authors: string[] = (book.contributions ?? [])
    .map((c: any) => c?.author?.name ?? '')
    .filter(Boolean)
  return {
    scope: 'work',
    title: book.title ?? '',
    authors,
    pageCount: book.pages ?? null,
    ...parsePubDate(book.release_date ?? ''),
    description: stripHtml(book.description ?? ''),
    series: bs?.series?.name ?? '',
    seriesPosition: bs?.position ?? null,
    categories: tags,
    cover: book.image?.url ?? '',
    ids: book.id ? { work: String(book.id) } : {},
  }
}

/**
 * Normalize a Hardcover SEARCH-result document (the Typesense doc shape returned by the `search`
 * query) — distinct from normalizeHardcover's `books`-row shape. Hardcover blocks `_ilike` filters,
 * so a title search MUST go through `search`, whose doc carries author_names, image.url (the cover —
 * best for romance/indie), the full isbns list, series_names, genres/moods/tags, pages, release_date.
 */
export function normalizeHardcoverSearch(doc: any): SourceRecord {
  if (!doc) return {}
  const isbns = [
    ...new Set((doc.isbns ?? []).map((x: string) => cleanIsbn(String(x))).filter(Boolean)),
  ].slice(0, 25) as string[]
  const tags: string[] = [...(doc.genres ?? []), ...(doc.moods ?? []), ...(doc.tags ?? [])]
    .map((t: any) => (typeof t === 'string' ? t : (t?.tag ?? t?.name ?? '')))
    .filter(Boolean)
  const releaseDate = String(doc.release_date ?? (doc.release_year ? String(doc.release_year) : ''))
  return {
    scope: 'work',
    subtitle: typeof doc.subtitle === 'string' ? doc.subtitle : undefined,
    title: doc.title ?? '',
    authors: doc.author_names ?? [],
    series: (doc.series_names ?? [])[0] ?? '',
    seriesPosition:
      typeof doc.featured_series_position === 'number' ? doc.featured_series_position : null,
    description: stripHtml(doc.description ?? ''),
    categories: [...new Set(tags)].slice(0, 12),
    cover: doc.image?.url ?? '',
    pageCount: typeof doc.pages === 'number' ? doc.pages : null,
    ...parsePubDate(releaseDate),
    isbn13: isbns.find((i) => i.length === 13) ?? '',
    isbn10: isbns.find((i) => i.length === 10) ?? '',
    isbns,
    ids: doc.id ? { work: String(doc.id) } : {},
  }
}

/* eslint-enable @typescript-eslint/no-explicit-any */

const EMPTY: EnrichedRecord = {
  title: '',
  authors: [],
  author: '',
  series: '',
  seriesPosition: null,
  description: '',
  categories: [],
  genre: '',
  genres: [],
  cover: '',
  pageCount: null,
  publisher: '',
  pubY: null,
  pubM: null,
  pubD: null,
  binding: '',
  language: '',
  isbn10: '',
  isbn13: '',
  isbn: '',
  isbns: [],
  ids: {},
  workId: '',
  editionId: '',
  provenance: {},
}

/**
 * Merge stamped source records into one most-complete record + provenance.
 * - scalar fields: per-field precedence (PRECEDENCE), first non-empty wins;
 * - description: longest non-empty across all sources;
 * - categories / authors / isbns: UNION (dedupe; authors keep first-seen order);
 * - genre/genres: mapped from the unioned categories;
 * - identifiers: cross-referenced per source;
 * - user-authored fields (the optional `user` partial): ALWAYS win and are stamped 'manual'.
 */
export function mergeRecords(
  sources: StampedSource[],
  user?: Partial<EnrichedRecord> & { at?: string },
): EnrichedRecord {
  const out: EnrichedRecord = { ...EMPTY, ids: {}, provenance: {} }

  for (const key of STR_KEYS) {
    const { value, prov } = resolveScalar(key, sources, false)
    ;(out as unknown as Record<string, unknown>)[key] = value
    if (prov) out.provenance[key] = prov
  }
  for (const key of NUM_KEYS) {
    const { value, prov } = resolveScalar(key, sources, true)
    ;(out as unknown as Record<string, unknown>)[key] = value
    if (prov) out.provenance[key] = prov
  }

  for (const source of PRECEDENCE.pubY ?? []) {
    const date = sources
      .filter((s) => s.source === source)
      .sort((a, b) => b.at.localeCompare(a.at))[0]
    if (!date?.record.pubY) continue
    const r = date.record
    const parsed = parsePubDate(
      `${r.pubY}${r.pubM != null ? `-${String(r.pubM).padStart(2, '0')}` : ''}${r.pubD != null ? `-${String(r.pubD).padStart(2, '0')}` : ''}`,
    )
    if (!parsed.pubY || (r.pubD != null && r.pubM == null)) continue
    Object.assign(out, parsed)
    for (const field of ['pubY', 'pubM', 'pubD'] as const)
      if (parsed[field] !== null) out.provenance[field] = { source, at: date.at }
    break
  }

  // description: longest non-empty wins (more text ≈ more complete).
  let bestDesc = ''
  let bestDescSrc: StampedSource | null = null
  for (const s of sources) {
    const d = (s.record.description ?? '').trim()
    if (d.length > bestDesc.length) {
      bestDesc = d
      bestDescSrc = s
    }
  }
  out.description = bestDesc
  if (bestDescSrc) out.provenance.description = { source: bestDescSrc.source, at: bestDescSrc.at }

  // authors: union, first-seen order preserved.
  const authors: string[] = []
  const seen = new Set<string>()
  for (const s of sources) {
    for (const a of s.record.authors ?? []) {
      const t = a.trim()
      if (t && !seen.has(t.toLowerCase())) {
        seen.add(t.toLowerCase())
        authors.push(t)
      }
    }
  }
  out.authors = authors
  out.author = authors.join(', ')

  // categories: union → genre mapping.
  out.categories = dedupe(sources.flatMap((s) => s.record.categories ?? []))
  const mapped = mapGenre(out.categories)
  out.genre = mapped.genre
  out.genres = mapped.genres

  // ISBNs: union of every source's isbn10/isbn13/isbns; normalize the canonical 13.
  const allIsbns = dedupe(
    sources
      .flatMap((s) => [s.record.isbn13, s.record.isbn10, ...(s.record.isbns ?? [])])
      .map((i) => cleanIsbn(i ?? '')),
  )
  out.isbns = allIsbns
  if (!out.isbn13)
    out.isbn13 = allIsbns.find((i) => i.length === 13) ?? (out.isbn10 ? isbn10to13(out.isbn10) : '')
  if (!out.isbn10) out.isbn10 = allIsbns.find((i) => i.length === 10) ?? ''
  out.isbn = out.isbn13 || normalizeIsbn(out.isbn10) || out.isbn10 || ''

  // Identity: cross-reference source ids; resolve work + edition (first available, source-prefixed).
  for (const s of sources) {
    if (s.record.ids && Object.keys(s.record.ids).length) {
      out.ids[s.source] = Object.entries(s.record.ids)
        .map(([k, v]) => `${k}:${v}`)
        .join('|')
    }
    if (!out.workId && s.record.ids?.work) out.workId = `${s.source}:${s.record.ids.work}`
    if (!out.editionId && s.record.ids?.edition)
      out.editionId = `${s.source}:${s.record.ids.edition}`
  }

  // User-authored fields ALWAYS win — applied last, stamped 'manual'. Empty user values don't clobber.
  if (user) {
    const at = user.at ?? new Date(0).toISOString()
    const applyStr = (k: keyof EnrichedRecord) => {
      const v = user[k]
      if (nonEmptyStr(v)) {
        ;(out as unknown as Record<string, unknown>)[k] = v
        out.provenance[k as string] = { source: 'manual', at }
      }
    }
    const applyNum = (k: keyof EnrichedRecord) => {
      const v = user[k]
      if (nonNullNum(v)) {
        ;(out as unknown as Record<string, unknown>)[k] = v
        out.provenance[k as string] = { source: 'manual', at }
      }
    }
    for (const k of STR_KEYS) applyStr(k as keyof EnrichedRecord)
    for (const k of NUM_KEYS) applyNum(k)
    if (user.pubY != null || user.pubM != null || user.pubD != null) {
      const ownDate = parsePubDate(
        `${user.pubY ?? ''}${user.pubM != null ? `-${String(user.pubM).padStart(2, '0')}` : ''}${user.pubD != null ? `-${String(user.pubD).padStart(2, '0')}` : ''}`,
      )
      for (const key of ['pubY', 'pubM', 'pubD'] as const) {
        out[key] = ownDate[key]
        delete out.provenance[key]
        if (ownDate[key] != null) out.provenance[key] = { source: 'manual', at }
      }
    }
    applyStr('description')
    applyStr('genre')
    if (user.authors?.length) {
      out.authors = user.authors
      out.author = user.authors.join(', ')
      out.provenance.authors = { source: 'manual', at }
    }
    if (user.genres?.length) out.genres = dedupe([...user.genres, ...out.genres])
  }

  return out
}

/**
 * Withhold fields the resolved match confidence doesn't back. `none` (title didn't match closely)
 * withholds cover AND series/seriesPosition — no confident match, no attach. `low` (author
 * conflict, unconfirmed fuzzy title, or an ambiguity downgrade) withholds series/seriesPosition
 * ONLY: cover has three downstream safety nets (high-confidence auto-fill only, an import-review
 * bucket for softer matches, one-tap Cover Studio correction) that make a wrong cover recoverable;
 * series has none, so a low-confidence series claim is wrong-book risk with nothing to catch it.
 * `medium`/`high` pass every field through unchanged. Takes the inline confidence union (not the
 * `Confidence` type from ./resolve) to avoid a circular import — resolve.ts imports from merge.ts.
 */
export function withholdByConfidence<
  T extends { cover: string; series: string; seriesPosition: number | null },
>(record: T, confidence: 'high' | 'medium' | 'low' | 'none'): T {
  if (confidence === 'none') return { ...record, cover: '', series: '', seriesPosition: null }
  if (confidence === 'low') return { ...record, series: '', seriesPosition: null }
  return record
}
