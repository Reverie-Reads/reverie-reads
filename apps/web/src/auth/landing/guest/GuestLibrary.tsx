import { useEffect, useId, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  SKINS,
  isBookRead,
  nextReadCandidates,
  type NextReadScope,
  type ResolvedMode,
  type SkinId,
} from '@reverie/core'
import { CoverCard } from '../../../components/CoverCard'
import { CoverImage } from '../../../components/CoverImage'
import { NavigationGlyph } from '../../../components/NavigationGlyph'
import type { NavigationIconName } from '../../../components/navigation'
import { NextReadCardView } from '../../../components/NextReadCardView'
import { Stars } from '../../../components/Stars'
import { useGuestLibrary } from './context'
import { GuestAddBooks } from './GuestAddBooks'
import { GuestBookDetail } from './GuestBookDetail'
import { GuestConfigure } from './GuestConfigure'
import { GUEST_VIEWS, type GuestView } from './state'
import { createGuestHandoff, saveGuestHandoff, summarizeGuestHandoff } from './handoff'
import { field, primary, quiet } from './styles'

const icons: Record<GuestView, NavigationIconName> = {
  library: 'library',
  reading: 'home',
  next: 'match',
  history: 'planner',
}

function focusHeading(heading: HTMLHeadingElement | null) {
  // Announce the new internal view without moving the surrounding landing page. On a phone only,
  // bring a genuinely offscreen destination back into view; this keeps long, tapped lists usable
  // without pulling either desktop demo under the sticky header on every action.
  heading?.focus({ preventScroll: true })
  if (!heading || !window.matchMedia('(max-width: 480px)').matches) return
  window.requestAnimationFrame(() => {
    if (!heading.isConnected) return
    const bounds = heading.getBoundingClientRect()
    if (bounds.top < 0 || bounds.bottom > window.innerHeight)
      heading.scrollIntoView({ block: 'start', behavior: 'instant' })
  })
}

/** The public library has real state and shared app controls. It persists only after the visitor
 * explicitly asks to carry it into an account. */
export function GuestLibrary({
  compact = false,
  skin,
  mode,
}: {
  compact?: boolean
  skin: SkinId
  mode: ResolvedMode
}) {
  const navigate = useNavigate()
  const { state, dispatch } = useGuestLibrary()
  const [scope, setScope] = useState<NextReadScope>('available')
  const [rereads, setRereads] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [handoffError, setHandoffError] = useState(false)
  const [pagination, setPagination] = useState({ key: '', index: 0 })
  const heading = useRef<HTMLHeadingElement>(null)
  const focusAfterChange = useRef(false)
  const headingId = useId()
  const book = state.books.find((item) => item.id === state.selected)
  const title = book
    ? 'Book details'
    : state.page === 'add'
      ? 'Add to your library'
      : state.page === 'configure'
        ? 'Arrange your dock'
        : GUEST_VIEWS[state.page]
  useEffect(() => {
    if (focusAfterChange.current) {
      focusHeading(heading.current)
      focusAfterChange.current = false
    }
  }, [state.page, state.selected])
  const shown =
    state.page === 'reading'
      ? state.books.filter((item) => item.readStatus === 'Reading')
      : state.books
  const candidates = nextReadCandidates(state.books, { scope, includeRereads: rereads })
  const currentRead = state.books.find((item) => item.readStatus === 'Reading')
  const history = state.books
    .flatMap((item) => item.reads.map((read, index) => ({ book: item, read, index })))
    .sort((a, b) => b.read.date.localeCompare(a.read.date) || b.index - a.index)
  const paged = !book && ['library', 'reading', 'next', 'history'].includes(state.page)
  const total =
    state.page === 'next'
      ? candidates.length
      : state.page === 'history'
        ? history.length
        : shown.length
  const pageSize = compact ? (state.page === 'next' ? 2 : 4) : state.page === 'next' ? 4 : 12
  const pageKey = `${state.page}-${state.books.length}-${scope}-${rereads}-${total}`
  const pageIndex =
    pagination.key === pageKey
      ? Math.min(pagination.index, Math.max(0, Math.ceil(total / pageSize) - 1))
      : 0
  const from = pageIndex * pageSize
  const handoff = createGuestHandoff(state, { skin, mode })
  const handoffSummary = summarizeGuestHandoff(handoff)
  return (
    <section
      id={compact ? 'try-next-read' : 'try-library'}
      aria-label={compact ? 'Your guest library' : 'Try your library'}
      data-testid={compact ? 'guest-library-compact' : 'guest-library-full'}
      className={`min-w-0 scroll-mt-24 text-ink ${compact ? 'guest-library-compact-viewport' : ''}`}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) focusAfterChange.current = false
      }}
      onClickCapture={() => {
        focusAfterChange.current = true
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted">
            Your guest library
          </p>
          <p className="mt-1 text-sm text-muted">
            {state.books.length} books · A little room to try
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={primary}
            onClick={() => dispatch({ type: 'navigate', page: 'add' })}
          >
            Add books
          </button>
          <button
            type="button"
            className={quiet}
            onClick={() => dispatch({ type: 'navigate', page: 'configure' })}
          >
            Arrange dock
          </button>
        </div>
      </div>
      <p className="my-4 text-sm leading-relaxed text-muted">
        Open a book. Make it yours. It stays on this page until you refresh; choose “Keep this
        library” when you want to carry it into an account.
      </p>
      <nav
        aria-label="Guest library dock"
        className="skin-panel mb-5 flex flex-wrap gap-1 border border-line bg-[color:var(--card-solid)] p-1.5"
      >
        {state.dock.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => dispatch({ type: 'navigate', page: id })}
            aria-current={state.page === id && !book ? 'page' : undefined}
            className={`skin-control flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-semibold leading-snug sm:flex-row sm:gap-2 sm:px-2 sm:text-sm ${state.page === id && !book ? 'skin-btn-primary' : 'text-ink'}`}
          >
            <NavigationGlyph name={icons[id]} className="h-5 w-5 shrink-0" />
            <span className="min-w-0 break-words">{GUEST_VIEWS[id]}</span>
          </button>
        ))}
      </nav>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3
          id={headingId}
          ref={heading}
          tabIndex={-1}
          className="scroll-mt-24 text-2xl font-semibold leading-[1.3]"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {title}
        </h3>
        {(book || state.page === 'add' || state.page === 'configure') && (
          <button
            type="button"
            className={quiet}
            onClick={() => dispatch({ type: 'navigate', page: 'library' })}
          >
            Back to library
          </button>
        )}
      </div>
      <div className="min-h-48" aria-labelledby={headingId}>
        {book ? (
          <GuestBookDetail key={book.id} book={book} />
        ) : state.page === 'add' ? (
          <GuestAddBooks />
        ) : state.page === 'configure' ? (
          <GuestConfigure />
        ) : state.page === 'next' ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted">
              A place to start from the books you’ve added. These sample picks use your copy and
              reading status; mood matching in the full app goes further.
            </p>
            <label className="block text-sm font-semibold">
              Choose from
              <select
                className={field}
                value={scope}
                onChange={(e) => setScope(e.target.value as NextReadScope)}
              >
                <option value="available">Books I own or have borrowed</option>
                <option value="wishlist">My wishlist</option>
                <option value="library">My whole library</option>
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={rereads}
                onChange={(e) => setRereads(e.target.checked)}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              Include rereads
            </label>
            <div className={compact ? 'space-y-3' : 'grid gap-3 md:grid-cols-2'}>
              {candidates.slice(from, from + pageSize).map((item) => (
                <NextReadCardView
                  key={item.id}
                  book={item}
                  reportCoverErrors={false}
                  isRead={isBookRead(item)}
                  reason={
                    state.saved.includes(item.id)
                      ? 'You saved this one for later.'
                      : scope === 'available'
                        ? 'Already in your hands, ready when you are.'
                        : scope === 'wishlist'
                          ? 'A book you’ve been meaning to bring home.'
                          : 'An unread possibility from your guest library.'
                  }
                  onOpen={() => dispatch({ type: 'select', id: item.id })}
                  onStart={() => dispatch({ type: 'start', id: item.id })}
                  onSave={() => dispatch({ type: 'later', id: item.id })}
                />
              ))}
            </div>
            {!candidates.length && (
              <p className="text-sm leading-relaxed text-muted">
                No books fit this selection yet. Add a book, record a copy you own or borrow, or
                include rereads.
              </p>
            )}
          </div>
        ) : state.page === 'history' ? (
          <div className="space-y-3">
            {!history.length && (
              <div className="skin-card border border-line bg-[color:var(--card-solid)] p-5">
                <p className="text-sm leading-relaxed">
                  Your reading journal begins with a finished book.{' '}
                  {currentRead
                    ? `${currentRead.title} is already underway; open it, leave a note, and finish the read.`
                    : 'Choose a book in Next read, then keep a note as you go.'}
                </p>
                <button
                  type="button"
                  className={`${quiet} mt-4`}
                  onClick={() => dispatch({ type: 'navigate', page: 'reading' })}
                >
                  Go to Reading now
                </button>
              </div>
            )}
            {history.slice(from, from + pageSize).map(({ book: item, read, index }) => (
              <article
                key={`${item.id}-${index}`}
                aria-label={`${item.title}, read ${index + 1}`}
                className="skin-card border border-line bg-[color:var(--card-solid)] p-4"
              >
                <button
                  type="button"
                  className="flex min-h-11 w-full items-start gap-3 text-left"
                  onClick={() => dispatch({ type: 'select', id: item.id })}
                >
                  <span className="aspect-[2/3] w-12 shrink-0 overflow-hidden">
                    <CoverImage book={item} reportErrors={false} thumb />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-semibold leading-relaxed">{item.title}</span>
                    <span className="mt-1 block text-sm text-muted">
                      {read.date || 'Date not recorded'}
                      {read.format ? ` · ${read.format}` : ''}
                    </span>
                  </span>
                </button>
                {read.rating > 0 && (
                  <div className="mt-3">
                    <Stars value={read.rating} size={16} />
                  </div>
                )}
                <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {read.notes || 'No note on this read.'}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <>
            {!shown.length && (
              <div className="space-y-3 text-sm leading-relaxed">
                <p>
                  {state.page === 'reading'
                    ? 'Nothing underway yet. Find a book for right now in Next read.'
                    : 'A shelf ready for your books. Add a title to make a start.'}
                </p>
                <button
                  type="button"
                  className={primary}
                  onClick={() =>
                    dispatch({ type: 'navigate', page: state.page === 'reading' ? 'next' : 'add' })
                  }
                >
                  {state.page === 'reading' ? 'Find my next read' : 'Add a book'}
                </button>
              </div>
            )}
            <div
              className={
                compact
                  ? 'mx-auto grid max-w-[330px] grid-cols-2 gap-4'
                  : 'grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-4'
              }
            >
              {shown.slice(from, from + pageSize).map((item) => (
                <div key={item.id} className="min-w-0">
                  <CoverCard
                    book={item}
                    coverSize="full"
                    hideIntensity
                    reportCoverErrors={false}
                    onOpen={() => dispatch({ type: 'select', id: item.id })}
                    onToggleFave={() => dispatch({ type: 'favorite', id: item.id })}
                  />
                  {item.readStatus === 'Reading' && (
                    <div className="mt-2">
                      <div className="h-1 overflow-hidden bg-[color:var(--field)]">
                        <div
                          className="h-full bg-[color:var(--primary)]"
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted">Reading · {item.progress}%</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {paged && total > pageSize && (
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-2"
          role="group"
          aria-label="Guest library pages"
        >
          <span className="text-sm text-muted">
            {from + 1}–{Math.min(from + pageSize, total)} of {total}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className={quiet}
              disabled={pageIndex === 0}
              onClick={() => {
                setPagination({ key: pageKey, index: pageIndex - 1 })
                focusHeading(heading.current)
              }}
            >
              Previous books
            </button>
            <button
              type="button"
              className={quiet}
              disabled={from + pageSize >= total}
              onClick={() => {
                setPagination({ key: pageKey, index: pageIndex + 1 })
                focusHeading(heading.current)
              }}
            >
              Next books
            </button>
          </div>
        </div>
      )}
      <div className="mt-6 space-y-3 border-t border-line pt-4">
        <p className="text-sm leading-relaxed text-muted" data-testid="guest-notice">
          {state.notice}
        </p>
        {handoffOpen ? (
          <div
            className="skin-card space-y-3 border border-line bg-[color:var(--card-solid)] p-4"
            aria-labelledby={`${headingId}-handoff`}
          >
            <h4
              id={`${headingId}-handoff`}
              className="text-xl font-semibold leading-snug text-ink"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Keep this little library?
            </h4>
            <p className="text-sm leading-relaxed text-muted">
              Reverie will hold a private copy in this browser for seven days, then ask before
              adding anything to your account.
            </p>
            <ul className="grid grid-cols-2 gap-2 text-sm text-ink sm:grid-cols-3">
              <li>{handoffSummary.books} books</li>
              <li>{handoffSummary.activeReads} in progress</li>
              <li>{handoffSummary.completedReads} finished reads</li>
              <li>{handoffSummary.readingNotes} journal notes</li>
              <li>{SKINS[skin].label} room</li>
            </ul>
            {handoffSummary.draftNotes > 0 && (
              <p className="text-sm leading-relaxed text-ink">
                {handoffSummary.draftNotes} unfinished{' '}
                {handoffSummary.draftNotes === 1 ? 'note has' : 'notes have'} no reading-record home
                yet. Reverie will keep the text in this browser and show it during review, but will
                not turn it into a finished read.
              </p>
            )}
            <p className="text-xs leading-relaxed text-muted">
              Your room carries over. The dock remains a preview while modular app layouts are being
              designed.
            </p>
            {handoffError && (
              <p role="alert" className="text-sm text-ink">
                This browser would not let Reverie hold the transfer. Your guest library is still
                here on this page.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primary}
                onClick={() => {
                  setHandoffError(false)
                  if (!saveGuestHandoff(handoff)) {
                    setHandoffError(true)
                    return
                  }
                  void navigate({
                    to: '/auth',
                    search: { mode: 'signup', guest: true },
                  })
                }}
              >
                Continue to my account
              </button>
              <button type="button" className={quiet} onClick={() => setHandoffOpen(false)}>
                Not yet
              </button>
            </div>
          </div>
        ) : resetting ? (
          <div className="space-y-2">
            <p className="text-sm">
              Reset this guest library? Your additions and notes will be cleared.
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={quiet} onClick={() => setResetting(false)}>
                Keep exploring
              </button>
              <button
                type="button"
                className={primary}
                onClick={() => {
                  dispatch({ type: 'reset' })
                  setResetting(false)
                }}
              >
                Reset guest library
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} onClick={() => setHandoffOpen(true)}>
              Keep this library
            </button>
            <button type="button" className={quiet} onClick={() => setResetting(true)}>
              Start over
            </button>
          </div>
        )}
        {compact && (
          <a
            className="flex min-h-11 items-center text-sm font-semibold underline underline-offset-4"
            href="#skins"
          >
            Try nine rooms with these books ↓
          </a>
        )}
      </div>
    </section>
  )
}
