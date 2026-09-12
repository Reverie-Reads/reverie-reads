import { ReadingTips } from '../components/ReadingTips'
import { useMemo, useState } from 'react'
import { createRoute, Link } from '@tanstack/react-router'
import {
  APP_NAME,
  claimedSeriesLength,
  isPossessed,
  seriesAuthorKeys,
  seriesProgress,
  SERIES_STATUS_LABELS,
  type Book,
  type ConsolidationSeries,
} from '@reverie/core'
import { rootRoute } from './RootRoute'
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'
import { Surface } from '../components/Surface'
import { useBooks } from '../data/books'
import { useLists } from '../data/lists'
import { useAllListItems } from '../data/listItems'
import { useSeriesList, type SeriesListRow } from '../data/series'
import { ConsolidationQueue } from '../series/ConsolidationQueue'
import { SeriesArranger } from '../series/SeriesArranger'
import {
  ArchivedSeriesPanel,
  DeleteSeriesDialog,
  MergeSeriesDialog,
  RenameSeriesDialog,
  type SeriesManagementRow,
} from '../series/SeriesManagement'
import { isSeriesMergeEligible } from '../series/seriesManagementPolicy'
import { SharedSeriesCatalogBrowser } from '../series/SharedSeriesCatalogBrowser'
import { LibraryNavigation } from '../components/LibraryNavigation'

interface StructuredSeriesSection {
  key: string
  name: string
  rows: SeriesListRow[]
}

/** Build the browse index from confirmed structured entries only. A books.series compatibility
 * string never creates a card; an unreviewed row remains solely in Membership review. Linked
 * secondary memberships still appear because the entry, not the book's primary projection, owns
 * the relationship. */
export function buildStructuredSeriesSections(
  seriesList: ReadonlyMap<string, SeriesListRow>,
  booksById: ReadonlyMap<string, Book>,
): StructuredSeriesSection[] {
  const byAuthor = new Map<string, StructuredSeriesSection>()
  for (const row of seriesList.values()) {
    if (!row.entries.length) continue
    const linkedBooks = row.entries.flatMap((entry) => {
      const book = entry.bookId ? booksById.get(entry.bookId) : undefined
      return book ? [book] : []
    })
    const authors = seriesAuthorKeys(linkedBooks, row.entries)
    const filing = authors.length ? authors : [{ key: 'author-not-set', name: 'Author not set' }]
    for (const author of filing) {
      const section = byAuthor.get(author.key) ?? {
        key: author.key,
        name: author.name,
        rows: [],
      }
      section.rows.push(row)
      byAuthor.set(author.key, section)
    }
  }
  return [...byAuthor.values()]
    .map((section) => ({
      ...section,
      rows: [...section.rows].sort((a, b) => a.series.name.localeCompare(b.series.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

const uniqueLinkedBooks = (row: SeriesListRow, byId: ReadonlyMap<string, Book>): Book[] => {
  const seen = new Set<string>()
  const out: Book[] = []
  for (const entry of row.entries) {
    if (!entry.bookId || seen.has(entry.bookId)) continue
    const book = byId.get(entry.bookId)
    if (!book) continue
    seen.add(entry.bookId)
    out.push(book)
  }
  return out
}

function CoverRun({ row, byId }: { row: SeriesListRow; byId: ReadonlyMap<string, Book> }) {
  const entries = row.entries.slice(0, 6)
  return (
    <div className="mt-4 flex min-h-[86px] items-end gap-1.5 overflow-hidden" aria-hidden>
      {entries.map((entry) => {
        const book = entry.bookId ? byId.get(entry.bookId) : undefined
        return (
          <span
            key={entry.id}
            className="relative h-[84px] w-14 flex-none overflow-hidden rounded-[calc(var(--radius-control)/2)] border border-line"
            style={
              book
                ? { background: 'var(--field)' }
                : { background: 'var(--chip)', borderStyle: 'dashed' }
            }
            title={book?.title ?? entry.title}
          >
            {book ? (
              <CoverImage book={book} thumb ghost={!isPossessed(book)} />
            ) : (
              <span className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-muted">
                <span className="text-[13px]">⊹</span>
                <span className="text-[9px] font-semibold tabular-nums">#{entry.position}</span>
              </span>
            )}
          </span>
        )
      })}
      {row.entries.length > entries.length ? (
        <span className="flex h-[84px] w-10 flex-none items-center justify-center text-[11px] font-semibold text-muted">
          +{row.entries.length - entries.length}
        </span>
      ) : null}
    </div>
  )
}

export function SeriesCard({
  row,
  management,
  byId,
  tbrBookIds,
  expanded,
  onToggle,
  onRename,
  onDelete,
  panelId,
}: {
  row: SeriesListRow
  management: SeriesManagementRow
  byId: ReadonlyMap<string, Book>
  tbrBookIds: ReadonlySet<string>
  expanded: boolean
  onToggle: () => void
  onRename: () => void
  onDelete: () => void
  panelId: string
}) {
  const linkedBooks = uniqueLinkedBooks(row, byId)
  const progress = seriesProgress(row.entries, byId)
  const claimedLength = claimedSeriesLength(linkedBooks)
  const knownLength = row.entries.length
  const explicitLength = Math.max(row.series.length ?? 0, claimedLength ?? 0)
  // Confirmed slots keep a stale explicit total from understating the series, but do not turn an
  // unknown singleton into a claimed one-book series.
  const seriesLength = explicitLength ? Math.max(explicitLength, knownLength) : null
  const barTotal = seriesLength ?? knownLength
  const percent = barTotal ? Math.min(100, Math.round((progress.read / barTotal) * 100)) : 0

  return (
    <Surface
      as="li"
      tone="card"
      radius="card"
      pad={3}
      className="flex min-w-0 flex-col"
      data-testid="series-browser-card"
      data-series-name={row.series.name}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="break-words text-[19px] italic leading-tight text-ink"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            {row.series.name}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {management.possessedBooks} in hand · {progress.read} read · {knownLength} known
            {seriesLength ? ` · ${seriesLength} in series` : ''}
            {progress.toGet ? ` · ${progress.toGet} to get` : ''}
          </p>
        </div>
        {row.series.status ? (
          <span
            className="skin-control-quiet flex-none border border-line px-2 py-1 text-[10px] font-semibold text-ink"
            style={{ background: 'var(--chip)' }}
          >
            {SERIES_STATUS_LABELS[row.series.status]}
          </span>
        ) : null}
      </div>

      <CoverRun row={row} byId={byId} />

      <div className="mt-4">
        <div
          role="progressbar"
          aria-label={`${row.series.name} reading progress`}
          aria-valuemin={0}
          aria-valuemax={barTotal}
          aria-valuenow={progress.read}
          className="h-1.5 w-full overflow-hidden rounded-full"
          style={{ background: 'var(--chip)' }}
        >
          <div
            className="h-full rounded-full motion-reduce:transition-none"
            style={{
              width: `${percent}%`,
              background: 'linear-gradient(90deg, var(--primary), var(--gold))',
            }}
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <Link
          to="/series/$seriesName"
          params={{ seriesName: encodeURIComponent(row.series.name) }}
          className="skin-control skin-btn-primary inline-flex h-10 w-full items-center justify-center px-4 text-[12px] sm:w-auto"
          aria-label={`Open the ${row.series.name} series page`}
        >
          Open series
        </Link>
        <Button
          variant="secondary"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`Arrange ${row.series.name}`}
          onClick={onToggle}
          className="w-full justify-center px-3 text-[12px] sm:w-auto"
        >
          {expanded ? 'Close order' : 'Arrange'}
        </Button>
        <Button
          variant="ghost"
          onClick={onRename}
          className="w-full justify-center px-2 text-[12px] sm:w-auto"
        >
          Rename
        </Button>
        <Button
          variant="ghost"
          onClick={onDelete}
          className="w-full justify-center px-2 text-[12px] sm:w-auto"
        >
          Delete
        </Button>
      </div>

      <div id={panelId} hidden={!expanded} className="mt-4 border-t border-line pt-3">
        {expanded ? (
          <SeriesArranger name={row.series.name} books={byId} tbrBookIds={tbrBookIds} />
        ) : null}
      </div>
    </Surface>
  )
}

export function SeriesIndexScreen() {
  const { scope: selectedScope } = seriesIndexRoute.useSearch()
  const scope = selectedScope ?? 'personal'
  const navigate = seriesIndexRoute.useNavigate()
  const { data: books } = useBooks()
  const { data: seriesList } = useSeriesList()
  const { data: lists } = useLists()
  const { data: items } = useAllListItems()
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set())
  const [renaming, setRenaming] = useState<SeriesManagementRow | null>(null)
  const [deleting, setDeleting] = useState<SeriesManagementRow | null>(null)
  const [merging, setMerging] = useState(false)

  const byId = useMemo(() => new Map((books ?? []).map((book) => [book.id, book])), [books])

  const tbrBookIds = useMemo(() => {
    const tbrIds = new Set(
      (lists ?? []).filter((list) => list.kind === 'tbr').map((list) => list.id),
    )
    const out = new Set<string>()
    for (const item of items ?? []) if (tbrIds.has(item.list_id)) out.add(item.book_id)
    return out
  }, [lists, items])

  const sections = useMemo(
    () => buildStructuredSeriesSections(seriesList ?? new Map(), byId),
    [seriesList, byId],
  )

  const managementRows = useMemo<SeriesManagementRow[]>(() => {
    if (!seriesList) return []
    return [...seriesList.values()]
      .map((row) => {
        const linkedBooks = uniqueLinkedBooks(row, byId)
        return {
          id: row.series.id,
          name: row.series.name,
          liveEntries: row.total,
          memberBooks: linkedBooks.length,
          series: row.series,
          entries: row.entries,
          possessedBooks: linkedBooks.filter(isPossessed).length,
          ghostEntries: row.ghosts,
          unreviewedEntries: row.unreviewed,
          removedEntries: row.removed,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [seriesList, byId])

  const managementById = useMemo(
    () => new Map(managementRows.map((row) => [row.id, row])),
    [managementRows],
  )

  const mergeEligibleRows = useMemo(
    () => managementRows.filter(isSeriesMergeEligible),
    [managementRows],
  )

  const unreviewedSeries = useMemo(
    () => [...(seriesList ?? new Map()).values()].filter((row) => row.unreviewed > 0),
    [seriesList],
  )

  const consolidationRows = useMemo<ConsolidationSeries[]>(
    () =>
      mergeEligibleRows.map(({ id, name, liveEntries, memberBooks }) => ({
        id,
        name,
        liveEntries,
        memberBooks,
      })),
    [mergeEligibleRows],
  )

  return (
    <section className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <p className="skin-label text-[10.5px]" style={{ color: 'var(--accent-ink)' }}>
            Reading order · collection progress
          </p>
          <h1
            className="mt-1 text-[30px] italic leading-tight text-ink sm:text-[38px]"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            Series
          </h1>
          <ReadingTips>
            <p className="mt-2 max-w-[60ch] text-[13.5px] leading-relaxed text-muted">
              {scope === 'personal'
                ? 'Browse your confirmed series, see what you have in hand, and arrange each reading order.'
                : 'Browse reviewed series identities and reading-order slots shared across Reverie.'}
            </p>
          </ReadingTips>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-line p-1" aria-label="Series catalog scope">
            {(
              [
                ['personal', 'My series'],
                ['shared', `${APP_NAME} catalog`],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={scope === value}
                onClick={() =>
                  void navigate({ search: { scope: value === 'shared' ? 'shared' : undefined } })
                }
                className="skin-control min-h-11 px-3 text-[13px] font-semibold text-ink"
                style={{
                  background: scope === value ? 'var(--accent-fill)' : 'transparent',
                  color: scope === value ? 'var(--on-primary)' : 'var(--ink)',
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {scope === 'personal' ? (
            <Button disabled={mergeEligibleRows.length < 2} onClick={() => setMerging(true)}>
              Merge series
            </Button>
          ) : null}
        </div>
      </header>
      <LibraryNavigation current="series" className="mb-4 mt-4" />

      {scope === 'shared' ? (
        <SharedSeriesCatalogBrowser />
      ) : (
        <>
          <ConsolidationQueue rows={consolidationRows} />

          {!!unreviewedSeries.length && (
            <section
              className="mt-5 border border-line p-3"
              aria-labelledby="series-membership-review"
            >
              <h2 id="series-membership-review" className="text-[13px] font-semibold text-ink">
                Membership review · {unreviewedSeries.reduce((sum, row) => sum + row.unreviewed, 0)}
              </h2>
              <p className="mt-1 text-[12px] leading-relaxed text-muted">
                These older labels are excluded from browsing and progress until you confirm them.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {unreviewedSeries.map((row) => (
                  <Link
                    key={row.series.id}
                    to="/series/$seriesName"
                    params={{ seriesName: encodeURIComponent(row.series.name) }}
                    className="skin-control min-h-11 border border-line px-3 py-2 text-[12px] font-semibold text-ink"
                  >
                    Review {row.series.name} · {row.unreviewed}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {!sections.length ? (
            <p className="mt-8 text-[13.5px] text-muted">
              No confirmed series yet. Add a series through a book’s details, or review an older
              label above.
            </p>
          ) : (
            <div className="mt-7 flex flex-col gap-8" data-testid="confirmed-series-browser">
              {sections.map((section) => (
                <section
                  key={section.key}
                  aria-labelledby={`author-${section.key.replace(/[^a-zA-Z0-9]+/g, '-')}`}
                >
                  <h2
                    id={`author-${section.key.replace(/[^a-zA-Z0-9]+/g, '-')}`}
                    className="mb-3 text-[12px] font-semibold uppercase tracking-[0.14em] text-muted"
                  >
                    {section.name}
                  </h2>
                  <ul className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {section.rows.map((row) => {
                      const management = managementById.get(row.series.id)
                      if (!management) return null
                      const rowKey = `${section.key}::${row.series.id}`
                      const panelId = `arrange-panel-${rowKey.replace(/[^a-zA-Z0-9]+/g, '-')}`
                      return (
                        <SeriesCard
                          key={rowKey}
                          row={row}
                          management={management}
                          byId={byId}
                          tbrBookIds={tbrBookIds}
                          expanded={open.has(rowKey)}
                          onToggle={() =>
                            setOpen((current) => {
                              const next = new Set(current)
                              if (!next.delete(rowKey)) next.add(rowKey)
                              return next
                            })
                          }
                          onRename={() => setRenaming(management)}
                          onDelete={() => setDeleting(management)}
                          panelId={panelId}
                        />
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <ArchivedSeriesPanel />
        </>
      )}

      {renaming ? <RenameSeriesDialog row={renaming} onClose={() => setRenaming(null)} /> : null}
      {deleting ? <DeleteSeriesDialog row={deleting} onClose={() => setDeleting(null)} /> : null}
      {merging ? (
        <MergeSeriesDialog rows={managementRows} onClose={() => setMerging(false)} />
      ) : null}
    </section>
  )
}

export function validateSeriesIndexSearch(search: Record<string, unknown>): { scope?: 'shared' } {
  return { scope: search.scope === 'shared' ? 'shared' : undefined }
}

export const seriesIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'series',
  validateSearch: validateSeriesIndexSearch,
  component: SeriesIndexScreen,
})
