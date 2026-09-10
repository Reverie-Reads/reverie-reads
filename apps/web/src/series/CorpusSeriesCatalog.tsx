import { useDeferredValue, useMemo, useState } from 'react'
import { SERIES_STATUS_LABELS } from '@reverie/core'
import { Button } from '../components/Button'
import { Surface } from '../components/Surface'
import {
  useArchiveCorpusSeries,
  useArchivedCorpusSeries,
  useCorpusSeriesCatalog,
  useMergeCorpusSeries,
  useRemoveCorpusSeriesEntry,
  useRestoreCorpusSeries,
  useSaveCorpusSeriesEntry,
  useSeriesOrderReview,
  isOrderSourceUrl,
  useUpdateCorpusSeries,
  type CorpusSeriesCatalogRow,
  type CorpusSeriesEntry,
  type CorpusSeriesStatus,
} from '../data/corpusSeriesCatalog'

const STATUS_OPTIONS: CorpusSeriesStatus[] = [
  'ongoing',
  'completed',
  'on_hiatus',
  'cancelled',
  'interconnected_standalone',
  'interconnected_series',
]

interface EditDraft {
  id: string
  revision: number
  name: string
  status: CorpusSeriesStatus | ''
  declaredCount: string
  aliases: string
}

const editDraft = (row: CorpusSeriesCatalogRow): EditDraft => ({
  id: row.id,
  revision: row.revision,
  name: row.name,
  status: row.status ?? '',
  declaredCount: row.declaredCount?.toString() ?? '',
  aliases: row.aliases.join(', '),
})

const seriesCreator = (row: CorpusSeriesCatalogRow): string =>
  row.entries.find((entry) => entry.author.trim())?.author.trim() || 'Creator not set'

function CatalogSlotEditor({
  row,
  entry,
}: {
  row: CorpusSeriesCatalogRow
  entry?: CorpusSeriesEntry
}) {
  const save = useSaveCorpusSeriesEntry()
  const remove = useRemoveCorpusSeriesEntry()
  const [title, setTitle] = useState(entry?.title ?? '')
  const [author, setAuthor] = useState(entry?.author ?? '')
  const [position, setPosition] = useState(entry?.position?.toString() ?? '')
  const [label, setLabel] = useState(entry?.label ?? '')
  const [sourceUrl, setSourceUrl] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const history = useSeriesOrderReview(row.id, entry?.id)
  const numericPosition = position.trim() ? Number(position) : null
  const orderChanged = !!entry && numericPosition !== entry.position
  const needsReview = !!entry && (orderChanged || !!sourceUrl.trim() || !!reviewNote.trim())
  const reviewValid =
    !needsReview ||
    (confirmed &&
      isOrderSourceUrl(sourceUrl.trim()) &&
      !!reviewNote.trim() &&
      reviewNote.trim().length <= 1000)
  const positionValid =
    numericPosition == null || (Number.isFinite(numericPosition) && numericPosition > 0)
  const linked = !!entry?.workId

  return (
    <form
      className="border border-line p-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!positionValid || !reviewValid || (!entry && !title.trim())) return
        save.mutate(
          {
            seriesId: row.id,
            revision: row.revision,
            entryId: entry?.id ?? null,
            title: title.trim(),
            author: author.trim(),
            position: numericPosition,
            label: label.trim(),
            ...(needsReview ? { sourceUrl: sourceUrl.trim(), reviewNote: reviewNote.trim() } : {}),
          },
          {
            onSuccess: () => {
              if (!entry) {
                setTitle('')
                setAuthor('')
                setPosition('')
                setLabel('')
              }
            },
          },
        )
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
        {linked ? (
          <div className="min-w-0">
            <p className="break-words text-[12px] font-semibold text-ink">{entry.title}</p>
            {entry.author ? (
              <p className="break-words text-[11px] text-muted">{entry.author}</p>
            ) : null}
            <p className="mt-1 text-[10px] text-muted">Linked corpus work</p>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] font-semibold text-ink">
              Slot title
              <input
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value)
                  setConfirmed(false)
                }}
                className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[12px]"
                required
              />
            </label>
            <label className="text-[11px] font-semibold text-ink">
              Author
              <input
                value={author}
                onChange={(event) => {
                  setAuthor(event.target.value)
                  setConfirmed(false)
                }}
                className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[12px]"
              />
            </label>
          </div>
        )}
        <label className="text-[11px] font-semibold text-ink">
          Position
          <input
            type="number"
            min="0.01"
            step="any"
            inputMode="decimal"
            value={position}
            onChange={(event) => {
              setPosition(event.target.value)
              setConfirmed(false)
            }}
            className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[12px]"
            aria-invalid={!positionValid}
          />
        </label>
      </div>
      <label className="mt-2 block text-[11px] font-semibold text-ink">
        Reading-order note
        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[12px]"
          placeholder="Prequel, novella, read after #2…"
        />
      </label>
      {entry && (
        <fieldset className="mt-3 space-y-2 border-t border-line pt-3 text-[11px] text-ink">
          <legend className="font-semibold">Order evidence</legend>
          <p className="text-muted">
            A changed or cleared position needs a source and explanation. This does not change the
            evidence for series membership.
          </p>
          {history.isError ? <p role="status">Previous order review is unavailable.</p> : null}
          {history.data ? (
            <details>
              <summary className="min-h-11 cursor-pointer py-2">Last cited order review</summary>
              <p>
                Reviewed position: {history.data.position ?? 'unknown'}. Current position:{' '}
                {entry.position ?? 'unknown'}.
              </p>
              <a
                className="underline"
                href={history.data.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                View order source
              </a>
              <p className="whitespace-pre-wrap break-words">{history.data.note}</p>
            </details>
          ) : null}
          <label className="block">
            Order source URL
            <input
              type="url"
              value={sourceUrl}
              maxLength={2000}
              onChange={(event) => {
                setSourceUrl(event.target.value)
                setConfirmed(false)
              }}
              className="skin-input mt-1 min-h-11 w-full px-3 py-2"
            />
          </label>
          <p className="text-muted">
            Use an HTTPS page link without query parameters or a fragment. We do not fetch this
            page.
          </p>
          <label className="block">
            Order review explanation
            <textarea
              value={reviewNote}
              maxLength={1000}
              onChange={(event) => {
                setReviewNote(event.target.value)
                setConfirmed(false)
              }}
              className="skin-input mt-1 min-h-20 w-full px-3 py-2"
            />
          </label>
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I checked this exact book and the proposed order against the source.
          </label>
          <p className="text-muted">
            The explanation is visible only to catalog administrators. A saved link is not automatic
            verification.
          </p>
        </fieldset>
      )}
      {!positionValid ? (
        <p className="mt-1 text-[11px]" style={{ color: 'var(--danger)' }}>
          Position must be greater than zero.
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="submit"
          variant="secondary"
          disabled={save.isPending || !positionValid || !reviewValid}
        >
          {save.isPending ? 'Saving…' : entry ? 'Save slot' : 'Add known slot'}
        </Button>
        {entry ? (
          <Button
            type="button"
            variant="ghost"
            disabled={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Remove ${entry.title} from ${row.name}? The slot stays in the audit history.`,
                )
              )
                remove.mutate({ entryId: entry.id, revision: row.revision })
            }}
          >
            {remove.isPending ? 'Removing…' : 'Remove slot'}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

function CatalogSlotsEditor({ row }: { row: CorpusSeriesCatalogRow }) {
  return (
    <section
      className="mt-4 border-t border-line pt-4 xl:mt-0 xl:border-t-0 xl:pt-0"
      aria-label={`Reading order for ${row.name}`}
    >
      <h4 className="text-[13px] font-semibold text-ink">Reading-order slots</h4>
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Correct linked positions here, or add a known title that is not yet linked to a corpus work.
      </p>
      <div className="mt-3 grid gap-2 xl:grid-cols-2">
        {row.entries.map((entry) => (
          <CatalogSlotEditor key={`${entry.id}-${row.revision}`} row={row} entry={entry} />
        ))}
        <CatalogSlotEditor key={`new-${row.revision}`} row={row} />
      </div>
    </section>
  )
}

function CatalogEditForm({ row, onClose }: { row: CorpusSeriesCatalogRow; onClose: () => void }) {
  const [draft, setDraft] = useState<EditDraft>(() => editDraft(row))
  const update = useUpdateCorpusSeries()
  const count = draft.declaredCount.trim() ? Number(draft.declaredCount) : null
  const countValid = count == null || (Number.isInteger(count) && count >= 1 && count <= 999)

  return (
    <div className="mt-3 grid border-t border-line pt-3 xl:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)] xl:gap-5">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!draft.name.trim() || !countValid) return
          update.mutate(
            {
              id: draft.id,
              revision: draft.revision,
              name: draft.name.trim(),
              status: draft.status || null,
              declaredCount: count,
              aliases: draft.aliases
                .split(',')
                .map((alias) => alias.trim())
                .filter(Boolean),
            },
            { onSuccess: onClose },
          )
        }}
      >
        <p className="text-[12px] leading-relaxed text-muted">
          Saving changes the shared corpus view. Eligible automatic personal defaults follow it;
          reader and import choices do not.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-semibold text-ink">
            Canonical name
            <input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px]"
              required
            />
          </label>
          <label className="text-[12px] font-semibold text-ink">
            Publication status
            <select
              value={draft.status}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  status: event.target.value as CorpusSeriesStatus | '',
                }))
              }
              className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px]"
            >
              <option value="">Not confirmed</option>
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {SERIES_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-ink">
            Confirmed length
            <input
              type="number"
              min={1}
              max={999}
              inputMode="numeric"
              value={draft.declaredCount}
              onChange={(event) =>
                setDraft((current) => ({ ...current, declaredCount: event.target.value }))
              }
              className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px]"
              aria-invalid={!countValid}
            />
            {!countValid ? (
              <span className="mt-1 block font-normal" style={{ color: 'var(--danger)' }}>
                Use a whole number from 1–999.
              </span>
            ) : null}
          </label>
          <label className="text-[12px] font-semibold text-ink sm:col-span-2">
            Add aliases
            <input
              value={draft.aliases}
              onChange={(event) =>
                setDraft((current) => ({ ...current, aliases: event.target.value }))
              }
              className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px]"
              placeholder="Alternate name, former name"
            />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="submit" disabled={update.isPending || !draft.name.trim() || !countValid}>
            {update.isPending ? 'Saving…' : 'Save shared series'}
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
      <div className="xl:border-l xl:border-line xl:pl-5">
        <CatalogSlotsEditor row={row} />
      </div>
    </div>
  )
}

function CatalogRow({
  row,
  editing,
  onEdit,
  archiving,
  onArchive,
}: {
  row: CorpusSeriesCatalogRow
  editing: boolean
  onEdit: () => void
  archiving: boolean
  onArchive: () => void
}) {
  const shown = row.entries.slice(0, 6)
  return (
    <Surface
      as="li"
      tone="card"
      radius="card"
      pad={3}
      className={editing ? 'lg:col-span-2' : ''}
      data-testid="corpus-series-card"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className="break-words text-[18px] italic leading-tight text-ink"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
            >
              {row.name}
            </h3>
            {row.state === 'review' ? (
              <span className="skin-control-quiet border border-line px-2 py-1 text-[10px] font-semibold text-ink">
                Needs review
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-[12px] text-muted">
            {seriesCreator(row)} · {row.entries.filter((entry) => entry.workId).length} corpus{' '}
            {row.entries.filter((entry) => entry.workId).length === 1 ? 'work' : 'works'}
            {row.declaredCount ? ` · ${row.declaredCount} in series` : ''}
            {row.status ? ` · ${SERIES_STATUS_LABELS[row.status]}` : ''}
          </p>
          {row.aliases.length ? (
            <p className="mt-1 break-words text-[11px] text-muted">
              Also known as {row.aliases.join(' · ')}
            </p>
          ) : null}
          {row.sources.length ? (
            <p className="mt-1 break-words text-[11px] text-muted">
              Sources{' '}
              {row.sources.map((source) => `${source.source} · ${source.sourceRef}`).join(' · ')}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={onEdit} aria-expanded={editing}>
            {editing ? 'Close' : 'Edit'}
          </Button>
          <Button variant="ghost" disabled={archiving} onClick={onArchive}>
            {archiving ? 'Archiving…' : 'Archive'}
          </Button>
        </div>
      </div>

      {shown.length ? (
        <ol className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className="flex min-w-0 items-start gap-2 border-l border-line pl-2 text-[12px]"
            >
              <span className="w-8 flex-none tabular-nums text-muted">
                {entry.position == null ? '—' : `#${entry.position}`}
              </span>
              <span className="min-w-0">
                <span className="block break-words font-semibold text-ink">{entry.title}</span>
                {entry.author ? (
                  <span className="block break-words text-muted">{entry.author}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-3 text-[12px] text-muted">No active membership slots.</p>
      )}
      {row.entries.length > shown.length ? (
        <p className="mt-2 text-[11px] text-muted">+{row.entries.length - shown.length} more</p>
      ) : null}
      {editing ? <CatalogEditForm key={row.revision} row={row} onClose={onEdit} /> : null}
    </Surface>
  )
}

export function CorpusSeriesCatalog() {
  const { data: rows = [], isLoading, isError } = useCorpusSeriesCatalog()
  const { data: archived = [] } = useArchivedCorpusSeries(true)
  const merge = useMergeCorpusSeries()
  const archive = useArchiveCorpusSeries()
  const restore = useRestoreCorpusSeries()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [editing, setEditing] = useState<string | null>(null)
  const [target, setTarget] = useState('')
  const [source, setSource] = useState('')

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
  const targetRow = rows.find((row) => row.id === target)
  const sourceRow = rows.find((row) => row.id === source)

  return (
    <section className="mt-8 border-t border-line pt-6" aria-labelledby="corpus-series-catalog">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="corpus-series-catalog"
            className="text-[20px] italic text-ink"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            Shared series catalog
          </h2>
          <p className="mt-1 max-w-[68ch] text-[12px] leading-relaxed text-muted">
            One reviewed identity and reading order for the corpus. Personal series remain editable
            and reader choices continue to win over shared defaults.
          </p>
        </div>
        <div className="flex gap-2 text-[11px] text-muted">
          <span>{rows.length} series</span>
          <span>·</span>
          <span>{rows.reduce((sum, row) => sum + row.entries.length, 0)} slots</span>
        </div>
      </div>

      <label className="mt-4 block text-[12px] font-semibold text-ink">
        Find a shared series
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px] sm:max-w-md"
          placeholder="Series, alias, book, or author"
        />
      </label>

      {isLoading ? <p className="mt-4 text-[13px] text-muted">Loading shared series…</p> : null}
      {isError ? (
        <p className="mt-4 text-[13px]" style={{ color: 'var(--danger)' }}>
          Shared series are unavailable. No review controls are active.
        </p>
      ) : null}
      {!isLoading && !isError && !filtered.length ? (
        <p className="mt-4 text-[13px] text-muted">
          {query.trim() ? 'No shared series match that search.' : 'No reviewed shared series yet.'}
        </p>
      ) : null}
      {filtered.length > 0 ? (
        <ul className="mt-4 grid items-start gap-3 lg:grid-cols-2">
          {filtered.slice(0, 100).map((row) => (
            <CatalogRow
              key={row.id}
              row={row}
              editing={editing === row.id}
              onEdit={() => setEditing((current) => (current === row.id ? null : row.id))}
              archiving={archive.isPending && archive.variables?.id === row.id}
              onArchive={() => {
                if (
                  window.confirm(
                    `Archive ${row.name}? Shared membership will be suspended, but the catalog record and its history remain recoverable.`,
                  )
                )
                  archive.mutate({ id: row.id, revision: row.revision })
              }}
            />
          ))}
        </ul>
      ) : null}
      {filtered.length > 100 ? (
        <p className="mt-3 text-[12px] text-muted">
          Showing the first 100 matches. Narrow the search to manage another series.
        </p>
      ) : null}

      {rows.length >= 2 ? (
        <Surface tone="card" radius="card" pad={3} className="mt-5">
          <h3 className="text-[14px] font-semibold text-ink">Merge duplicate shared series</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Every membership, source identity, and alias moves to the series you keep. The other
            record is archived as merge history.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-[12px] font-semibold text-ink">
              Keep
              <select
                className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px]"
                value={target}
                onChange={(event) => setTarget(event.target.value)}
              >
                <option value="">Choose the surviving series</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id} disabled={row.id === source}>
                    {row.name} · {seriesCreator(row)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-semibold text-ink">
              Merge into it
              <select
                className="skin-input mt-1 min-h-11 w-full px-3 py-2 text-[13px]"
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                <option value="">Choose the duplicate</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id} disabled={row.id === target}>
                    {row.name} · {seriesCreator(row)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Button
            className="mt-3"
            disabled={!targetRow || !sourceRow || merge.isPending}
            onClick={() => {
              if (
                targetRow &&
                sourceRow &&
                window.confirm(`Merge ${sourceRow.name} into ${targetRow.name}?`)
              )
                merge.mutate({ target: targetRow, source: sourceRow })
            }}
          >
            {merge.isPending ? 'Merging…' : 'Merge shared series'}
          </Button>
        </Surface>
      ) : null}

      {archived.length > 0 ? (
        <details className="mt-5 border border-line px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-semibold text-ink">
            Archived shared series · {archived.length}
          </summary>
          <ul className="space-y-2 pb-2">
            {archived.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3">
                <span className="text-[12px] text-ink">
                  <strong>{row.name}</strong> · {row.linkedWorkCount} linked works
                  {row.mergedInto ? ' · merged' : ''}
                </span>
                {!row.mergedInto ? (
                  <Button
                    variant="secondary"
                    disabled={restore.isPending}
                    onClick={() => restore.mutate({ id: row.id, revision: row.revision })}
                  >
                    Restore
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
