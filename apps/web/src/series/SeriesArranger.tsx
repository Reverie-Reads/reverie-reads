import { useMemo, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  entryState,
  positionBetween,
  resolveReorder,
  SERIES_ARRANGER_TOKENS as TOK,
  type Book,
  type SeriesEntry,
} from '@reverie/core'
import { CoverImage } from '../components/CoverImage'
import { Surface } from '../components/Surface'
import { UtilityGlyph } from '../components/UtilityGlyph'
import { useMoveEntry, useSeriesDetail } from '../data/series'

/**
 * The /series index's arranging surface for ONE series (feat/series-builder).
 *
 * DRAG IS THE POINT, and dnd-kit is here for `PointerSensor`: the app's four other reorder surfaces
 * are hand-rolled HTML5 drag-and-drop, which does not fire from touch on iOS Safari or Android
 * Chrome — a reorder feature no phone can reach. Pointer events do.
 *
 * The ▲▼ buttons stay as the VISIBLE affordance and are what the e2e drives. dnd-kit's
 * `KeyboardSensor` is wired too (focus a row's grip, Space to lift, arrows to move, Space to drop,
 * with live announcements below), but a keyboard path is only an answer if a reader can find it, and
 * a visible button is discoverable in a way a lifted-drag convention is not. They are not redundant:
 * the buttons call the same reposition the drag does, so neither can drift from the other.
 *
 * READING ORDER IS WRITTEN BY MIDPOINT INSERTION through the SAME `positionBetween` +
 * `useMoveEntry` path that the full series page uses. The midpoint is a private `sort_order` key;
 * dragging never changes the canonical volume number or its books.position compatibility mirror.
 */

/** Ghost slots ARE draggable — a ghost is a position with no book yet, and its place in the reading
 *  order is exactly the thing a reader arranges before the book arrives. `syncBookPosition` no-ops
 *  on a null bookId, so a ghost's position lives only on its entry, which is correct. */
function Row({
  entry,
  book,
  onTbr,
  index,
  count,
  seriesName,
  onNudge,
  disabled,
}: {
  entry: SeriesEntry
  book: Book | undefined
  onTbr: boolean
  index: number
  count: number
  seriesName: string
  onNudge: (dir: -1 | 1) => void
  disabled: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    // Names the GRIP as the activator, so the keyboard sensor lifts from it and focus returns there
    // after a drop rather than to the row, which is what makes arrow-key sorting repeatable.
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled })
  const state = entryState(book, onTbr)
  const title = book?.title ?? entry.title

  return (
    <Surface
      as="li"
      ref={setNodeRef}
      tone="bare"
      radius="card"
      pad={0}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Colours come from the ONE token object the contrast test measures, so a change here cannot
        // pass a test that is still measuring the old value. `text-ink` on the title below resolves
        // to the same --ink through `--color-ink` in globals.css.
        // Hence tone="bare" + TOK.surface here rather than tone="card": Surface would paint the
        // same var(--card) string, but the SOURCE would no longer be the measured token object.
        background: TOK.surface,
        opacity: isDragging ? 0.65 : 1,
      }}
      className="flex items-center gap-2.5 px-2.5 py-2"
      data-testid="arrange-row"
      data-entry-id={entry.id}
      data-position={entry.position}
      data-sort-order={entry.sortOrder ?? entry.position}
    >
      {/* The grip is the drag handle AND the keyboard sensor's activator — never the cover, so a
          cover press stays a cover press (the drag-hijack guard the shelf surfaces already keep). */}
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Reorder ${title}`}
        className="grid h-8 w-6 flex-none cursor-grab place-items-center rounded-md text-[13px] disabled:cursor-default disabled:opacity-40"
        style={{ color: TOK.meta }}
      >
        <UtilityGlyph name="grip" className="h-[18px] w-[18px]" />
      </button>
      <span
        className="w-16 flex-none text-[11.5px] font-semibold tabular-nums"
        style={{ color: TOK.meta }}
      >
        {index + 1} in order
        <span className="block text-[12.5px] text-ink">Vol. {entry.position}</span>
      </span>
      <span
        className="h-[46px] w-8 flex-none overflow-hidden rounded-md border border-line"
        style={state === 'ghost' ? { borderStyle: 'dashed', background: 'var(--chip)' } : undefined}
        aria-hidden
      >
        {book ? (
          <CoverImage book={book} thumb ghost={state === 'wishlist'} />
        ) : (
          <span className="flex h-full items-center justify-center text-[12px] text-muted">⊹</span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span
          data-testid="row-title"
          className="block break-words text-[13.5px] font-semibold"
          style={{ color: TOK.title }}
        >
          {title}
        </span>
        <span className="block break-words text-[12px]" style={{ color: TOK.meta }}>
          {state === 'ghost' ? entry.author || 'Not in your library' : (entry.label ?? '')}
        </span>
      </span>
      {/* The visible keyboard affordance. Same reposition the drag performs. */}
      <span className="flex flex-none flex-col">
        <button
          type="button"
          onClick={() => onNudge(-1)}
          disabled={disabled || index === 0}
          aria-label={`Move ${title} earlier in ${seriesName}`}
          className="h-4 w-6 text-[10px] leading-none disabled:opacity-30"
          style={{ color: TOK.meta }}
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => onNudge(1)}
          disabled={disabled || index === count - 1}
          aria-label={`Move ${title} later in ${seriesName}`}
          className="h-4 w-6 text-[10px] leading-none disabled:opacity-30"
          style={{ color: TOK.meta }}
        >
          ▼
        </button>
      </span>
    </Surface>
  )
}

export function SeriesArranger({
  name,
  books,
  tbrBookIds,
}: {
  name: string
  books: ReadonlyMap<string, Book>
  tbrBookIds: ReadonlySet<string>
}) {
  const { data: detail, isLoading } = useSeriesDetail(name)
  const moveEntry = useMoveEntry(name)
  const [announcement, setAnnouncement] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const entries = useMemo(() => detail?.entries ?? [], [detail])
  const ids = useMemo(() => entries.map((e) => e.id), [entries])

  /** Reposition the entry at `from` so it lands at visual slot `to`. Dense keys renumber only the
   *  private order; canonical volume numbers remain unchanged. */
  const placeAt = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return
    const rest = entries.filter((_, i) => i !== from)
    const prev = rest[to - 1] ? (rest[to - 1]!.sortOrder ?? rest[to - 1]!.position) : null
    const nextPos = rest[to] ? (rest[to]!.sortOrder ?? rest[to]!.position) : null
    const moved = entries[from]!
    const { position, renumber } = positionBetween(prev, nextPos)
    const title = moved.bookId ? (books.get(moved.bookId)?.title ?? moved.title) : moved.title
    setAnnouncement(`${title} moved to position ${to + 1} of ${entries.length} in ${name}.`)
    if (!detail) return
    const slots = renumber
      ? [...rest.slice(0, to), moved, ...rest.slice(to)].map((e, i) => ({
          entryId: e.id,
          sortOrder: i + 1,
        }))
      : [{ entryId: moved.id, sortOrder: position }]
    moveEntry.mutate({ seriesId: detail.series.id, slots })
  }

  /**
   * CROSS-SERIES DROPS ARE REFUSED, explicitly rather than by omission.
   *
   * Two mechanisms, because one of them is a claim about configuration and the other is a check.
   * Each series owns its own `DndContext` and resolves targets with `pointerWithin`, so a drag that
   * leaves this list resolves to no target at all and writes nothing. `resolveReorder` then refuses a
   * foreign id on top of that — `series_entries` ids are unique account-wide, and an unguarded caller
   * would turn `indexOf === -1` into a silent no-op, the bug shape that reads as "drag sometimes does
   * nothing". Its refusal branch is unit-tested; this file cannot reach it while the config holds,
   * which is exactly why the check is not written as an assertion about the config.
   *
   * Moving a book BETWEEN series is not a reorder at all: it rewrites `books.series` and tombstones
   * the old slot. That belongs to the book page's series field, which already does it correctly.
   */
  const onDragEnd = (ev: DragEndEvent) => {
    const r = resolveReorder(ids, String(ev.active.id), ev.over ? String(ev.over.id) : null)
    if (r.kind === 'reject') {
      setAnnouncement('A book can only be reordered within its own series.')
      return
    }
    if (r.kind === 'noop') return
    placeAt(r.from, r.to)
  }

  if (isLoading)
    return (
      <p className="px-2 py-3 text-[13px] text-muted" role="status">
        Opening {name}…
      </p>
    )

  if (!detail || detail.unreviewed.length > 0)
    return (
      <p className="px-2 py-3 text-[13px] text-muted">
        Review this series on its full page before arranging its order.
      </p>
    )

  if (!entries.length)
    return (
      <p className="px-2 py-3 text-[13px] text-muted">
        Nothing in this series yet — add a book to it and its order appears here.
      </p>
    )

  return (
    <div>
      <DndContext
        sensors={sensors}
        // pointerWithin, NOT closestCenter, and no restrictToParentElement — both deliberate, and
        // both learned from the cross-series e2e failing. closestCenter returns the nearest droppable
        // in THIS context however far away the pointer is, and restrictToParentElement pins the
        // dragged row inside its own list, so together they turned a drag aimed at another series
        // into a silent reorder of the row's OWN series: a write the reader never asked for, at the
        // near end of the list. pointerWithin resolves a target only when the pointer is actually
        // inside one, so a drag that leaves this series' list resolves to nothing and writes nothing.
        collisionDetection={pointerWithin}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) =>
              `Lifted ${active.id}. Use arrow keys to move, space to drop.`,
            onDragOver: ({ active, over }) =>
              over ? `${active.id} is over position ${ids.indexOf(String(over.id)) + 1}.` : '',
            onDragEnd: ({ active, over }) =>
              over
                ? `${active.id} dropped at position ${ids.indexOf(String(over.id)) + 1} of ${ids.length}.`
                : `${active.id} returned to its place.`,
            onDragCancel: ({ active }) => `${active.id} returned to its place.`,
          },
        }}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-1.5" data-testid={`arrange-${name}`}>
            {entries.map((e, i) => (
              <Row
                key={e.id}
                entry={e}
                book={e.bookId ? books.get(e.bookId) : undefined}
                onTbr={!!e.bookId && tbrBookIds.has(e.bookId)}
                index={i}
                count={entries.length}
                seriesName={name}
                onNudge={(dir) => placeAt(i, i + dir)}
                disabled={moveEntry.isPending}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {/* Our own live region: dnd-kit announces the DRAG, this announces the RESULT, including the
          ▲▼ path, which dnd-kit never sees. */}
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}
