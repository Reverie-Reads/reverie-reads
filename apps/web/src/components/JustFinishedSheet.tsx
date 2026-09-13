import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  beginReadingPatch,
  isBookRead,
  cycleEmphasis,
  frequentTropes,
  PIN_CAP,
  PIN_CAP_COPY,
  type ChipEmphasis,
  type TropeEmphasis,
} from '@reverie/core'
import { Modal } from './Modal'
import { TropeChip } from './TropeChip'
import { MoodPicker } from './MoodPicker'
import { useBooks, useUpdateBook } from '../data/books'
import { useReads } from '../data/reads'
import { useAddListItem, useAllListItems } from '../data/listItems'
import { useLists } from '../data/lists'
import { useAcquireGhost } from '../data/series'
import {
  useAllBookTropes,
  useAssignTrope,
  useFetchSuggestions,
  useResolveSuggestion,
  useSuggestions,
  useTropes,
  useUnassignTrope,
} from '../data/tropes'
import { useJustFinishedStore } from '../lib/chainPrompt'
import { useLabels } from '../skin/labels'

/**
 * The ONE just-finished sheet: a skippable trope quick-tag (suggested + frequent as one-tap
 * confirms; same tap-cycle gesture as the picker — second tap pins), then the next-in-series
 * block when a next entry exists. One gesture (Done, ✕, or the backdrop) skips everything.
 */
export function JustFinishedSheet() {
  const target = useJustFinishedStore((s) => s.target)
  const close = useJustFinishedStore((s) => s.close)
  const navigate = useNavigate()
  const labels = useLabels()
  const { data: books } = useBooks()
  const nextReads = useReads(target?.next?.bookId ?? '')
  const { data: lists } = useLists()
  const { data: items } = useAllListItems()
  const { data: tropes } = useTropes()
  const { data: allAssignments } = useAllBookTropes()
  const { data: suggestions } = useSuggestions(target?.book.id ?? '')
  const assign = useAssignTrope()
  const unassign = useUnassignTrope()
  const fetchSuggestions = useFetchSuggestions()
  const resolveSuggestion = useResolveSuggestion()
  const updateBook = useUpdateBook(target?.next?.bookId ?? undefined)
  const addListItem = useAddListItem()
  const acquire = useAcquireGhost(target?.seriesName ?? '')

  const [note, setNote] = useState<string | null>(null)
  const fetchedFor = useRef<string | null>(null)

  // the live book (assignments land while the sheet is open)
  const book = useMemo(
    () => (books ?? []).find((b) => b.id === target?.book.id) ?? target?.book,
    [books, target],
  )

  useEffect(() => {
    if (!target || !tropes || !book) return
    if (fetchedFor.current === book.id || book.tropesSuggestedAt != null) return
    fetchedFor.current = book.id
    fetchSuggestions.mutate({ book, tropes })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, tropes, book?.id])

  if (!target || !book) return null
  const { next } = target

  const byId = new Map((tropes ?? []).map((t) => [t.id, t]))
  const onBook = new Map(book.tropes.map((t) => [t.id, t.emphasis]))
  const pinnedCount = book.tropes.filter((t) => t.emphasis === 'pinned').length

  const cycle = (tropeId: string) => {
    setNote(null)
    const cur: ChipEmphasis = onBook.get(tropeId) ?? 'off'
    let nextE = cycleEmphasis(cur)
    if (nextE === 'pinned' && pinnedCount >= PIN_CAP) {
      setNote(PIN_CAP_COPY)
      nextE = 'off'
    }
    if (nextE === 'off') {
      unassign.mutate({ bookId: book.id, tropeId })
    } else {
      assign.mutate({ bookId: book.id, tropeId, emphasis: nextE as TropeEmphasis })
    }
  }

  const openSuggestions = (suggestions ?? []).filter((s) => !onBook.has(s.tropeId))
  const frequent = frequentTropes(
    (allAssignments ?? []).map((a) => ({ tropeId: a.trope_id })),
    6,
  )
    .map((id) => byId.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t && !onBook.has(t.id))

  // ── next-in-series actions (the #52 toast's actions, living inside the sheet) ──
  const linked = next?.bookId ? (books ?? []).find((b) => b.id === next.bookId) : undefined
  const needsHistory =
    linked && !isBookRead(linked) && linked.readStatus !== 'Reading' && linked.readStatus !== 'DNF'
  const historyUnavailable = needsHistory && nextReads.data === undefined
  const tbr = (lists ?? []).find((l) => l.kind === 'tbr')
  const tbrMax = tbr
    ? Math.max(
        0,
        ...(items ?? []).filter((it) => it.list_id === tbr.id).map((it) => it.position ?? 0),
      )
    : 0

  const readNow = () => {
    if (!next || historyUnavailable) return
    if (linked) {
      updateBook.mutate(
        {
          id: linked.id,
          patch: beginReadingPatch({ ...linked, reads: nextReads.data ?? linked.reads }),
        },
        {
          onSuccess: () => {
            close()
            void navigate({ to: '/book/$bookId', params: { bookId: linked.id } })
          },
        },
      )
    } else {
      acquire.mutate(
        { entry: next, genre: target.genre },
        {
          onSuccess: (bookId) => {
            updateBook.mutate({
              id: bookId,
              patch: { readStatus: 'Reading', readingNowHidden: false, progress: 0 },
            })
            close()
            void navigate({ to: '/book/$bookId', params: { bookId } })
          },
          onError: close,
        },
      )
    }
  }

  const addNext = () => {
    if (!next) return
    if (linked) {
      if (tbr) addListItem.mutate({ listId: tbr.id, bookId: linked.id, afterPosition: tbrMax })
    } else {
      acquire.mutate({ entry: next, genre: target.genre, tbrId: tbr?.id })
    }
    close()
  }

  return (
    <Modal title="Just finished" onClose={close}>
      <p className="-mt-2 mb-3 text-[13px] text-muted">
        {book.title} — shelved. Tag the {labels.tags.toLowerCase()} while it's fresh; tap again to
        pin.
      </p>

      {(openSuggestions.length > 0 || frequent.length > 0 || book.tropes.length > 0) && (
        <div className="mb-4 flex flex-col gap-3">
          {book.tropes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {book.tropes.map((t) => (
                <TropeChip
                  key={t.id}
                  name={t.name}
                  emphasis={t.emphasis}
                  onClick={() => cycle(t.id)}
                />
              ))}
            </div>
          )}
          {openSuggestions.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
                Suggested
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {openSuggestions.map((s) => (
                  <span key={s.tropeId} className="inline-flex items-center gap-0.5">
                    <TropeChip
                      name={s.name}
                      emphasis="off"
                      onClick={() =>
                        resolveSuggestion.mutate({
                          bookId: book.id,
                          tropeId: s.tropeId,
                          accept: true,
                        })
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        resolveSuggestion.mutate({
                          bookId: book.id,
                          tropeId: s.tropeId,
                          accept: false,
                        })
                      }
                      aria-label={`Dismiss suggestion ${s.name}`}
                      className="h-6 w-6 rounded-full text-[11px] text-muted hover:text-ink"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {frequent.length > 0 && (
            <div>
              <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
                Your frequent
              </div>
              <div className="flex flex-wrap gap-1.5">
                {frequent.map((t) => (
                  <TropeChip key={t.id} name={t.name} emphasis="off" onClick={() => cycle(t.id)} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {note && (
        <p className="mb-3 text-[12.5px]" style={{ color: 'var(--accent-ink)' }}>
          {note}
        </p>
      )}

      {/* Mood — the natural moment: you just closed the book feeling something. Skippable like the
          rest of this ONE sheet; reader-assigned, never derived (docs/archive/task-mood.md §2). */}
      <div className="mb-4">
        <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
          How did it land?
        </div>
        <MoodPicker book={book} />
      </div>

      {next && (
        <div
          className="mb-4 rounded-2xl border p-3"
          style={{ borderColor: 'var(--accent-ink)', background: 'var(--card)' }}
        >
          <p
            className="text-[10.5px] font-bold uppercase tracking-[0.24em]"
            style={{ color: 'var(--accent-ink)' }}
          >
            The story continues
          </p>
          <p
            className="mt-1 break-words text-[14.5px] font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Next: {linked?.title ?? next.title}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={readNow}
              disabled={!!historyUnavailable || updateBook.isPending || acquire.isPending}
              className="skin-control px-3 py-1.5 text-[12px] font-semibold"
              style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
            >
              {historyUnavailable
                ? nextReads.isError
                  ? 'Reading history unavailable'
                  : 'Loading reading history…'
                : 'Reading now'}
            </button>
            <button
              type="button"
              onClick={addNext}
              className="skin-control-quiet border border-line px-3 py-1.5 text-[12px] font-semibold text-ink"
              style={{
                background: 'var(--card)',
              }}
            >
              {linked
                ? tbr
                  ? `Add to ${tbr.name}`
                  : 'Keep it in mind'
                : tbr
                  ? `⊹ Add to ${tbr.name}`
                  : '⊹ Add to wishlist'}
            </button>
          </div>
          {historyUnavailable && nextReads.isError && (
            <button
              type="button"
              onClick={() => void nextReads.refetch()}
              className="mt-2 min-h-11 text-[13px] text-primary"
            >
              Retry reading history
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={close}
        data-reading-tour-book={book.id}
        data-book-tour="reading-reflect-done"
        className="skin-control h-11 w-full text-[14px] font-semibold"
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--gold))',
          color: 'var(--on-primary)',
        }}
      >
        Done
      </button>
    </Modal>
  )
}
