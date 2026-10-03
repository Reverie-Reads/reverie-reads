import { useEffect, useMemo, useRef, useState } from 'react'
import {
  cycleEmphasis,
  type ChipEmphasis,
  FACET_LABELS,
  frequentTropes,
  orderByAffinity,
  PIN_CAP,
  PIN_CAP_COPY,
  resolveTrope,
  TROPE_FACETS,
  tropeMatches,
  type Book,
  type TropeEmphasis,
} from '@reverie/core'
import { Modal } from './Modal'
import { TropeChip } from './TropeChip'
import {
  useAllBookTropes,
  useAssignTrope,
  useCreatePersonalTrope,
  useFetchSuggestions,
  useRenamePersonalTrope,
  useResolveSuggestion,
  useSuggestions,
  useTropes,
  useUnassignTrope,
} from '../data/tropes'
import { useLabels } from '../skin/labels'

/**
 * The trope picker (docs/archive/task-trope-system.md §3) — search-first across names AND aliases,
 * grouped by facet, the reader's frequent tropes on top, ordering inside each facet biased by
 * the book's genre (a hint, never a gate). One gesture everywhere: tap tags, a second tap pins
 * (soft-capped warmly at three), a third removes. Inline personal creation resolves against
 * canon first so a near-match offers the canonical instead of duplicating.
 */
export function TropePicker({ book, onClose }: { book: Book; onClose: () => void }) {
  const labels = useLabels()
  const { data: tropes } = useTropes()
  const { data: allAssignments } = useAllBookTropes()
  const { data: suggestions } = useSuggestions(book.id)
  const assign = useAssignTrope()
  const unassign = useUnassignTrope()
  const createPersonal = useCreatePersonalTrope()
  const rename = useRenamePersonalTrope()
  const fetchSuggestions = useFetchSuggestions()
  const resolveSuggestion = useResolveSuggestion()

  const [q, setQ] = useState('')
  const [note, setNote] = useState<string | null>(null)

  // one Hardcover descriptor fetch per book, ever — triggered by the first tagging moment
  const fetchedRef = useRef(false)
  useEffect(() => {
    if (fetchedRef.current || !tropes || book.tropesSuggestedAt != null) return
    fetchedRef.current = true
    fetchSuggestions.mutate({ book, tropes })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tropes, book.id])

  const byId = useMemo(() => new Map((tropes ?? []).map((t) => [t.id, t])), [tropes])
  const onBook = useMemo(() => new Map(book.tropes.map((t) => [t.id, t.emphasis])), [book.tropes])
  const pinnedCount = book.tropes.filter((t) => t.emphasis === 'pinned').length

  const setEmphasis = (tropeId: string, next: ChipEmphasis) => {
    if (next === 'off') {
      unassign.mutate({ bookId: book.id, tropeId })
    } else {
      assign.mutate({ bookId: book.id, tropeId, emphasis: next as TropeEmphasis })
    }
  }

  const cycle = (tropeId: string) => {
    setNote(null)
    const cur: ChipEmphasis = onBook.get(tropeId) ?? 'off'
    let next = cycleEmphasis(cur)
    if (next === 'pinned' && pinnedCount >= PIN_CAP) {
      setNote(PIN_CAP_COPY)
      next = 'off' // the gesture still completes — third-tap removal stays reachable
    }
    setEmphasis(tropeId, next)
  }

  const frequentIds = useMemo(
    () => frequentTropes((allAssignments ?? []).map((a) => ({ tropeId: a.trope_id }))),
    [allAssignments],
  )
  const frequent = frequentIds
    .map((id) => byId.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t && !onBook.has(t.id))

  const matching = useMemo(() => (tropes ?? []).filter((t) => tropeMatches(q, t)), [tropes, q])
  const exactExists = (tropes ?? []).some((t) => t.name.toLowerCase() === q.trim().toLowerCase())

  const createDraft = () => {
    const raw = q.trim()
    if (!raw) return
    const hit = resolveTrope(raw, tropes ?? [])
    if (hit) {
      // near-match: offer the canonical instead of duplicating
      setNote(`Filed under ${hit.name} — the shelf already knows this one.`)
      if (!onBook.has(hit.id)) setEmphasis(hit.id, 'present')
      setQ('')
      return
    }
    createPersonal.mutate(
      { name: raw },
      {
        onSuccess: (t) => {
          setEmphasis(t.id, 'present')
          setNote(`${t.name} is yours now — it lives in every picker from here on.`)
          setQ('')
        },
      },
    )
  }

  const openSuggestions = (suggestions ?? []).filter((s) => !onBook.has(s.tropeId))

  return (
    <Modal title={`Tag ${labels.tags.toLowerCase()}`} onClose={onClose} wide>
      <p className="-mt-2 mb-3 text-[12.5px] text-muted">
        Tap to tag · tap again to pin (up to {PIN_CAP}) · a third tap clears.
      </p>
      <p className="mb-3 text-[12.5px] text-muted">
        When this book is included in your household library, changes here also update its shared
        tags. Your moods and reading notes stay private.
      </p>

      {book.tropes.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
            On this book
          </div>
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
        </div>
      )}

      {openSuggestions.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">Suggested</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {openSuggestions.map((s) => (
              <span key={s.tropeId} className="inline-flex items-center gap-0.5">
                <TropeChip
                  name={s.name}
                  emphasis="off"
                  onClick={() =>
                    resolveSuggestion.mutate({ bookId: book.id, tropeId: s.tropeId, accept: true })
                  }
                  title={`Suggested: ${s.name} — tap to add`}
                />
                <button
                  type="button"
                  onClick={() =>
                    resolveSuggestion.mutate({ bookId: book.id, tropeId: s.tropeId, accept: false })
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

      {frequent.length > 0 && !q && (
        <div className="mb-4">
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

      <div className="mb-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              createDraft()
            }
          }}
          placeholder={`Search ${labels.tags.toLowerCase()} — names and aliases…`}
          aria-label={`Search ${labels.tags}`}
          className="skin-field h-10 w-full border border-line px-3 text-[14px] text-ink outline-none"
          style={{ background: 'var(--field)' }}
        />
      </div>
      {note && (
        <p className="mb-3 text-[12.5px]" style={{ color: 'var(--accent-ink)' }}>
          {note}
        </p>
      )}
      {q.trim() && !exactExists && (
        <button
          type="button"
          onClick={createDraft}
          className="skin-control-quiet mb-3 border border-dashed border-line px-3.5 py-1.5 text-[12.5px] font-semibold text-ink"
          style={{ background: 'var(--chip)' }}
        >
          ＋ Add “{q.trim()}” as your own
        </button>
      )}

      {TROPE_FACETS.map((facet) => {
        const group = orderByAffinity(
          matching.filter((t) => t.facet === facet),
          book.genre,
        )
        if (!group.length) return null
        return (
          <div key={facet} className="mb-4">
            <div className="mb-1.5 text-[11px] uppercase tracking-[0.2em] text-muted">
              {FACET_LABELS[facet]}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.slice(0, q ? 40 : 16).map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1">
                  <TropeChip
                    name={t.name}
                    emphasis={onBook.get(t.id) ?? 'off'}
                    onClick={() => cycle(t.id)}
                    title={t.personal ? `${t.name} (yours)` : t.name}
                  />
                  {/* Rename is offered for PERSONAL tropes only. Canonical names are shared
                      vocabulary generated from SEED_TROPES, so renaming one locally would put this
                      library out of step with the source of truth — the hook refuses them at the
                      query too, rather than trusting this condition to be the only guard. */}
                  {t.personal && (
                    <button
                      type="button"
                      onClick={() => {
                        const next = window.prompt(`Rename “${t.name}” to:`, t.name)
                        if (next?.trim()) rename.mutate({ id: t.id, name: next })
                      }}
                      aria-label={`Rename ${t.name}`}
                      title={`Rename ${t.name}`}
                      className="text-[11px] text-muted hover:text-primary"
                    >
                      ✎
                    </button>
                  )}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </Modal>
  )
}
