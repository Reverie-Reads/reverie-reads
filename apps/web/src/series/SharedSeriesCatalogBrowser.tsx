import { useDeferredValue, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { SERIES_STATUS_LABELS } from '@reverie/core'
import { Surface } from '../components/Surface'
import { useCorpusSeriesCatalog } from '../data/corpusSeriesCatalog'

export function SharedSeriesCatalogBrowser() {
  const { data: rows = [], isLoading, isError } = useCorpusSeriesCatalog()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase()
    if (!needle) return rows
    return rows.filter((row) =>
      [
        row.name,
        ...row.aliases,
        ...row.entries.flatMap((entry) => [entry.title, entry.author]),
      ].some((value) => value.toLocaleLowerCase().includes(needle)),
    )
  }, [deferredQuery, rows])

  return (
    <section className="mt-6" aria-labelledby="shared-series-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="shared-series-heading"
            className="text-[20px] italic text-ink"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            Shared catalog
          </h2>
          <p className="mt-1 max-w-[64ch] text-[12.5px] leading-relaxed text-muted">
            Reviewed series identities and reading-order slots shared across Reverie. This does not
            change your personal series choices.
          </p>
        </div>
        <p className="text-[11px] text-muted">
          {rows.length} series · {rows.reduce((sum, row) => sum + row.entries.length, 0)} slots
        </p>
      </div>
      <label className="mt-4 block max-w-md text-[12px] font-semibold text-ink">
        Find a series
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px]"
          placeholder="Series, alias, book, or author"
        />
      </label>

      {isLoading ? (
        <p className="mt-6 text-[13px] text-muted">Opening the shared catalog…</p>
      ) : null}
      {isError ? (
        <p className="mt-6 text-[13px]" style={{ color: 'var(--danger)' }}>
          The shared catalog is unavailable. Your personal series are unchanged.
        </p>
      ) : null}
      {!isLoading && !isError && !filtered.length ? (
        <p className="mt-6 text-[13px] text-muted">
          {query.trim() ? 'No shared series match that search.' : 'No reviewed shared series yet.'}
        </p>
      ) : null}

      {filtered.length > 0 ? (
        <ul className="mt-5 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, 100).map((row) => {
            const linked = row.entries.filter((entry) => entry.workId)
            const unbound = row.entries.length - linked.length
            return (
              <Surface
                as="li"
                key={row.id}
                tone="card"
                radius="card"
                pad={3}
                className="min-w-0"
                data-testid="shared-series-card"
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3
                      className="break-words text-[18px] italic leading-tight text-ink"
                      style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
                    >
                      <Link
                        to="/catalog/series/$seriesId"
                        params={{ seriesId: row.id }}
                        className="underline decoration-transparent underline-offset-4 hover:decoration-current focus-visible:decoration-current"
                        aria-label={`Open the ${row.name} shared series`}
                      >
                        {row.name}
                      </Link>
                    </h3>
                    <p className="mt-1 text-[11.5px] text-muted">
                      {linked.length} linked {linked.length === 1 ? 'work' : 'works'}
                      {unbound ? ` · ${unbound} unbound ${unbound === 1 ? 'slot' : 'slots'}` : ''}
                      {row.declaredCount ? ` · ${row.declaredCount} confirmed` : ''}
                    </p>
                  </div>
                  {row.status ? (
                    <span className="skin-control-quiet flex-none border border-line px-2 py-1 text-[10px] font-semibold text-ink">
                      {SERIES_STATUS_LABELS[row.status]}
                    </span>
                  ) : null}
                </div>

                {row.aliases.length ? (
                  <p className="mt-2 break-words text-[11px] text-muted">
                    Also known as {row.aliases.join(' · ')}
                  </p>
                ) : null}

                <ol className="mt-4 space-y-2">
                  {row.entries.slice(0, 6).map((entry) => (
                    <li key={entry.id} className="flex min-w-0 items-center gap-2">
                      <span
                        className="flex h-14 w-9 flex-none items-center justify-center overflow-hidden border border-line text-[10px] text-muted"
                        style={{ background: 'var(--field)' }}
                        aria-hidden
                      >
                        {entry.work?.cover ? (
                          <img
                            src={entry.work.cover}
                            alt=""
                            className="h-full w-full object-contain"
                            loading="lazy"
                          />
                        ) : (
                          (entry.position ?? '—')
                        )}
                      </span>
                      <span className="min-w-0 text-[12px]">
                        <span className="block break-words font-semibold text-ink">
                          {entry.position == null ? '' : `#${entry.position} · `}
                          {entry.title}
                        </span>
                        {entry.author ? (
                          <span className="block break-words text-muted">{entry.author}</span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ol>
                {row.entries.length > 6 ? (
                  <p className="mt-2 text-[11px] text-muted">
                    +{row.entries.length - 6} more slots
                  </p>
                ) : null}
                <Link
                  to="/catalog/series/$seriesId"
                  params={{ seriesId: row.id }}
                  className="skin-control mt-4 inline-flex min-h-11 items-center border border-line px-3 text-[12px] font-semibold text-ink"
                  aria-label={`View all books in ${row.name}`}
                >
                  Open series
                </Link>
              </Surface>
            )
          })}
        </ul>
      ) : null}
      {filtered.length > 100 ? (
        <p className="mt-3 text-[12px] text-muted">
          Showing the first 100 matches. Narrow the search to find another series.
        </p>
      ) : null}
    </section>
  )
}
