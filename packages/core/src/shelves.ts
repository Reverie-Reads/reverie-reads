import type { Book } from './types'
import { isOwnedBook, isWanted, ownedFormats, type OwnedFormat } from './ownership'
import { hasReadingHistory, isBookRead } from './filters'
import { isDnf } from './statePill'

// The derived shelves (docs/task-shelf-views.md — B2 of the shelf redesign).
//
// EVERY SHELF IS A VIEW, never a stored membership. Nothing here writes; nothing here is a list a
// reader can add to or remove from. A book's flags decide where it appears, and it appears
// everywhere its flags say — a book both owned and wanted sits on Owned AND Wishlist, exactly as a
// book both owned and borrowed sits on Owned AND Borrowed. That is the point of a model whose
// possession signals are independent flags rather than one enum slot: shelves are not a partition
// and the UI must not imply they are.

/** One derived shelf. `key` is stable; the app owns every string a reader sees. */
export type ShelfKey =
  | 'owned'
  | 'ownedPhysical'
  | 'ownedEbook'
  | 'ownedAudiobook'
  | 'ownedUnmarked'
  | 'borrowed'
  | 'read'
  | 'dnf'
  | 'wishlist'

/** The four groups, in render order. Owned and Read carry a breakdown toggle; the others do not. */
export type ShelfSectionKey = 'owned' | 'borrowed' | 'read' | 'wishlist'

export interface DerivedShelf {
  key: ShelfKey
  books: Book[]
}

export interface DerivedSection {
  key: ShelfSectionKey
  shelves: DerivedShelf[]
  /**
   * Whether this section's breakdown toggle is ON — decided at DERIVATION, never inferred from how
   * many shelves survived the empty filter.
   *
   * The difference is not cosmetic. With the DNF split on and nothing finished, the Read section
   * collapses to a single visible shelf: the DNF one. Reading "is this split?" from the surviving
   * count would then say no, drop the shelf's own label, and file abandoned books under a heading
   * that reads "Read" — the exact mislabelling the split exists to prevent.
   */
  split: boolean
}

export interface ShelfBreakdowns {
  /** split Owned into physical / ebook / audiobook (+ the unmarked bucket) */
  format: boolean
  /** split DNF out of Read onto its own shelf */
  dnf: boolean
}

const FORMAT_SHELF: Record<OwnedFormat, ShelfKey> = {
  physical: 'ownedPhysical',
  ebook: 'ownedEbook',
  audiobook: 'ownedAudiobook',
}

/**
 * Owned in a specific format.
 *
 * OWNED-ONLY, deliberately — `isOwnedBook`, not `isPossessed`. A shelf named "Owned · Ebook" that
 * contains a library loan is telling the reader something false, and borrowed copies already have
 * a shelf of their own, so including them here would also show one book twice for one reason.
 * `bookOwnedFormats` keeps its `isPossessed` gate for cards and the detail screen: those answer
 * "which formats do you have in hand", which is a different question and still the right one there.
 */
function ownedShelfFormats(b: Book): OwnedFormat[] {
  if (!b.copyInventory) return ownedFormats(b.owned)
  const ownedIds = new Set(
    b.copyInventory.copies.filter((copy) => copy.state === 'owned').map((copy) => copy.editionId),
  )
  const formats = new Set<OwnedFormat>()
  for (const edition of b.copyInventory.editions) {
    if (!ownedIds.has(edition.id) || edition.format === 'unknown') continue
    formats.add(
      edition.format === 'ebook' || edition.format === 'audiobook' ? edition.format : 'physical',
    )
  }
  return [...formats]
}
export const onFormatShelf = (b: Book, fmt: OwnedFormat): boolean =>
  isOwnedBook(b) && ownedShelfFormats(b).includes(fmt)

/**
 * Owned, with no format recorded.
 *
 * The bucket exists because the data demands it: in production 528 of 536 owned books carry no
 * format flag at all. Without it, turning the format breakdown on would drop 98% of a reader's
 * owned books out of their own shelf — not moved somewhere else, simply gone from the view that
 * answers "what do I own". The split is only honest if everything owned lands somewhere.
 */
export const onUnmarkedShelf = (b: Book): boolean =>
  isOwnedBook(b) && ownedShelfFormats(b).length === 0

/**
 * The Read shelf when DNF is NOT split out: anything the reader has engaged with, abandoned books
 * included. This is `hasReadingHistory` verbatim — the predicate stage A created for exactly this,
 * so that DNF affects VISIBILITY without ever counting as read.
 */
export const onReadShelfMixed = (b: Book): boolean => hasReadingHistory(b)

/**
 * The Read shelf when DNF IS split out: finished, and not abandoned.
 *
 * The `!isDnf` guard is load-bearing, not defensive. `isBookRead` counts a logged read as proof of
 * finishing, and a DNF book can carry one — you read part of it and logged the attempt. Without the
 * guard that book appears on BOTH Read and DNF, while its cover wears a DNF pill, because the pill
 * layer already ruled that the recorded status wins. Production has zero such books, so nothing
 * would catch this organically; it needs a fixture, and it has one.
 *
 * `isBookRead` itself is untouched and must stay so: it feeds series progress, the taste profile,
 * the matcher and the reading stats, where an abandoned book must not count as read.
 */
export const onReadShelfSplit = (b: Book): boolean => isBookRead(b) && !isDnf(b)

/** Books on hand but not owned. Independent of ownership — a book can be both. */
export const onBorrowedShelf = (b: Book): boolean => b.borrowed

/** Books wanted. Independent of ownership — owning one edition and wanting another is legal. */
export const onWishlistShelf = (b: Book): boolean => isWanted(b)

/**
 * Derive every shelf, in render order, for a library and a pair of breakdown toggles.
 *
 * Empty shelves are RETAINED here and dropped by the caller: the rule for what a reader sees is a
 * display decision (a shelf with nothing in it is noise), while a caller counting or testing wants
 * the full shape. `visibleSections` applies the display rule.
 */
export function deriveShelfSections(
  books: readonly Book[],
  breakdowns: ShelfBreakdowns,
): DerivedSection[] {
  const pick = (p: (b: Book) => boolean): Book[] => books.filter(p)

  const ownedShelves: DerivedShelf[] = breakdowns.format
    ? [
        ...(['physical', 'ebook', 'audiobook'] as const).map((fmt) => ({
          key: FORMAT_SHELF[fmt],
          books: pick((b) => onFormatShelf(b, fmt)),
        })),
        { key: 'ownedUnmarked' as const, books: pick(onUnmarkedShelf) },
      ]
    : [{ key: 'owned' as const, books: pick(isOwnedBook) }]

  const readShelves: DerivedShelf[] = breakdowns.dnf
    ? [
        { key: 'read' as const, books: pick(onReadShelfSplit) },
        { key: 'dnf' as const, books: pick(isDnf) },
      ]
    : [{ key: 'read' as const, books: pick(onReadShelfMixed) }]

  return [
    { key: 'owned', shelves: ownedShelves, split: breakdowns.format },
    { key: 'borrowed', shelves: [{ key: 'borrowed', books: pick(onBorrowedShelf) }], split: false },
    { key: 'read', shelves: readShelves, split: breakdowns.dnf },
    { key: 'wishlist', shelves: [{ key: 'wishlist', books: pick(onWishlistShelf) }], split: false },
  ]
}

/**
 * What actually renders: shelves with no books are dropped, and a section left with no shelves is
 * dropped with them. An empty result means the whole group collapses to one empty state rather
 * than repeating the same invitation once per shelf — which is what the old screen did, three
 * times over, on a library with no format flags.
 */
export function visibleSections(sections: readonly DerivedSection[]): DerivedSection[] {
  return sections
    .map((s) => ({ ...s, shelves: s.shelves.filter((sh) => sh.books.length > 0) }))
    .filter((s) => s.shelves.length > 0)
}
