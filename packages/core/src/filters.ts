import { bookGuidance } from './contentGuidance'
import type { Book, ReadStatus, SeriesStatus } from './types'
import { bookGenres, bookSubgenres } from './genreNormalize'
import { bookTropeNames } from './tropes'
import { authorOf } from './normalize'
import { normalizeName } from './contributors'
import { isOwnedBook, isPossessed, isWanted } from './ownership'

export type LibrarySort =
  | 'az'
  | 'author'
  | 'rating'
  | 'intensity'
  | 'darkness'
  | 'recent'
  | 'series'
export type SeriesLenBucket = 'Any' | '1' | '2' | '3' | '4' | '5+' | 'Unknown'
/** Mirrors the /shelves derived-shelf sections (ShelfSectionKey in shelves.ts), for the Library link
 *  each section header carries. Kept as its own facet rather than overloading `read`/`wishlist`
 *  because it must replicate the shelf's own predicate exactly (e.g. the Read shelf's unsplit count
 *  includes DNF — `hasReadingHistory`, not `isBookRead`) and it must bypass the default-library scope
 *  gate the way `deriveShelfSections` does, since it filters the whole library, not just what's
 *  already in view. */
export type LibraryShelfLink = 'All' | 'owned' | 'borrowed' | 'read' | 'wishlist'

export interface LibraryFilters {
  q: string
  /** primary-or-additional genre facet ('All' = off). A book matches if ANY of its genres does —
   *  read through bookGenres, so a multi-genre romantasy book is reachable from either shelf's
   *  facet, and a pre-multi-genre book still matches on its single `genre`. */
  genre: 'All' | string
  sub: 'All' | string
  tags: string[]
  status: 'All' | SeriesStatus
  len: SeriesLenBucket
  read: 'All' | ReadStatus
  format: 'All' | string
  fave: boolean
  /**
   * Selected intensity levels; empty = any. A book matches if ITS OWN value is in the set.
   *
   * `null` is a selectable member and means NOT ASSESSED — nobody has judged this book's
   * intensity. It is a different thing from `0`, which means assessed and found to have none,
   * and the two are never collapsed (owner ruling, 2026-08-21). Measured on the live database at
   * the time of the ruling: 535 books at 0, 179 at null. Reading null as 0 would silently claim
   * 179 judgements that were never made.
   */
  intensity: (number | null)[]
  /**
   * Selected DARKNESS levels; empty = any. Same contract as `intensity` above and for the same
   * reason — `null` is a selectable member meaning NOT ASSESSED, distinct from `0` (assessed and
   * found to have none), never collapsed. A separate axis from Spice (owner ruling 2026-08-21):
   * intensity is heat, this is how dark/heavy the book is. Every existing book starts null here.
   */
  darkness: (number | null)[]
  /** filter to books where any contributor matches this name ('' = off) */
  author: string
  /** include books outside the default scope — books you neither have in hand nor ever opened.
   *  Off by default: the grid is what you have or have engaged with (see inDefaultLibrary). */
  wishlist: boolean
  /** which /shelves derived-shelf section this view was opened from ('All' = none) */
  shelf: LibraryShelfLink
  sort: LibrarySort
}

export const defaultFilters = (): LibraryFilters => ({
  q: '',
  genre: 'All',
  sub: 'All',
  tags: [],
  status: 'All',
  len: 'Any',
  read: 'All',
  format: 'All',
  fave: false,
  intensity: [],
  darkness: [],
  author: '',
  wishlist: false,
  shelf: 'All',
  sort: 'az',
})

/** Does any of the book's contributors match the given name (case/space-insensitive)? */
export function bookHasAuthor(b: Book, name: string): boolean {
  const key = normalizeName(name)
  if (!key) return true
  if (b.contributors.length) return b.contributors.some((c) => normalizeName(c.name) === key)
  return normalizeName(authorOf(b)) === key // back-compat for not-yet-joined books
}

/** A book counts as "read" if marked Read or it has any logged reads.
 *
 *  DNF is deliberately NOT read, and this predicate must stay that way: it feeds series progress,
 *  the taste profile, the reading stats and the matcher, where counting an abandoned book as read
 *  would overstate a series' completion and teach the recommender from a book the reader bailed on.
 *  Library VISIBILITY is a different question — see hasReadingHistory. */
export const isBookRead = (b: Book): boolean => b.readStatus === 'Read' || b.reads.length > 0

/** Has the reader engaged with this book at all — finished it, or started and abandoned it.
 *
 *  Split from isBookRead because the two questions diverge on exactly one status. A DNF book you
 *  never owned was invisible: not possessed, not read, so outside the default library and reachable
 *  only through the wishlist chip. That is a book the reader definitely handled, hidden by a
 *  predicate meant to hide books they had not. Visibility says yes; "read" still says no. */
export const hasReadingHistory = (b: Book): boolean => isBookRead(b) || b.readStatus === 'DNF'

/** The default library scope (docs/archive/task-shelf-model.md): anything you have in hand (owned or
 *  borrowed) OR have any reading history with, DNF included. Reading history is never hidden by
 *  possession — a book you read from the library stays in your library. Books you neither had nor
 *  opened fall outside; the wishlist chip lets them back in. */
export const inDefaultLibrary = (b: Book): boolean => isPossessed(b) || hasReadingHistory(b)

const positionOf = (b: Book, fallback = 0): number =>
  typeof b.position === 'number' ? b.position : Number(b.position) || fallback

/** Which "Books in series" bucket a book falls in (null length => "Unknown"/"None set"). */
export function seriesLenBucket(b: Book): SeriesLenBucket {
  const c = b.seriesCount
  if (c == null) return 'Unknown'
  if (c >= 5) return '5+'
  return String(c) as SeriesLenBucket
}

/** The prototype's library predicate, ported verbatim. */
export function matchesFilters(b: Book, f: LibraryFilters): boolean {
  // A shelf link replaces collection scoping rather than adding to it — it must show exactly the
  // set /shelves showed (deriveShelfSections filters the WHOLE library, not the default-scoped
  // view), so a wishlist-only book reached via the Wishlist shelf must not be excluded by the
  // default-library gate below.
  if (f.shelf !== 'All') {
    if (f.shelf === 'owned' && !isOwnedBook(b)) return false
    if (f.shelf === 'borrowed' && !b.borrowed) return false
    if (f.shelf === 'read' && !hasReadingHistory(b)) return false
    if (f.shelf === 'wishlist' && !isWanted(b)) return false
  } else if (!f.wishlist && !inDefaultLibrary(b)) return false
  if (f.genre !== 'All' && !bookGenres(b).includes(f.genre)) return false
  if (f.sub !== 'All' && !bookSubgenres(b).includes(f.sub)) return false
  if (f.tags.length) {
    const names = bookTropeNames(b)
    if (!f.tags.every((t) => names.includes(t))) return false
  }
  if (f.status !== 'All' && b.status !== f.status) return false
  if (f.len !== 'Any' && seriesLenBucket(b) !== f.len) return false
  if (f.read !== 'All') {
    const read = isBookRead(b)
    if (f.read === 'Read' && !read) return false
    if (f.read === 'Unread' && (read || b.readStatus === 'Reading' || b.readStatus === 'DNF'))
      return false
    if (f.read === 'Reading' && b.readStatus !== 'Reading') return false
    if (f.read === 'DNF' && b.readStatus !== 'DNF') return false
    if (f.read === 'unset' && b.readStatus !== 'unset') return false
  }
  if (f.format !== 'All' && b.format !== f.format) return false
  if (f.fave && !b.fave) return false
  // `bookGuidance(b).intensity ?? null`, never `?? 0`: an unassessed book matches only the explicit
  // not-assessed selection. Normalizing undefined to null keeps a partial fixture honest too.
  if (f.intensity.length && !f.intensity.includes(bookGuidance(b).intensity ?? null)) return false
  // Same `?? null` rule as intensity directly above — see the comment there.
  if (f.darkness.length && !f.darkness.includes(bookGuidance(b).darkness ?? null)) return false
  if (f.author && !bookHasAuthor(b, f.author)) return false
  if (f.q) {
    const hay = [
      b.title,
      authorOf(b),
      b.series,
      ...b.tags,
      ...b.tropes.map((t) => t.name),
      ...b.genres,
    ]
      .join(' ')
      .toLowerCase()
    if (!hay.includes(f.q.toLowerCase())) return false
  }
  return true
}

/** How many books the CURRENT SEARCH matched but the default-library scope withheld.
 *
 *  SAY WHAT YOU SILENTLY DID. matchesFilters applies the inDefaultLibrary gate BEFORE the text
 *  filter, which is deliberate — but it means an exact-title query on a wishlist-only book returns
 *  an empty grid with no indication anything was held back. The strongest intent signal a reader
 *  can send is overruled by a view default, silently. This counts what was withheld so the UI can
 *  state it. The sibling case is DuplicateReview's `differs` line, which narrates the values a
 *  merge silently keeps over the ones it discards; Discover's fn-down fallback is the third surface
 *  with the same shape (curated content substituted for live, indistinguishably) and has no such
 *  line yet. All three do a defensible thing quietly; the fix is never to stop doing it, it is to
 *  say so.
 *
 *  Both operands go through matchesFilters itself rather than re-deriving the predicate, so the
 *  count can never disagree with the grid it annotates: a book counts only if lifting the scope
 *  gate — and nothing else — would have brought it in. Every other facet still applies, so a book
 *  the genre chip excluded is not reported as withheld by scope.
 *
 *  Zero without a query, mirroring matchesFilters' own `if (f.q)` gate: this narrates SEARCH, and
 *  the unqueried grid already reads as "your library", not as a result set. Naturally zero when the
 *  wishlist chip is already on or a shelf link is active, since neither run the gate — both
 *  operands then agree, and there is nothing left to reveal. Like the differs line, it must return
 *  nothing when nothing was withheld: a standing "0 hidden" is what teaches a reader to stop
 *  reading the line. */
export function hiddenMatchCount(books: readonly Book[], f: LibraryFilters): number {
  if (!f.q) return 0
  const unscoped: LibraryFilters = { ...f, wishlist: true }
  return books.filter((b) => !matchesFilters(b, f) && matchesFilters(b, unscoped)).length
}

/** Ported verbatim from the prototype's libSort. */
export function sortBooks(books: readonly Book[], sort: LibrarySort): Book[] {
  const c = [...books]
  switch (sort) {
    case 'az':
      c.sort((a, b) => a.title.localeCompare(b.title))
      break
    case 'author':
      c.sort(
        (a, b) =>
          (a.last || a.title).localeCompare(b.last || b.title) || positionOf(a) - positionOf(b),
      )
      break
    case 'rating':
      c.sort((a, b) => b.rating - a.rating)
      break
    case 'intensity': {
      /*
       * Not-assessed books go LAST, by partition rather than by sentinel.
       *
       * The previous `?? -1` ranked null BELOW 0 — an arithmetic claim that an unjudged book is
       * less intense than one judged to have none. It happened to put them last, but only because
       * this comparator is descending; the same expression under an ascending sort would put every
       * unassessed book FIRST. Partitioning states the intent directly and survives a direction
       * change, and it is the same distinction matchesFilters above now draws.
       */
      const assessed: Book[] = []
      const unassessed: Book[] = []
      for (const b of c) (bookGuidance(b).intensity == null ? unassessed : assessed).push(b)
      assessed.sort(
        (a, b) => (bookGuidance(b).intensity as number) - (bookGuidance(a).intensity as number),
      )
      return [...assessed, ...unassessed]
    }
    case 'darkness': {
      /*
       * Same partition as the intensity case above, and for the same reason: not-assessed books
       * have no level to rank, so they go LAST by partition rather than by a sentinel that only
       * happens to sort correctly while this comparator is descending.
       */
      const assessed: Book[] = []
      const unassessed: Book[] = []
      for (const b of c) (bookGuidance(b).darkness == null ? unassessed : assessed).push(b)
      assessed.sort(
        (a, b) => (bookGuidance(b).darkness as number) - (bookGuidance(a).darkness as number),
      )
      return [...assessed, ...unassessed]
    }
    case 'recent':
      c.sort((a, b) => (b.addedTs || 0) - (a.addedTs || 0))
      break
    case 'series':
      c.sort(
        (a, b) =>
          (a.series || 'zzz').localeCompare(b.series || 'zzz') || positionOf(a) - positionOf(b),
      )
      break
  }
  return c
}

/** How many filters are active (drives the "(n)" badge); search box not counted. */
export function activeFilterCount(f: LibraryFilters): number {
  let n = 0
  if (f.sub !== 'All') n++
  n += f.tags.length
  if (f.status !== 'All') n++
  if (f.len !== 'Any') n++
  if (f.read !== 'All') n++
  if (f.format !== 'All') n++
  if (f.fave) n++
  if (f.intensity.length) n++
  if (f.darkness.length) n++
  if (f.author) n++
  if (f.wishlist) n++
  if (f.shelf !== 'All') n++
  return n
}

/**
 * Intensity hidden: the filter/sort state a hidden-spice reader must actually get.
 *
 * Hiding a FIELD is not the same as hiding its CONTROLS, and the difference is a real defect
 * rather than a nicety. Two pieces of library state can go on constraining what a reader sees
 * after the control that set them is gone:
 *   · `intensity: [4, 5]` keeps filtering the grid — books vanish with no visible reason and no
 *     way to clear it, because the Group that renders those chips is no longer on screen
 *   · `sort: 'intensity'` keeps ordering the grid by the hidden field, which reads as a random
 *     shuffle
 * So hiding neutralizes both. `hiddenMatchCount` and `activeFilterCount` then report honestly on
 * their own, since they read the same cleared object.
 *
 * Pure and total — it never mutates its argument, and returns it unchanged when nothing is
 * hidden, so the visible-spice path is byte-identical to the pre-toggle behaviour.
 */
export function withIntensityHidden(f: LibraryFilters, hidden: boolean): LibraryFilters {
  if (!hidden || f.intensity.length === 0) return f
  return { ...f, intensity: [] }
}

/** The sort a hidden-spice reader gets: 'intensity' is meaningless once the field is hidden. */
export function withIntensityHiddenSort(sort: LibrarySort, hidden: boolean): LibrarySort {
  return hidden && sort === 'intensity' ? 'recent' : sort
}
