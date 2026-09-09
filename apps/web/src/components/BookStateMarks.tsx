import {
  STATE_PILL_TOKENS,
  isBorrowedBook,
  isDnf,
  type Book,
  type StatePillKind,
} from '@reverie/core'
import { StatePill } from './StatePill'

type StateBook = Pick<Book, 'readStatus' | 'reads' | 'ownership' | 'borrowed' | 'wishlist'>

function CompactStateMark({ kind }: { kind: 'dnf' | 'borrowed' }) {
  const label = kind === 'dnf' ? 'Did not finish' : 'Borrowed'
  return (
    <span
      aria-hidden="true"
      data-over-art=""
      data-state-marker={kind}
      title={label}
      className={`absolute grid h-[18px] w-[18px] place-items-center shadow-sm ${
        kind === 'dnf' ? 'left-1 top-1' : 'bottom-1 right-1'
      }`}
      style={{
        background: STATE_PILL_TOKENS.surface,
        color: STATE_PILL_TOKENS.accent,
        borderRadius: STATE_PILL_TOKENS.radius,
      }}
    >
      <svg
        viewBox="0 0 16 16"
        width="14"
        height="14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {kind === 'dnf' ? (
          <>
            <circle cx="8" cy="8" r="4.75" />
            <path d="M4.5 11.5 11.5 4.5" />
          </>
        ) : (
          <>
            <path d="M3 5.25h9M9.5 2.75 12 5.25 9.5 7.75" />
            <path d="M13 10.75H4M6.5 8.25 4 10.75l2.5 2.5" />
          </>
        )}
      </svg>
    </span>
  )
}

/**
 * The shared browsing marks for cover grids and true thumbnails.
 *
 * Cover-sized tiles reuse StatePill word-for-word with the Library. A 36–48px thumbnail cannot
 * hold those words without hiding the cover, so it receives the same two shapes on 18px solid
 * plates. The enclosing control owns the accessible name; these marks are visual finders only.
 */
export function BookStateMarks({
  book,
  density = 'cover',
  showRead = false,
}: {
  book: StateBook
  density?: 'cover' | 'thumb'
  /** Cover grids can show the existing Read pill; narrow thumbnails stay quiet for ordinary reads. */
  showRead?: boolean
}) {
  const dnf = isDnf(book)
  const readKind: StatePillKind | null = dnf
    ? 'dnf'
    : showRead && (book.readStatus === 'Read' || book.reads.length > 0)
      ? 'read'
      : null
  const borrowed = isBorrowedBook(book)

  if (density === 'thumb') {
    return (
      <>
        {dnf && <CompactStateMark kind="dnf" />}
        {borrowed && <CompactStateMark kind="borrowed" />}
      </>
    )
  }

  return (
    <>
      {readKind && <StatePill kind={readKind} className="absolute left-1.5 top-1.5" />}
      {borrowed && <StatePill kind="borrowed" className="absolute bottom-1.5 right-1.5" />}
    </>
  )
}
