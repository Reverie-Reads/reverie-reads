import type { Book } from './types'
import { isBookRead } from './filters'
import { isPossessed } from './ownership'

export type NextReadScope = 'available' | 'wishlist' | 'library'

export interface NextReadOptions {
  scope?: NextReadScope
  includeRereads?: boolean
  includeDnf?: boolean
}

/** Candidate scope is independent of the full library used to learn taste and series progress. */
export function nextReadCandidates(
  books: readonly Book[],
  { scope = 'available', includeRereads = false, includeDnf = false }: NextReadOptions = {},
): Book[] {
  return books.filter((book) => {
    if (scope === 'available' && !isPossessed(book)) return false
    if (scope === 'wishlist' && !book.wishlist) return false
    if (book.readStatus === 'Reading') return false
    // An abandoned reread needs both deliberate choices; DNF alone never invites it back.
    if (book.readStatus === 'DNF' && !includeDnf) return false
    return includeRereads || !isBookRead(book)
  })
}

/** An Unread book with a retained place was explicitly set aside and can be resumed. */
export function hasPausedReadingProgress(book: Pick<Book, 'readStatus' | 'progress'>): boolean {
  return book.readStatus === 'Unread' && book.progress > 0
}

/** Start or resume an active read without changing the reader's copies or completed history. */
export function beginReadingPatch(book: Book): Partial<Book> {
  // "Set it aside" changes an active read to Unread while deliberately retaining its place.
  // A previous completed read must not turn that resume into a new reread and erase the retained
  // position. A completed 100% book still starts a deliberate reread at zero.
  const hasPausedPlace = hasPausedReadingProgress(book)
  return {
    readStatus: 'Reading',
    readingNowHidden: false,
    progress:
      book.readStatus !== 'Reading' &&
      book.readStatus !== 'DNF' &&
      isBookRead(book) &&
      !hasPausedPlace
        ? 0
        : book.progress,
  }
}
