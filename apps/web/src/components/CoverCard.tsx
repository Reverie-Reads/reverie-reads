import { useState } from 'react'
import {
  formatAuthors,
  bookOwnedFormats,
  isDnf,
  possessionState,
  stateSuffix,
  type Book,
} from '@reverie/core'
import { subgenreGradient } from '../library/constants'
import { useLabels } from '../skin/labels'
import { useBrokenCoverIds } from '../data/brokenCovers'
import { CoverImage } from './CoverImage'
import { StatePill } from './StatePill'

const FORMAT_ICON = { physical: '📖', ebook: '📱', audiobook: '🎧' } as const

/** A library cover card with small spice (🌶️) and favorite (♥) marks — design signature. */
export function CoverCard({
  book,
  reportCoverErrors = true,
  onOpen,
  onToggleFave,
  onAddCover,
  selected = false,
  hideIntensity = false,
  coverSize = 'thumb',
}: {
  book: Book
  reportCoverErrors?: boolean
  onOpen: () => void
  onToggleFave: () => void
  /** When set, a no-cover placeholder carries a quiet "add a cover" affordance opening the sheet. */
  onAddCover?: () => void
  /** Master-detail selection (desktop): draws the accent ring + marks aria-current. */
  selected?: boolean
  /** hide the intensity mark — the reader's profile flag, passed down (this is a leaf: no query) */
  hideIntensity?: boolean
  /** Prominent previews can ask for the provider's largest image; library grids stay economical. */
  coverSize?: 'thumb' | 'full'
}) {
  const author =
    formatAuthors(book.contributors) || [book.first, book.last].filter(Boolean).join(' ')
  const [g0, g1] = subgenreGradient(book.subgenre, book.genre)
  // The read-status slot renders Read, DNF, or nothing — the two are mutually exclusive recorded
  // statuses. DNF wins over a logged read: a book you abandoned may still carry a read-log row, and
  // wearing "Read" because of it would contradict its own recorded status (see isDnf).
  const dnf = isDnf(book)
  const isRead = !dnf && (book.readStatus === 'Read' || book.reads.length > 0)
  const labels = useLabels()
  const intensity = book.intensity ?? 0

  // The skin-accent marks (--mark-accent: Tryst gold, Aphelion cyan) keep their flavour everywhere
  // axe can't measure them or where they still clear AA: over a real cover (contrast skipped over the
  // image), always in the accent. Over a PLACEHOLDER the colour comes from --mark-on-ph — by default
  // the accent in dark mode and white in light, but the non-inverting skins (Marginalia's bond page,
  // Almanac's buff manual) keep light placeholders at night and override it to white in tokens.css.
  // Scrim deepens over placeholders to hold the text. The mark silhouette follows --mark-radius
  // (Tryst round pills · Aphelion squared instrument tags) — the two-worlds signal.
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const brokenIds = useBrokenCoverIds()
  const showsPlaceholder = !book.cover || failedCover === book.cover || brokenIds.has(book.id)
  const markInk = showsPlaceholder ? 'var(--mark-on-ph)' : 'var(--mark-accent)'
  const markBg = showsPlaceholder ? 'rgba(0,0,0,0.62)' : 'rgba(0,0,0,0.45)'
  // Possession, read through the derived word (docs/archive/task-shelf-model.md). A book NOT in hand gets
  // the ghost: the ARTWORK dims behind --ghost-opacity and the frame goes dashed. A BORROWED book is
  // in your hands — it never dims; instead it wears a solid accent ring (distinct from the ghost).
  // Title/author below and the marks keep full contrast (AA untouched). One word, not a flag test,
  // because a book that is owned AND wanted must read as owned — not as a ghost.
  const possession = possessionState(book)
  const borrowed = possession === 'borrowed'
  const ghost = possession === 'wishlist' || possession === 'unset'
  const ownedFormats = bookOwnedFormats(book)
  const frameAccent = selected
    ? { boxShadow: '0 0 0 2.5px var(--primary), var(--shadow)' }
    : ghost
      ? { borderStyle: 'dashed' as const }
      : borrowed
        ? { boxShadow: 'inset 0 0 0 2px var(--primary)' }
        : undefined

  return (
    <div className="group">
      <div
        className="skin-card relative aspect-[2/3] overflow-hidden border border-line transition-shadow motion-reduce:transition-none"
        style={frameAccent}
      >
        <button
          type="button"
          onClick={onOpen}
          // State reaches the SCREEN READER here, not only the eye. Before this the marks were
          // sibling static text and mouse-only `title` tooltips — reachable by accident at best,
          // and a grep found zero aria hits for borrowed or DNF anywhere in the app.
          aria-label={`Open ${book.title}${stateSuffix(book)}`}
          aria-current={selected ? 'true' : undefined}
          className="block h-full w-full"
          style={{ background: `linear-gradient(150deg, ${g0}, ${g1})` }}
        >
          {/* cover → skin placeholder fallback + dead-link detection (Cover Studio). The ghost dim
              lives INSIDE CoverImage so it never lands on the placeholder's type — the dashed frame
              above already carries "not in hand". */}
          <CoverImage
            onExhausted={() => setFailedCover(book.cover)}
            reportErrors={reportCoverErrors}
            book={book}
            thumb={coverSize === 'thumb'}
            ghost={ghost}
          />
        </button>

        {/* the honest placeholder invites — a quiet affordance, not a restyle (import-quality owns
            the placeholder's look). Sits above the intensity mark; opens the cover sheet. */}
        {showsPlaceholder && onAddCover && (
          <button
            type="button"
            onClick={onAddCover}
            aria-label={`Add a cover for ${book.title}`}
            className="absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold backdrop-blur"
            style={{ background: markBg, color: markInk, borderRadius: 'var(--mark-radius)' }}
          >
            + add a cover
          </button>
        )}

        <button
          type="button"
          onClick={onToggleFave}
          aria-pressed={book.fave}
          aria-label={
            book.fave ? `Remove ${book.title} from favorites` : `Add ${book.title} to favorites`
          }
          // A coarse (touch) primary pointer can't hover, so `group-hover:opacity-100` never
          // reveals this control there — an unfaved book's toggle was invisible until a stray tap
          // or keyboard focus found it (docs/audits/mobile-shelf-interaction.md Defect B).
          // `pointer-coarse:` is Tailwind's built-in variant for this repo's existing
          // `@media (pointer: coarse)` idiom (globals.css:60) — a mouse/trackpad becoming primary
          // still gets the quiet hover-reveal.
          className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center text-[14px] opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100 aria-pressed:opacity-100 pointer-coarse:opacity-100"
          style={{
            background: markBg,
            // RULED (fix/scrim-contrast-guard): white in BOTH states, not the accent when faved.
            // Over a real cover the accent inks at 1.09-2.69:1 across all 18 skin/mode combos
            // (0.45 black on white artwork composites to rgb(140,140,140)) — under the 3:1
            // non-text floor for a glyph that identifies a control's state. White reaches 3.36:1.
            // The smallest ruling available, and self-consistent: this control ALREADY renders
            // white when unfaved, so the accent only ever appeared in one of its two states. The
            // skin's flavour signal is untouched — --mark-radius still gives Tryst a round pill
            // and Aphelion a squared instrument tag. Guarded by coverOverlay.contrast.test.ts.
            color: '#fff',
            borderRadius: 'var(--mark-radius)',
          }}
        >
          {book.fave ? '♥' : '♡'}
        </button>

        {/* read-status slot: Read, DNF, or nothing. The DNF pill is SOLID (see STATE_PILL_TOKENS) —
            it has to stay legible over arbitrary cover art, which a translucent scrim does not. */}
        {dnf ? (
          <StatePill kind="dnf" className="absolute left-1.5 top-1.5" />
        ) : isRead ? (
          // Same solid plate as the other two. It was the last translucent pill on the card, and a
          // card whose other pills are correct while this one is not is the worse of both worlds.
          // `announce` because, unlike borrowed and DNF, "read" is not in the card's accessible
          // name — aria-hiding it here would remove the only channel it has.
          <StatePill kind="read" announce className="absolute left-1.5 top-1.5" />
        ) : null}

        {intensity > 0 && !hideIntensity && (
          <div
            className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 text-[10px] backdrop-blur"
            style={{ background: markBg, color: '#fff', borderRadius: 'var(--mark-radius)' }}
            title={`${labels.intensity} ${intensity}/5`}
          >
            {labels.intensityGlyph.repeat(intensity)}
          </div>
        )}

        {/* one bottom-right mark: wishlist ghost, else borrowed (with any format glyphs), else the
            plain format glyphs of a book you own. The three never collide. */}
        {possession === 'wishlist' ? (
          <span
            className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
            style={{ background: markBg, color: markInk, borderRadius: 'var(--mark-radius)' }}
          >
            ⊹ Wishlist
          </span>
        ) : borrowed ? (
          // Converted from the translucent mark to the SOLID pill. Deliberate scope: borrowed's old
          // mark measured 1.1–2.7:1 against worst-case art and was failing in production.
          <StatePill
            kind="borrowed"
            className="absolute bottom-1.5 right-1.5"
            title={ownedFormats.length ? `Borrowed: ${ownedFormats.join(', ')}` : 'Borrowed'}
          >
            {ownedFormats.map((f) => (
              <span key={f} className="font-normal">
                {FORMAT_ICON[f]}
              </span>
            ))}
          </StatePill>
        ) : ownedFormats.length > 0 ? (
          <div
            className="absolute bottom-1.5 right-1.5 flex gap-0.5 px-1 py-0.5 text-[10px] backdrop-blur"
            style={{ background: markBg, color: '#fff', borderRadius: 'var(--mark-radius)' }}
            title={`Owned: ${ownedFormats.join(', ')}`}
          >
            {ownedFormats.map((f) => (
              <span key={f}>{FORMAT_ICON[f]}</span>
            ))}
          </div>
        ) : null}
      </div>

      <button type="button" onClick={onOpen} className="mt-2.5 block w-full text-left">
        <div className="break-words text-[12.5px] font-semibold leading-5 text-ink">
          {book.title}
        </div>
        {author ? (
          <div className="break-words text-[11.5px] leading-5 text-muted">{author}</div>
        ) : null}
      </button>
    </div>
  )
}
