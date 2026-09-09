import { useRef, useState } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import {
  authorOf,
  deriveShelfSections,
  visibleSections,
  type Book,
  type ShelfBreakdowns,
  type ShelfKey,
  type ShelfSectionKey,
} from '@reverie/core'
import { rootRoute } from './RootRoute'
import { useBooks } from '../data/books'
import {
  useCreateList,
  useDeleteList,
  useLists,
  useReorderList,
  useReorderLists,
  useUpdateList,
  type UiList,
} from '../data/lists'
import { useAddListItem, useAllListItems, useRemoveListItem } from '../data/listItems'
import { LibraryPicker } from '../components/LibraryPicker'
import { ExternalSearchSheet } from '../components/ExternalSearchSheet'
import { SpineShelf } from '../components/SpineShelf'
import { Modal } from '../components/Modal'
import { BookmarkGlyph } from '../components/BookmarkGlyph'
import { Switch } from '../components/Switch'
import { useProfile, useUpdateProfile } from '../data/profile'
import { Surface } from '../components/Surface'
import { PageHeader } from '../components/PageHeader'
import { LibraryNavigation } from '../components/LibraryNavigation'
import { UtilityGlyph } from '../components/UtilityGlyph'

type Tab = 'tbr' | 'collection'

function ListModal({
  list,
  books,
  onClose,
  onOpenBook,
}: {
  list: UiList
  books: Book[]
  onClose: () => void
  onOpenBook: (id: string) => void
}) {
  const updateList = useUpdateList()
  const deleteList = useDeleteList()
  const reorder = useReorderList()
  const removeItem = useRemoveListItem()
  const [order, setOrder] = useState(books.map((b) => b.id))
  const byId = new Map(books.map((b) => [b.id, b]))

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    const a = next[i]
    const b = next[j]
    if (a === undefined || b === undefined) return
    next[i] = b
    next[j] = a
    setOrder(next)
    reorder.mutate({ listId: list.id, orderedBookIds: next })
  }

  return (
    <Modal title={list.name} onClose={onClose}>
      <div className="-mt-2 mb-4 flex flex-wrap gap-2">
        {/* Priority is for every kind now — the flag is the cap, home renders all flagged shelves. */}
        <button
          type="button"
          onClick={() => updateList.mutate({ id: list.id, isPriority: !list.priority })}
          className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink"
          style={{ background: 'var(--card)' }}
        >
          <BookmarkGlyph filled={list.priority} />{' '}
          {list.priority ? 'Priority list' : 'Make priority'}
        </button>
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Rename:', list.name)
            if (name?.trim()) updateList.mutate({ id: list.id, name: name.trim() })
          }}
          className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink"
          style={{ background: 'var(--card)' }}
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Delete this list? (Books stay in your library.)')) {
              deleteList.mutate(list.id, { onSuccess: onClose })
            }
          }}
          className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-primary"
          style={{ background: 'var(--card)' }}
        >
          Delete list
        </button>
      </div>

      {order.length ? (
        <ul className="flex flex-col gap-1.5">
          {order.map((id, i) => {
            const b = byId.get(id)
            if (!b) return null
            return (
              <Surface
                as="li"
                key={id}
                radius="card"
                tone="field"
                pad={0}
                className="flex items-center gap-2 px-3 py-2"
              >
                <span className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    aria-label="Move up"
                    className="px-1 py-0.5 text-[12px] leading-none text-muted"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, 1)}
                    aria-label="Move down"
                    className="px-1 py-0.5 text-[12px] leading-none text-muted"
                  >
                    ▼
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => onOpenBook(id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className="block break-words text-[14px] font-semibold text-ink"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {b.title}
                  </span>
                  <span className="block break-words text-[12px] text-muted">{authorOf(b)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    removeItem.mutate({ listId: list.id, bookId: id })
                    setOrder((prev) => prev.filter((x) => x !== id))
                  }}
                  className="text-[12px] text-muted hover:text-primary"
                >
                  remove
                </button>
              </Surface>
            )
          })}
        </ul>
      ) : (
        <p className="text-[13px] text-muted">
          Empty — open any book and use “Lists &amp; shelves” to add it here.
        </p>
      )}
    </Modal>
  )
}

// ── the derived shelves ─────────────────────────────────────────────────────────────────────────
// Every string a reader sees lives here, in one block, so copy can be reviewed without reading the
// render. Membership itself is in @reverie/core (deriveShelfSections) and has no strings at all.

/** Section headings. Glyphs match the marks the same states already wear on covers — ⇄ borrowed,
 *  ⊹ wishlist, ⊘ DNF — so a shelf and a pill read as the same fact, not two vocabularies. */
const SECTION_LABEL: Record<ShelfSectionKey, string> = {
  owned: 'Owned',
  borrowed: '⇄ Borrowed',
  read: 'Read',
  wishlist: '⊹ Wishlist',
}

/** Shelf headings within a section. A section with one shelf shows no shelf heading — the section
 *  heading already said it — so only the split shelves need names. */
const SHELF_LABEL: Partial<Record<ShelfKey, string>> = {
  ownedPhysical: '📖 Physical',
  ownedEbook: '📱 Ebook',
  ownedAudiobook: '🎧 Audiobook',
  ownedUnmarked: '📚 Format not set',
  read: 'Read',
  dnf: '⊘ Did not finish',
}

const COPY = {
  groupHeading: 'Your shelves',
  /** Shelves overlap by design; without this the counts read as a partition that does not exist. */
  overlap: 'Views of one library, not folders — a book can sit on more than one.',
  /** Replaces three separate "flip a copy switch" invitations when nothing is on any shelf. */
  groupEmpty:
    'Nothing shelved yet — mark a book owned, borrowed or wanted and it files itself here.',
  /** The bucket holding owned books with no format recorded. Invites the action that empties it. */
  unmarkedHint: 'No format recorded. Mark one on a book and it moves to that shelf.',
  // Parallel by construction, and neither contradicts the heading it produces: the shelf reads
  // "Did not finish", so the control that creates it says the same words rather than abbreviating.
  // (The cover PILL stays "DNF" — it has ~40px to work with; a section header does not.)
  formatToggle: 'Split by format',
  dnfToggle: 'Split out did not finish',
} as const

/** A breakdown toggle, in the header of the section it splits. Profile-synced, so it follows the
 *  reader across devices — the `autoMergeDuplicates` write path, not local state. */
function BreakdownToggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <span className="flex items-center gap-2">
      <span className="text-[12px] text-muted">{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </span>
  )
}

/**
 * The derived shelves — Owned · Borrowed · Read · Wishlist, each a VIEW of the library rather than
 * a list anyone edits. Two profile-synced toggles split Owned by format and DNF out of Read.
 *
 * Empty shelves do not render, and a section with nothing in it goes with them. The screen this
 * replaces rendered three format shelves unconditionally, so a library with no format flags — 98%
 * of production — got the same "flip a copy switch" invitation three times over.
 */
function DerivedShelves({
  books,
  onOpen,
  onOpenSection,
  breakdowns,
  onToggle,
}: {
  books: Book[]
  onOpen: (id: string) => void
  onOpenSection: (key: ShelfSectionKey) => void
  breakdowns: ShelfBreakdowns
  onToggle: (which: 'format' | 'dnf', next: boolean) => void
}) {
  const sections = visibleSections(deriveShelfSections(books, breakdowns))

  return (
    <div className="mb-8">
      <h2 className="text-[16px] font-semibold text-ink">{COPY.groupHeading}</h2>
      <p className="mb-4 text-[12px] text-muted">{COPY.overlap}</p>

      {sections.length === 0 ? (
        <Surface
          as="p"
          radius="panel"
          tone="bare"
          pad={5}
          className="text-center text-[14px] text-muted"
        >
          {COPY.groupEmpty}
        </Surface>
      ) : (
        <div className="flex flex-col gap-7">
          {sections.map((section) => (
            <div key={section.key}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                {/* Same affordance as a "Your lists" header (ShelvesRoute's list-header button below):
                    the whole heading is the link, not just the chevron — one hit target, one pattern. */}
                <button
                  type="button"
                  onClick={() => onOpenSection(section.key)}
                  className="block text-left"
                >
                  <h3 className="text-[15px] font-semibold text-ink underline-offset-4 hover:underline">
                    {SECTION_LABEL[section.key]}{' '}
                    {/* A split section shows no total — a total across overlapping shelves asserts a
                        partition that does not exist. Its shelves carry their own counts. */}
                    {!section.split && (
                      <span className="text-[12px] font-normal text-muted">
                        · {section.shelves[0]!.books.length}
                      </span>
                    )}{' '}
                    <span aria-hidden className="text-[13px] text-muted">
                      ›
                    </span>
                  </h3>
                </button>
                {section.key === 'owned' && (
                  <BreakdownToggle
                    label={COPY.formatToggle}
                    checked={breakdowns.format}
                    onChange={(next) => onToggle('format', next)}
                  />
                )}
                {section.key === 'read' && (
                  <BreakdownToggle
                    label={COPY.dnfToggle}
                    checked={breakdowns.dnf}
                    onChange={(next) => onToggle('dnf', next)}
                  />
                )}
              </div>

              <div className="flex flex-col gap-4">
                {section.shelves.map((shelf) => (
                  <div key={shelf.key}>
                    {/* Only a SPLIT section names its shelves; an unsplit section is already named
                        by its heading, and repeating it reads as two shelves. Keyed off `split`,
                        not the surviving shelf count: with DNF split on and nothing finished, this
                        section holds ONE visible shelf — the DNF one — and labelling it "Read"
                        would file abandoned books under exactly the wrong word. */}
                    {section.split && (
                      <div className="mb-1 text-[13.5px] font-semibold text-ink">
                        {SHELF_LABEL[shelf.key] ?? shelf.key}{' '}
                        <span className="text-[12px] font-normal text-muted">
                          · {shelf.books.length}
                        </span>
                      </div>
                    )}
                    {shelf.key === 'ownedUnmarked' && (
                      <p className="mb-1 text-[12px] text-muted">{COPY.unmarkedHint}</p>
                    )}
                    <SpineShelf books={shelf.books} onOpen={onOpen} compact />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ShelvesScreen() {
  const navigate = useNavigate()
  const { data: books } = useBooks()
  const { data: lists } = useLists()
  const { data: items } = useAllListItems()
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()
  // Profile-synced, per the autoMergeDuplicates pattern — a display preference that follows the
  // reader across devices rather than living in this tab. `?? false` mirrors the column defaults.
  const breakdowns: ShelfBreakdowns = {
    format: profile?.shelfBreakdownFormat ?? false,
    dnf: profile?.shelfBreakdownDnf ?? false,
  }
  const setBreakdown = (which: 'format' | 'dnf', next: boolean) =>
    updateProfile.mutate(
      which === 'format' ? { shelfBreakdownFormat: next } : { shelfBreakdownDnf: next },
    )
  const createList = useCreateList()
  const reorderLists = useReorderLists()
  const addItem = useAddListItem()
  // Tab lives in the ROUTE, not component state: the route tree is flat, so navigating to a shelf
  // fully unmounts this screen and useState would re-initialize on the way back — the reported
  // defect. `undefined` means the default, so /shelves stays the canonical URL and only
  // /shelves?tab=collection carries a param (the AuthRoute ?mode= pattern).
  const { tab = 'tbr' } = shelvesRoute.useSearch()
  const setTab = (t: Tab) =>
    // replace: true — back should leave the page, not undo a tab click.
    void navigate({ to: '/shelves', search: { tab: t === 'tbr' ? undefined : t }, replace: true })
  // The open edit sheet stays COMPONENT state, deliberately, and it is the one thing on this screen
  // that does. It was briefly a search param alongside `tab`, and the consequence is what killed it:
  // a param that survives back-navigation makes the browser's back button re-open a modal nobody
  // clicked, stealing focus on arrival. Losing an edit sheet on back-nav is a smaller cost than
  // gaining one unbidden. See the BACKLOG entry — it names this as considered and declined, not
  // overlooked.
  const [openListId, setOpenListId] = useState<string | null>(null)
  const [pickerFor, setPickerFor] = useState<UiList | null>(null)
  const [externalFor, setExternalFor] = useState<UiList | null>(null)
  const [dragListIdx, setDragListIdx] = useState<number | null>(null)
  // Native dragstart and drop may occur before React has committed the state update from
  // dragstart. Keep the source synchronously available to the drop handler; state remains the
  // render channel for the dragged-row treatment.
  const dragListIdxRef = useRef<number | null>(null)

  const all = books ?? []
  const byId = new Map(all.map((b) => [b.id, b]))
  const openBook = (id: string) => void navigate({ to: '/book/$bookId', params: { bookId: id } })
  const openSection = (key: ShelfSectionKey) =>
    void navigate({ to: '/library', search: { shelf: key } })

  const booksFor = (listId: string): Book[] =>
    (items ?? [])
      .filter((it) => it.list_id === listId)
      .sort((a, b) => (a.position ?? 1e9) - (b.position ?? 1e9))
      .map((it) => byId.get(it.book_id))
      .filter((b): b is Book => !!b)

  // Manual order (useLists sorts by sort_order) — priority no longer jumps the queue here.
  const shown = (lists ?? []).filter((l) => l.kind === tab)

  // Renumber the FULL list set (both kinds) with this tab's segment reordered in place — kinds
  // interleave on Home by the same sort_order, so a tab-local renumber must not collide.
  const applyTabOrder = (tabIds: string[]) => {
    const queue = [...tabIds]
    const full = (lists ?? []).map((l) => (l.kind === tab ? queue.shift()! : l.id))
    reorderLists.mutate(full)
  }

  const moveList = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= shown.length) return
    const ids = shown.map((l) => l.id)
    const a = ids[i]!
    ids[i] = ids[j]!
    ids[j] = a
    applyTabOrder(ids)
  }

  const dropListOn = (target: number) => {
    const source = dragListIdxRef.current
    if (source == null || source === target) return
    const ids = shown.map((l) => l.id)
    const [moved] = ids.splice(source, 1)
    ids.splice(target, 0, moved!)
    dragListIdxRef.current = null
    setDragListIdx(null)
    applyTabOrder(ids)
  }

  const openList = openListId ? (lists ?? []).find((l) => l.id === openListId) : null

  return (
    <section className="px-4 py-6 sm:px-6">
      <PageHeader
        eyebrow="My library"
        title="Shelves"
        description="Browse your books by reading state, format, or the lists you make."
      />
      <LibraryNavigation current="shelves" className="mb-6 mt-4" />

      <DerivedShelves
        books={all}
        onOpen={openBook}
        onOpenSection={openSection}
        breakdowns={breakdowns}
        onToggle={setBreakdown}
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-ink">Your lists</h2>
        <div className="flex items-center gap-2">
          {/* The GROUP's shape follows the skin, like the buttons inside it. `rounded-full` here was
              a hardcoded 999px pill, so the wrapper stayed a pill in all nine skins while its own
              buttons — which carry .skin-control — squared off to `--radius-control`. Measured after
              the fix, wrapper and button now agree in every skin: tryst 999px, bloom 999px,
              aphelion 2px, grimoire 2px, folio 3px, marrow 0px. The visible silhouette is the
              wrapper's, so the pill is what a reader saw regardless of the buttons.

              An arbitrary-value class rather than a kit class, because no existing kit member fits a
              non-interactive grouping box: .skin-control would put control TYPOGRAPHY and motion on
              a div, .skin-control-quiet is documented for controls whose label is data,
              .skin-tile/.skin-panel are the card/panel radius scale rather than the control one, and
              .skin-field adds `clip-path: var(--ctl-clip)`, which would clip the buttons it wraps.
              A new kit class for one site would be overkill. */}
          <Surface radius="control" tone="card" pad={1} className="flex">
            {(['tbr', 'collection'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                aria-pressed={tab === t}
                className="skin-control px-3 py-1.5 text-[12.5px] font-semibold"
                style={
                  tab === t
                    ? { background: 'var(--accent-fill)', color: 'var(--on-primary)' }
                    : { color: 'var(--muted)' }
                }
              >
                {t === 'tbr' ? 'TBRs' : 'Collections'}
              </button>
            ))}
          </Surface>
          <button
            type="button"
            onClick={() => {
              const name = window.prompt(
                tab === 'tbr' ? 'Name this TBR list:' : 'Name this collection:',
              )
              if (name?.trim()) createList.mutate({ name: name.trim(), kind: tab })
            }}
            className="skin-control px-4 py-2 text-[13px] font-semibold"
            style={{
              background: 'linear-gradient(135deg, var(--primary), var(--gold))',
              color: 'var(--on-primary)',
            }}
          >
            ＋ New {tab === 'tbr' ? 'TBR' : 'collection'}
          </button>
        </div>
      </div>

      {shown.length ? (
        <div className="flex flex-col gap-8">
          {shown.map((l, i) => {
            const shelfBooks = booksFor(l.id)
            return (
              // The card is a drop TARGET but not a drag source: making the whole thing draggable
              // meant dragging a book cover picked up the entire shelf instead of doing nothing.
              // The grab handle below is the only place a shelf drag can start.
              <div
                key={l.id}
                // Commit on entry as well as drop: the richer spine preview can put the next shelf
                // beyond the viewport, and Chromium may finish an auto-scrolled native drag
                // without dispatching drop. Only the grab handle seeds dragListIdxRef, so book
                // cover drags still cannot reorder shelves.
                onDragEnter={() => {
                  if (dragListIdxRef.current != null) dropListOn(i)
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => dropListOn(i)}
                style={dragListIdx === i ? { opacity: 0.4 } : undefined}
              >
                <div className="mb-1 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    {/* the shelf's name IS the door to its full page */}
                    <button
                      type="button"
                      onClick={() =>
                        void navigate({ to: '/shelf/$listId', params: { listId: l.id } })
                      }
                      className="block text-left"
                    >
                      <h2
                        className="text-[18px] italic text-ink underline-offset-4 hover:underline"
                        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                      >
                        {l.priority && (
                          <span style={{ color: 'var(--accent-ink)' }}>
                            <BookmarkGlyph size={12} />{' '}
                          </span>
                        )}
                        {l.name}{' '}
                        <span aria-hidden className="text-[13px] text-muted">
                          ›
                        </span>
                      </h2>
                    </button>
                    <p className="text-[12px] text-muted">
                      {shelfBooks.length} book{shelfBooks.length !== 1 ? 's' : ''}
                      {shelfBooks.length > 1 ? ' · scroll the shelf to flip a cover' : ''}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-1.5">
                    <button
                      type="button"
                      draggable
                      onDragStart={() => {
                        dragListIdxRef.current = i
                        setDragListIdx(i)
                      }}
                      onDragEnd={() => {
                        dragListIdxRef.current = null
                        setDragListIdx(null)
                      }}
                      aria-label={`Drag to reorder ${l.name}`}
                      title={`Drag to reorder ${l.name}`}
                      className="grid h-8 w-7 cursor-grab place-items-center text-muted"
                    >
                      <UtilityGlyph name="grip" className="h-[18px] w-[18px]" />
                    </button>
                    <span className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => moveList(i, -1)}
                        aria-label={`Move ${l.name} up`}
                        className="px-1 py-0.5 text-[12px] leading-none text-muted"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => moveList(i, 1)}
                        aria-label={`Move ${l.name} down`}
                        className="px-1 py-0.5 text-[12px] leading-none text-muted"
                      >
                        ▼
                      </button>
                    </span>
                    <button
                      type="button"
                      onClick={() => setOpenListId(l.id)}
                      className="skin-control border border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-ink"
                      style={{ background: 'var(--card)' }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
                {shelfBooks.length ? (
                  <SpineShelf
                    books={shelfBooks}
                    onOpen={openBook}
                    onAdd={() => setPickerFor(l)}
                    addLabel={`Add a book to ${l.name}`}
                    compact
                  />
                ) : (
                  <Surface
                    as="p"
                    radius="panel"
                    tone="bare"
                    pad={3}
                    className="text-[13px] text-muted"
                  >
                    No books yet —{' '}
                    <button
                      type="button"
                      onClick={() => setPickerFor(l)}
                      className="font-semibold text-primary underline-offset-2 hover:underline"
                    >
                      add the first
                    </button>
                    .
                  </Surface>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <Surface
          as="p"
          radius="panel"
          tone="bare"
          pad={5}
          className="text-center text-[14px] text-muted"
        >
          No {tab === 'tbr' ? 'TBRs' : 'collections'} yet — hit ＋ New.
        </Surface>
      )}

      {openList && (
        <ListModal
          list={openList}
          books={booksFor(openList.id)}
          onClose={() => setOpenListId(null)}
          onOpenBook={(id) => {
            setOpenListId(null)
            openBook(id)
          }}
        />
      )}

      {pickerFor && (
        <LibraryPicker
          title={`Add to ${pickerFor.name}`}
          books={all}
          excludeIds={new Set(booksFor(pickerFor.id).map((b) => b.id))}
          onPick={(b) => {
            const positions = (items ?? [])
              .filter((it) => it.list_id === pickerFor.id)
              .map((it) => it.position ?? 0)
            addItem.mutate({
              listId: pickerFor.id,
              bookId: b.id,
              afterPosition: Math.max(0, ...positions),
            })
          }}
          onClose={() => setPickerFor(null)}
          // The external-search seam — same as the shelf detail page. Without it, "search everywhere"
          // stays disabled and a book you don't already own can't be added from the Shelves page.
          onExternalSearch={() => {
            const l = pickerFor
            setPickerFor(null)
            setExternalFor(l)
          }}
        />
      )}

      {externalFor && (
        <ExternalSearchSheet
          listId={externalFor.id}
          listName={externalFor.name}
          books={all}
          onClose={() => setExternalFor(null)}
        />
      )}
    </section>
  )
}

export const shelvesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'shelves',
  // Fails CLOSED, like storedUserId(): anything that isn't a known tab resolves to the default
  // rather than throwing. A validateSearch that throws takes the whole screen down over a typo in
  // a shared link, which is a worse outcome than quietly showing the default tab.
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: search.tab === 'collection' ? 'collection' : undefined,
  }),
  component: ShelvesScreen,
})
