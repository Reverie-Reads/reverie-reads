import type { ReactNode } from 'react'
import type { ReleaseHit } from '../../data/releases'
import { releaseBrowseGroups, useReleaseBrowse } from '../../data/releaseBrowse'
import { Chip } from '../Chip'

export function ReleaseBrowse({
  renderCard,
  period,
  newWorksOnly,
  onPeriod,
  onNewWorks,
}: {
  renderCard: (hit: ReleaseHit) => ReactNode
  period: 'recent' | 'upcoming'
  newWorksOnly: boolean
  onPeriod: (period: 'recent' | 'upcoming') => void
  onNewWorks: () => void
}) {
  const query = useReleaseBrowse()
  const groups = releaseBrowseGroups(query.data?.hits ?? [], new Date())
  const hits = groups[period].filter((h) => !newWorksOnly || h.release?.kind === 'new_work')
  const checked = query.data?.checkedAt ? new Date(query.data.checkedAt) : null
  const checkedLabel =
    checked && !Number.isNaN(checked.getTime())
      ? checked.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : ''
  return (
    <section aria-labelledby="release-browse-title">
      <header className="skin-panel mb-6 border border-line bg-card p-5 sm:p-7">
        <p className="text-sm text-muted">Explore beyond your library</p>
        <h2
          id="release-browse-title"
          className="mt-2 text-3xl leading-tight text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          New & upcoming
        </h2>
        <p className="mt-3 max-w-[65ch] text-sm leading-relaxed text-muted">
          Recent releases and books on the horizon. Open one to look inside, then choose whether to
          add it to your wishlist.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          A selection across genres, not a complete release calendar. Dates and availability vary by
          edition and country; upcoming dates can change.
        </p>
      </header>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Release window">
        <Chip active={period === 'recent'} onClick={() => onPeriod('recent')}>
          Last 90 days
        </Chip>
        <Chip active={period === 'upcoming'} onClick={() => onPeriod('upcoming')}>
          Next six months
        </Chip>
        <Chip active={newWorksOnly} onClick={() => onNewWorks()}>
          New books only
        </Chip>
      </div>
      {newWorksOnly && (
        <p className="mb-4 text-sm text-muted">
          Only books whose source identifies the first publication. New editions and unconfirmed
          first-publication dates are left out.
        </p>
      )}
      {query.isPending && (
        <p role="status" className="py-8 text-muted">
          Checking recent and upcoming releases…
        </p>
      )}
      {query.isError && (
        <div role="alert" className="skin-panel border border-line bg-card p-5">
          <p>
            Release information couldn’t be refreshed. You can still browse curated picks or the
            shared catalog.
          </p>
          <button className="mt-3 min-h-11 text-ink underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </div>
      )}
      {query.data && (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <p>
              {query.data.providers.hardcover === 'ready' ? 'Hardcover' : ''}
              {query.data.providers.hardcover === 'ready' && query.data.providers.prh === 'ready'
                ? ' · '
                : ''}
              {query.data.providers.prh === 'ready' ? 'Publisher catalog (US)' : ''}
              {checkedLabel ? ` · checked ${checkedLabel}` : ''}
            </p>
            <button
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
              className="min-h-11 text-ink underline disabled:opacity-50"
            >
              {query.isFetching ? 'Checking…' : 'Check for updates'}
            </button>
          </div>
          {Object.values(query.data.providers).includes('unavailable') && (
            <p role="status" className="mb-4 text-sm text-muted">
              One release source is unavailable. These are the results from the source that
              answered.
            </p>
          )}
          {hits.length ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {hits.map(renderCard)}
            </div>
          ) : (
            <p className="skin-panel border border-line bg-card p-6 text-muted">
              No releases match this window in the current selection. Try another window or include
              all editions.
            </p>
          )}
        </>
      )}
    </section>
  )
}
