import { useMemo, useState, type ReactNode } from 'react'
import { Link, createRoute, useNavigate } from '@tanstack/react-router'
import {
  authorOf,
  beginReadingPatch,
  isBookRead,
  bookGenres,
  bookSubgenres,
  CORE_GENRES,
  buildBuyLinks,
  buyDisclosure,
  isAuthorRole,
  seriesStatusBadge,
  ROLE_LABELS,
  type Book,
  possessionPatch,
  possessionState,
  type PossessionState,
  type Owned,
  formatPartialDate,
  hasPausedReadingProgress,
  latestRatingByFormat,
} from '@reverie/core'
import { useFilters } from '../library/filterStore'
import { buyConfig } from '../lib/buyConfig'
import { useLabels, useVoice } from '../skin/labels'
import { rootRoute } from '../routes/RootRoute'
import { BackLink } from '../components/BackLink'
import { SeriesStrip } from '../components/SeriesStrip'
import { CoverImage } from '../components/CoverImage'
import { useBooks, useDeleteBook, useUpdateBook } from '../data/books'
import {
  useAdoptCorpusWorkMetadata,
  useAddPersonalBookToHousehold,
  useHouseholdLibraryAuthorization,
  useRemovePersonalBookFromHousehold,
} from '../data/household'
import { useDeleteRead, useReads } from '../data/reads'
import { useBookListIds, useToggleListItem } from '../data/listItems'
import { useCreateList, useLists } from '../data/lists'
import { LevelGuideCard } from '../components/LevelGuideCard'
import { Stars } from '../components/Stars'
import { Chip } from '../components/Chip'
import { READ_STATUS_OPTIONS, readStatusLabel, subgenreGradient } from '../library/constants'
import { maybeChainPrompt } from '../lib/chainPrompt'
import { EditDetails, LogReadForm, MergeDialog } from './dialogs'
import { PlanEditor } from './PlanEditor'
import { TropePicker } from '../components/TropePicker'
import { TropeChip } from '../components/TropeChip'
import { MoodChip } from '../components/MoodChip'
import { MoodPicker } from '../components/MoodPicker'
import { Modal } from '../components/Modal'
import { CoverSheet } from '../components/CoverSheet'
import { useCoverBackfill } from '../data/coverBackfill'
import { OwnedCopies } from './OwnedCopies'
import { ReviewsPanel } from './ReviewsPanel'
import { MoreLikeThis } from './MoreLikeThis'
import { workKeyFor } from '../data/reviews'
import { useProfile } from '../data/profile'
import { BookmarkGlyph } from '../components/BookmarkGlyph'
import { Surface } from '../components/Surface'
import { sharedCorpusDetailsDiffer } from './sharedCorpusDetails'
import { CorpusCoverReviewToggle } from '../components/CorpusCoverReviewToggle'
import { ReadingProgressDialog } from '../components/ReadingProgress'
import { ProgressMeter } from '../components/Structure'
import {
  useAdminReviewPersonalCoverForCorpus,
  useCorpusAdminStatus,
  usePersonalCoverCorpusReview,
} from '../data/enrichCorpus'

function fmtDate(d: string): string {
  if (!d) return 'Date not set'
  return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function Label({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-6 flex items-center justify-between">
      <span className="text-[11px] uppercase tracking-[0.2em] text-muted">{children}</span>
      {action}
    </div>
  )
}

/**
 * WHICH LEVEL PILLS SHOW — the two gating rules, as one testable function rather than two inline
 * conditions in JSX where neither can be asserted without rendering the whole route.
 *
 * They differ, and the difference is the thing most likely to be "tidied" into a single condition:
 *
 *   · `> 0` for BOTH axes. NULL means NOT ASSESSED, 0 means ASSESSED AND FOUND TO HAVE NONE
 *     (#326's ruling), and neither is a claim worth a pill. `books.darkness` is NULL across
 *     essentially the whole library today, so darkness is absent from nearly every book — the rule
 *     working, not a missing feature.
 *   · `hideIntensity` gates SPICE ONLY. It is the spice-hiding preference; darkness is a separate
 *     axis and a reader who hid spice has said nothing about it. Gating both on one flag would
 *     silently hide a level they never asked to hide.
 */
export function visibleLevelPills(
  book: Pick<Book, 'intensity' | 'darkness'>,
  hideIntensity: boolean,
): { intensity: boolean; darkness: boolean } {
  return {
    intensity: (book.intensity ?? 0) > 0 && !hideIntensity,
    darkness: (book.darkness ?? 0) > 0,
  }
}

/**
 * A level pill that can explain itself. READ-ONLY BY CONSTRUCTION — it renders `LevelGuideCard`,
 * which has no `onChange` and no way to reach one. `LevelPicker` is deliberately NOT used here:
 * it is an input, and book detail must not become an editing surface because a prop defaulted the
 * wrong way. See LevelGuideCard's header for the full reasoning.
 *
 * A <button> rather than a tappable <span>: it is focusable, Enter/Space work, and `aria-expanded`
 * tells a screen-reader user the definition is a thing they can open rather than decoration.
 */
function LevelPill({
  axis,
  label,
  glyph,
  level,
  open,
  onToggle,
}: {
  axis: string
  label: string
  glyph: string
  level: number
  open: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={`level-guide-${axis}`}
      // The glyph row is decorative once the accessible name says the number: five chillies read
      // as five separate emoji to a screen reader otherwise.
      aria-label={`${label} ${level} of 5 — ${open ? 'hide' : 'show'} what this means`}
      className="skin-control-quiet px-2.5 py-1 text-[11.5px] font-semibold"
      style={{
        background: 'color-mix(in srgb, var(--violet) 18%, transparent)',
        color: 'var(--ink)',
      }}
    >
      <span aria-hidden>{glyph.repeat(level)}</span>
    </button>
  )
}

function Pill({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className="skin-control-quiet px-2.5 py-1 text-[11.5px] font-semibold"
      style={{
        /*
         * TOKEN, not a literal. This was `rgba(123,63,160,0.18)` — which is tryst's `--violet`
         * (#7b3fa0) at 18%, hardcoded, so EVERY skin rendered tryst's purple regardless of its own
         * palette. It breaks AGENTS.md's no-hardcoded-colours rule and it had been sitting here
         * unflagged; a second glyph pill (darkness, below) was about to depend on it.
         *
         * `color-mix` over the live token keeps the recipe identical — same hue source, same 18% —
         * so tryst is pixel-unchanged and the other eight skins stop borrowing its purple. That is
         * a deliberate visual change in eight skins, screenshotted rather than slipped in.
         */
        background: muted ? 'var(--chip)' : 'color-mix(in srgb, var(--violet) 18%, transparent)',
        color: muted ? 'var(--muted)' : 'var(--ink)',
      }}
    >
      {children}
    </span>
  )
}

export function corpusCoverReviewIsUnavailable({
  data,
  isFetching,
  isError,
  fetchStatus,
}: {
  data: boolean | undefined
  isFetching: boolean
  isError: boolean
  fetchStatus: 'fetching' | 'paused' | 'idle'
}) {
  return isError || fetchStatus === 'paused' || (data === undefined && !isFetching)
}

/** Starting changes current reading state only; completed reads are logged separately. */
export function BookReadingActions({
  book,
  onUpdateProgress,
  onLogPastRead,
  startUnavailable,
  onRetryHistory,
}: {
  book: Book
  onUpdateProgress: () => void
  onLogPastRead: () => void
  startUnavailable?: 'loading' | 'error'
  onRetryHistory?: () => void
}) {
  const updateBook = useUpdateBook(book.id)
  const reading = book.readStatus === 'Reading'
  const action = reading
    ? 'Update progress'
    : hasPausedReadingProgress(book)
      ? 'Resume reading'
      : isBookRead(book)
        ? 'Read again'
        : 'Start reading'
  return (
    <div className="mt-5 flex flex-wrap gap-2">
      <button
        type="button"
        disabled={updateBook.isPending || !!startUnavailable}
        onClick={() =>
          reading
            ? onUpdateProgress()
            : updateBook.mutate({ id: book.id, patch: beginReadingPatch(book) })
        }
        className="skin-control skin-btn-primary min-h-11 px-4 text-[14px] disabled:opacity-50"
      >
        {startUnavailable === 'loading'
          ? 'Loading reading history…'
          : startUnavailable === 'error'
            ? 'Reading history unavailable'
            : action}
      </button>
      {startUnavailable === 'error' && (
        <button
          type="button"
          onClick={onRetryHistory}
          className="skin-control skin-btn-secondary min-h-11 px-4 text-[14px] font-semibold"
        >
          Retry reading history
        </button>
      )}
      <button
        type="button"
        onClick={onLogPastRead}
        className="skin-control skin-btn-secondary min-h-11 px-4 text-[14px] font-semibold"
      >
        Log a past read
      </button>
    </div>
  )
}

type Dialog = 'trope' | 'mood' | 'log' | 'finish' | 'progress' | 'edit' | 'merge' | 'cover' | null

export function BookDetailScreen() {
  const { bookId } = bookRoute.useParams()
  const navigate = useNavigate()
  const { data: books, isLoading } = useBooks()
  const { data: reads, isError: readsError, refetch: retryReads } = useReads(bookId)
  /** Which level axis is currently explaining itself, if any. One at a time: two open cards on a
   *  metadata row would push the page around and neither would be the answer to a single tap. */
  const [openLevel, setOpenLevel] = useState<'intensity' | 'darkness' | null>(null)
  const formatRatings = useMemo(() => latestRatingByFormat(reads ?? []), [reads])
  const { data: listIds } = useBookListIds(bookId)
  const { data: lists } = useLists()
  const { data: profile } = useProfile()
  const labels = useLabels()
  // One screen, one book, many small writes — fave, rating, possession, and the per-format toggles,
  // which each send the WHOLE `owned` object. Rapid toggling is the same clobbering shape the plan
  // editor hit, so these serialize per book. Scoped on the route param, which is available before
  // the book itself loads.
  const updateBook = useUpdateBook(bookId)
  const deleteBook = useDeleteBook()
  const household = useHouseholdLibraryAuthorization()
  const adoptCorpusDetails = useAdoptCorpusWorkMetadata()
  const shareWithHousehold = useAddPersonalBookToHousehold()
  const unshareFromHousehold = useRemovePersonalBookFromHousehold()
  const deleteRead = useDeleteRead(bookId)
  const toggleListItem = useToggleListItem(bookId)
  const createList = useCreateList()
  const setAuthor = useFilters((s) => s.setAuthor)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [tropesExpanded, setTropesExpanded] = useState(false)
  const [progressNotice, setProgressNotice] = useState<{ bookId: string; text: string } | null>(
    null,
  )

  const filterByAuthor = (name: string) => {
    setAuthor(name)
    void navigate({ to: '/library' })
  }

  const book = books?.find((b) => b.id === bookId)
  const { data: isCorpusAdmin = false } = useCorpusAdminStatus()
  const coverReview = usePersonalCoverCorpusReview({
    bookId: book?.id ?? '',
    workId: book?.corpusWorkId ?? '',
    coverUrl: book?.cover ?? '',
    enabled: isCorpusAdmin,
  })
  const reviewPersonalCover = useAdminReviewPersonalCoverForCorpus()

  const voice = useVoice()
  // Lazy backfill: an externally-hotlinked cover moves into owned Storage on first view (task §3).
  useCoverBackfill(book)
  if (isLoading) return <p className="px-6 py-16 text-center text-muted">{voice.loading}</p>
  if (!book)
    return (
      <div className="px-6 py-16 text-center text-muted">
        <p>That book isn’t in your library.</p>
        <BackLink fallback="/library" className="mt-3 inline-block text-primary">
          ← Back to library
        </BackLink>
      </div>
    )

  const levelPills = visibleLevelPills(book, profile?.hideIntensity ?? false)
  const [g0, g1] = subgenreGradient(book.subgenre, book.genre)
  const workKey = workKeyFor(book)
  const corpusWorkId = book.corpusWorkId
  const coverReviewUnavailable = corpusCoverReviewIsUnavailable(coverReview)
  const householdWork = corpusWorkId
    ? household.books.find((candidate) => candidate.id === corpusWorkId)
    : undefined
  const personalHouseholdShare = householdWork?.owners.find(
    (owner) => owner.bookId === book.id && owner.shared,
  )
  const sharedDetailsDiffer = sharedCorpusDetailsDiffer(book, householdWork)
  const reviewerName = profile?.displayName || 'Reader'
  const setOwned = (owned: Owned) => updateBook.mutate({ id: book.id, patch: { owned } })
  // Four-state possession WORD over five independent flags (docs/archive/task-shelf-model.md): picking one
  // word is exclusive, so possessionPatch writes the whole trio. Format flags are left alone across
  // any change — dropping possession suppresses them (bookOwnedFormats gates every read), so marking
  // a book owned or borrowed again restores your copies.
  const setPossession = (next: PossessionState) =>
    updateBook.mutate({ id: book.id, patch: possessionPatch(next) })
  const memberIds = new Set(listIds ?? [])
  const tbrs = (lists ?? []).filter((l) => l.kind === 'tbr')
  const collections = (lists ?? []).filter((l) => l.kind === 'collection')

  const seriesBadge = seriesStatusBadge(book)
  const journalRead = reads?.[0]
  // The base books query omits read rows. Until the log is known, unset/unread records may
  // still be rereads; the explicit Read/Reading/DNF states already determine the safe patch.
  const startUnavailable =
    reads === undefined &&
    !isBookRead(book) &&
    book.readStatus !== 'Reading' &&
    book.readStatus !== 'DNF'
      ? readsError
        ? 'error'
        : 'loading'
      : undefined

  return (
    <section className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <BackLink fallback="/library" className="text-[13px] text-muted hover:text-ink">
        ← Library
      </BackLink>

      {/* header */}
      {/* cover + title share the row even on phones — a stacked w-32 cover left dead space beside it */}
      <div
        className="skin-panel mt-4 flex gap-4 border border-line p-4 sm:gap-7 sm:p-7"
        style={{
          background:
            'linear-gradient(115deg, color-mix(in srgb, var(--primary) 10%, var(--panel-fill)), var(--panel-fill) 48%)',
          boxShadow: 'var(--shadow)',
        }}
      >
        {/* the cover is the door — tapping it opens the cover sheet (change/add a cover) */}
        <button
          type="button"
          onClick={() => setDialog('cover')}
          aria-label={book.cover ? 'Change cover' : 'Add a cover'}
          className="skin-card relative aspect-[2/3] w-28 flex-none self-start overflow-hidden border border-line sm:w-44"
          style={{
            background: `linear-gradient(150deg, ${g0}, ${g1})`,
            filter: 'drop-shadow(0 18px 22px rgba(0, 0, 0, 0.3))',
          }}
        >
          <CoverImage book={book} />
          {!book.cover && (
            <span
              aria-hidden
              className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 text-[10px] font-semibold backdrop-blur"
              style={{
                background: 'rgba(0,0,0,0.62)',
                color: 'var(--mark-on-ph)',
                borderRadius: 'var(--mark-radius)',
              }}
            >
              + add a cover
            </span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          <span className="skin-label text-[10px]" style={{ color: 'var(--accent-ink)' }}>
            Book record
          </span>
          <div className="flex items-start justify-between gap-3">
            <h1
              className="mt-2 max-w-[18ch] text-balance text-[27px] font-semibold leading-[1.02] text-ink sm:text-[42px]"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
            >
              {book.title}
            </h1>
            <button
              type="button"
              onClick={() => updateBook.mutate({ id: book.id, patch: { fave: !book.fave } })}
              aria-pressed={book.fave}
              aria-label={book.fave ? 'Remove from favorites' : 'Add to favorites'}
              className="text-[24px] leading-none"
              style={{ color: book.fave ? 'var(--primary)' : 'var(--muted)' }}
            >
              {book.fave ? '♥' : '♡'}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-1.5 text-[15px] text-muted">
            {book.contributors.length ? (
              book.contributors.map((c, i) => (
                <span key={`${c.name}-${i}`} className="inline-flex items-center">
                  {isAuthorRole(c.role) ? (
                    <button
                      type="button"
                      onClick={() => filterByAuthor(c.name)}
                      className="text-ink underline-offset-2 hover:underline"
                    >
                      {c.name}
                    </button>
                  ) : (
                    <span>
                      {c.name}{' '}
                      <span className="text-[12px] lowercase">
                        · {ROLE_LABELS[c.role].toLowerCase()}
                      </span>
                    </span>
                  )}
                  {i < book.contributors.length - 1 ? <span aria-hidden>,</span> : null}
                </span>
              ))
            ) : (
              <span>{authorOf(book) || 'Unknown author'}</span>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {bookGenres(book).map((g) => (
              <Pill key={g}>{CORE_GENRES.find((cg) => cg.toLowerCase() === g) ?? g}</Pill>
            ))}
            {bookSubgenres(book).map((s) => (
              <Pill key={s}>{s}</Pill>
            ))}
            <Pill>{seriesBadge}</Pill>
            {/*
              TWO AXES, ONE GATE EACH — and the gates differ on purpose.

              `> 0` for both: NULL means NOT ASSESSED and 0 means ASSESSED AS NONE (#326's ruling),
              and neither earns a pill. `books.darkness` is NULL for essentially the whole library
              today, so the darkness pill is ABSENT on nearly every book. That is the rule working,
              not a missing feature.

              `hideIntensity` gates SPICE ONLY. It is the spice-hiding preference; darkness is a
              different axis and a reader who hid spice has said nothing about it.
            */}
            {levelPills.intensity && (
              <LevelPill
                axis="intensity"
                label={labels.intensity}
                glyph={labels.intensityGlyph}
                level={book.intensity ?? 0}
                open={openLevel === 'intensity'}
                onToggle={() => setOpenLevel((c) => (c === 'intensity' ? null : 'intensity'))}
              />
            )}
            {levelPills.darkness && (
              <LevelPill
                axis="darkness"
                label={labels.darkness}
                glyph={labels.darknessGlyph}
                level={book.darkness ?? 0}
                open={openLevel === 'darkness'}
                onToggle={() => setOpenLevel((c) => (c === 'darkness' ? null : 'darkness'))}
              />
            )}
            {formatPartialDate(book.pub) && <Pill>📅 {formatPartialDate(book.pub)}</Pill>}
            {/* Absent when unknown — no pill at all, rather than a fabricated 0 or a guess. */}
            {book.pages != null && <Pill>{book.pages} pp</Pill>}
          </div>

          {/* BELOW the row, not inside it: the pills live in a flex-wrap, and a card in that flow
              would be squeezed between them and re-wrap the row every time it opened. */}
          {openLevel && (
            <LevelGuideCard
              id={`level-guide-${openLevel}`}
              level={(openLevel === 'intensity' ? book.intensity : book.darkness) ?? 0}
              definition={
                (openLevel === 'intensity'
                  ? labels.intensityLevels[book.intensity ?? 0]
                  : labels.darknessLevels[book.darkness ?? 0]) ?? ''
              }
              onDismiss={() => setOpenLevel(null)}
              dismissLabel={`Close the ${
                openLevel === 'intensity' ? labels.intensity : labels.darkness
              } level guide`}
            />
          )}

          {book.readStatus === 'Reading' && (
            <div className="mt-5 max-w-md">
              <ProgressMeter value={book.progress} max={100} />
              <p className="mt-2 text-[13px] font-semibold text-ink" role="status">
                {progressNotice?.bookId === book.id
                  ? progressNotice.text
                  : `${book.progress}% · your current place`}
              </p>
            </div>
          )}
          <BookReadingActions
            book={{ ...book, reads: reads ?? book.reads }}
            startUnavailable={startUnavailable}
            onRetryHistory={() => void retryReads()}
            onUpdateProgress={() => {
              setProgressNotice(null)
              setDialog('progress')
            }}
            onLogPastRead={() => setDialog('log')}
          />
        </div>
      </div>

      {journalRead && (
        <section
          aria-labelledby="reading-memory"
          className="skin-card mt-6 border border-line bg-[color:var(--card-solid)] p-5 sm:p-6"
        >
          <h2
            id="reading-memory"
            className="text-[22px] font-semibold leading-[1.3] text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            From your reading journal
          </h2>
          <p className="mt-2 text-[14px] leading-relaxed text-muted">
            {fmtDate(journalRead.date)}
            {journalRead.format ? ` · ${journalRead.format}` : ''}
          </p>
          {journalRead.rating > 0 && (
            <div className="mt-3">
              <Stars value={journalRead.rating} size={18} />
            </div>
          )}
          {journalRead.notes && (
            <p className="mt-3 line-clamp-5 whitespace-pre-wrap break-words text-[16px] leading-relaxed text-ink">
              {journalRead.notes}
            </p>
          )}
          <a
            href="#personal-read-log"
            className="mt-3 inline-flex min-h-11 items-center text-[14px] font-semibold text-ink underline underline-offset-4"
          >
            View your full reading history
          </a>
        </section>
      )}

      <section aria-labelledby="your-copy" className="mt-8 border-t border-line pt-6">
        <h2
          id="your-copy"
          className="mb-4 text-[20px] font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Your copy
        </h2>
        {/* your copies (per-format ownership) */}
        <div className="mt-6">
          <OwnedCopies
            possession={possessionState(book)}
            owned={book.owned}
            onChange={setOwned}
            onPossessionChange={setPossession}
          />
        </div>

        {book.ownership === 'owned' ? (
          household.members.length > 0 && (
            <Surface
              tone="field"
              radius="control"
              pad={2}
              className="mt-4 text-[12.5px] text-muted"
            >
              Included in the household library automatically because you own a copy.
            </Surface>
          )
        ) : book.borrowed && household.members.length > 0 ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={!!personalHouseholdShare}
            disabled={
              !household.authorized ||
              shareWithHousehold.isPending ||
              unshareFromHousehold.isPending
            }
            onClick={() =>
              personalHouseholdShare
                ? unshareFromHousehold.mutate(book.id)
                : shareWithHousehold.mutate(book.id)
            }
            className="skin-control mt-4 flex w-full items-center justify-between border border-line px-3 py-2.5 text-left text-[13px] font-semibold text-ink disabled:opacity-50"
            style={{ background: 'var(--field)' }}
          >
            <span>
              Share this borrowed book with the household
              <span className="mt-0.5 block text-[11.5px] font-normal text-muted">
                Your wishlist choice stays personal.
              </span>
            </span>
            <span aria-hidden>{personalHouseholdShare ? '✓' : '○'}</span>
          </button>
        ) : null}

        {/* buy at an indie (discover + support — not live inventory) */}
        <BuyAtIndie book={book} />
      </section>

      <section aria-labelledby="your-reading" className="mt-8 border-t border-line pt-6">
        <h2
          id="your-reading"
          className="mb-4 text-[20px] font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Your reading
        </h2>
        {/* reading status — "Not set" is a real, selectable state; no forced choice */}
        <Label>Reading status</Label>
        <div className="flex flex-wrap gap-1.5">
          {READ_STATUS_OPTIONS.map((s) =>
            s === 'Reading' && startUnavailable ? (
              <button
                key={s}
                type="button"
                disabled
                className="skin-control-quiet border border-line px-3 py-1.5 text-[12.5px] text-muted opacity-50"
              >
                {readStatusLabel(s)}
              </button>
            ) : (
              <Chip
                key={s}
                active={book.readStatus === s}
                onClick={() => {
                  updateBook.mutate({
                    id: book.id,
                    patch:
                      s === 'Reading'
                        ? beginReadingPatch({ ...book, reads: reads ?? book.reads })
                        : { readStatus: s },
                  })
                  if (s === 'Read') void maybeChainPrompt(book, books ?? [])
                }}
              >
                {readStatusLabel(s)}
              </Chip>
            ),
          )}
        </div>

        {book.readStatus === 'Reading' && (
          <button
            type="button"
            onClick={() => setDialog('finish')}
            className="skin-control skin-btn-secondary mt-5 min-h-11 px-4 text-[14px] font-semibold"
          >
            Finish this read
          </button>
        )}

        {/* rating */}
        <Label
          action={
            <button
              type="button"
              onClick={() => setDialog('edit')}
              className="text-[12px] text-primary"
            >
              Edit rating
            </button>
          }
        >
          Your rating
        </Label>
        <Stars
          value={book.rating}
          step={0.5}
          onChange={(v) => updateBook.mutate({ id: book.id, patch: { rating: v } })}
        />
        <p className="mt-1 text-[11.5px] text-muted">
          Your rating only — Reverie never shows an averaged score.
        </p>
        {/* Audiobook-vs-print: shown only when two or more formats carry rated reads. Most recent
          rated read per format — the display rule and its reasons live on latestRatingByFormat. */}
        {formatRatings.length > 0 && (
          /*
           * STAR AND REVIEW TOGETHER, PER FORMAT. Both halves come from the same read — see
           * `FormatRating.notes` — so the sentence under a format's stars is the opinion that
           * produced them, never a note from a different sitting. Previously the words lived only
           * in the reread log further down the page, which meant the one surface that exists to
           * answer "was the audiobook better" showed the scores and hid the reasons.
           *
           * A format with no note renders its stars alone rather than an empty line: notes are
           * optional, and a blank row would read as a missing thing rather than an unwritten one.
           */
          <div className="mt-2 flex flex-col gap-1.5" data-testid="format-ratings">
            {formatRatings.map((f) => (
              <div key={f.format} data-testid={`format-rating-${f.format}`}>
                <span className="flex items-center gap-1.5 text-[12.5px] text-muted">
                  {f.format}
                  <Stars value={f.rating} size={12} />
                </span>
                {f.notes && (
                  <p
                    className="mt-0.5 text-[13px] text-ink"
                    data-testid={`format-review-${f.format}`}
                  >
                    {f.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* read log */}
        <div id="personal-read-log" className="scroll-mt-24" />
        <Label
          action={
            <button
              type="button"
              onClick={() => setDialog('log')}
              className="text-[12px] text-primary"
            >
              Log a past read
            </button>
          }
        >
          Read log
        </Label>
        <div className="mb-2 text-[13px] text-muted">
          {reads && reads.length
            ? `Read ${reads.length} time${reads.length > 1 ? 's' : ''}`
            : book.readStatus === 'Read'
              ? 'Marked read — log a date to see it on your calendar'
              : 'Not logged yet'}
        </div>
        <div className="flex flex-col gap-2">
          {(reads ?? []).map((r) => (
            <Surface key={r.id} tone="field" radius="card" pad={2}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13.5px] font-semibold text-ink">{fmtDate(r.date)}</span>
                <button
                  type="button"
                  onClick={() => deleteRead.mutate(r.id)}
                  className="text-[12px] text-muted hover:text-primary"
                >
                  remove
                </button>
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[12.5px] text-muted">
                {r.format}
                {r.rating ? <Stars value={r.rating} size={12} /> : null}
              </div>
              {r.notes && <div className="mt-1 text-[13px] text-ink">{r.notes}</div>}
            </Surface>
          ))}
        </div>
      </section>

      <section aria-labelledby="series-and-plans" className="mt-8 border-t border-line pt-6">
        <h2
          id="series-and-plans"
          className="mb-4 text-[20px] font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Series and plans
        </h2>
        <SeriesStrip book={book} />
        {!book.series && (
          <p className="text-[14px] text-muted">
            No personal series is set. You can add one in Edit details.
          </p>
        )}
        {/* lists & shelves */}
        <Label
          action={
            <button
              type="button"
              onClick={async () => {
                const name = window.prompt('Name the new shelf / collection:')
                if (!name) return
                const created = await createList.mutateAsync({
                  name: name.trim(),
                  kind: 'collection',
                })
                toggleListItem.mutate({ listId: created.id, member: false })
              }}
              className="text-[12px] text-primary"
            >
              + new shelf
            </button>
          }
        >
          Lists &amp; shelves
        </Label>
        <div className="mb-1 text-[12px] text-muted">TBR lists</div>
        <div className="flex flex-wrap gap-1.5">
          {tbrs.length ? (
            tbrs.map((l) => (
              <Chip
                key={l.id}
                active={memberIds.has(l.id)}
                onClick={() => toggleListItem.mutate({ listId: l.id, member: memberIds.has(l.id) })}
              >
                {l.priority && (
                  <>
                    <BookmarkGlyph />{' '}
                  </>
                )}
                {l.name} {memberIds.has(l.id) ? '✓' : '+'}
              </Chip>
            ))
          ) : (
            <span className="text-[13px] text-muted">No TBR lists yet</span>
          )}
        </div>
        <div className="mb-1 mt-3 text-[12px] text-muted">Collections &amp; shelves</div>
        <div className="flex flex-wrap gap-1.5">
          {collections.length ? (
            collections.map((l) => (
              <Chip
                key={l.id}
                active={memberIds.has(l.id)}
                onClick={() => toggleListItem.mutate({ listId: l.id, member: memberIds.has(l.id) })}
              >
                {l.name} {memberIds.has(l.id) ? '✓' : '+'}
              </Chip>
            ))
          ) : (
            <span className="text-[13px] text-muted">No shelves yet</span>
          )}
        </div>

        {/* plan */}
        <Label>Plan a read</Label>
        <PlanEditor key={book.id} book={book} />

        {householdWork ? (
          <Surface tone="field" radius="control" pad={2} className="mt-4 text-[12.5px] text-muted">
            <p>
              Shared catalog edits do not change your personal copy automatically. Ownership,
              reading history, rating, ISBN, and private notes are never part of this merge.
            </p>
            {sharedDetailsDiffer ? (
              <button
                type="button"
                disabled={adoptCorpusDetails.isPending}
                onClick={() => {
                  if (
                    !window.confirm(
                      'Use the shared catalog’s series, genre, cover, and publication details for your personal copy? Your ownership, reading history, rating, ISBN, and private notes stay unchanged.',
                    )
                  )
                    return
                  adoptCorpusDetails.mutate(book.id)
                }}
                className="skin-control mt-2 border border-line px-3 py-2 text-[12px] font-semibold text-ink disabled:opacity-50"
                style={{ background: 'var(--card)' }}
              >
                {adoptCorpusDetails.isPending ? 'Using shared details…' : 'Use shared details'}
              </button>
            ) : (
              <p className="mt-1.5 text-[11.5px]">Your copy already matches the shared details.</p>
            )}
          </Surface>
        ) : null}
      </section>

      <section aria-labelledby="more-about-book" className="mt-8 border-t border-line pt-6">
        <h2
          id="more-about-book"
          className="mb-4 text-[20px] font-semibold text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          More about this book
        </h2>
        <button
          type="button"
          onClick={() => setDialog('edit')}
          className="skin-control skin-btn-secondary min-h-11 px-4 text-[14px] font-semibold"
        >
          Edit details
        </button>
        {/* tags (Tryst skin: "Tropes") */}
        <Label
          action={
            <button
              type="button"
              onClick={() => setDialog('trope')}
              className="text-[12px] text-primary"
            >
              + tag
            </button>
          }
        >
          {labels.tags}
        </Label>
        {/* pinned lead with the skin's ornament; the rest collapse behind a count (≤5 visible) */}
        <div className="flex flex-wrap items-center gap-1.5">
          {book.tropes.length ? (
            <>
              {(tropesExpanded ? book.tropes : book.tropes.slice(0, 5)).map((t) => (
                <TropeChip key={t.id} name={t.name} emphasis={t.emphasis} to={`/tropes/${t.id}`} />
              ))}
              {book.tropes.length > 5 && (
                <button
                  type="button"
                  onClick={() => setTropesExpanded((v) => !v)}
                  className="skin-control border border-line px-2.5 py-1 text-[12px] font-semibold text-muted"
                  style={{ background: 'var(--field)' }}
                >
                  {tropesExpanded ? 'fewer' : `+${book.tropes.length - 5} more`}
                </button>
              )}
            </>
          ) : (
            <span className="text-[13px] text-muted">No {labels.tags.toLowerCase()} yet</span>
          )}
        </div>

        {/* Mood — the reader's OWN impression (how it landed), its own area, apart from the descriptive
          tropes above. Never derived: empty is a valid, quiet state (docs/archive/task-mood.md). */}
        <Label
          action={
            <button
              type="button"
              onClick={() => setDialog('mood')}
              className="text-[12px] text-primary"
            >
              {book.moods.length ? 'edit' : '+ mood'}
            </button>
          }
        >
          Mood
        </Label>
        <div className="flex flex-wrap items-center gap-1.5">
          {book.moods.length ? (
            book.moods.map((m) => <MoodChip key={m.id} name={m.name} to={`/moods/${m.id}`} />)
          ) : (
            <span className="text-[13px] text-muted">No mood set — how did it land on you?</span>
          )}
        </div>

        {/* reviews (opt-in, individual voices) */}
        <div className="mt-4">
          <ReviewsPanel workKey={workKey} reviewerName={reviewerName} />
        </div>

        {/* Tier 2: semantic neighbours from your own shelves (silent until embeddings exist) */}
        <MoreLikeThis bookId={book.id} />

        {isCorpusAdmin && book.cover && corpusWorkId ? (
          <CorpusCoverReviewToggle
            reviewed={coverReview.data === true}
            loading={coverReview.isFetching}
            unavailable={coverReviewUnavailable}
            saving={reviewPersonalCover.isPending}
            onReview={() =>
              reviewPersonalCover.mutate({
                bookId: book.id,
                workId: corpusWorkId,
                coverUrl: book.cover,
              })
            }
          />
        ) : null}

        {/* actions */}
        <div className="mt-8 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setDialog('merge')}
            className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink"
            style={{ background: 'var(--card)' }}
          >
            Merge…
          </button>
          <button
            type="button"
            onClick={() => {
              if (
                !window.confirm(
                  'Remove this book from your personal library? Reading history is preserved, and any household entry stays in the household.',
                )
              )
                return
              deleteBook.mutate(book.id, { onSuccess: () => void navigate({ to: '/' }) })
            }}
            // accent-ink, not primary: on this --card background, hearth/dark's --primary measures
            // 2.24:1 (a11y sweep, 2026-08-10). There is no dedicated destructive/danger token in
            // tokens.css — this button was leaning on --primary's reddish hue as its only color
            // signal, with the label as the real signal. A --danger token is a queued follow-up;
            // not designed here.
            className="skin-control border border-line px-4 py-2 text-[13px] font-semibold"
            style={{ background: 'var(--card)', color: 'var(--accent-ink)' }}
          >
            Remove from personal library
          </button>
        </div>
      </section>

      {dialog === 'trope' && <TropePicker book={book} onClose={() => setDialog(null)} />}
      {dialog === 'mood' && (
        <Modal title="Mood" onClose={() => setDialog(null)}>
          <p className="-mt-2 mb-3 text-[13px] text-muted">
            How did {book.title} land on you? Tap what you felt — yours alone, and only if you want
            to.
          </p>
          <MoodPicker book={book} />
        </Modal>
      )}
      {(dialog === 'log' || dialog === 'finish') && (
        <LogReadForm
          book={book}
          mode={dialog === 'log' ? 'past' : 'finish'}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'edit' && (
        <EditDetails
          book={book}
          onClose={() => setDialog(null)}
          onChangeCover={() => setDialog('cover')}
        />
      )}
      {dialog === 'cover' && <CoverSheet book={book} onClose={() => setDialog(null)} />}
      {dialog === 'progress' && (
        <ReadingProgressDialog
          book={book}
          onClose={() => setDialog(null)}
          onSaved={(progress) =>
            setProgressNotice({ bookId: book.id, text: `Progress saved at ${progress}%.` })
          }
        />
      )}
      {dialog === 'merge' && (
        <MergeDialog book={book} allBooks={books ?? []} onClose={() => setDialog(null)} />
      )}
    </section>
  )
}

/** Format-aware indie buy links — Bookshop.org (print/ebook) + Libro.fm (audio), routed to the
 *  reader's chosen local store. Discover + support, never a claim of in-store stock. */
function BuyAtIndie({ book }: { book: Book }) {
  const { data: profile } = useProfile()
  const config = buyConfig(profile?.defaultStore)
  const links = buildBuyLinks(book, config)
  return (
    <Surface as="details" tone="card" radius="card" pad={3} className="mt-4">
      <summary className="cursor-pointer text-[14px] font-semibold text-ink">
        Buy at an indie{profile?.defaultStore ? ` · ${profile.defaultStore.name}` : ''}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {links.map((l) => (
          <a
            key={l.provider}
            href={l.url}
            target="_blank"
            rel="noreferrer"
            className="skin-control flex items-center justify-between border border-line px-3 py-2 text-[13px] font-semibold text-ink"
            style={{ background: 'var(--field)' }}
          >
            <span>{l.label}</span>
            <span className="text-primary">↗</span>
          </a>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">
        {buyDisclosure(config)} These open the store’s online shop — not a live in-stock check.
        {!profile?.defaultStore && (
          <>
            {' '}
            {/* `underline` is load-bearing, not decoration. This link sits inside a
                `text-muted` <p>, so WCAG 1.4.1 (axe `link-in-text-block`) requires it be
                distinguishable from the surrounding text by something other than colour — and
                --primary vs --muted measures BELOW 3:1 in all 18 skin x mode combinations,
                1.01:1 (folio/dark) to 2.01:1 (hearth/dark). Colour alone can never carry it in any
                skin. Same treatment as the three sibling inline links (SettingsRoute.tsx:454,
                SettingsRoute.tsx:741, OnboardingRoute.tsx:382); the first of those carries a
                comment recording the same class of defect found in 2026-08. */}
            <Link to="/indie" className="text-primary underline underline-offset-2">
              Pick your local store
            </Link>
            .
          </>
        )}
      </p>
    </Surface>
  )
}

export const bookRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'book/$bookId',
  component: BookDetailScreen,
})
