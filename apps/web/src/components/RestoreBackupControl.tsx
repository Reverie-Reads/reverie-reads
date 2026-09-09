import { useRef, useState } from 'react'
import { inspectBackup, restoreBackup, type BackupPreview } from '../data/importExport'
import { Modal } from './Modal'
import { Surface } from './Surface'

type RestoreResult = Awaited<ReturnType<typeof restoreBackup>>

interface PendingRestore {
  fileName: string
  json: string
  preview: BackupPreview
}

function exportedLabel(value: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
  `${count.toLocaleString()} ${count === 1 ? singular : plural}`

function PreviewCount({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-line py-2.5 last:border-b-0">
      <dt className="text-[12px] text-muted">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-ink">
        {value.toLocaleString()}
      </dd>
    </div>
  )
}

export function RestoreBackupControl({
  currentBookCount,
  onRestored,
}: {
  /** null while the current library is still loading; a projected total would be false before then. */
  currentBookCount: number | null
  onRestored: (result: RestoreResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [pending, setPending] = useState<PendingRestore | null>(null)
  const [issue, setIssue] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)

  const close = () => {
    if (restoring) return
    setPending(null)
    setIssue(null)
  }

  const chooseFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setIssue(null)
    try {
      const json = await file.text()
      // File dialogs can return focus to the hidden input in some browsers. Put it back on the
      // visible opener before mounting Modal so the dialog can restore it there when it closes.
      triggerRef.current?.focus({ preventScroll: true })
      setPending({ fileName: file.name, json, preview: inspectBackup(json) })
    } catch (error) {
      setPending(null)
      setIssue(error instanceof Error ? error.message : 'Reverie couldn’t read that backup.')
    }
  }

  const restore = async () => {
    if (!pending || pending.preview.isNewerVersion || pending.preview.unknownSections.length) return
    setRestoring(true)
    setIssue(null)
    try {
      const result = await restoreBackup(pending.json)
      setPending(null)
      onRestored(result)
    } catch (error) {
      setIssue(error instanceof Error ? error.message : 'Reverie couldn’t restore that backup.')
    } finally {
      setRestoring(false)
    }
  }

  const preview = pending?.preview
  const exported = exportedLabel(preview?.exportedAt ?? null)
  const afterCount =
    preview && currentBookCount !== null ? currentBookCount + preview.counts.activeBooks : null
  const incompatible = Boolean(preview?.isNewerVersion || preview?.unknownSections.length)
  const additionalCandidates: [number, string, string?][] = preview
    ? [
        [preview.counts.listItems, 'shelf placement'],
        [preview.counts.tropes + preview.counts.moods, 'tag or mood', 'tags and moods'],
        [preview.counts.reviews, 'review'],
        [preview.counts.authorFollows, 'author choice'],
        [preview.counts.plannedBooks, 'planned book'],
        [preview.counts.favoriteBooks, 'favorite'],
      ]
    : []
  const additionalCounts = additionalCandidates.filter(([count]) => count > 0)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="restore-backup"
        onClick={() => inputRef.current?.click()}
        disabled={currentBookCount === null}
        className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:cursor-not-allowed disabled:border-dashed"
        style={{ background: 'var(--field)' }}
      >
        {currentBookCount === null ? 'Loading before restore…' : '⬆ Restore backup'}
      </button>
      <input
        ref={inputRef}
        data-opener="restore-backup"
        data-testid="restore-backup-file"
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => void chooseFile(event.currentTarget)}
      />

      {!pending && issue && (
        <p className="mt-3 text-[12.5px] text-primary" role="alert">
          {issue}
        </p>
      )}

      {pending && preview && currentBookCount !== null && (
        <Modal title="Review your restore" onClose={close} wide>
          <div className="space-y-4">
            <div>
              <p className="break-all text-[12px] font-semibold text-ink">{pending.fileName}</p>
              <p className="mt-1 text-[12px] text-muted">
                {exported ? `Exported ${exported}` : 'Export date not recorded'}
                {preview.version !== null ? ` · Backup version ${preview.version}` : ''}
              </p>
            </div>

            <Surface radius="card" tone="field" pad={4}>
              <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-muted">
                Library after restore
              </p>
              <p className="mt-1 text-[28px] font-semibold leading-none tabular-nums text-ink">
                {afterCount?.toLocaleString()}
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Reverie will add {countLabel(preview.counts.activeBooks, 'book')} to the{' '}
                {countLabel(currentBookCount, 'book')} already here. Existing books stay in place,
                and matching books are not merged during a restore.
              </p>
              {preview.counts.removedBooks > 0 && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  The file also carries{' '}
                  {countLabel(preview.counts.removedBooks, 'removed book record')} for backup
                  continuity. Those records remain outside your visible library.
                </p>
              )}
            </Surface>

            <div>
              <h3 className="text-[14px] font-semibold text-ink">In this backup</h3>
              <dl className="mt-2 grid grid-cols-2 gap-x-5 rounded-[var(--radius-card)] border border-line px-3 sm:grid-cols-3">
                <PreviewCount label="Books" value={preview.counts.books} />
                <PreviewCount label="Reading records" value={preview.counts.reads} />
                <PreviewCount label="Saved notes" value={preview.counts.notes} />
                <PreviewCount label="Shelves" value={preview.counts.lists} />
                <PreviewCount label="Saved shortlists" value={preview.counts.discoveries} />
                <PreviewCount label="Series memberships" value={preview.counts.seriesEntries} />
              </dl>
              {additionalCounts.length > 0 && (
                <p className="mt-2 text-[12px] leading-relaxed text-muted">
                  Also included:{' '}
                  {additionalCounts
                    .map(([count, singular, plural]) => countLabel(count, singular, plural))
                    .join(' · ')}
                </p>
              )}
            </div>

            {preview.integrity === 'verified' ? (
              <p className="text-[12.5px] leading-relaxed text-muted">
                ✓ The backup’s completeness record matches the contents of the file.
              </p>
            ) : (
              <Surface radius="card" tone="field" pad={3}>
                <p className="text-[12.5px] leading-relaxed text-ink">
                  This older backup predates completeness records. Reverie can restore it, but
                  cannot confirm whether the original download included every record.
                </p>
              </Surface>
            )}

            {preview.restoresProfile && (
              <p className="text-[12.5px] leading-relaxed text-muted">
                The saved reader name, room, appearance, reading goal, bookstore, and app
                arrangement will replace those preferences on this account.
              </p>
            )}

            {incompatible && (
              <Surface radius="card" tone="field" pad={3}>
                <p className="text-[12.5px] font-semibold leading-relaxed text-ink" role="alert">
                  This backup contains newer data Reverie cannot restore yet. Update the app before
                  trying again.
                  {preview.unknownSections.length > 0
                    ? ` Unrecognized: ${preview.unknownSections.join(', ')}.`
                    : ''}
                </p>
              </Surface>
            )}

            {issue && (
              <p className="text-[12.5px] text-primary" role="alert">
                {issue}
              </p>
            )}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={close}
                disabled={restoring}
                className="skin-control min-h-11 border border-line px-4 py-2 text-[13px] font-semibold text-ink disabled:opacity-50"
                style={{ background: 'var(--field)' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void restore()}
                disabled={restoring || incompatible}
                className="skin-control min-h-11 px-4 py-2 text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
              >
                {restoring ? 'Restoring…' : 'Restore this backup'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
