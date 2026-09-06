import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  mergeFieldOptions,
  mergeImport,
  type Book,
  type Incoming,
  type MatchStrength,
  type MergeFieldOption,
  type MergeFieldPicks,
} from '@reverie/core'
import { useBooks } from '../data/books'
import { resolveCandidate, type ReviewAction } from '../data/duplicates'
import { verdictLookupKey, type ReviewCandidate } from '../data/intake'
import { Surface } from './Surface'

const STRENGTH_LABEL: Record<MatchStrength, string> = {
  isbn: 'same ISBN',
  'title-author': 'same title + author',
  'title-series-pos': 'same series position',
  fuzzy: 'similar title — may be a different book',
  none: '',
}

const FIELD_LABELS: Record<string, string> = {
  cover: 'cover',
  series: 'series',
  position: 'series #',
  seriesCount: 'series length',
  isbn: 'ISBN',
  pub: 'publication date',
  intensity: 'intensity',
  rating: 'rating',
  tags: 'tags',
  genres: 'genres',
  owned: 'formats owned',
  status: 'series status',
  genre: 'genre',
  subgenre: 'subgenre',
  first: 'author',
  last: 'author',
  format: 'format',
  source: 'source',
  readStatus: 'read status',
}

/** Human summary of what folding the incoming record would ADD to the existing one. */
function foldSummary(existing: Book, inc: Incoming): string[] {
  const { patch, newReads } = mergeImport(existing, inc)
  const fields = Object.keys(patch).map((k) => FIELD_LABELS[k] ?? k)
  const seen = new Set<string>()
  const out = fields.filter((f) => (seen.has(f) ? false : (seen.add(f), true)))
  if (newReads.length) out.push(`${newReads.length} read date${newReads.length > 1 ? 's' : ''}`)
  return out
}

const author = (inc: Incoming) => [inc.first, inc.last].filter(Boolean).join(' ')

/**
 * WHY THERE IS NO LONGER A "differs:" LINE (#302 shipped one; this replaces it).
 *
 * That line existed to narrate what a merge SILENTLY DISCARDS — a field both records set, where
 * `mergeImport`'s patch reports nothing because nothing is added. It was passive by design, since
 * at the time there was no control to offer. A 'replace' checkbox states the identical pair
 * (yours 4.5 / import 5) and lets a reader act on it, so keeping both would put the same sentence
 * on one card twice — and the redundant one is the one that cannot be acted on. `mergeDifferences`
 * is not orphaned by the removal: it is now the picker's contested-field predicate.
 */

/** Whether a merge would take this option, given the reader's picks over the engine's defaults. */
const taken = (o: MergeFieldOption, picks: MergeFieldPicks | undefined) => picks?.[o.key] ?? o.take

export function DuplicateReview({
  candidates,
  onDone,
  requireAll = false,
}: {
  candidates: ReviewCandidate[]
  onDone?: (remaining: number) => void
  /** A transfer cannot quietly leave books behind. Hide the early exit until every pair is ruled. */
  requireAll?: boolean
}) {
  const qc = useQueryClient()
  const { data: books } = useBooks()
  const byId = useMemo(() => new Map((books ?? []).map((b) => [b.id, b])), [books])

  const [queue, setQueue] = useState<ReviewCandidate[]>(candidates)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /**
   * Reader overrides, keyed by candidate then field. ABSENT MEANS THE ENGINE'S ANSWER — this map
   * starts empty and stays empty for an untouched card, which is what keeps a 200-row import
   * one-click: `applyFieldPicks(existing, inc, undefined)` is the engine's own patch.
   */
  const [picks, setPicks] = useState<Record<string, MergeFieldPicks>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const keyOf = (c: ReviewCandidate) => verdictLookupKey(c.existingId, c.incoming)

  async function resolveMany(items: ReviewCandidate[], action: ReviewAction) {
    setBusy(true)
    setError(null)
    const done = new Set<string>()
    try {
      for (const c of items) {
        const existing = byId.get(c.existingId)
        if (!existing) continue
        await resolveCandidate(c, existing, action, picks[keyOf(c)])
        done.add(keyOf(c))
      }
    } catch (e) {
      setError(`Couldn’t finish: ${(e as Error).message}`)
    }
    setQueue((q) => q.filter((c) => !done.has(keyOf(c))))
    setSelected((s) => {
      const next = new Set(s)
      done.forEach((k) => next.delete(k))
      return next
    })
    await qc.invalidateQueries({ queryKey: ['books'] })
    await qc.invalidateQueries({ queryKey: ['reads', 'all'] })
    setBusy(false)
  }

  if (!queue.length) {
    return (
      <div>
        <p className="text-[13px] text-muted">All set — no duplicates left to review ✨</p>
        {onDone && (
          <button
            type="button"
            onClick={() => onDone(0)}
            className="mt-3 text-[12.5px] font-semibold text-primary"
          >
            Continue →
          </button>
        )}
      </div>
    )
  }

  const selectedItems = queue.filter((c) => selected.has(keyOf(c)))
  const allSelected = selected.size === queue.length

  return (
    <div className="flex flex-col gap-3">
      <Surface
        tone="field"
        radius="card"
        pad={0}
        className="flex flex-wrap items-center gap-2 p-2.5"
      >
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(e) => setSelected(e.target.checked ? new Set(queue.map(keyOf)) : new Set())}
          />
          Select all ({queue.length})
        </label>
        <span className="flex-1" />
        <span className="text-[12px] text-muted">
          Apply to {selectedItems.length || 'selected'}:
        </span>
        <button
          type="button"
          disabled={busy || !selectedItems.length}
          onClick={() => void resolveMany(selectedItems, 'merge')}
          className="skin-control px-3 py-1.5 text-[12.5px] font-semibold text-on-primary disabled:opacity-40"
          style={{ background: 'var(--accent-fill)' }}
        >
          Merge
        </button>
        <button
          type="button"
          disabled={busy || !selectedItems.length}
          onClick={() => void resolveMany(selectedItems, 'keep_both')}
          className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-40"
          style={{ background: 'var(--card)' }}
        >
          Keep both
        </button>
        <button
          type="button"
          disabled={busy || !selectedItems.length}
          onClick={() => void resolveMany(selectedItems, 'dismiss')}
          className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-muted disabled:opacity-40"
          style={{ background: 'var(--card)' }}
        >
          Dismiss
        </button>
      </Surface>

      {error && <p className="text-[12.5px] text-primary">{error}</p>}

      {queue.map((c) => {
        const existing = byId.get(c.existingId)
        const adds = existing ? foldSummary(existing, c.incoming) : []
        const options = existing ? mergeFieldOptions(existing, c.incoming) : []
        const k = keyOf(c)
        const chosen = picks[k]
        const setPick = (field: string, take: boolean) =>
          setPicks((p) => ({ ...p, [k]: { ...p[k], [field]: take } }))
        return (
          <Surface key={k} tone="card" radius="card" pad={2}>
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={selected.has(k)}
                onChange={(e) =>
                  setSelected((s) => {
                    const n = new Set(s)
                    if (e.target.checked) n.add(k)
                    else n.delete(k)
                    return n
                  })
                }
                aria-label={`Select ${c.incoming.title}`}
              />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-ink">
                  {c.incoming.title}{' '}
                  <span className="text-[12px] font-normal text-muted">
                    · {author(c.incoming) || 'unknown author'}
                  </span>
                </div>
                <div className="mt-0.5 text-[12.5px] text-muted">
                  Matches your <span className="text-ink">{c.existingTitle}</span>
                  {c.existingAuthor ? ` · ${c.existingAuthor}` : ''}{' '}
                  <span className="italic">({STRENGTH_LABEL[c.strength]})</span>
                </div>
                <div className="mt-1.5 grid gap-1 text-[12.5px] sm:grid-cols-2">
                  <Surface tone="field" radius="card" pad={0} className="px-2 py-1">
                    <span className="text-[11px] uppercase tracking-[0.12em] text-muted">Kept</span>
                    <div className="text-ink">
                      your entry — rating, notes, shelves &amp; reads stay
                    </div>
                  </Surface>
                  <Surface tone="field" radius="card" pad={0} className="px-2 py-1">
                    <span className="text-[11px] uppercase tracking-[0.12em] text-muted">
                      Added on merge
                    </span>
                    {options.length ? (
                      /*
                       * COLLAPSED BY DEFAULT, and the summary is exactly the sentence this panel
                       * showed before the picker existed. An import of several hundred rows pays
                       * nothing for the capability: the closed card reads the same, Merge without
                       * opening writes the same patch, and only a reader who has a disagreement
                       * to settle opens it.
                       */
                      <details className="group">
                        <summary className="cursor-pointer list-none text-ink marker:content-none">
                          {adds.length ? adds.join(', ') : 'nothing new — already complete'}{' '}
                          <span className="text-[11px] text-muted underline">
                            choose fields ({options.length})
                          </span>
                        </summary>
                        <ul className="mt-1.5 flex flex-col gap-1" data-testid="merge-field-picker">
                          {options.map((o) => (
                            <li key={o.key}>
                              <label className="flex items-start gap-2 text-[12px]">
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={taken(o, chosen)}
                                  onChange={(e) => setPick(o.key, e.target.checked)}
                                />
                                <span className="min-w-0">
                                  <span className="text-ink">{o.label}</span>{' '}
                                  {o.kind === 'add' ? (
                                    /*
                                     * `theirs` is empty for the three fields the classification
                                     * table carries with no `show` (cover, status, source) — they
                                     * are unrenderable, not absent, so the row offers the decision
                                     * without quoting a value it cannot display.
                                     */
                                    <span className="text-muted">
                                      {o.theirs ? `add “${o.theirs}”` : 'add from the import'}
                                    </span>
                                  ) : (
                                    <span className="text-muted">
                                      keep yours “{o.mine}” — or take “{o.theirs}”
                                    </span>
                                  )}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : (
                      <div className="text-ink">
                        {adds.length ? adds.join(', ') : 'nothing new — already complete'}
                      </div>
                    )}
                  </Surface>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveMany([c], 'merge')}
                    aria-label={`Merge ${c.incoming.title}`}
                    className="skin-control px-3 py-1.5 text-[12.5px] font-semibold text-on-primary disabled:opacity-40"
                    style={{ background: 'var(--accent-fill)' }}
                  >
                    Merge
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveMany([c], 'keep_both')}
                    aria-label={`Keep both ${c.incoming.title}`}
                    className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink disabled:opacity-40"
                    style={{ background: 'var(--field)' }}
                  >
                    Keep both
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolveMany([c], 'always_merge')}
                    aria-label={`Always merge ${c.incoming.title}`}
                    className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-muted disabled:opacity-40"
                    style={{ background: 'var(--field)' }}
                    title="Merge now and auto-merge this pair on future imports"
                  >
                    Always merge
                  </button>
                </div>
              </div>
            </div>
          </Surface>
        )
      })}

      {onDone && !requireAll && (
        <button
          type="button"
          onClick={() => onDone(queue.length)}
          className="self-start text-[12.5px] text-primary"
        >
          Done reviewing
        </button>
      )}
    </div>
  )
}
