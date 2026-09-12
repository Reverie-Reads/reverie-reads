import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createRoute, Link, useNavigate } from '@tanstack/react-router'
import {
  hiddenMatchCount,
  inDefaultLibrary,
  matchesFilters,
  sortBooks,
  withIntensityHidden,
  withIntensityHiddenSort,
  type Book,
  type LibraryShelfLink,
} from '@reverie/core'
import { rootRoute } from './RootRoute'
import { useBooks, useUpdateBook } from '../data/books'
import { useHideIntensity } from '../data/profile'
import { useFilters } from '../library/filterStore'
import { Toolbar } from '../library/Toolbar'
import { FilterPanel } from '../library/FilterPanel'
import { CoverCard } from '../components/CoverCard'
import { CoverSheet } from '../components/CoverSheet'
import { BookDetailRail } from '../components/BookDetailRail'
import { DrawerDialog } from '../components/DrawerDialog'
import {
  HouseholdBookCard,
  HouseholdBookDetail,
  LibraryScopeControl,
  type HouseholdCorpusEdit,
  type LibraryScope,
} from '../components/HouseholdLibrary'
import { Surface } from '../components/Surface'
import {
  labelHouseholdData,
  useAdminReviewHouseholdCoverForCorpus,
  useHouseholdBookSelection,
  useHouseholdLibraryAuthorization,
  useRemoveHouseholdWork,
  useSetHouseholdMemberLibraryAdds,
  useUpdateCorpusWorkMetadata,
  type HouseholdBook,
  type HouseholdBookOwner,
} from '../data/household'
import { useAuth } from '../auth/AuthProvider'
import { useIsDesktop, useIsWide } from '../hooks/useMediaQuery'
import { useVoice } from '../skin/labels'
import { SectionHeader, SignatureEmblem } from '../components/Structure'
import { PageHeader } from '../components/PageHeader'
import { LibraryNavigation } from '../components/LibraryNavigation'
import { useAdminAddCorpusWorkTrope, useCorpusAdminStatus } from '../data/enrichCorpus'

function Centered({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center text-muted">
      {children}
    </section>
  )
}

function EmptyState() {
  // The empty state speaks in the active skin's VOICE (Tryst sultry-warm · Aphelion spacefarer-spare),
  // led by the skin's signature motif — the Skin Character voice lever, never hardcoded.
  const voice = useVoice()
  return (
    <section className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <SignatureEmblem fallback={voice.motif} size={40} />
      <h1
        className="mt-3 max-w-[18ch] text-balance text-[40px] italic leading-[1.05] text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        {voice.empty.heading}
      </h1>
      <p className="mt-4 max-w-[42ch] text-[15px] leading-relaxed text-muted">{voice.empty.body}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
        <Link
          to="/add"
          className="skin-control skin-btn-primary flex h-11 items-center px-6 text-[14px]"
        >
          ＋ {voice.empty.cta}
        </Link>
        <Link
          to="/settings"
          className="skin-control skin-btn-secondary flex h-11 items-center px-5 text-[14px]"
        >
          Import books
        </Link>
      </div>
    </section>
  )
}

const COVER_GRID: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(144px, 1fr))',
  // Metadata is intentionally natural-height. Pin grid items to the row start so a two-line title
  // cannot baseline-align its shorter neighbours and shift their cover tops out of line.
  alignItems: 'start',
  columnGap: '18px',
  rowGap: '40px',
}

function DetailDrawer({
  book,
  onClose,
  onToggleFave,
}: {
  book: Book
  onClose: () => void
  onToggleFave: (id: string) => void
}) {
  return (
    <DrawerDialog title={`${book.title} details`} closeLabel="Close details" onClose={onClose}>
      <BookDetailRail book={book} onToggleFave={onToggleFave} />
    </DrawerDialog>
  )
}

function PersonalLibraryScreen() {
  const { data: books, isLoading, isError, error } = useBooks()
  const hideIntensity = useHideIntensity()
  /*
   * The EFFECTIVE filter state for a hidden-spice reader. Derived once, here, so every consumer
   * below — the grid, the sort, and hiddenMatchCount's badge — reads the same object and cannot
   * disagree about what is filtering. Without this, a level selected before hiding keeps
   * constraining the grid with its clear-it chip no longer on screen.
   */
  const rawFilters = useFilters((s) => s.filters)
  const filters = useMemo(
    () => withIntensityHidden(rawFilters, hideIntensity),
    [rawFilters, hideIntensity],
  )
  const sort = withIntensityHiddenSort(filters.sort, hideIntensity)
  const panelOpen = useFilters((s) => s.panelOpen)
  const togglePanel = useFilters((s) => s.togglePanel)
  const setShelf = useFilters((s) => s.setShelf)
  // The withheld-matches line REVEALS BY DRIVING THE CHIP — the same action ⊹ Show wishlist fires,
  // not a second switch beside it. A parallel piece of state would be free to disagree with the
  // chip (line says shown, chip says off), and the reader would have two controls for one scope.
  const toggleWishlist = useFilters((s) => s.toggleWishlist)
  const updateBook = useUpdateBook()
  const navigate = useNavigate()
  // A shelf link is a one-time arrival, not a persistent URL param: it seeds the filter store on the
  // way in (so Owned/Borrowed/Read/Wishlist land pre-filtered) and the reader can clear it like any
  // other facet from there — Clear all, or picking the same value off, both leave the URL alone.
  const { shelf } = libraryRoute.useSearch()
  useEffect(() => {
    if (shelf) setShelf(shelf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shelf])
  const isDesktop = useIsDesktop() // ≥ lg: select in place (rail), else navigate to the book route
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [coverSheetId, setCoverSheetId] = useState<string | null>(null) // placeholder "add a cover"
  const voice = useVoice()

  const visible = useMemo(
    () =>
      books
        ? sortBooks(
            books.filter((b) => matchesFilters(b, filters)),
            sort,
          )
        : [],
    [books, filters, sort],
  )
  // The default library — what you have in hand (owned or borrowed) or have read. Wishlist and
  // unset-unread records join in only via the filter chip (docs/archive/task-ownership-v2.md).
  const libraryBooks = useMemo(() => (books ?? []).filter(inDefaultLibrary), [books])
  // SAY WHAT YOU SILENTLY DID.
  //
  // The scope gate above is a deliberate model and stays exactly as it is — the defect it caused
  // was never the filtering, it was the SILENCE. An exact-title query is the strongest intent
  // signal a reader can send, and a view default was overruling it with nothing on screen to say
  // so; the only escape was a chip whose label ("⊹ Show wishlist") never advertises that it
  // governs search results.
  //
  // Third surface in this app with that shape, so it is worth naming rather than fixing once more
  // in isolation. The sibling is DuplicateReview's `differs` line, which states the values a merge
  // silently kept over the ones it discarded (components/DuplicateReview.tsx). The one still
  // unnarrated is Discover's fn-down fallback, which substitutes curated content for live results
  // indistinguishably. Each does something defensible and does it quietly; the fix is never to stop
  // doing it, it is to say so — and, where there is a way to undo it, to offer that in the same
  // breath.
  //
  // Two properties this line borrows from the differs line, both load-bearing: the count is REAL
  // (hiddenMatchCount runs the books through matchesFilters itself, so it cannot disagree with the
  // grid it annotates) and it renders NOTHING at zero, which is most searches. A standing "0
  // hidden" is what teaches a reader to stop reading the line.
  const hiddenCount = useMemo(() => hiddenMatchCount(books ?? [], filters), [books, filters])

  if (isLoading) {
    return (
      <div className="flex min-h-full flex-col px-4 py-6 sm:px-6">
        <LibraryHeader scope="personal" readout="Loading…" />
        <Centered>{voice.loading}</Centered>
      </div>
    )
  }
  if (isError) {
    return (
      <div className="flex min-h-full flex-col px-4 py-6 sm:px-6">
        <LibraryHeader scope="personal" readout="Unavailable" />
        <Centered>Couldn’t load your library — {(error as Error).message}</Centered>
      </div>
    )
  }
  if (!books || books.length === 0) {
    return (
      <div className="flex min-h-full flex-col px-4 py-6 sm:px-6">
        <LibraryHeader scope="personal" readout="0 books · 0 faves" />
        <EmptyState />
      </div>
    )
  }

  const toggleFave = (id: string, fave: boolean) =>
    updateBook.mutate({ id, patch: { fave: !fave } })

  const activate = (id: string) => {
    if (isDesktop) setSelectedId(id)
    else void navigate({ to: '/book/$bookId', params: { bookId: id } })
  }

  // The "/ total" readout compares against the active scope: the default library by default,
  // everything when the wishlist chip is on.
  const baseCount = filters.wishlist ? books.length : libraryBooks.length

  const selected = (selectedId && visible.find((b) => b.id === selectedId)) || null
  const coverSheetBook = (coverSheetId && books.find((b) => b.id === coverSheetId)) || null
  const center = (
    <div className="mx-auto min-w-0 w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <LibraryHeader
        scope="personal"
        readout={`${libraryBooks.length} books · ${libraryBooks.filter((b) => b.fave).length} faves`}
        className="mb-5"
      />

      <Toolbar />

      {hiddenCount > 0 && (
        <p
          role="status"
          data-testid="search-hidden-notice"
          className="mb-3 text-[12.5px] text-muted"
        >
          {hiddenCount} {hiddenCount === 1 ? 'match' : 'matches'} hidden by filters —{' '}
          <button
            type="button"
            data-testid="search-hidden-reveal"
            /*
             * PRESS BEFORE THE BLUR. This control sits directly under the search box, and while
             * that box holds focus Toolbar renders SearchResultsPanel. A mousedown here blurs the
             * input, the panel unmounts mid-press, the line JUMPS UP into the space the panel was
             * occupying, and mouseup therefore lands on a different element than mousedown — the
             * browser fires `click` on their common ancestor instead of on this button. The
             * reader's first press does nothing on the one path this feature is for: type a query,
             * read the line, press "show".
             *
             * RIGHT ANSWER, WRONG REASON — corrected from this commit's own first description,
             * which said the panel was absolutely positioned and the button was vaguely
             * "re-laid-out". The fix below was correct; the mechanism given for it was not, and a
             * reviewer navigating by it would carry the wrong model of the whole `Frame` thread.
             * What is actually true, measured on `feat/search-withheld-notice` (dd7e287):
             * `SearchResultsPanel` is handed `absolute` in its className but `Frame` also applies
             * `relative`, and `relative` WINS — so the panel is IN FLOW and reserves 77.8px of
             * vertical space. Removing it collapses that space and this line moves top 246.75 →
             * 169.0 mid-gesture. Vertical overlap between panel and line measures 0.0px, so there
             * was never any occlusion to work around.
             *
             * The original reading came from reading a CLASS STRING (`absolute left-0 right-0
             * z-30`) instead of a computed style — the exact proxy this repo's own testing rules
             * warn about, committed while writing a comment about measuring rather than reasoning.
             *
             * The observations that were right and still stand: with a plain onClick, native
             * listeners recorded `pointerdown` and `mousedown` and then neither `mouseup` nor
             * `click`, and `document.elementFromPoint` at the button's centre returned the button
             * itself — nothing was intercepting it.
             *
             * SearchResultsPanel's own rows already carry this guard, with the same reason in a
             * comment ("mousedown so the pick lands before the input's blur closes the panel").
             * Second control to need it, which makes it a property of sitting under that panel.
             *
             * onClick stays: it is what the keyboard uses, and the keyboard never takes this path.
             */
            onMouseDown={(e) => e.preventDefault()}
            onClick={toggleWishlist}
            aria-label="Show matches hidden by filters"
            className="underline underline-offset-2"
            style={{ color: 'var(--accent-ink)' }}
          >
            show
          </button>
        </p>
      )}

      <SectionHeader
        className="mb-4 mt-6"
        label="Your library"
        readout={`${visible.length}${visible.length !== baseCount ? ` / ${baseCount}` : ''}`}
      />

      {visible.length ? (
        <div style={COVER_GRID}>
          {visible.map((b) => (
            <CoverCard
              hideIntensity={hideIntensity}
              key={b.id}
              book={b}
              selected={isDesktop && b.id === selectedId}
              onOpen={() => activate(b.id)}
              onToggleFave={() => toggleFave(b.id, b.fave)}
              onAddCover={() => setCoverSheetId(b.id)}
            />
          ))}
        </div>
      ) : (
        <p className="px-2 py-10 text-center text-[14px] text-muted">{voice.miss}</p>
      )}
    </div>
  )

  return (
    <>
      {center}

      {isDesktop && selected && (
        <DetailDrawer
          book={selected}
          onClose={() => setSelectedId(null)}
          onToggleFave={(id) => toggleFave(id, selected.fave)}
        />
      )}

      {panelOpen ? (
        <div
          className="pointer-events-none fixed inset-0 z-40"
          role="dialog"
          aria-label="Library filters"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{ background: 'color-mix(in srgb, var(--bg0) 58%, transparent)' }}
          />
          <aside
            className="pointer-events-auto absolute bottom-0 left-0 top-0 w-[min(390px,94vw)] overflow-y-auto border-r border-line p-5 pb-24 sm:pb-5"
            style={{ background: 'var(--bg1)', boxShadow: 'var(--shadow)' }}
          >
            <div
              className="sticky top-0 z-10 mb-4 flex items-center justify-between border-b border-line pb-4"
              style={{ background: 'var(--bg1)' }}
            >
              <div>
                <span className="skin-label text-[10px]" style={{ color: 'var(--accent-ink)' }}>
                  Refine results
                </span>
                <h2
                  className="mt-1 text-[24px] font-semibold text-ink"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Filters
                </h2>
              </div>
              <button
                type="button"
                onClick={togglePanel}
                className="skin-control skin-btn-icon grid h-9 w-9 place-items-center"
                aria-label="Close filters"
              >
                ×
              </button>
            </div>
            <FilterPanel books={books} bare />
            <button
              type="button"
              onClick={togglePanel}
              className="skin-control skin-btn-primary sticky bottom-[78px] mt-5 h-11 w-full px-5 text-[12px] sm:bottom-3"
            >
              Show {visible.length} books
            </button>
          </aside>
        </div>
      ) : null}

      {/* the placeholder's quiet "add a cover" affordance opens the same sheet as book detail */}
      {coverSheetBook && <CoverSheet book={coverSheetBook} onClose={() => setCoverSheetId(null)} />}
    </>
  )
}

function ScopeSwitch({ scope }: { scope: LibraryScope }) {
  const navigate = useNavigate()
  const setScope = (next: LibraryScope) =>
    void navigate({
      to: '/library',
      search: next === 'household' ? { scope: 'household' } : {},
      replace: true,
    })
  return <LibraryScopeControl scope={scope} onChange={setScope} />
}

export function LibraryHeader({
  scope,
  readout,
  className = '',
}: {
  scope: LibraryScope
  readout: string
  className?: string
}) {
  return (
    <>
      <PageHeader
        className={className}
        eyebrow={readout}
        title={scope === 'household' ? 'Household library' : 'My library'}
        descriptionIsTip={scope === 'personal'}
        description={
          scope === 'household'
            ? 'The books shared across your household, with every reader’s copy kept distinct.'
            : 'Search, filter, and rediscover the books you’ve made part of your reading life.'
        }
        actions={
          <>
            <ScopeSwitch scope={scope} />
            <Link
              to="/add"
              search={scope === 'household' ? { scope: 'household' } : {}}
              className="skin-control skin-btn-primary flex min-h-11 items-center px-4 text-[14px]"
            >
              ＋ Add books
            </Link>
          </>
        }
      />
      {scope === 'personal' && <LibraryNavigation current="books" className="mb-4 mt-4" />}
    </>
  )
}

function HouseholdCentered({ children }: { children: ReactNode }) {
  return (
    <Surface
      tone="field"
      radius="panel"
      pad={5}
      className="mx-auto my-10 max-w-xl text-center text-[14px] text-muted"
    >
      {children}
    </Surface>
  )
}

function HouseholdDetailDrawer({
  book,
  currentReaderId,
  onClose,
  onRemove,
  removing,
  onAddCorpusTrope,
  addingCorpusTrope,
  onEditCorpus,
  editingCorpus,
  onReviewCover,
  reviewingCoverBookId,
}: {
  book: HouseholdBook
  currentReaderId: string
  onClose: () => void
  onRemove?: () => void
  removing: boolean
  onAddCorpusTrope?: (name: string) => Promise<void>
  addingCorpusTrope?: boolean
  onEditCorpus?: (patch: HouseholdCorpusEdit) => Promise<void>
  editingCorpus?: boolean
  onReviewCover?: (owner: HouseholdBookOwner) => Promise<void>
  reviewingCoverBookId?: string | null
}) {
  return (
    <DrawerDialog
      title={`${book.title} household details`}
      closeLabel="Close household details"
      onClose={onClose}
    >
      <HouseholdBookDetail
        book={book}
        currentReaderId={currentReaderId}
        onRemove={onRemove}
        removing={removing}
        onAddCorpusTrope={onAddCorpusTrope}
        addingCorpusTrope={addingCorpusTrope}
        onEditCorpus={onEditCorpus}
        editingCorpus={editingCorpus}
        onReviewCover={onReviewCover}
        reviewingCoverBookId={reviewingCoverBookId}
      />
    </DrawerDialog>
  )
}

function HouseholdLibraryScreen() {
  const { session } = useAuth()
  const currentReaderId = session?.user.id ?? ''
  const household = useHouseholdLibraryAuthorization()
  const setMemberLibraryAdds = useSetHouseholdMemberLibraryAdds()
  const removeWork = useRemoveHouseholdWork()
  const updateCorpus = useUpdateCorpusWorkMetadata()
  const reviewHouseholdCover = useAdminReviewHouseholdCoverForCorpus()
  const { data: isCorpusAdmin = false } = useCorpusAdminStatus()
  const addCorpusTrope = useAdminAddCorpusWorkTrope()
  const isWide = useIsWide()

  const labelled = useMemo(
    () => labelHouseholdData(household.members, household.books, currentReaderId),
    [currentReaderId, household.members, household.books],
  )
  const members = labelled.members
  const books = labelled.books
  const currentMember = members.find((member) => member.userId === currentReaderId)
  const hasHousehold = household.authorized && members.length > 0
  const canEditCorpus =
    isCorpusAdmin ||
    members.some((member) => member.userId === currentReaderId && member.role === 'owner')
  const availableBooks = useMemo(() => (hasHousehold ? books : []), [books, hasHousehold])
  const selection = useHouseholdBookSelection({
    householdId: household.householdId,
    books: availableBooks,
    authorized: hasHousehold,
    loading: household.loading,
  })
  const editCorpus = async (book: HouseholdBook, patch: HouseholdCorpusEdit): Promise<void> => {
    await updateCorpus.mutateAsync({ workId: book.id, ...patch })
  }
  const reviewCover = async (book: HouseholdBook, owner: HouseholdBookOwner): Promise<void> => {
    if (!household.householdId || !owner.cover) return
    await reviewHouseholdCover.mutateAsync({
      householdId: household.householdId,
      bookId: owner.bookId,
      workId: book.id,
      coverUrl: owner.cover,
    })
  }
  const selected = selection.selected
  const removeFromHousehold = (book: HouseholdBook) => {
    if (
      !window.confirm(
        `Remove ${book.title} from the household library? Personal libraries and the corpus will stay unchanged.`,
      )
    )
      return
    removeWork.mutate(book.id, { onSuccess: selection.clear })
  }

  const dockedBook =
    isWide && availableBooks.length > 0 ? (selected ?? availableBooks[0] ?? null) : null
  const onlyCurrentMember =
    hasHousehold &&
    members.length === 1 &&
    !!currentReaderId &&
    members[0]?.userId === currentReaderId
  const householdName = hasHousehold ? (members[0]?.householdName ?? 'Household') : 'Household'

  const center = (
    <div className="min-w-0 px-4 py-6 sm:px-6 lg:px-7">
      <LibraryHeader scope="household" readout="Household · shared" className="mb-4" />

      {household.paused ? (
        <HouseholdCentered>
          Household access can’t be verified while offline. Reconnect to view the household library.
        </HouseholdCentered>
      ) : household.loading ? (
        <HouseholdCentered>Loading the household library…</HouseholdCentered>
      ) : household.error ? (
        <HouseholdCentered>
          Couldn’t load the household library — {(household.error as Error).message}
        </HouseholdCentered>
      ) : members.length === 0 ? (
        <HouseholdCentered>
          <h2 className="text-[18px] font-semibold text-ink">No household linked</h2>
          <p className="mt-2">
            Household access is not set up for this account. Your personal books remain in My
            library.
          </p>
        </HouseholdCentered>
      ) : (
        <>
          <Surface tone="field" radius="panel" pad={2} className="mb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-ink">{householdName}</h2>
                <p className="mt-0.5 text-[12px] text-muted">
                  {members.length} {members.length === 1 ? 'member' : 'members'} · one shared entry
                  per work
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5" aria-label="Household members">
                {members.map((member) => (
                  <span
                    key={member.userId}
                    className="skin-control px-2.5 py-1 text-[11.5px] font-semibold text-ink"
                    style={{ background: 'var(--chip)' }}
                  >
                    {member.displayName}
                    {member.userId === currentReaderId ? ' (you)' : ''}
                  </span>
                ))}
              </div>
            </div>
            {currentMember ? (
              <label className="mt-3 flex items-start gap-2.5 border-t border-line pt-3 text-[12.5px] text-ink">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={currentMember.allowMemberLibraryAdds}
                  disabled={setMemberLibraryAdds.isPending}
                  onChange={(event) => setMemberLibraryAdds.mutate(event.target.checked)}
                />
                <span>
                  Let household members add books to my personal library
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-muted">
                    Adds neutral book records only. They cannot set ownership, reading history,
                    ratings, or private details for you.
                  </span>
                </span>
              </label>
            ) : null}
          </Surface>

          {onlyCurrentMember ? (
            <Surface
              tone="field"
              radius="control"
              pad={2}
              role="status"
              className="mb-4 text-[12.5px] text-muted"
            >
              You’re the only household member left. Household entries remain independent of your
              personal library.
            </Surface>
          ) : null}

          {availableBooks.length === 0 ? (
            <HouseholdCentered>
              <h2 className="text-[18px] font-semibold text-ink">
                {onlyCurrentMember ? 'Your household library is empty' : 'No household books yet'}
              </h2>
              <p className="mt-2">
                {onlyCurrentMember
                  ? 'Add a shared book directly, add an owned book, or explicitly share a borrowed copy.'
                  : 'Add shared books directly. Owned copies join automatically; borrowed copies join only when a member chooses to share them.'}
              </p>
            </HouseholdCentered>
          ) : (
            <>
              <SectionHeader
                label="Household library"
                readout={availableBooks.length}
                className="mb-3"
              />
              <div style={COVER_GRID}>
                {availableBooks.map((book) => (
                  <HouseholdBookCard
                    key={book.id}
                    book={book}
                    currentReaderId={currentReaderId}
                    selected={isWide && dockedBook?.id === book.id}
                    onOpen={() => selection.open(book.id)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )

  return (
    <>
      <section
        className={
          dockedBook ? 'xl:grid xl:items-start xl:grid-cols-[minmax(0,1fr)_360px]' : undefined
        }
      >
        {center}
        {dockedBook ? (
          <aside
            aria-label="Household book details"
            className="hidden xl:sticky xl:top-0 xl:block xl:h-dvh xl:border-l xl:border-line"
          >
            <HouseholdBookDetail
              book={dockedBook}
              currentReaderId={currentReaderId}
              onRemove={
                dockedBook.owners.some((owner) => owner.ownership === 'owned')
                  ? undefined
                  : () => removeFromHousehold(dockedBook)
              }
              removing={removeWork.isPending}
              onAddCorpusTrope={
                isCorpusAdmin
                  ? async (name) => {
                      await addCorpusTrope.mutateAsync({ workId: dockedBook.id, name })
                    }
                  : undefined
              }
              addingCorpusTrope={addCorpusTrope.isPending}
              onEditCorpus={canEditCorpus ? (patch) => editCorpus(dockedBook, patch) : undefined}
              editingCorpus={updateCorpus.isPending}
              onReviewCover={isCorpusAdmin ? (owner) => reviewCover(dockedBook, owner) : undefined}
              reviewingCoverBookId={
                reviewHouseholdCover.isPending
                  ? (reviewHouseholdCover.variables?.bookId ?? null)
                  : null
              }
            />
          </aside>
        ) : null}
      </section>
      {!isWide && selected ? (
        <HouseholdDetailDrawer
          book={selected}
          currentReaderId={currentReaderId}
          onClose={selection.clear}
          onRemove={
            selected.owners.some((owner) => owner.ownership === 'owned')
              ? undefined
              : () => removeFromHousehold(selected)
          }
          removing={removeWork.isPending}
          onAddCorpusTrope={
            isCorpusAdmin
              ? async (name) => {
                  await addCorpusTrope.mutateAsync({ workId: selected.id, name })
                }
              : undefined
          }
          addingCorpusTrope={addCorpusTrope.isPending}
          onEditCorpus={canEditCorpus ? (patch) => editCorpus(selected, patch) : undefined}
          editingCorpus={updateCorpus.isPending}
          onReviewCover={isCorpusAdmin ? (owner) => reviewCover(selected, owner) : undefined}
          reviewingCoverBookId={
            reviewHouseholdCover.isPending ? (reviewHouseholdCover.variables?.bookId ?? null) : null
          }
        />
      ) : null}
    </>
  )
}

function LibraryScreen() {
  const { scope } = libraryRoute.useSearch()
  return scope === 'household' ? <HouseholdLibraryScreen /> : <PersonalLibraryScreen />
}

const SHELF_LINK_VALUES: readonly LibraryShelfLink[] = ['owned', 'borrowed', 'read', 'wishlist']

export interface LibraryRouteSearch {
  shelf?: LibraryShelfLink
  scope?: 'household'
}

export const validateLibrarySearch = (search: Record<string, unknown>): LibraryRouteSearch => ({
  shelf: SHELF_LINK_VALUES.includes(search.shelf as LibraryShelfLink)
    ? (search.shelf as LibraryShelfLink)
    : undefined,
  // Personal is represented by absence. Every unknown or array-valued input fails closed to it.
  scope: search.scope === 'household' ? 'household' : undefined,
})

export const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'library',
  // Deep link from a /shelves derived-shelf header (the AuthRoute `?mode=` pattern) — undefined
  // means "no shelf link", so plain /library stays the canonical URL.
  validateSearch: validateLibrarySearch,
  component: LibraryScreen,
})
