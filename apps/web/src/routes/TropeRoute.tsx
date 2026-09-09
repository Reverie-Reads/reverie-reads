import { useMemo, useState } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import {
  FACET_LABELS,
  coverStateSuffix,
  isBookRead,
  isOwnedBook,
  tropeKin,
  type Book,
} from '@reverie/core'
import { rootRoute } from './RootRoute'
import { BackLink } from '../components/BackLink'
import { CoverImage } from '../components/CoverImage'
import { BookStateMarks } from '../components/BookStateMarks'
import { TropeChip } from '../components/TropeChip'
import { useBooks } from '../data/books'
import {
  useAllBookTropes,
  useAssignTrope,
  useDeletePersonalTrope,
  useRenamePersonalTrope,
  useTropes,
  useUnassignTrope,
} from '../data/tropes'
import { useLabels, useVoice } from '../skin/labels'
import { useConfirmedLookup } from '../hooks/useConfirmedLookup'

/**
 * A trope's own page (docs/archive/task-trope-system.md §5): your shelf of books carrying it, your
 * read-rate, and KIN — what you pair it with, computed from YOUR library only (nothing global).
 * The per-trope sweep lives here: flip to sweep and tap covers to tag in bulk.
 */
function TropeScreen() {
  const { tropeId } = tropeRoute.useParams()
  const navigate = useNavigate()
  const rename = useRenamePersonalTrope()
  const deleteTrope = useDeletePersonalTrope()
  const labels = useLabels()
  const booksQuery = useBooks()
  const books = booksQuery.data
  const tropesQuery = useTropes()
  const tropes = tropesQuery.data
  const voice = useVoice()
  const assignmentsQuery = useAllBookTropes()
  const assignments = assignmentsQuery.data
  const assign = useAssignTrope()
  const unassign = useUnassignTrope()
  const [sweep, setSweep] = useState(false)

  // Absence is verified against the server before it is reported — see useConfirmedLookup.
  const lookup = useConfirmedLookup(
    tropesQuery,
    (tropes ?? []).find((t) => t.id === tropeId),
  )
  const trope = lookup.status === 'found' ? lookup.value : undefined
  const tropeById = useMemo(() => new Map((tropes ?? []).map((t) => [t.id, t])), [tropes])

  const carrierIds = useMemo(
    () => new Set((assignments ?? []).filter((a) => a.trope_id === tropeId).map((a) => a.book_id)),
    [assignments, tropeId],
  )
  const carriers = useMemo(
    () => (books ?? []).filter((b) => carrierIds.has(b.id)),
    [books, carrierIds],
  )
  // Tropes, books, and assignments load independently. The trope heading can therefore be ready
  // while its carrier inventory is not. Deletion must fail closed during that window: treating
  // missing query data as an empty inventory would tell a reader the tag is on no books and let
  // them erase assignments they have not yet been shown.
  const carrierInventoryReady = booksQuery.isSuccess && assignmentsQuery.isSuccess
  const kin = useMemo(
    () =>
      tropeKin(
        tropeId,
        (assignments ?? []).map((a) => ({ bookId: a.book_id, tropeId: a.trope_id })),
      )
        .map((k) => tropeById.get(k.tropeId))
        .filter((t): t is NonNullable<typeof t> => !!t),
    [assignments, tropeId, tropeById],
  )

  if (lookup.status === 'loading')
    return <p className="px-6 py-16 text-center text-muted">{voice.loading}</p>

  if (!trope)
    return (
      <div className="px-6 py-16 text-center text-muted">
        <p>That {labels.tag.toLowerCase()} isn’t on your shelves.</p>
        <BackLink fallback="/tropes" className="mt-3 inline-block text-primary">
          ← All {labels.tags.toLowerCase()}
        </BackLink>
      </div>
    )

  const owned = carriers.filter(isOwnedBook).length
  const read = carriers.filter(isBookRead).length
  const gridBooks = sweep ? (books ?? []) : carriers

  const toggle = (b: Book) => {
    if (!sweep) {
      void navigate({ to: '/book/$bookId', params: { bookId: b.id } })
      return
    }
    if (carrierIds.has(b.id)) unassign.mutate({ bookId: b.id, tropeId })
    else assign.mutate({ bookId: b.id, tropeId, emphasis: 'present' }) // sweep tags at present; pins stay per-book
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <BackLink fallback="/tropes" className="text-[13px] text-muted hover:text-ink">
        ← {labels.tags}
      </BackLink>

      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1
            className="text-[26px] italic leading-tight text-ink"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            {trope.name}
          </h1>
          <p className="mt-0.5 text-[13px] text-muted">
            {FACET_LABELS[trope.facet]}
            {trope.personal ? ' · yours' : ''}
            {trope.aliases.length ? ` · also answers to ${trope.aliases.join(', ')}` : ''}
          </p>
          <p className="mt-1.5 text-[14px] text-ink">
            You own {owned}, read {read}
            {carriers.length !== owned ? ` — ${carriers.length} carrying it in all` : ''}
          </p>
          {/* Rename and delete, PERSONAL tropes only. Canonical names are shared vocabulary — the
              seed migration is generated from SEED_TROPES and a parity test pins the two together,
              so a local edit would put this library out of step with the source of truth. Both
              hooks also refuse canonical rows at the query, so this condition is the affordance
              rather than the enforcement. */}
          {trope.personal && (
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!carrierInventoryReady || deleteTrope.isPending}
                onClick={() => {
                  const next = window.prompt(`Rename “${trope.name}” to:`, trope.name)
                  if (next?.trim()) rename.mutate({ id: trope.id, name: next })
                }}
                className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-ink"
                style={{ background: 'var(--card)' }}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  // The carrier count is already computed above for the header, so the confirm can
                  // say what actually goes — book_tropes cascades on the trope delete, so this
                  // removes the tag from every one of them. A tag vanishing from eleven books
                  // deserves to say "eleven" BEFORE it happens.
                  const n = carriers.length
                  const scope =
                    n === 0
                      ? 'It is not on any books.'
                      : `It will be removed from ${n} book${n === 1 ? '' : 's'}.`
                  if (window.confirm(`Delete “${trope.name}”? ${scope} This cannot be undone.`))
                    deleteTrope.mutate(trope.id, {
                      onSuccess: () => void navigate({ to: '/tropes' }),
                    })
                }}
                className="skin-control border border-line px-3 py-1.5 text-[12.5px] font-semibold text-primary disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--card)' }}
              >
                {carrierInventoryReady ? 'Delete' : 'Checking books…'}
              </button>
            </div>
          )}
          {kin.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[12px] text-muted">You pair this with</span>
              {kin.map((k) => (
                <TropeChip key={k.id} name={k.name} emphasis="present" to={`/tropes/${k.id}`} />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setSweep((s) => !s)}
          aria-pressed={sweep}
          className="skin-control border px-3.5 py-1.5 text-[12.5px] font-semibold"
          style={
            sweep
              ? {
                  background: 'var(--accent-fill)',
                  color: 'var(--on-primary)',
                  borderColor: 'transparent',
                }
              : { background: 'var(--card)', color: 'var(--ink)', borderColor: 'var(--line)' }
          }
        >
          {sweep ? 'Done sweeping' : '⟲ Sweep your library'}
        </button>
      </header>
      {sweep && (
        <p className="mt-2 text-[12.5px] text-muted">
          Tap covers to tag or untag — highlighted books carry {trope.name}.
        </p>
      )}

      {gridBooks.length ? (
        <div className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-7">
          {gridBooks.map((b) => {
            const carrying = carrierIds.has(b.id)
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => toggle(b)}
                aria-pressed={sweep ? carrying : undefined}
                aria-label={
                  sweep
                    ? `${carrying ? 'Untag' : 'Tag'} ${b.title}${coverStateSuffix(b)}`
                    : `Open ${b.title}${coverStateSuffix(b)}`
                }
                className="relative overflow-hidden skin-tile border text-left"
                style={{
                  borderColor: sweep && carrying ? 'var(--accent-ink)' : 'var(--line)',
                  boxShadow: sweep && carrying ? '0 0 0 2px var(--accent-ink)' : undefined,
                  opacity: sweep && !carrying ? 0.6 : 1,
                }}
              >
                <div className="aspect-[2/3] w-full">
                  <CoverImage book={b} thumb />
                </div>
                <BookStateMarks book={b} showRead />
                {sweep && carrying && (
                  <span
                    aria-hidden
                    className="absolute right-1 top-1 rounded-full px-1.5 text-[11px] font-bold"
                    style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
                  >
                    ✓
                  </span>
                )}
              </button>
            )
          })}
        </div>
      ) : (
        <p className="mt-6 rounded-2xl border border-dashed border-line p-6 text-center text-[13.5px] text-muted">
          Nothing carries {trope.name} yet — sweep your library and tap the ones that do.
        </p>
      )}
    </section>
  )
}

export const tropeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'tropes/$tropeId',
  component: TropeScreen,
})
