import { Fragment, useEffect, useState } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import {
  authorOf,
  beginReadingPatch,
  isPossessed,
  nextReadCandidates,
  type Book,
} from '@reverie/core'
import { rootRoute } from './RootRoute'
import { CoverImage } from '../components/CoverImage'
import { useUpdateBook } from '../data/books'
import { useReaderBooks } from '../data/readerBooks'
import { useAllReads } from '../data/reads'
import { useLists, type UiList } from '../data/lists'
import { useAddListItem, useAllListItems } from '../data/listItems'
import { LibraryPicker } from '../components/LibraryPicker'
import { ExternalSearchSheet } from '../components/ExternalSearchSheet'
import { Modal } from '../components/Modal'
import { useProfile, useUpdateProfile } from '../data/profile'
import { SpineShelf } from '../components/SpineShelf'
import { LogReadForm } from '../book/dialogs'
import { MONTHS } from '../library/constants'
import {
  Frame,
  ProgressMeter,
  SectionHeader,
  SignatureRing,
  StatusTag,
} from '../components/Structure'
import { hasOnboarded } from './OnboardingRoute'
import { loadGuestHandoff } from '../auth/landing/guest/handoff'
import { useVoice } from '../skin/labels'
import { BookmarkGlyph } from '../components/BookmarkGlyph'
import { Surface } from '../components/Surface'
import { PageHeader } from '../components/PageHeader'
import { DEFAULT_ARRANGEMENT_PRESET, type HomeModuleId } from '../design/arrangements'
import { ReadingProgressDialog } from '../components/ReadingProgress'

const YEAR = new Date().getFullYear()

function HomeScreen() {
  const navigate = useNavigate()
  const booksQuery = useReaderBooks()
  const { data: books } = booksQuery
  const { data: reads } = useAllReads()
  const { data: lists } = useLists()
  const { data: items } = useAllListItems()
  const { data: profile } = useProfile()
  const updateBook = useUpdateBook()
  const updateProfile = useUpdateProfile()
  const voice = useVoice()
  const addItem = useAddListItem()
  const [finishing, setFinishing] = useState<Book | null>(null)
  const [progressing, setProgressing] = useState<Book | null>(null)
  const [progressMessage, setProgressMessage] = useState('')
  const [readingPickerOpen, setReadingPickerOpen] = useState(false)
  const [removing, setRemoving] = useState<Book | null>(null)
  const [railPickerFor, setRailPickerFor] = useState<UiList | null>(null)
  const [railExternalFor, setRailExternalFor] = useState<UiList | null>(null)

  const all = books ?? []
  const openBook = (id: string) => void navigate({ to: '/book/$bookId', params: { bookId: id } })

  // A deliberately saved guest library always gets its review, including for a returning reader.
  // Otherwise, first-run onboarding remains limited to an empty, not-yet-onboarded account.
  useEffect(() => {
    if (books && (loadGuestHandoff() || (books.length === 0 && !hasOnboarded()))) {
      void navigate({ to: '/onboarding', replace: true })
    }
  }, [books, navigate])

  const yearReads = (reads ?? []).filter((r) => r.read_on?.slice(0, 4) === String(YEAR))
  const uniqueThisYear = new Set(yearReads.map((r) => r.book_id)).size
  const goalTarget = profile?.goalYear === YEAR ? (profile?.goalTarget ?? 0) : 0
  const homeModules =
    profile?.arrangement?.homeModules ?? DEFAULT_ARRANGEMENT_PRESET.config.homeModules

  // Reading Now: mid-read books minus the display-only hidden ones, in the reader's manual order.
  const reading = all
    .filter((b) => b.readStatus === 'Reading' && !b.readingNowHidden)
    .sort((a, b) => (a.readingPosition ?? 1e15) - (b.readingPosition ?? 1e15))
  const available = nextReadCandidates(all)
  // ALL priority-flagged shelves + TBRs, in the user's manual order (useLists sorts by sort_order).
  const priorityLists = (lists ?? []).filter((l) => l.priority)
  const booksFor = (listId: string): Book[] =>
    (items ?? [])
      .filter((it) => it.list_id === listId)
      .sort((a, b) => (a.position ?? 1e15) - (b.position ?? 1e15))
      .map((it) => all.find((b) => b.id === it.book_id))
      .filter((b): b is Book => !!b)
  const priorityTotal = priorityLists.reduce((n, l) => n + booksFor(l.id).length, 0)

  const today = new Date()
  const soon = all
    .filter((b) => b.pub.y)
    .map((b) => ({ b, d: new Date(b.pub.y ?? 0, (b.pub.m ?? 1) - 1, b.pub.d ?? 1) }))
    .filter(({ d }) => {
      const days = (d.getTime() - today.getTime()) / 864e5
      return days >= -7 && days <= 120
    })
    .sort((a, c) => a.d.getTime() - c.d.getTime())
    .slice(0, 12)

  const setGoal = () => {
    const input = window.prompt(
      `How many books do you want to read in ${YEAR}?`,
      String(goalTarget || ''),
    )
    if (input == null) return
    updateProfile.mutate({ goalYear: YEAR, goalTarget: Math.max(0, parseInt(input) || 0) })
  }

  const moveReading = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= reading.length) return
    const ids = reading.map((b) => b.id)
    const a = ids[i]!
    ids[i] = ids[j]!
    ids[j] = a
    // renumber-on-write, same spaced scheme as shelves
    ids.forEach((id, k) => updateBook.mutate({ id, patch: { readingPosition: (k + 1) * 1000 } }))
  }

  const startReading = (b: Book) => {
    const maxPos = Math.max(0, ...reading.map((x) => x.readingPosition ?? 0))
    updateBook.mutate({
      id: b.id,
      patch: { ...beginReadingPatch(b), readingPosition: maxPos + 1000 },
    })
  }

  const todayLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date())

  return (
    <section className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        eyebrow={todayLabel}
        title="Welcome back."
        description="Continue reading or choose something from your library."
        showDescriptionOnMobile
        actions={
          <>
            <button
              type="button"
              onClick={() => void navigate({ to: '/library' })}
              className="skin-control skin-btn-secondary h-11 px-4 text-[14px]"
            >
              Browse library
            </button>
            <button
              type="button"
              onClick={() => void navigate({ to: '/add' })}
              className="skin-control skin-btn-primary h-11 px-4 text-[14px]"
            >
              ＋ Add a book
            </button>
          </>
        }
      />

      {!books && (booksQuery.isPending || booksQuery.isError) && (
        <Surface tone="card" radius="panel" pad={5} className="mt-6">
          <p role={booksQuery.isError ? 'alert' : 'status'} className="text-[16px] text-ink">
            {booksQuery.isError ? 'Your library could not be loaded.' : 'Loading your library…'}
          </p>
          {booksQuery.isError && (
            <button
              type="button"
              onClick={() => void booksQuery.refetch()}
              className="skin-control skin-btn-secondary mt-4 min-h-11 px-4 text-[14px]"
            >
              Try again
            </button>
          )}
        </Surface>
      )}

      {homeModules.map((homeModule: HomeModuleId) => (
        <Fragment key={homeModule}>
          {/* reading now — editable in place: add a current read, set one aside, reorder */}
          {homeModule === 'reading' && (
            <div data-home-module="reading">
              {reading.length > 0 ? (
                <div className="mt-8">
                  <div className="flex items-end justify-between gap-3">
                    <SectionHeader
                      className="flex-1"
                      label="Reading now"
                      readout={reading.length}
                    />
                    <button
                      type="button"
                      onClick={() => setReadingPickerOpen(true)}
                      className="skin-control skin-btn-secondary mb-0.5 min-h-11 flex-none px-3 text-[13px] font-semibold"
                    >
                      ＋ Add
                    </button>
                  </div>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    {reading.map((b, i) => (
                      <Surface
                        key={b.id}
                        tone="card"
                        radius="card"
                        pad={2}
                        raised={i === 0}
                        className={`flex gap-3 ${i === 0 ? 'sm:col-span-2 sm:grid sm:grid-cols-[112px_minmax(0,1fr)] sm:p-5' : ''}`}
                      >
                        <button
                          type="button"
                          onClick={() => openBook(b.id)}
                          className={`aspect-[2/3] flex-none self-start overflow-hidden rounded-md border border-line ${i === 0 ? 'w-20 sm:w-[112px]' : 'w-16'}`}
                          style={{ background: 'var(--field)' }}
                          aria-label={`Open ${b.title}`}
                        >
                          <CoverImage book={b} />
                        </button>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-[12ch] flex-1">
                              <h3
                                className={`break-words font-semibold leading-[1.3] text-ink ${i === 0 ? 'text-[22px] sm:text-[26px]' : 'text-[19px]'}`}
                                style={{ fontFamily: 'var(--font-display)' }}
                              >
                                {b.title}
                              </h3>
                              <div className="break-words text-[13px] leading-[1.45] text-ink">
                                {authorOf(b)}
                              </div>
                            </div>
                            <span className="flex flex-none flex-wrap items-center justify-end gap-0.5">
                              {reading.length > 1 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => moveReading(i, -1)}
                                    aria-label={`Move ${b.title} earlier`}
                                    className="grid h-11 w-11 place-items-center text-[12px] leading-none text-ink hover:text-ink"
                                  >
                                    ▲
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => moveReading(i, 1)}
                                    aria-label={`Move ${b.title} later`}
                                    className="grid h-11 w-11 place-items-center text-[12px] leading-none text-ink hover:text-ink"
                                  >
                                    ▼
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => setRemoving(b)}
                                aria-label={`Remove ${b.title} from Reading now`}
                                className="grid h-11 w-11 place-items-center text-[13px] leading-none text-ink hover:text-primary"
                              >
                                ✕
                              </button>
                            </span>
                          </div>
                          <ProgressMeter value={b.progress} max={100} className="mt-2" />
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-semibold text-ink">
                              {b.progress}%
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setProgressMessage('')
                                setProgressing(b)
                              }}
                              aria-label={`Update progress for ${b.title}`}
                              className="skin-control skin-btn-secondary ml-auto min-h-11 px-3 text-[14px] text-ink"
                            >
                              Update progress
                            </button>
                            <button
                              type="button"
                              onClick={() => setFinishing(b)}
                              className="skin-control min-h-11 px-3 py-1 text-[13px] font-semibold"
                              style={{ background: 'var(--chip)', color: 'var(--ink)' }}
                            >
                              Finish this read
                            </button>
                          </div>
                        </div>
                      </Surface>
                    ))}
                  </div>
                  {progressMessage && (
                    <p role="status" className="mt-3 text-[13px] font-semibold text-ink">
                      {progressMessage}
                    </p>
                  )}
                </div>
              ) : books ? (
                <div className="mt-8">
                  <SectionHeader label="Reading now" readout={0} />
                  <Surface tone="card" radius="card" pad={4} className="mt-3">
                    <p className="text-[14px] leading-relaxed text-muted">
                      Nothing is underway. Start a book from your library when you are ready.
                    </p>
                    <button
                      type="button"
                      onClick={() => setReadingPickerOpen(true)}
                      className="skin-control skin-btn-secondary mt-3 min-h-11 px-4 text-[13px] font-semibold"
                    >
                      Start reading
                    </button>
                  </Surface>
                </div>
              ) : null}
            </div>
          )}

          {homeModule === 'next-read' && (
            <div data-home-module="next-read">
              {books && (
                <Frame className="mt-6 p-5 sm:p-6" style={{ boxShadow: 'var(--shadow)' }}>
                  <h2
                    className="text-[25px] font-semibold leading-tight text-ink sm:text-[30px]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {all.length ? 'Choose a next read' : 'Start with a book you want to read.'}
                  </h2>
                  <p className="mt-2 max-w-[60ch] text-[16px] leading-relaxed text-ink">
                    {available.length
                      ? `${available.length} unread ${available.length === 1 ? 'book is' : 'books are'} marked owned or borrowed. Choose what fits now, or try a random pick.`
                      : all.length
                        ? 'No new unread books are marked owned or borrowed. Browse your library to check what you have, or explore other choices in Next read.'
                        : 'Add one book or bring an existing file. You can choose a room and set a goal later.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void navigate({ to: all.length ? '/match' : '/add' })}
                      className="skin-control skin-btn-primary min-h-11 px-4 text-[14px]"
                    >
                      {all.length ? 'Choose a next read' : 'Add a book'}
                    </button>
                    {available.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => {
                          const pick = available[Math.floor(Math.random() * available.length)]
                          if (pick) openBook(pick.id)
                        }}
                        className="skin-control skin-btn-secondary min-h-11 px-4 text-[14px]"
                      >
                        Surprise me
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          void navigate({ to: all.length ? '/library' : '/onboarding' })
                        }
                        className="skin-control skin-btn-secondary min-h-11 px-4 text-[14px]"
                      >
                        {all.length ? 'Review your library' : 'Import a file'}
                      </button>
                    )}
                  </div>
                </Frame>
              )}
            </div>
          )}

          {/* priority shelves — every flagged shelf/TBR, in the reader's manual order */}
          {homeModule === 'priority' && (
            <div data-home-module="priority">
              {priorityLists.map((l) => {
                const shelfBooks = booksFor(l.id)
                return (
                  <div key={l.id} className="mt-8">
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({ to: '/shelf/$listId', params: { listId: l.id } })
                      }
                      className="block w-full text-left"
                    >
                      <SectionHeader
                        label={
                          <>
                            <BookmarkGlyph size={13} /> {l.name} <span aria-hidden>›</span>
                          </>
                        }
                        readout={shelfBooks.length}
                      />
                    </button>
                    {shelfBooks.length > 0 && (
                      <p className="mb-3 mt-1 text-[13px] leading-[1.5] text-muted">
                        Your hand-picked next reads. Swipe the shelf and open one when it feels
                        right.
                      </p>
                    )}
                    <SpineShelf
                      books={shelfBooks}
                      onOpen={openBook}
                      onAdd={() => setRailPickerFor(l)}
                      addLabel={`Add a book to ${l.name}`}
                    />
                  </div>
                )
              })}
              {books && priorityLists.length === 0 && (
                <div className="mt-8">
                  <SectionHeader label="Priority shelves" readout={0} />
                  <Surface tone="card" radius="card" pad={4} className="mt-3">
                    <p className="text-[14px] leading-relaxed text-muted">
                      Keep a shelf close by marking it as a priority in Shelves.
                    </p>
                    <button
                      type="button"
                      onClick={() => void navigate({ to: '/shelves' })}
                      className="skin-control skin-btn-secondary mt-3 min-h-11 px-4 text-[13px] font-semibold"
                    >
                      Open shelves
                    </button>
                  </Surface>
                </div>
              )}
            </div>
          )}

          {/* coming soon */}
          {homeModule === 'releases' && (
            <div data-home-module="releases">
              {soon.length > 0 ? (
                <div className="mt-8">
                  <SectionHeader label="Coming soon" readout={soon.length} />
                  <p className="mb-3 mt-1 text-[13px] leading-[1.5] text-muted">
                    Releases you’re tracking over the next four months.
                  </p>
                  <div
                    className="flex snap-x gap-4 overflow-x-auto pb-2"
                    style={{ scrollbarWidth: 'none' }}
                  >
                    {soon.map(({ b }) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => openBook(b.id)}
                        className="w-28 flex-none snap-start text-left"
                        aria-label={`Open ${b.title}`}
                      >
                        <div
                          className="skin-card aspect-[2/3] overflow-hidden border border-line"
                          style={{ background: 'var(--field)', boxShadow: 'var(--shadow)' }}
                        >
                          <CoverImage book={b} />
                        </div>
                        <div className="mt-2 break-words text-[13px] font-semibold leading-[1.35] text-ink">
                          {b.title}
                        </div>
                        <div className="mt-0.5 text-[12px] text-primary">
                          {b.pub.m ? `${MONTHS[b.pub.m - 1]} ` : ''}
                          {b.pub.y}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : books ? (
                <div className="mt-8">
                  <SectionHeader label="Coming soon" readout={0} />
                  <p className="mt-2 text-[13px] leading-relaxed text-muted">
                    No releases from your library fall within the next four months.
                  </p>
                </div>
              ) : null}
            </div>
          )}

          {homeModule === 'year' && (
            <div data-home-module="year">
              {goalTarget > 0 || yearReads.length > 0 ? (
                <Frame className="mt-8 flex flex-wrap items-center gap-5 p-5">
                  {goalTarget > 0 && (
                    <button
                      type="button"
                      onClick={setGoal}
                      aria-label={`Set your ${YEAR} reading goal`}
                    >
                      <SignatureRing value={uniqueThisYear} max={goalTarget} size={96} />
                    </button>
                  )}
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[20px] font-semibold text-ink">Your reading year</h2>
                    <p className="mt-1 text-[14px] leading-relaxed text-ink">
                      {yearReads.length} read{yearReads.length !== 1 ? 's' : ''} logged in {YEAR}
                      {yearReads.length !== uniqueThisYear ? ` across ${uniqueThisYear} books` : ''}
                      .
                      {goalTarget > 0
                        ? ` ${uniqueThisYear} of ${goalTarget} books in your goal.`
                        : ''}
                    </p>
                    {goalTarget > 0 && uniqueThisYear >= goalTarget && (
                      <p className="mt-2 text-[14px] italic text-[color:var(--accent-ink)]">
                        {voice.milestone}
                      </p>
                    )}
                    {goalTarget > 0 && uniqueThisYear > 0 && uniqueThisYear < goalTarget && (
                      <p className="mt-2 text-[14px] italic text-[color:var(--accent-ink)]">
                        {voice.season}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <StatusTag tone="muted">
                        {all.filter(isPossessed).length} owned or borrowed
                      </StatusTag>
                      <StatusTag glyph="♥">{all.filter((b) => b.fave).length} faves</StatusTag>
                      {priorityLists.length > 0 && (
                        <StatusTag glyph={<BookmarkGlyph />}>{priorityTotal} priority</StatusTag>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={setGoal}
                    className="skin-control skin-btn-secondary min-h-11 px-4 text-[14px]"
                  >
                    {goalTarget > 0 ? 'Edit goal' : 'Set a reading goal'}
                  </button>
                </Frame>
              ) : books ? (
                <button
                  type="button"
                  onClick={setGoal}
                  className="skin-control mt-8 min-h-11 px-3 text-[14px] text-muted"
                >
                  Set a reading goal
                </button>
              ) : null}
            </div>
          )}
        </Fragment>
      ))}

      {finishing && <LogReadForm book={finishing} onClose={() => setFinishing(null)} />}

      {progressing && (
        <ReadingProgressDialog
          book={all.find((book) => book.id === progressing.id) ?? progressing}
          onClose={() => setProgressing(null)}
          onSaved={(progress) => setProgressMessage(`Progress saved at ${progress}%.`)}
        />
      )}

      {readingPickerOpen && (
        <LibraryPicker
          title="Add to Reading now"
          books={all}
          excludeIds={
            new Set(
              all.filter((b) => b.readStatus === 'Reading' && !b.readingNowHidden).map((b) => b.id),
            )
          }
          onPick={startReading}
          onClose={() => setReadingPickerOpen(false)}
        />
      )}

      {railPickerFor && (
        <LibraryPicker
          title={`Add to ${railPickerFor.name}`}
          books={all}
          excludeIds={new Set(booksFor(railPickerFor.id).map((b) => b.id))}
          onPick={(b) => {
            const positions = (items ?? [])
              .filter((it) => it.list_id === railPickerFor.id)
              .map((it) => it.position ?? 0)
            addItem.mutate({
              listId: railPickerFor.id,
              bookId: b.id,
              afterPosition: Math.max(0, ...positions),
            })
          }}
          onClose={() => setRailPickerFor(null)}
          // Same shelf-add seam as /shelves and the shelf detail page — without it a book you don't
          // own can't be added to a priority shelf from Home. (Follow-up to #64.)
          onExternalSearch={() => {
            const l = railPickerFor
            setRailPickerFor(null)
            setRailExternalFor(l)
          }}
        />
      )}

      {railExternalFor && (
        <ExternalSearchSheet
          listId={railExternalFor.id}
          listName={railExternalFor.name}
          books={all}
          onClose={() => setRailExternalFor(null)}
        />
      )}

      {/* Removing from Reading Now ≠ un-marking as reading. Two explicit outcomes, progress kept
          either way: set it aside (status → Unread, resume anytime) or hide it here only. */}
      {removing && (
        <Modal title={`Remove “${removing.title}”?`} onClose={() => setRemoving(null)}>
          <p className="text-[13.5px] text-muted">
            Your {removing.progress}% progress is kept either way — this only changes where it
            shows.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <button
              type="button"
              onClick={() => {
                updateBook.mutate({ id: removing.id, patch: { readStatus: 'Unread' } })
                setRemoving(null)
              }}
              className="skin-control skin-btn-primary px-4 py-2.5 text-[13.5px]"
            >
              Set it aside — back to Unread, resume anytime
            </button>
            <button
              type="button"
              onClick={() => {
                updateBook.mutate({ id: removing.id, patch: { readingNowHidden: true } })
                setRemoving(null)
              }}
              className="skin-control border border-line px-4 py-2.5 text-[13.5px] text-ink"
              style={{ background: 'var(--field)' }}
            >
              Keep reading — just hide it from Home
            </button>
            <button
              type="button"
              onClick={() => setRemoving(null)}
              className="px-4 py-1.5 text-[13px] text-muted"
            >
              Cancel
            </button>
          </div>
        </Modal>
      )}
    </section>
  )
}

export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeScreen,
})
