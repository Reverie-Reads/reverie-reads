import { createRoute, Link } from '@tanstack/react-router'
import { SERIES_STATUS_LABELS } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { Surface } from '../components/Surface'
import { useCorpusSeriesCatalog, type CorpusSeriesCatalogRow } from '../data/corpusSeriesCatalog'

/** Shared bibliographic data only. Opening this page never hydrates or edits personal series. */
export function SharedSeriesDetail({ series }: { series: CorpusSeriesCatalogRow }) {
  return (
    <>
      <header className="mt-4 border-b border-line pb-5">
        <p className="skin-label text-[11px] text-muted">Shared catalog series</p>
        <h1
          className="mt-2 break-words text-[30px] italic leading-tight text-ink sm:text-[38px]"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          {series.name}
        </h1>
        <p className="mt-3 text-[13px] text-muted">
          {series.entries.length} known {series.entries.length === 1 ? 'entry' : 'entries'}
          {series.declaredCount != null
            ? ` · ${series.declaredCount} confirmed in series`
            : ' · Series length not confirmed'}
          {series.status ? ` · ${SERIES_STATUS_LABELS[series.status]}` : ''}
        </p>
        {series.aliases.length > 0 && (
          <p className="mt-2 break-words text-[13px] text-muted">
            Also known as {series.aliases.join(' · ')}
          </p>
        )}
        <p className="mt-3 max-w-[65ch] text-[13px] leading-relaxed text-muted">
          These are shared catalog details, not your personal reading order or progress. Opening a
          series does not add books to your library or change anyone’s choices.
        </p>
        {series.state === 'review' && (
          <p className="mt-3 text-[13px] text-ink" role="status">
            This shared series still has details awaiting review.
          </p>
        )}
      </header>
      {series.entries.length === 0 ? (
        <p className="mt-6 text-[14px] text-muted">
          No books have been linked to this shared series yet.
        </p>
      ) : (
        <ol className="mt-6 grid items-start gap-4 sm:grid-cols-2" aria-label="Shared series books">
          {series.entries.map((entry) => (
            <Surface
              as="li"
              key={entry.id}
              tone="card"
              radius="card"
              pad={3}
              className="flex min-w-0 gap-4"
            >
              <span
                className="flex h-36 w-24 flex-none items-center justify-center overflow-hidden border border-line bg-field text-[13px] text-muted"
                aria-hidden
              >
                {entry.work?.cover ? (
                  <img
                    src={entry.work.cover}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  '—'
                )}
              </span>
              <div className="min-w-0">
                <p className="text-[12px] text-muted">
                  {entry.position == null ? 'Position not confirmed' : `#${entry.position}`}
                </p>
                <h2 className="mt-1 break-words text-[17px] font-semibold leading-snug text-ink">
                  {entry.title}
                </h2>
                {entry.author && (
                  <p className="mt-1 break-words text-[13px] text-muted">{entry.author}</p>
                )}
                {entry.label && (
                  <p className="mt-2 break-words text-[12px] text-muted">{entry.label}</p>
                )}
                {!entry.workId && (
                  <p className="mt-2 text-[12px] text-muted">Catalog book record not linked yet</p>
                )}
              </div>
            </Surface>
          ))}
        </ol>
      )}
    </>
  )
}

export function SharedSeriesScreen({ seriesId }: { seriesId: string }) {
  const catalog = useCorpusSeriesCatalog()
  const series = catalog.data?.find((row) => row.id === seriesId)
  return (
    <section className="mx-auto w-full max-w-[1000px] px-4 py-6 sm:px-6 lg:py-8">
      <Link
        to="/series"
        search={{ scope: 'shared' }}
        className="skin-control inline-flex min-h-11 items-center text-[13px] text-ink underline underline-offset-4"
      >
        Back to shared catalog
      </Link>
      {catalog.isLoading ? (
        <p className="mt-6 text-muted">Opening the shared series…</p>
      ) : catalog.isError ? (
        <div className="mt-6">
          <p role="alert" className="text-ink">
            The shared series could not be loaded. Your library is unchanged.
          </p>
          <button
            type="button"
            onClick={() => void catalog.refetch()}
            className="skin-control mt-3 min-h-11 border border-line px-4 text-[13px] text-ink"
          >
            Try again
          </button>
        </div>
      ) : series ? (
        <SharedSeriesDetail series={series} />
      ) : (
        <div className="mt-6">
          <h1 className="text-2xl text-ink">Shared series unavailable</h1>
          <p className="mt-3 text-muted">
            This series is no longer available in the shared catalog. Nothing was created or changed
            by opening this page.
          </p>
        </div>
      )}
    </section>
  )
}

function SharedSeriesPage() {
  const { seriesId } = sharedSeriesRoute.useParams()
  return <SharedSeriesScreen seriesId={seriesId} />
}

export const sharedSeriesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'catalog/series/$seriesId',
  component: SharedSeriesPage,
})
