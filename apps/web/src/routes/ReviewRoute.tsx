import { useMemo, useState } from 'react'
import { createRoute, Link } from '@tanstack/react-router'
import type { Book, NeedsLookItem, NeedsLookReason } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { useBooks, useUpdateBook } from '../data/books'
import { useImportReviewModel } from '../data/importReview'
import { CoverImage } from '../components/CoverImage'
import { CoverPicker } from '../components/CoverPicker'
import { useVoice } from '../skin/labels'
import { Surface } from '../components/Surface'
import { CorpusSeriesCatalog } from '../series/CorpusSeriesCatalog'
import {
  useCorpusAdminStatus,
  useCorpusSeriesSuggestions,
  useReviewCorpusSeriesSuggestion,
  type CorpusSeriesSuggestion,
} from '../data/enrichCorpus'

const REASON_LABEL: Record<NeedsLookReason, string> = {
  missing_cover: 'No cover',
  low_confidence_cover: 'Low-confidence cover',
  broken_cover: 'Broken cover',
  odd_genre: 'Unmapped genre',
  likely_duplicate: 'Likely duplicate',
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Surface tone="card" radius="card" pad={0} className="px-3 py-2.5">
      <div
        className="text-[20px] font-semibold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{label}</div>
    </Surface>
  )
}

/** A triage tile: shows the book's cover (low-confidence) or the skin placeholder (missing/broken; a
 *  dead link falls back + is reported via CoverImage). Actions: pick a found edition (CoverPicker),
 *  confirm a low-confidence match, or skip (dismiss for this session — the placeholder stands). */
function TriageTile({
  item,
  book,
  onDismiss,
}: {
  item: NeedsLookItem
  book?: Book
  onDismiss: () => void
}) {
  const coverBook = book ?? { id: item.ref, title: item.title, last: item.author, cover: '' }
  const update = useUpdateBook()
  return (
    <li className="w-[132px] flex-none">
      <div
        className="aspect-[2/3] overflow-hidden rounded-[10px] border border-line"
        style={{ background: 'var(--field)' }}
      >
        <CoverImage book={coverBook} />
      </div>
      <div className="mt-1.5 break-words text-[12.5px] font-semibold text-ink">{item.title}</div>
      {item.author && <div className="break-words text-[11px] text-muted">{item.author}</div>}
      <Surface
        tone="bare"
        radius="control"
        pad={0}
        className="mt-1 inline-block px-2 py-0.5 text-[11px] text-muted"
        style={{ background: 'var(--chip)' }}
      >
        {REASON_LABEL[item.reason]}
      </Surface>
      <CoverPicker book={coverBook} />
      {item.reason === 'low_confidence_cover' ? (
        <button
          type="button"
          onClick={() => update.mutate({ id: item.ref, patch: { coverConfidence: 'high' } })}
          className="skin-control mt-1 w-full px-2 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
        >
          Looks right
        </button>
      ) : (
        <button
          type="button"
          onClick={onDismiss}
          className="mt-1 w-full text-[11px] text-muted underline"
        >
          Use placeholder
        </button>
      )}
    </li>
  )
}

function ListBucket({ title, items }: { title: string; items: NeedsLookItem[] }) {
  if (!items.length) return null
  return (
    <section className="mt-5">
      <h3 className="text-[13px] font-semibold text-ink">
        {title} <span className="text-muted">· {items.length}</span>
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((i) => (
          <Surface as="li" key={i.ref} tone="card" radius="card" pad={0} className="px-3 py-2">
            <div className="break-words text-[13.5px] font-semibold text-ink">{i.title}</div>
            <div className="text-[12px] text-muted">
              {i.author ? `${i.author} · ` : ''}
              {i.detail}
            </div>
          </Surface>
        ))}
      </ul>
    </section>
  )
}

export function CorpusSeriesReview({ suggestions }: { suggestions: CorpusSeriesSuggestion[] }) {
  const review = useReviewCorpusSeriesSuggestion()
  if (!suggestions.length) return null
  return (
    <section className="mt-6">
      <h2
        className="text-[15px] font-semibold text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Corpus series matches <span className="text-muted">· {suggestions.length}</span>
      </h2>
      <p className="mb-2 text-[12px] leading-relaxed text-muted">
        These catalog matches were not certain enough to change shared series information. Accept
        only when the proposed series and position belong to this work.
      </p>
      <ul className="space-y-2">
        {suggestions.map((suggestion) => (
          <Surface as="li" key={suggestion.id} tone="card" radius="card" pad={3}>
            <div className="break-words text-[13.5px] font-semibold text-ink">
              {suggestion.title}
            </div>
            {suggestion.author && (
              <div className="break-words text-[12px] text-muted">{suggestion.author}</div>
            )}
            <div className="mt-2 grid gap-1 text-[12.5px] sm:grid-cols-2 sm:gap-3">
              <div>
                <span className="text-muted">Current: </span>
                <span className="text-ink">
                  {suggestion.currentSeries || 'No series set'}
                  {!suggestion.currentSeries || suggestion.currentPosition == null
                    ? ''
                    : ` · #${suggestion.currentPosition}`}
                </span>
              </div>
              <div>
                <span className="text-muted">Proposed: </span>
                <span className="text-ink">
                  {suggestion.proposedSeries}
                  {suggestion.proposedPosition == null ? '' : ` · #${suggestion.proposedPosition}`}
                  {suggestion.proposedCount == null ? '' : ` · ${suggestion.proposedCount} books`}
                </span>
              </div>
            </div>
            <div className="mt-1 text-[11px] text-muted">
              {suggestion.source} · identity {suggestion.identityConfidence} · membership{' '}
              {suggestion.membershipConfidence}
            </div>
            {suggestion.reason && (
              <p className="mt-1 text-[12px] leading-relaxed text-muted">{suggestion.reason}</p>
            )}
            {!!suggestion.evidence.length && (
              <details className="mt-2 text-[12px] text-muted">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink">
                  Evidence · {suggestion.evidence.length}{' '}
                  {suggestion.evidence.length === 1 ? 'observation' : 'observations'}
                </summary>
                <ul className="space-y-1 border-l border-line pl-3">
                  {suggestion.evidence.map((evidence, index) => {
                    const label =
                      evidence.kind === 'relational_membership'
                        ? 'membership'
                        : evidence.kind === 'candidate_label'
                          ? 'search candidate'
                          : 'source unavailable'
                    const order =
                      evidence.position == null
                        ? ''
                        : ` · #${evidence.position} · ${evidence.orderType === 'unspecified' ? 'order type unknown' : `${evidence.orderType} order`}`
                    const count =
                      evidence.memberCount == null ? '' : ` · ${evidence.memberCount} books`
                    const refIsUrl = /^https?:\/\//i.test(evidence.sourceRef ?? '')
                    return (
                      <li key={`${evidence.source}-${evidence.kind}-${index}`}>
                        {evidence.source} · {label}
                        {order}
                        {count}
                        {refIsUrl && (
                          <>
                            {' · '}
                            <a
                              href={evidence.sourceRef ?? undefined}
                              target="_blank"
                              rel="noreferrer"
                              className="underline underline-offset-2"
                            >
                              View source
                            </a>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </details>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate({ suggestionId: suggestion.id, decision: 'accept' })}
                className="skin-control min-h-11 px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50"
                style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
              >
                Accept shared series
              </button>
              <button
                type="button"
                disabled={review.isPending}
                onClick={() => review.mutate({ suggestionId: suggestion.id, decision: 'dismiss' })}
                className="skin-control min-h-11 border border-line px-3 py-2 text-[12.5px] font-semibold text-ink disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </Surface>
        ))}
      </ul>
    </section>
  )
}

function ReviewScreen() {
  const voice = useVoice()
  const model = useImportReviewModel()
  const { data: books } = useBooks()
  const byId = useMemo(() => new Map((books ?? []).map((b) => [b.id, b])), [books])
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set())
  const dismiss = (ref: string) => setDismissed((prev) => new Set(prev).add(ref))
  const { data: isCorpusAdmin = false } = useCorpusAdminStatus()
  const { data: seriesSuggestions = [] } = useCorpusSeriesSuggestions(isCorpusAdmin)

  if (!model && !seriesSuggestions.length && !isCorpusAdmin) {
    return (
      <section className="mx-auto w-full max-w-2xl px-4 py-10 text-center sm:px-6">
        <h1
          className="text-[22px] italic text-ink"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          Review
        </h1>
        <p className="mt-2 text-[13px] text-muted">
          Nothing needs review right now. Import a library export to inspect its uncertain matches.
        </p>
        <Link
          to="/settings"
          className="skin-control mt-4 inline-block px-5 py-2 text-[14px] font-semibold"
          style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
        >
          Go to import
        </Link>
      </section>
    )
  }

  if (!model) {
    return (
      <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <h1
          className="text-[22px] italic text-ink"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          Administrator review
        </h1>
        <Link
          to="/catalog/covers"
          search={{ state: 'attention', q: '', page: 0, work: undefined }}
          className="skin-control my-4 inline-flex min-h-11 items-center border border-line px-4 text-sm font-semibold text-ink"
          style={{ background: 'var(--card-solid)' }}
        >
          Review catalog covers
        </Link>
        <CorpusSeriesReview suggestions={seriesSuggestions} />
        <CorpusSeriesCatalog />
      </section>
    )
  }

  const { summary, needsLook, coverTriage } = model
  const shownTriage = coverTriage.filter((i) => !dismissed.has(i.ref))
  const genreChips = Object.entries(summary.genres).sort((a, b) => b[1] - a[1])

  return (
    <section
      className={`mx-auto w-full px-4 py-6 sm:px-6 ${isCorpusAdmin ? 'max-w-6xl' : 'max-w-3xl'}`}
    >
      <h1
        className="text-[22px] italic text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        Import review
      </h1>
      {isCorpusAdmin && (
        <Link
          to="/catalog/covers"
          search={{ state: 'attention', q: '', page: 0, work: undefined }}
          className="skin-control my-4 inline-flex min-h-11 items-center border border-line px-4 text-sm font-semibold text-ink"
          style={{ background: 'var(--card-solid)' }}
        >
          Review catalog covers
        </Link>
      )}
      <p className="mb-4 text-[13px] text-muted">
        What came in, and what needs a look. Covers fill in as enrichment runs.
      </p>

      <CorpusSeriesReview suggestions={seriesSuggestions} />

      {/* summary */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Total" value={summary.total} />
        <Stat label="Added" value={summary.added} />
        <Stat label="Merged" value={summary.merged} />
        <Stat label="In series" value={summary.inSeries} />
        <Stat label="Standalone" value={summary.standalones} />
      </div>

      {genreChips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {genreChips.map(([g, n]) => (
            <span
              key={g}
              className="skin-control-quiet border border-line px-2.5 py-1 text-[12px] text-ink"
              style={{ background: 'var(--chip)' }}
            >
              {g === '∅' ? 'Unresolved' : g} <span className="text-muted">{n}</span>
            </span>
          ))}
        </div>
      )}

      {/* cover triage */}
      {shownTriage.length > 0 && (
        <section className="mt-6">
          <h2
            className="text-[15px] font-semibold text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Covers to sort <span className="text-muted">· {shownTriage.length}</span>
          </h2>
          <p className="mb-2 text-[12px] text-muted">
            Missing, low-confidence, or broken. Pick a found edition, confirm a match, or keep the
            skin placeholder. Upload / photo come with the Studio design.
          </p>
          <ul className="flex flex-wrap gap-3">
            {shownTriage.map((i) => (
              <TriageTile
                key={i.ref}
                item={i}
                book={byId.get(i.ref)}
                onDismiss={() => dismiss(i.ref)}
              />
            ))}
          </ul>
        </section>
      )}

      <ListBucket title="Unmapped genres" items={needsLook.oddGenre} />
      <ListBucket title="Likely duplicates" items={needsLook.likelyDuplicate} />

      {shownTriage.length === 0 &&
        !needsLook.oddGenre.length &&
        !needsLook.likelyDuplicate.length && (
          <Surface
            as="p"
            tone="card"
            radius="card"
            pad={0}
            className="mt-6 px-3 py-3 text-center text-[13px] text-muted"
          >
            Nothing needs a look — every book came in clean. {voice.motif}
          </Surface>
        )}
      {isCorpusAdmin ? <CorpusSeriesCatalog /> : null}
    </section>
  )
}

export const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'review',
  component: ReviewScreen,
})
