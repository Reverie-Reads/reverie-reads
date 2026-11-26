import type { Book } from './types'

// Genre/tag normalization for real library-export ingest (Import I1). Real exports use messy,
// inconsistent vocab — mixed case, typos, ";"/","/":"-joined, non-genre tokens mixed in. This maps
// them to the canonical CORE genre set (= the 9 skins) for the primary genre + genres[] signal, and
// routes everything else to tags. Pure + unit-tested against the real export vocab.

// The canonical genres — one per skin, spelled exactly as skins.ts spells them (keep in sync).
// Lowercased, these are the keys the genre-scoped subgenre/trope taxonomies look up, so every
// pipe that writes a genre (import here, enrichment's mapGenre, the add flow's skin genre) must
// land on this vocabulary or the book misses its genre's shelves.
export const CORE_GENRES = [
  'Romance',
  'Fantasy',
  'Science fiction',
  'Horror',
  'Mystery',
  'Literary',
  'Cozy',
  'Nonfiction',
  'Young adult',
] as const
export type CoreGenre = (typeof CORE_GENRES)[number]

// token (lowercased, trimmed) -> CoreGenre. Includes the confirmed typos/aliases from the exports.
export const LIBRARY_GENRES = [
  ...CORE_GENRES,
  'Children’s',
  'Classic',
  'Fiction',
  'Historical Fiction',
] as const
const GENRE_ALIASES: Record<string, (typeof LIBRARY_GENRES)[number]> = {
  "children's": 'Children’s',
  'children’s': 'Children’s',
  childrens: 'Children’s',
  classic: 'Classic',
  classics: 'Classic',
  fiction: 'Fiction',
  'historical fiction': 'Historical Fiction',
  romance: 'Romance',
  romace: 'Romance', // typo in the real export
  fantasy: 'Fantasy',
  fantays: 'Fantasy', // typo
  fantast: 'Fantasy', // typo
  'sci-fi': 'Science fiction',
  scifi: 'Science fiction',
  'sci fi': 'Science fiction',
  'science fiction': 'Science fiction',
  'science-fiction': 'Science fiction',
  horror: 'Horror',
  mystery: 'Mystery',
  thriller: 'Mystery', // collapsed into Mystery (no Thriller skin)
  crime: 'Mystery',
  cozy: 'Cozy',
  cosy: 'Cozy',
  nonfiction: 'Nonfiction',
  'non-fiction': 'Nonfiction',
  'non fiction': 'Nonfiction',
  ya: 'Young adult',
  'young adult': 'Young adult',
  'young-adult': 'Young adult',
  literary: 'Literary',
}

// tokens that map to Literary but ALSO leave a descriptive tag (so the nuance isn't lost).
const LITERARY_DESCRIPTIVE: Record<string, string> = {
  fiction: 'fiction',
  poetry: 'poetry',
  historical: 'historical',
  'historical fiction': 'historical fiction',
  'short stories': 'short stories',
}

// non-genre tokens that appear in the genre column and should simply be dropped.
const DROP_TOKENS = new Set([
  'standalone',
  'standalones',
  'complete',
  'completed',
  'tbr',
  'n/a',
  'none',
])

// spice-ish tokens → the intensity signal (kept as a tag too). Binary in the exports, so a single
// representative level.
const SPICE_TOKENS = new Set(['spicy', 'spice', 'steamy', 'smut'])
export const SPICE_INTENSITY = 3

export interface NormalizedGenres {
  /** primary genre = first CORE token in the genre field (null when none) — the skin/adaptive signal */
  genre: string | null
  /** all CORE genres found, first-seen order, deduped */
  genres: string[]
  /** lowercased descriptive tags: non-core genre tokens + the tags field + spice + literary nuance */
  tags: string[]
  /** intensity from a spice token, else null */
  intensity: number | null
  /** the primary subgenre — first KNOWN subgenre seen in the genre column, else null */
  subgenre: string | null
  /** every known subgenre seen, first-seen order, deduped */
  subgenres: string[]
  /** the raw genre field when it was non-empty but mapped to NO core genre (e.g. a leaked "standalone"
   *  or an unrecognized label) — the import-review "odd/unmapped genre" signal (E3). null otherwise. */
  unmappedGenre: string | null
}

/** Split a messy field on ; / , and the stray ":" separator; trim; drop empties. */
function splitTokens(field: string): string[] {
  return (field ?? '')
    .split(/[;/,:]/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Normalize an export's genre + tags fields into the app's shapes. The genre field drives the
 * primary genre + genres[] (CORE only); non-core genre tokens, the whole tags field, spice, and
 * literary nuance all become lowercased deduped tags; a spice token sets the intensity signal.
 * Blank inputs yield genre null / empty arrays / intensity null.
 */
export function normalizeImportGenres(genreField: string, tagsField = ''): NormalizedGenres {
  const cores: (typeof LIBRARY_GENRES)[number][] = []
  const tags: string[] = []
  const subgenres: string[] = []
  let intensity: number | null = null

  const addTag = (t: string) => {
    const v = t.trim().toLowerCase()
    if (v) tags.push(v)
  }

  // 1) The genre column → CORE genres (+ descriptive/non-core spillover to tags).
  for (const raw of splitTokens(genreField)) {
    const key = raw.toLowerCase()
    if (DROP_TOKENS.has(key)) continue
    if (SPICE_TOKENS.has(key)) {
      intensity = SPICE_INTENSITY
      addTag(key)
      continue
    }
    const core = GENRE_ALIASES[key]
    if (core) {
      if (LITERARY_DESCRIPTIVE[key]) addTag(key)
      if (!cores.includes(core)) cores.push(core)
      continue
    }
    const litTag = LITERARY_DESCRIPTIVE[key]
    if (litTag) {
      if (!cores.includes('Literary')) cores.push('Literary')
      addTag(litTag)
      continue
    }
    // A KNOWN SUBGENRE names its parent genre. Before this, "Dark Romance" in the genre column was
    // demoted to a tag and the book landed with no genre at all — the taxonomy already knew the
    // answer and nothing asked it.
    //
    // The tag is KEPT as well as the subgenre recorded, following the LITERARY_DESCRIPTIVE branch
    // directly above, which maps to a genre *and* leaves a tag "so the nuance isn't lost". Tags are
    // load-bearing elsewhere — search, filters, and bookTropeNames' fallback — so dropping them
    // here would quietly change what an imported book matches. Making the tag go away is a
    // separate decision with its own consequences, not a fold into this one.
    const parentKey = SUBGENRE_PRIMARY_GENRE[key]
    if (parentKey) {
      const parent = CORE_GENRES.find((g) => g.toLowerCase() === parentKey)
      if (parent && !cores.includes(parent)) cores.push(parent)
      if (!subgenres.some((x) => x.toLowerCase() === key)) subgenres.push(raw.trim())
      addTag(raw)
      continue
    }
    addTag(raw) // a genuine non-core token → a descriptive tag
  }

  // 2) The tags column → descriptive tags (never promoted to a genre); spice → intensity.
  for (const raw of splitTokens(tagsField)) {
    const key = raw.toLowerCase()
    if (SPICE_TOKENS.has(key)) intensity = SPICE_INTENSITY
    addTag(key)
  }

  const uniqueTags = [...new Set(tags)]
  // A non-empty genre column that yielded no core genre is worth a look in the import review (the
  // canonical case is the real file's leaked "standalone"; also catches genuinely unrecognized labels).
  // Unchanged in meaning: `cores` is non-empty whenever a known subgenre named its parent, so a
  // genre column of "Dark Romance" is no longer reported as unmapped — because it no longer is.
  const unmappedGenre = genreField.trim() !== '' && cores.length === 0 ? genreField.trim() : null
  return {
    genre: cores[0] ?? null,
    genres: cores,
    tags: uniqueTags,
    subgenre: subgenres[0] ?? null,
    subgenres,
    intensity,
    unmappedGenre,
  }
}

/**
 * Resolve any genre spelling a stored book may carry — import canon ('Sci-Fi', 'YA' from older
 * imports), legacy enrichment tokens ('science-fiction', 'thriller'), skin genres ('Science
 * fiction'), hand-typed variants — onto the canonical lowercased key the genre-scoped taxonomies
 * use. Unrecognized input just lowercases, so a reader's own genre vocabulary passes through.
 */
export function genreKey(raw: string): string {
  const t = (raw ?? '').trim().toLowerCase()
  const core = GENRE_ALIASES[t] ?? (LITERARY_DESCRIPTIVE[t] != null ? 'Literary' : undefined)
  return core ? core.toLowerCase() : t
}

// ── Primary-genre inference from a single subgenre ──
// Derived from the GENRE_SUBGENRES taxonomy (apps/web library/constants.ts): a subgenre that
// appears under exactly ONE genre names that genre. Anything shared across genres (Romantasy,
// Contemporary, Cozy Mystery, Cozy Fantasy), the neutral 'Other', and the legacy romance-era
// 'Fantasy' subgenre stay unmapped — the reader picks; we never guess wrong. Keys are lowercased
// subgenre spellings; values are the lowercased genre keys `book.genre` stores. The book_editing
// migration mirrors these pairs exactly — a web-side parity test keeps all three in sync.
export const SUBGENRE_PRIMARY_GENRE: Record<string, string> = {
  'dark romance': 'romance',
  // No `romance: 'romance'` — see GENRE_SUBGENRES. A genre is never its own subgenre, so there is
  // nothing to infer FROM it; the value should not be in the subgenre field at all.
  sports: 'romance',
  'cowboy romance': 'romance',
  'epic fantasy': 'fantasy',
  'dark fantasy': 'fantasy',
  'portal fantasy': 'fantasy',
  'sword & sorcery': 'fantasy',
  'space opera': 'science fiction',
  cyberpunk: 'science fiction',
  dystopian: 'science fiction',
  'hard sf': 'science fiction',
  'time travel': 'science fiction',
  'first contact': 'science fiction',
  gothic: 'horror',
  supernatural: 'horror',
  slasher: 'horror',
  'cosmic horror': 'horror',
  psychological: 'horror',
  'haunted house': 'horror',
  noir: 'mystery',
  thriller: 'mystery',
  detective: 'mystery',
  whodunit: 'mystery',
  'locked room': 'mystery',
  'literary fiction': 'literary',
  historical: 'literary',
  'magical realism': 'literary',
  'short stories': 'literary',
  'small town': 'cozy',
  'slice of life': 'cozy',
  culinary: 'cozy',
  memoir: 'nonfiction',
  history: 'nonfiction',
  science: 'nonfiction',
  essays: 'nonfiction',
  biography: 'nonfiction',
  'self-help': 'nonfiction',
  'ya fantasy': 'young adult',
  'ya romance': 'young adult',
  'ya dystopian': 'young adult',
  'coming of age': 'young adult',
  'ya contemporary': 'young adult',
  // ── genre-neutral broadening (docs/archive/task-taxonomy-neutral.md) — all NEW single-genre subgenres ──
  'historical romance': 'romance',
  'paranormal romance': 'romance',
  'romantic comedy': 'romance',
  'urban fantasy': 'fantasy',
  grimdark: 'fantasy',
  'fairytale retelling': 'fantasy',
  'post-apocalyptic': 'science fiction',
  'military sf': 'science fiction',
  'climate fiction': 'science fiction',
  'folk horror': 'horror',
  'body horror': 'horror',
  splatterpunk: 'horror',
  'police procedural': 'mystery',
  'legal thriller': 'mystery',
  'historical mystery': 'mystery',
  satire: 'literary',
  'speculative fiction': 'literary',
  autofiction: 'literary',
  epistolary: 'literary',
  'cozy crime': 'cozy',
  cottagecore: 'cozy',
  'bookshop cozy': 'cozy',
  'cozy paranormal': 'cozy',
  'true crime': 'nonfiction',
  travel: 'nonfiction',
  philosophy: 'nonfiction',
  'ya horror': 'young adult',
  'ya mystery': 'young adult',
  'ya sci-fi': 'young adult',
  'ya thriller': 'young adult',
}

/** The genre a subgenre unambiguously implies, or null (shared/unknown — reader decides). */
/**
 * Is this value a CORE GENRE, and therefore never a subgenre?
 *
 * Owner ruling: subgenres are exactly one layer below genre. "Dark Romance" is a subgenre of
 * Romance; "Romance" is never a subgenre of anything. A core-genre value in the subgenre field is
 * not a subgenre — it is a second genre that was mis-filed.
 *
 * Matched against CORE_GENRES by NAME, case-insensitively — deliberately NOT through `genreKey`.
 * `genreKey` resolves 'Thriller' to Mystery and 'Historical' to Literary, but those are collapses
 * and descriptive mappings, not spellings of a genre: both are legitimate subgenres one layer below
 * their parent. Measured before choosing: checking the taxonomy through `genreKey` flags four
 * values, of which exactly one is a real violation and three are these. An over-reporting
 * instrument's hit is a question, not a verdict, so the narrow test is the correct one.
 */
export function isCoreGenreValue(value: string): boolean {
  const v = (value ?? '').trim().toLowerCase()
  return v !== '' && CORE_GENRES.some((g) => g.toLowerCase() === v)
}

/** Drop any value that is really a genre from a list of subgenres. */
export function withoutGenres(values: readonly string[]): string[] {
  return values.filter((v) => !isCoreGenreValue(v))
}

export function inferGenreFromSubgenre(subgenre: string): string | null {
  return SUBGENRE_PRIMARY_GENRE[subgenre.trim().toLowerCase()] ?? null
}

/** Every subgenre a book carries. New records store subgenres[]; pre-migration singles ride in
 *  `subgenre`. Read subgenres through this everywhere a book is filtered, tallied, or displayed. */
export function subgenreLabel(value: string): string {
  return value.toLowerCase() === 'sports' ? 'Sports Romance' : value
}

export function bookSubgenres(b: Pick<Book, 'subgenre' | 'subgenres'>): string[] {
  return b.subgenres.length ? b.subgenres : b.subgenre ? [b.subgenre] : []
}

/** Normalize the genre array at every read/write boundary.
 *
 * Core genre labels have one stored spelling (the lowercase key used by filters and skins), while
 * provider-only labels such as "Thriller" remain intact. Identity is case/space-insensitive so a
 * mixed source cannot turn `romance` + `Romance` into two tags. This deliberately does not resolve
 * aliases through genreKey: "Thriller" and "Mystery" are distinct descriptive labels even though
 * both file into the Mystery room. */
export function normalizeBookGenres(values: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of values) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    const core = LIBRARY_GENRES.find(
      (genre) => genre.toLowerCase() === trimmed.toLowerCase().replaceAll("'", '’'),
    )
    const value = core ? core.toLowerCase() : trimmed
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out
}

/** Every CORE genre a book carries (lowercased keys, e.g. 'romance'). New records store genres[];
 *  pre-migration singles ride in `genre`. Mirrors bookSubgenres — read genres through this
 *  everywhere a book's full genre set is filtered, tallied, or displayed, rather than reading the
 *  single `genre` field directly and silently dropping any additional tags. */
export function bookGenres(b: Pick<Book, 'genre' | 'genres'>): string[] {
  return normalizeBookGenres(b.genres.length ? b.genres : b.genre ? [b.genre] : [])
}
