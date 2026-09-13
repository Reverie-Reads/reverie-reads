import { Link } from '@tanstack/react-router'
import {
  formatAuthors,
  bookOwnedFormats,
  possessionState,
  seriesStatusBadge,
  type Book,
} from '@reverie/core'
import { subgenreGradient } from '../library/constants'
import { useLabels, useVoice } from '../skin/labels'
import { useHideIntensity } from '../data/profile'
import { Chip } from './Chip'
import { CoverImage } from './CoverImage'
import { Nameplate } from './Nameplate'
import { useBookTour, useBookTourObservation } from '../guidance/BookTourContext'

const FORMAT_ICON = { physical: '📖', ebook: '📱', audiobook: '🎧' } as const
const FORMAT_LABEL = { physical: 'Physical', ebook: 'Ebook', audiobook: 'Audiobook' } as const

/** The master-detail right rail: a read-only summary of the selected book with a link into the
 *  full book page for editing. Renders an invitation when nothing is selected. */
export function BookDetailRail({
  book,
  onToggleFave,
}: {
  book: Book | null
  onToggleFave?: (id: string) => void
}) {
  const labels = useLabels()
  const voice = useVoice()
  // Above the `if (!book)` early return below — rules-of-hooks.
  const hideIntensity = useHideIntensity()
  const { state: bookTour } = useBookTour()
  useBookTourObservation(book ? 'opened' : null, book?.id)

  if (!book) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center text-muted">
        <span aria-hidden className="text-[28px] opacity-50">
          ✶
        </span>
        <p className="mt-3 text-[13px]">Select a book to see its details.</p>
      </div>
    )
  }

  const author =
    formatAuthors(book.contributors) || [book.first, book.last].filter(Boolean).join(' ')
  const [g0, g1] = subgenreGradient(book.subgenre, book.genre)
  const isRead = book.readStatus === 'Read' || book.reads.length > 0
  const intensity = book.intensity ?? 0
  const owned = bookOwnedFormats(book)
  const possession = possessionState(book)
  const borrowed = possession === 'borrowed'

  return (
    <div
      className="flex h-full flex-col overflow-y-auto px-4 py-5"
      data-book-tour={book.id === bookTour.bookId ? 'tour-opened-book' : undefined}
      tabIndex={-1}
    >
      <div
        className="mx-auto aspect-[2/3] w-36 overflow-hidden rounded-xl border border-line"
        style={{ background: `linear-gradient(150deg, ${g0}, ${g1})` }}
      >
        <CoverImage book={book} />
      </div>

      <Nameplate
        className="mt-4"
        eyebrow={
          book.series
            ? `${book.series}${book.position !== '' ? ` · #${book.position}` : ''}`
            : undefined
        }
        title={book.title}
        subtitle={author || undefined}
      />

      <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        <span
          className="skin-control px-2.5 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--chip)', color: 'var(--muted)' }}
        >
          {seriesStatusBadge(book)}
        </span>
        {isRead && (
          <span
            className="skin-control px-2.5 py-1 text-[11px] font-semibold"
            style={{
              background: 'color-mix(in srgb, var(--gold) 18%, transparent)',
              color: 'var(--ink)',
            }}
          >
            Read
          </span>
        )}
        {intensity > 0 && !hideIntensity && (
          <span
            className="skin-control px-2.5 py-1 text-[11px] font-semibold"
            style={{
              background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
              color: 'var(--ink)',
            }}
            title={`${labels.intensity} ${intensity}/5`}
          >
            {labels.intensityGlyph.repeat(intensity)}
          </span>
        )}
        {onToggleFave && (
          <button
            type="button"
            onClick={() => onToggleFave(book.id)}
            aria-pressed={book.fave}
            aria-label={book.fave ? 'Remove from favorites' : 'Add to favorites'}
            className="skin-control border border-line px-2.5 py-1 text-[12px]"
            style={{ background: 'var(--chip)', color: book.fave ? 'var(--gold)' : 'var(--muted)' }}
          >
            {book.fave ? '♥' : '♡'}
          </button>
        )}
      </div>

      {book.tropes.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
            {labels.tags}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {book.tropes.slice(0, 5).map((t) => (
              <Chip key={t.id}>{t.emphasis === 'pinned' ? `♥ ${t.name}` : t.name}</Chip>
            ))}
            {book.tropes.length > 5 && <Chip>+{book.tropes.length - 5}</Chip>}
          </div>
        </div>
      )}

      {/* Read-only here like the rest of the rail — the ownership CONTROL lives on the full page. */}
      {possession === 'wishlist' && (
        <div className="mt-4">
          <span
            className="inline-flex items-center gap-1 skin-control border border-dashed border-line px-2.5 py-1 text-[12px] font-semibold text-muted"
            style={{ background: 'var(--chip)' }}
          >
            ⊹ Wishlist — not owned yet
          </span>
        </div>
      )}
      {borrowed && (
        <div className="mt-4">
          <span
            className="inline-flex items-center gap-1 skin-control border border-line px-2.5 py-1 text-[12px] font-semibold text-ink"
            style={{ background: 'var(--chip)' }}
          >
            ⇄ Borrowed — in hand, not owned
          </span>
        </div>
      )}

      {owned.length > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
            {borrowed ? 'Borrowed' : 'Owned'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {owned.map((f) => (
              <span
                key={f}
                className="flex items-center gap-1 skin-control px-2.5 py-1 text-[12px] font-semibold text-ink"
                style={{ background: 'var(--chip)' }}
              >
                <span aria-hidden>{FORMAT_ICON[f]}</span> {FORMAT_LABEL[f]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* The RESUME line — every composed rail speaks one when a book is mid-read (chunk 4,
          verdict-approved): "You left off — the lamps are still lit." / "THE TRAIL IS STILL WARM." */}
      {book.readStatus === 'Reading' && (
        <p
          className="mt-auto pt-4 text-[13px] italic text-muted"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {voice.resume}
        </p>
      )}

      <Link
        to="/book/$bookId"
        params={{ bookId: book.id }}
        className={`${book.readStatus === 'Reading' ? 'mt-2' : 'mt-auto'} flex h-11 items-center justify-center skin-control text-[13.5px] font-semibold`}
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--gold))',
          color: 'var(--on-primary)',
        }}
      >
        Open full page
      </Link>
    </div>
  )
}
