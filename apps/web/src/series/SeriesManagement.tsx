import { useMemo, useState } from 'react'
import {
  canonicalPairKeys,
  seriesNameKey,
  type ConsolidationCandidate,
  type ConsolidationSeries,
  type SeriesEntry,
} from '@reverie/core'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { Surface } from '../components/Surface'
import {
  useArchivedSeriesList,
  useArchiveSeries,
  useRestoreSeries,
  useUpdateSeries,
  type UiSeries,
} from '../data/series'
import { useMergeSeries } from '../data/seriesConsolidation'
import { isSeriesMergeEligible } from './seriesManagementPolicy'

export interface SeriesManagementRow extends ConsolidationSeries {
  series: UiSeries
  entries: readonly SeriesEntry[]
  possessedBooks: number
  ghostEntries: number
  unreviewedEntries: number
  removedEntries: number
}

const messageOf = (error: unknown): string =>
  error instanceof Error && error.message.trim() ? error.message : 'The change could not be saved.'

export function RenameSeriesDialog({
  row,
  peers = [],
  onClose,
  onRenamed,
}: {
  row: SeriesManagementRow
  peers?: readonly SeriesManagementRow[]
  onClose: () => void
  onRenamed?: (name: string) => void
}) {
  const [name, setName] = useState(row.name)
  const update = useUpdateSeries(row.name)
  const nextName = name.trim()
  const collision = peers.find(
    (other) =>
      other.id !== row.id &&
      (other.series.displayName || other.name).toLowerCase() === nextName.toLowerCase(),
  )
  const [merging, setMerging] = useState(false)
  const [qualifier, setQualifier] = useState('')
  if (merging && collision)
    return (
      <MergeSeriesDialog
        rows={[row, collision]}
        initialIds={[row.id, collision.id]}
        onClose={onClose}
      />
    )

  return (
    <Modal title={`Rename ${row.name}`} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (
            !nextName ||
            nextName === row.name ||
            (collision && !qualifier.trim()) ||
            update.isPending
          )
            return
          update.mutate(
            {
              id: row.id,
              name: nextName,
              ...(collision
                ? { distinction: { otherId: collision.id, qualifier: qualifier.trim() } }
                : {}),
            },
            {
              onSuccess: () => {
                onRenamed?.(collision ? nextName + ' · ' + qualifier.trim() : nextName)
                onClose()
              },
            },
          )
        }}
      >
        <label htmlFor="series-rename" className="block text-[13px] font-semibold text-ink">
          Series name
        </label>
        <input
          id="series-rename"
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="skin-field mt-2 h-11 w-full border border-line px-3 text-[14px] text-ink"
          style={{ background: 'var(--field)' }}
        />
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          Every confirmed membership and linked book will follow the new name.
        </p>
        {collision && (
          <div className="my-3">
            <p>
              A series with this title already exists. Merge the two records or keep separate
              memberships under the same display title.
            </p>
            <Button
              onClick={() => setMerging(true)}
              disabled={!isSeriesMergeEligible(row) || !isSeriesMergeEligible(collision)}
            >
              Review a merge
            </Button>
            <label className="block">
              Label for this separate series (author or other distinction)
              <input
                className="skin-field block w-full"
                maxLength={150}
                value={qualifier}
                onChange={(e) => setQualifier(e.target.value)}
              />
            </label>
          </div>
        )}
        {update.isError ? (
          <p role="alert" className="mt-3 text-[12.5px] text-primary">
            {messageOf(update.error)}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={!nextName || nextName === row.name || update.isPending}>
            {update.isPending
              ? 'Renaming…'
              : collision
                ? 'Keep as separate series'
                : 'Rename series'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

const asConsolidationRow = (row: SeriesManagementRow): ConsolidationSeries => ({
  id: row.id,
  name: row.name,
  liveEntries: row.liveEntries,
  memberBooks: row.memberBooks,
})

export function MergeSeriesDialog({
  initialIds,
  rows,
  onClose,
}: {
  initialIds?: readonly [string, string]
  rows: readonly SeriesManagementRow[]
  onClose: () => void
}) {
  const eligibleRows = useMemo(() => rows.filter(isSeriesMergeEligible), [rows])
  const excludedCount = rows.length - eligibleRows.length
  const [firstId, setFirstId] = useState(initialIds?.[0] ?? '')
  const [secondId, setSecondId] = useState(initialIds?.[1] ?? '')
  const [keepId, setKeepId] = useState('')
  const merge = useMergeSeries()
  const first = eligibleRows.find((row) => row.id === firstId)
  const second = eligibleRows.find((row) => row.id === secondId)

  const preview = useMemo(() => {
    if (!first || !second || first.id === second.id) return null
    const firstPositions = new Set(first.entries.map((entry) => String(entry.position)))
    const positionConflicts = second.entries.filter((entry) =>
      firstPositions.has(String(entry.position)),
    ).length
    const firstBooks = new Set(
      first.entries.flatMap((entry) => (entry.bookId ? [entry.bookId] : [])),
    )
    const duplicateBooks = second.entries.filter(
      (entry) => entry.bookId && firstBooks.has(entry.bookId),
    ).length
    return { positionConflicts, duplicateBooks }
  }, [first, second])

  const chooseFirst = (id: string) => {
    setFirstId(id)
    if (id === secondId) setSecondId('')
    setKeepId('')
  }
  const chooseSecond = (id: string) => {
    setSecondId(id)
    if (id === firstId) setFirstId('')
    setKeepId('')
  }

  const submit = () => {
    if (!first || !second || !keepId || first.id === second.id || merge.isPending) return
    const survivor = keepId === second.id ? second : first
    const loser = survivor.id === first.id ? second : first
    const [nameKeyA, nameKeyB] = canonicalPairKeys(
      seriesNameKey(first.name),
      seriesNameKey(second.name),
    )
    const candidate: ConsolidationCandidate = {
      tier: 3,
      primary: asConsolidationRow(survivor),
      loser: asConsolidationRow(loser),
      nameKeyA,
      nameKeyB,
    }
    merge.mutate(candidate, { onSuccess: onClose })
  }

  return (
    <Modal title="Merge series" onClose={onClose} wide>
      {eligibleRows.length < 2 ? (
        <div className="text-[13.5px] leading-relaxed text-muted">
          <p>You need at least two active, confirmed series to merge.</p>
          {excludedCount > 0 ? (
            <p className="mt-2">
              {excludedCount} {excludedCount === 1 ? 'record is' : 'records are'} hidden because it
              has no confirmed entries or still needs membership review.
            </p>
          ) : null}
        </div>
      ) : (
        <div>
          <p className="text-[13px] leading-relaxed text-muted">
            Choose two confirmed series, inspect their books, then deliberately choose the name to
            keep. Records marked standalone, with only removed slots, or with unresolved memberships
            are excluded.
          </p>
          {excludedCount > 0 ? (
            <p className="mt-2 text-[12px] text-muted">
              {excludedCount} ineligible {excludedCount === 1 ? 'record is' : 'records are'} hidden
              until its membership review is complete.
            </p>
          ) : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-[12.5px] font-semibold text-ink">
              First series
              <select
                value={firstId}
                onChange={(event) => chooseFirst(event.target.value)}
                className="skin-control mt-1.5 h-11 w-full border border-line px-3 text-[13px] text-ink"
                style={{ background: 'var(--field)' }}
              >
                <option value="">Choose a series…</option>
                {eligibleRows.map((row) => (
                  <option key={row.id} value={row.id} disabled={row.id === secondId}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12.5px] font-semibold text-ink">
              Second series
              <select
                value={secondId}
                onChange={(event) => chooseSecond(event.target.value)}
                className="skin-control mt-1.5 h-11 w-full border border-line px-3 text-[13px] text-ink"
                style={{ background: 'var(--field)' }}
              >
                <option value="">Choose a series…</option>
                {eligibleRows.map((row) => (
                  <option key={row.id} value={row.id} disabled={row.id === firstId}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {first && second && preview ? (
            <Surface tone="field" radius="control" pad={2} className="mt-4">
              <p className="text-[13px] font-semibold text-ink">Merge preview</p>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
                <div>
                  <dt className="text-muted">Confirmed entries</dt>
                  <dd className="font-semibold text-ink">
                    {first.liveEntries} + {second.liveEntries}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Books in hand</dt>
                  <dd className="font-semibold text-ink">
                    {first.possessedBooks} + {second.possessedBooks}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Missing-book slots</dt>
                  <dd className="font-semibold text-ink">
                    {first.ghostEntries} + {second.ghostEntries}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Removed slots preserved</dt>
                  <dd className="font-semibold text-ink">
                    {first.removedEntries} + {second.removedEntries}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Overlapping positions</dt>
                  <dd className="font-semibold text-ink">{preview.positionConflicts}</dd>
                </div>
                <div>
                  <dt className="text-muted">Books in both</dt>
                  <dd className="font-semibold text-ink">{preview.duplicateBooks}</dd>
                </div>
              </dl>
              {preview.positionConflicts || preview.duplicateBooks ? (
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Conflicting slots are kept and placed into one stable order. A book already in
                  both series remains one personal book.
                </p>
              ) : null}
              <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
                {[first, second].map((row) => (
                  <div key={row.id}>
                    <p className="break-words text-[12px] font-semibold text-ink">{row.name}</p>
                    <ol className="mt-1.5 max-h-40 space-y-1 overflow-y-auto pr-1 text-[11.5px] text-muted">
                      {row.entries.map((entry, index) => (
                        <li key={entry.id} className="flex gap-2">
                          <span className="w-14 flex-none tabular-nums">
                            {index + 1} · Vol. {entry.position}
                          </span>
                          <span className="min-w-0 break-words text-ink">{entry.title}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </Surface>
          ) : null}

          {first && second ? (
            <fieldset className="mt-4">
              <legend className="text-[12.5px] font-semibold text-ink">Name to keep</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[first, second].map((row) => (
                  <label
                    key={row.id}
                    className="skin-control flex min-h-11 cursor-pointer items-center gap-2 border border-line px-3 py-2 text-[13px] text-ink"
                    style={{ background: keepId === row.id ? 'var(--chip)' : 'var(--card)' }}
                  >
                    <input
                      type="radio"
                      name="series-name-to-keep"
                      checked={keepId === row.id}
                      onChange={() => setKeepId(row.id)}
                    />
                    <span className="min-w-0 break-words font-semibold">{row.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {merge.isError ? (
            <div role="alert" className="mt-4 text-[12.5px] leading-relaxed text-primary">
              <p>{messageOf(merge.error)}</p>
              <p className="mt-1 text-muted">
                If this merge would leave a connected universe with fewer than two series, change
                that universe first and try again.
              </p>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={merge.isPending}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={!first || !second || !keepId || first.id === second.id || merge.isPending}
            >
              {merge.isPending ? 'Merging…' : 'Merge series'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

export function DeleteSeriesDialog({
  row,
  onClose,
  onDeleted,
  initialPermanent = false,
}: {
  row: SeriesManagementRow
  onClose: () => void
  onDeleted?: () => void
  initialPermanent?: boolean
}) {
  const [permanent, setPermanent] = useState(initialPermanent)
  const archive = useArchiveSeries(permanent)
  const close = () => {
    if (!archive.isPending) onClose()
  }
  return (
    <Modal title={permanent ? `Not a series: ${row.name}` : `Delete ${row.name}?`} onClose={close}>
      <p className="text-base leading-relaxed text-ink">
        Your books stay in your library, with their notes, ratings, copies, and reading history.
      </p>
      <fieldset className="mt-5 space-y-3" disabled={archive.isPending}>
        <legend className="mb-3 text-sm font-semibold text-ink">
          What should happen to this category?
        </legend>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-line p-3 text-sm leading-relaxed text-ink">
          <input
            type="radio"
            name="series-removal"
            checked={permanent}
            onChange={() => setPermanent(true)}
            className="mt-1"
          />
          <span>
            <strong>This is not a series</strong>
            <span className="mt-1 block text-muted">
              Permanently delete the category, its order, and missing-book slots. Remove this series
              label from your books; other series memberships stay. This cannot be restored.
            </span>
          </span>
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[var(--radius-card)] border border-line p-3 text-sm leading-relaxed text-ink">
          <input
            type="radio"
            name="series-removal"
            checked={!permanent}
            onChange={() => setPermanent(false)}
            className="mt-1"
          />
          <span>
            <strong>Keep it for later</strong>
            <span className="mt-1 block text-muted">
              Remove it from the active collection, but keep its entries and order in Deleted series
              so you can restore it.
            </span>
          </span>
        </label>
      </fieldset>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        This changes only your personal series category. It does not change the shared catalog or
        classify these books as standalone.
      </p>
      {archive.isError && (
        <p role="alert" className="mt-4 text-sm leading-relaxed text-primary">
          {messageOf(archive.error)}
          {/universe/i.test(messageOf(archive.error)) && (
            <span className="mt-1 block text-muted">
              To remove this category, remove it from that universe first.
            </span>
          )}
        </p>
      )}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={close} disabled={archive.isPending}>
          Keep series
        </Button>
        <Button
          onClick={() =>
            archive.mutate(row.series, {
              onSuccess: () => {
                onDeleted?.()
                onClose()
              },
            })
          }
          disabled={archive.isPending}
        >
          {archive.isPending
            ? 'Removing…'
            : permanent
              ? 'Permanently delete category'
              : 'Delete series'}
        </Button>
      </div>
    </Modal>
  )
}

export function ArchivedSeriesPanel() {
  const { data: rows, isLoading, isError, error } = useArchivedSeriesList()
  const restore = useRestoreSeries()
  const [open, setOpen] = useState(false)
  if (isLoading || (!isError && !rows?.length)) return null

  return (
    <section className="mt-6" aria-labelledby="archived-series-heading">
      <Surface tone="card" radius="panel" pad={3}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="archived-series-heading" className="text-[14px] font-semibold text-ink">
              Deleted series{rows?.length ? ` · ${rows.length}` : ''}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted">Restore a series with its order intact.</p>
          </div>
          {!isError ? (
            <Button
              variant="secondary"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? 'Hide' : 'View'}
            </Button>
          ) : null}
        </div>
        {isError ? (
          <p role="alert" className="mt-3 text-[12.5px] text-primary">
            {messageOf(error)}
          </p>
        ) : null}
        {open && rows ? (
          <ul className="mt-3 flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 first:border-0 first:pt-0"
              >
                <span className="min-w-0">
                  <span className="block break-words text-[13.5px] font-semibold text-ink">
                    {row.name}
                  </span>
                  <span className="block text-[12px] text-muted">
                    {row.entryCount} {row.entryCount === 1 ? 'entry' : 'entries'} ·{' '}
                    {row.linkedBookCount} linked {row.linkedBookCount === 1 ? 'book' : 'books'} ·{' '}
                    {row.ghostCount} missing
                  </span>
                </span>
                <Button
                  variant="secondary"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(row)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {restore.isError ? (
          <p role="alert" className="mt-3 text-[12.5px] text-primary">
            {messageOf(restore.error)}
          </p>
        ) : null}
      </Surface>
    </section>
  )
}
