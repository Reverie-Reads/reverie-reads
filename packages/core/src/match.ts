import type { Book, Owned, ReadEntry } from './types'
import { authorOf, norm, workIdentityPart } from './normalize'
import { contributorsChanged, reconcileContributors } from './contributors'
import { mergePossession } from './ownership'
import { normalizeBookGenres } from './genreNormalize'

// ── ISBN normalization (match the same book whether it stored ISBN-10 or ISBN-13) ──

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

// ── Matching ──

export type MatchStrength = 'isbn' | 'title-author' | 'title-series-pos' | 'fuzzy' | 'none'
/** Strong matches auto-merge; fuzzy always routes to review. */
export const isStrong = (s: MatchStrength): boolean =>
  s === 'isbn' || s === 'title-author' || s === 'title-series-pos'

export type Incoming = Partial<Book> & { title: string }

/**
 * THE PERSISTED KEY. Stays on `norm`, deliberately, and must not be "upgraded" to the fold below.
 *
 * `importKey` builds `merge_verdicts.incoming_key` from this, and that column is part of the table's
 * PRIMARY KEY (`owner_id, book_id, incoming_key`) — every remembered "keep separate" / "always
 * merge" verdict a reader has ever recorded is filed under a key of this exact shape. Change the
 * shape and none of them are ever found again: the verdicts do not error, they simply stop applying,
 * and the reader is re-asked about pairs they already ruled on. Same orphaning hazard as
 * `works.work_key` and the enrich fn's `ta:` cache keys, which is why the fold is a SEPARATE
 * comparator rather than a change to `norm`.
 */
const authorAuthorKey = (b: { title: string; last?: string }) => norm(b.title) + '|' + norm(b.last)

// ── THE MATCHING FOLD — comparison only, never storage ──────────────────────────────────────────
//
// Corpus identity and library comparison now share the Unicode-preserving fold. It degrades
// diacritics to their base letters without collapsing non-Latin titles/authors to empty strings.
//
// ⚠ THIS MUST NOT MOVE INTO `norm`. `importKey` persists `norm` output in merge-verdict primary
// keys; changing that shape would silently orphan readers' prior duplicate decisions.
const fold = workIdentityPart

/** The whole author name, folded — split-invariant. This is what makes 'Scarlett'/'St. Clair' and
 *  'Scarlett St.'/'Clair' the same person: both compose to 'scarlettstclair'. */
const foldedFullAuthor = (b: { first?: string; last?: string }): string => fold(authorOf(b))

// Title with the subtitle (after :/– etc.) dropped, then normalized (strips punctuation + case).
const fuzzyTitle = (t: string) => fold(t.replace(/\s*[:–—-].*$/, ''))

export interface BookMatch {
  book: Book
  strength: MatchStrength
}

// ── TYPO TOLERANCE (fuzzy only, never strong) ───────────────────────────────────────────────────

/**
 * The title as the typo leg compares it: the matching fold, plus `&` spelled out.
 *
 * `norm` DELETES `&` rather than folding it, so 'Promises & Pomegranates' becomes
 * 'promisespomegranates' and sits 3 edits from 'promisesandpomegranates' — a 0.87 ratio, under the
 * threshold, for a pair that is obviously the same book. Spelling it out first makes that pair
 * identical under this comparator.
 *
 * DELIBERATELY NOT in the strong legs' fold. An ampersand difference resolving to an exact key
 * would AUTO-MERGE the pair, and the whole argument of this leg is that a title that differs at all
 * — by a slipped letter or by a spelled-out conjunction — earns a human glance rather than a silent
 * merge. So it widens what gets REVIEWED and nothing else.
 */
const typoTitle = (t: string): string => fold(String(t ?? '').replace(/&/g, ' and '))

/** Levenshtein distance, two-row DP. Callers gate on the length pre-filter below, so this only ever
 *  runs on same-author candidates of comparable length. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  let cur = new Array<number>(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      const sub = (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)
      cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, sub)
    }
    const swap = prev
    prev = cur
    cur = swap
  }
  return prev[b.length] as number
}

/** 1 − distance/longest. 1.0 identical, 0.0 nothing in common. */
function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length)
  if (!max) return 1
  return 1 - editDistance(a, b) / max
}

/** A one-or-two-character slip in a title is a typo; a different title is a different book. 0.9 was
 *  chosen against the 2026-08-23 import: it admits all 17 real typos and, with the author gate in
 *  front of it, excludes both same-title-different-author false positives in that file. */
const TYPO_MIN_SIMILARITY = 0.9
/** Titles this far apart in length are not the same title with a slip in it. Pure cost control — it
 *  keeps the edit distance off pairs that cannot clear the threshold anyway. */
const TYPO_MAX_LEN_DELTA = 8

/**
 * Find the best existing library record for an incoming book.
 *
 * Priority: compatible unique ISBN (10↔13 normalized) → unique title + FULL author →
 * surname / title+series+position for review → fuzzy (same author, title equal ignoring subtitle) → fuzzy (same author,
 * title within a typo's distance). Returns strength 'none' if nothing matches. Matches only on real
 * shared keys — enrichment may fill the incoming ISBN, but a match is never fabricated.
 *
 * Full-author comparison remains split-invariant. Surname-only and series-label matches
 * suggest review; they never silently combine personal books. Competing exact candidates also
 * require review. Persisted verdict keys below stay unchanged.
 *
 * ── THE EMPTY-AUTHOR GUARD, WHICH IS A BEHAVIOUR CHANGE ────────────────────────────────────────
 * A leg fires only when its own author component is non-empty. Without that, a row with no author
 * keys as `title|` and title-author-matches ANY same-titled authorless book — and because
 * `isStrong('title-author')` is true while `autoMergeStrong` defaults TRUE on the import path, that
 * silently AUTO-MERGED two unrelated books with no review step. The ISBN leg is untouched: a row
 * with no author can still match on a real shared identifier.
 */
export function matchBook(incoming: Incoming, library: readonly Book[]): BookMatch {
  const inIsbn = normalizeIsbn(incoming.isbn ?? '')
  if (inIsbn) {
    const matches = library.filter((b) => normalizeIsbn(b.isbn) === inIsbn)
    const m = matches[0]
    if (m) {
      const titleConflict =
        !!fold(incoming.title) && !!fold(m.title) && fold(incoming.title) !== fold(m.title)
      const authorConflict =
        !!foldedFullAuthor(incoming) &&
        !!foldedFullAuthor(m) &&
        foldedFullAuthor(incoming) !== foldedFullAuthor(m)
      return {
        book: m,
        strength: titleConflict || authorConflict || matches.length > 1 ? 'fuzzy' : 'isbn',
      }
    }
  }

  const inTitle = fold(incoming.title)

  // Strong leg 1 — title + FULL author. Guarded on a non-empty folded name.
  const inFull = foldedFullAuthor(incoming)
  if (inFull && inTitle) {
    const matches = library.filter((b) => {
      const bFull = foldedFullAuthor(b)
      return !!bFull && bFull === inFull && fold(b.title) === inTitle
    })
    const m = matches[0]
    if (m) return { book: m, strength: matches.length > 1 ? 'fuzzy' : 'title-author' }
  }

  // Surname agreement only proposes review; distinct people can share a surname.
  const inLast = fold(incoming.last)
  if (inLast && inTitle) {
    const m = library.find((b) => {
      const bLast = fold(b.last)
      return !!bLast && bLast === inLast && fold(b.title) === inTitle
    })
    if (m) return { book: m, strength: 'fuzzy' }
  }

  if (
    inTitle &&
    incoming.series &&
    typeof incoming.position === 'number' &&
    Number.isFinite(incoming.position)
  ) {
    const m = library.find(
      (b) =>
        !!b.series &&
        norm(b.title) === norm(incoming.title) &&
        norm(b.series) === norm(incoming.series ?? '') &&
        String(b.position) === String(incoming.position ?? ''),
    )
    if (m) return { book: m, strength: 'fuzzy' }
  }

  // Same author, same title once the subtitle is dropped.
  if (inLast) {
    const inFuzzy = fuzzyTitle(incoming.title)
    const m = library.find((b) => fold(b.last) === inLast && fuzzyTitle(b.title) === inFuzzy)
    if (m) return { book: m, strength: 'fuzzy' }
  }

  // Same author, title within a typo's distance. FUZZY BY CONSTRUCTION, NEVER STRONG — `decideIntake`
  // routes fuzzy to review/add and never to an auto-merge, and that is the entire safety argument
  // for admitting near-misses at all. The same data that produced 17 true positives produced two
  // same-title-different-author pairs; the author gate excludes those, and anything the gate lets
  // through still stops at a human.
  //
  // COST: this is the only leg that computes edit distance, and it runs per import row against a
  // ~1,600-book library. The author gate is evaluated FIRST and is a string compare, so the distance
  // is computed only for same-author candidates — a handful per row, not the whole shelf.
  if (inFull || inLast) {
    const inTypo = typoTitle(incoming.title)
    const m = library.find((b) => {
      const bFull = foldedFullAuthor(b)
      const bLast = fold(b.last)
      const sameAuthor = (!!inFull && bFull === inFull) || (!!inLast && bLast === inLast)
      if (!sameAuthor) return false
      const bTypo = typoTitle(b.title)
      if (Math.abs(bTypo.length - inTypo.length) > TYPO_MAX_LEN_DELTA) return false
      return similarity(bTypo, inTypo) >= TYPO_MIN_SIMILARITY
    })
    if (m) return { book: m, strength: 'fuzzy' }
  }

  return { book: undefined as unknown as Book, strength: 'none' }
}

/**
 * Stable identity of an incoming record, used to remember a per-pair verdict across imports:
 * the canonical ISBN-13 if present, else normalized title + author. Re-importing the same row
 * yields the same key, so a remembered "keep separate" / "always merge" decision still applies.
 */
export function importKey(inc: Incoming): string {
  const isbn = normalizeIsbn(inc.isbn ?? '')
  return isbn ? `isbn:${isbn}` : authorAuthorKey({ title: inc.title, last: inc.last })
}

export type DuplicateVerdict = 'keep_separate' | 'always_merge'
export type IntakeDecision = 'merge' | 'add' | 'review' | 'skip'

/**
 * Decide what to do with a matched incoming record. Pure so the matrix is unit-tested:
 * - no match → add it;
 * - a remembered verdict wins (always_merge → fold in; keep_separate → skip, don't re-flag);
 * - a strong match folds in only when auto-merge is on, otherwise it goes to review;
 * - a fuzzy match adds (single-add paths) or reviews (import) — never auto-merges.
 */
export function decideIntake(
  strength: MatchStrength,
  opts: {
    autoMergeStrong: boolean
    verdict?: DuplicateVerdict | null
    fuzzyMode: 'review' | 'add'
  },
): IntakeDecision {
  if (strength === 'none') return 'add'
  if (opts.verdict === 'always_merge') return 'merge'
  if (opts.verdict === 'keep_separate') return 'skip'
  if (isStrong(strength)) return opts.autoMergeStrong ? 'merge' : 'review'
  return opts.fuzzyMode === 'add' ? 'add' : 'review'
}

// ── Import merge: fold the incoming record INTO the existing one (existing row survives) ──

export interface ImportMergeResult {
  patch: Partial<Book> // field changes to apply to the existing record (empty = no-op)
  newReads: ReadEntry[] // incoming reads not already present (dedup by date)
  changed: boolean
}

function mergeOwned(existing: Owned, incoming?: Owned): Owned {
  if (!incoming) return existing
  return {
    // Keep the user's physical sub-type; only fill in if they don't own physical at all.
    physical: existing.physical !== false ? existing.physical : incoming.physical,
    ebook: existing.ebook || incoming.ebook,
    audiobook: existing.audiobook || incoming.audiobook,
  }
}

/**
 * Enrichment-only series gate, mirroring enrichmentCoverFill (covers.ts): withhold entirely once
 * the reader has named or cleared the series themselves, otherwise fill-only. Scoped to the
 * enrichment path (toIncoming) — CSV/XLSX import stays ungated via mergeImport's own `fill('series')`.
 */
export function enrichmentSeriesFill(
  book: { series: string; seriesUserChosen?: boolean },
  offered: string,
): string {
  if (book.seriesUserChosen) return ''
  if (book.series) return '' // fill-only — an existing series (user, seed, or prior fill) stays
  return offered
}

/**
 * THE FILL-BLANK CLASSIFICATION — one table, two readers (feat/merge-differs-line).
 *
 * These are the fields where, when BOTH sides carry a value, the EXISTING one wins silently and
 * the incoming one is discarded. `mergeImport` consumes this to compute its patch; `mergeDifferences`
 * consumes the same entries to report what was discarded. They must not drift: if a field is
 * reclassified in one place and not the other, the differs line starts describing a merge that no
 * longer happens — the shape this repo has paid for three times in a fortnight (`max + 1000` at
 * three sites, the half-star snap at three, two copies of DESIGN_BACKLOG.md). Hence a table rather
 * than a second hand-written list.
 *
 * NOT IN HERE, deliberately, and each exclusion is by CONSTRUCTION rather than omission:
 *   · union / additive fields (tags, genres, subgenres, contributors, owned, possession) — both
 *     sides are kept, so nothing is discarded and there is nothing to report;
 *   · never-overwrite fields (fave, plan, progress) and untouched ones (tropes, moods) — not the
 *     engine's call to make, so not the engine's difference to narrate;
 *   · `title`, which is the match key and is never patched.
 * `rating` IS here: it fills a blank only, so a set existing rating wins — that silent keep is the
 * single most common contested field (60 of 290 seed books carry a fractional rating that a
 * Goodreads integer re-import disagrees with) and it is exactly what the differs line exists to
 * show. Showing it is not offering it: it stays unpickable.
 *
 * `show` present = renderable on the one-line summary. Absent = classified but never reported,
 * with the reason on the entry.
 */
interface FillBlankField {
  key: string
  /** short human label for the differs line */
  label: string
  existingBlank: (b: Book) => boolean
  incomingHas: (inc: Incoming) => boolean
  apply: (patch: Partial<Book>, inc: Incoming) => void
  show?: (b: Book | Incoming) => string
}

/** The uniform "existing wins unless blank" entry, GENERIC over the key so `patch[k] = inc[k]`
 *  keeps each field's own type (a widened key union collapses `status` to bare string). */
const text = <
  K extends
    | 'first'
    | 'last'
    | 'series'
    | 'genre'
    | 'subgenre'
    | 'status'
    | 'cover'
    | 'isbn'
    | 'format'
    | 'source',
>(
  key: K,
  label: string,
  show?: (b: Book | Incoming) => string,
): FillBlankField => ({
  key,
  label,
  existingBlank: (b) => !b[key],
  incomingHas: (inc) => !!inc[key],
  apply: (patch, inc) => {
    patch[key] = inc[key]
  },
  ...(show ? { show } : {}),
})

const str =
  (key: 'first' | 'last' | 'series' | 'genre' | 'subgenre' | 'format' | 'isbn') =>
  (b: Book | Incoming): string =>
    String(b[key] ?? '')

export const FILL_BLANK_FIELDS: readonly FillBlankField[] = [
  text('first', 'author first', str('first')),
  text('last', 'author last', str('last')),
  {
    key: 'series',
    label: 'series',
    existingBlank: (b) => !b.series,
    incomingHas: (inc) => !!inc.series,
    apply: (patch, inc) => {
      patch.series = inc.series
      // The claim travels with the value that won. Omitting this made manual Add, explicit import,
      // and enrichment indistinguishable as soon as they filled an existing blank row.
      if (inc.seriesClaim) patch.seriesClaim = inc.seriesClaim
      if (inc.seriesUserChosen !== undefined) patch.seriesUserChosen = inc.seriesUserChosen
    },
    show: str('series'),
  },
  text('genre', 'genre', str('genre')),
  text('subgenre', 'subgenre', str('subgenre')),
  text('format', 'format', str('format')),
  text('isbn', 'ISBN', str('isbn')),
  // NOT REPORTED — a cover is a URL, which cannot be stated in a few words on a one-line summary,
  // and a cover difference is already visible as a picture on the card.
  text('cover', 'cover'),
  // NOT REPORTED — both are values an import FABRICATES rather than carries: `source` is always
  // 'Imported' (csv.ts) and `status` is always 'standalone' on the StoryGraph path / absent on
  // Goodreads. Existing rows have both set on 290 of 290 seed books, so reporting them would fire
  // on essentially every card — the noise that trains a reader to stop reading the line.
  text('status', 'series status'),
  text('source', 'source'),
  {
    key: 'position',
    label: 'series position',
    existingBlank: (b) => b.position === '',
    incomingHas: (inc) => inc.position != null && inc.position !== '',
    apply: (patch, inc) => {
      patch.position = inc.position
    },
    show: (b) => String(b.position ?? ''),
  },
  {
    key: 'seriesCount',
    label: 'series length',
    existingBlank: (b) => b.seriesCount == null,
    incomingHas: (inc) => inc.seriesCount != null,
    apply: (patch, inc) => {
      patch.seriesCount = inc.seriesCount
    },
    show: (b) => (b.seriesCount == null ? '' : String(b.seriesCount)),
  },
  {
    // The pub date moves as a WHOLE object, gated on the year; the differs line projects it to the
    // year alone, which is the part a reader can read at a glance and the part the gate tests.
    key: 'pub',
    label: 'published',
    existingBlank: (b) => !b.pub || !b.pub.y,
    incomingHas: (inc) => !!inc.pub?.y,
    apply: (patch, inc) => {
      patch.pub = inc.pub
    },
    show: (b) => (b.pub?.y == null ? '' : String(b.pub.y)),
  },
  {
    key: 'intensity',
    label: 'intensity',
    existingBlank: (b) => b.intensity == null,
    incomingHas: (inc) => inc.intensity != null,
    apply: (patch, inc) => {
      patch.intensity = inc.intensity
    },
    show: (b) => (b.intensity == null ? '' : String(b.intensity)),
  },
  {
    key: 'rating',
    label: 'rating',
    existingBlank: (b) => !b.rating,
    incomingHas: (inc) => !!inc.rating,
    apply: (patch, inc) => {
      patch.rating = inc.rating
    },
    show: (b) => (b.rating ? String(b.rating) : ''),
  },
]

/** One field the merge decided silently: the existing value won, the incoming one was discarded. */
export interface MergeDifference {
  /** the classification table's key — what a picker checkbox is keyed to */
  key: string
  /** short human label, from the classification table */
  field: string
  /** the value that survives (the existing record's) */
  kept: string
  /** the value the incoming record offered and the merge discards */
  offered: string
}

/**
 * What a merge DISCARDS — the counterpart to `mergeImport`'s patch, which reports only what it adds.
 *
 * A fill-blank field whose existing value is already set produces NO patch entry, which is why a
 * disagreement renders nothing today. This reports those pairs, and only those: both sides set, and
 * different. A blank on either side is a FILL (or a no-op), never a difference. Pure and total —
 * same input, same answer, no ordering dependence.
 *
 * Comparison is on the RENDERED string, deliberately: the question the line answers is "would a
 * reader see two different values", so 'The Empyrean' vs 'the empyrean' is worth surfacing (the
 * merge does keep the existing casing) even though the values are semantically the same.
 *
 * This is ALSO the picker's contested-field predicate (`mergeFieldOptions` builds its 'replace'
 * rows from this list), which is why the row carries `key` and not just a display label. One
 * predicate, one place: a second implementation of "both set and different" could drift from this
 * one and nothing would catch it.
 */
export function mergeDifferences(existing: Book, incoming: Incoming): MergeDifference[] {
  const out: MergeDifference[] = []
  for (const f of FILL_BLANK_FIELDS) {
    if (!f.show) continue
    const kept = f.show(existing)
    const offered = f.show(incoming)
    if (!kept || !offered || kept === offered) continue
    out.push({ key: f.key, field: f.label, kept, offered })
  }
  return out
}

/**
 * Most-complete field values flow into the existing record; **user-authored fields always win**.
 * Single-value fields fill blanks only (existing kept when set). Multi-value fields union
 * (additive — never removes a curated trope/genre or turns off an owned flag). myRating, owned,
 * fave, plan, and progress are never overwritten. Reads dedupe by date. Idempotent: re-merging
 * identical data yields `changed: false`.
 */
export function mergeImport(existing: Book, incoming: Incoming): ImportMergeResult {
  const patch: Partial<Book> = {}

  for (const f of FILL_BLANK_FIELDS) {
    if (f.existingBlank(existing) && f.incomingHas(incoming)) f.apply(patch, incoming)
  }

  // Multi-value: union (additive).
  const tags = [...new Set([...existing.tags, ...(incoming.tags ?? [])])]
  if (tags.length !== existing.tags.length) patch.tags = tags
  const genres = normalizeBookGenres([...existing.genres, ...(incoming.genres ?? [])])
  if (genres.length !== existing.genres.length || genres.some((g, i) => g !== existing.genres[i]))
    patch.genres = genres

  // Contributors: union the lists (additive; existing order + curation preserved, user edits win).
  if (incoming.contributors?.length) {
    const reconciled = reconcileContributors(existing.contributors ?? [], incoming.contributors)
    if (contributorsChanged(existing.contributors ?? [], reconciled))
      patch.contributors = reconciled
  }

  const owned = mergeOwned(existing.owned, incoming.owned)
  if (JSON.stringify(owned) !== JSON.stringify(existing.owned)) patch.owned = owned

  // Possession is one-way on import-merge: a signal the import carries is ADDED to the record, and
  // an absent one never takes away what the reader has. Every rule in mergePossession is a union
  // with no subtraction, so an import can only ever upgrade — it cannot clear a flag the reader set,
  // whatever it does or doesn't say about possession.
  const possession = mergePossession([
    existing,
    {
      ownership: incoming.ownership ?? 'unowned',
      borrowed: incoming.borrowed ?? false,
      wishlist: incoming.wishlist ?? false,
    },
  ])
  if (possession.ownership !== existing.ownership) patch.ownership = possession.ownership
  if (possession.borrowed !== existing.borrowed) patch.borrowed = possession.borrowed
  if (possession.wishlist !== existing.wishlist) patch.wishlist = possession.wishlist

  // Reading status: only promote toward Read when the import shows more progress — an unset/Unread
  // record can gain Read, but a Read book is never walked back by a to-read row.
  if (
    (existing.readStatus === 'unset' || existing.readStatus === 'Unread') &&
    (incoming.readStatus === 'Read' || (incoming.reads?.length ?? 0) > 0)
  ) {
    patch.readStatus = 'Read'
  }

  const haveDates = new Set(existing.reads.map((r) => r.date).filter(Boolean))
  const newReads = (incoming.reads ?? []).filter((r) => r.date && !haveDates.has(r.date))

  return { patch, newReads, changed: Object.keys(patch).length > 0 || newReads.length > 0 }
}
