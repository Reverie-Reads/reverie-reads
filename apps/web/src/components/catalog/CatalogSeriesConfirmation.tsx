import { useRef, useState } from 'react'
import {
  useSaveCatalogSeriesConfirmation,
  type CatalogMetadataWork,
  type SeriesConfirmationInput,
} from '../../data/corpusMetadataReview'
import { Button } from '../Button'

const HTTPS_URL = /^https:\/\/[^\s/?#@]+([/?#][^\s]*)?$/

function tupleLabel(work: CatalogMetadataWork) {
  return [
    work.series,
    work.position == null ? null : `book ${work.position}`,
    work.seriesCount == null ? null : `${work.seriesCount} declared books`,
  ]
    .filter(Boolean)
    .join(' · ')
}

export function CatalogSeriesConfirmation({
  work,
  blocked,
  onDirtyChange,
  onSaved,
  onRefresh,
}: {
  work: CatalogMetadataWork
  blocked: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: (message: string) => void
  onRefresh: () => void
}) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<SeriesConfirmationInput | null>(null)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)
  const inflight = useRef(false)
  const save = useSaveCatalogSeriesConfirmation()

  if (work.seriesConfirmationVersion !== 1 || !work.seriesFingerprint)
    return (
      <p className="my-4 text-sm text-muted">
        Shared series confirmation needs the updated server. Reload after deployment.
      </p>
    )
  if (!work.series?.trim())
    return (
      <p className="my-4 text-sm text-muted">
        This record has no shared series tuple to confirm. Use the existing correction or suggestion
        review workflow first.
      </p>
    )

  function changed() {
    setPreview(null)
    setApproved(false)
    setError('')
    onDirtyChange(true)
  }
  function prepare() {
    if (blocked || save.isPending || attempted) return
    setError('')
    if (!note.trim() || !HTTPS_URL.test(sourceUrl.trim())) {
      setError('Enter an independently checked HTTPS source link and a short explanation.')
      return
    }
    setPreview({ work, sourceUrl, note, identityConfirmed: true })
    setApproved(false)
  }
  async function apply() {
    if (!preview || !approved || inflight.current || attempted || blocked) return
    inflight.current = true
    setAttempted(true)
    try {
      await save.mutateAsync(preview)
      onSaved(
        `Shared series confirmed for ${work.title}. Eligible catalog-default personal copies were reconciled.`,
      )
    } catch (e) {
      setError(
        (e as { message?: string })?.message ?? 'The confirmation result could not be verified.',
      )
    } finally {
      inflight.current = false
    }
  }
  function discard() {
    setSourceUrl('')
    setNote('')
    setPreview(null)
    setApproved(false)
    setError('')
    onDirtyChange(false)
  }
  const disabled = blocked || save.isPending || attempted

  return (
    <section aria-label="Shared series confirmation" className="my-5 border-t border-line pt-4">
      <h3 className="font-semibold">Confirm shared series with source</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Confirm only the exact tuple already shown below after checking the book on an independent
        source. This action does not search providers, import a proposal, or change the tuple.
      </p>
      <p className="mt-2 text-sm">Current shared tuple: {tupleLabel(work)}</p>
      <p className="mt-1 text-xs text-muted">
        Current check state: {work.seriesCheckState ?? 'Unknown'}
        {work.seriesCheckedAt
          ? ` · Last checked ${new Date(work.seriesCheckedAt).toLocaleString()}`
          : ''}
      </p>
      {work.seriesSourceUrl && (
        <p className="mt-1 break-all text-xs text-muted">
          Existing recorded source:{' '}
          <a
            href={work.seriesSourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            {work.seriesSourceUrl}
          </a>
        </p>
      )}
      <p className="mt-2 text-sm leading-relaxed text-muted">
        A successful confirmation refreshes the shared relationship and only eligible personal
        catalog defaults. Reader-selected and CSV-imported series choices remain unchanged.
      </p>
      {blocked && (
        <p className="mt-2 text-sm">
          Apply or discard the other metadata draft before confirming shared series.
        </p>
      )}
      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          prepare()
        }}
      >
        <fieldset disabled={disabled} className="space-y-4">
          <legend className="sr-only">Shared series evidence</legend>
          <label className="block text-sm">
            Series evidence link
            <input
              type="url"
              value={sourceUrl}
              onChange={(event) => {
                changed()
                setSourceUrl(event.target.value)
              }}
              maxLength={2000}
              placeholder="https://…"
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            />
          </label>
          <label className="block text-sm">
            Series confirmation explanation
            <textarea
              value={note}
              onChange={(event) => {
                changed()
                setNote(event.target.value)
              }}
              rows={3}
              maxLength={1200}
              className="skin-field mt-2 w-full px-3 py-3 text-base"
              placeholder="What on this source confirms this title, series name, and order?"
            />
          </label>
          <Button type="submit" variant="secondary">
            Preview series confirmation
          </Button>
          <Button variant="ghost" disabled={attempted} onClick={discard}>
            Discard series draft
          </Button>
        </fieldset>
        {preview && (
          <div
            className="skin-tile space-y-3 border border-line p-3 text-sm"
            aria-label="Series confirmation preview"
          >
            <p>Confirm unchanged shared tuple: {tupleLabel(work)}</p>
            <p className="break-all">Recorded source: {preview.sourceUrl.trim()}</p>
            <p>
              No provider lookup runs. No title, contributors, ISBN, cover, edition detail,
              possession, reading history, or reader-selected series choice changes.
            </p>
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                checked={approved}
                disabled={disabled}
                onChange={(event) => setApproved(event.target.checked)}
                className="mt-1"
              />
              I checked this book’s exact identity and series relationship and approve recording
              this unchanged shared tuple.
            </label>
            <Button disabled={disabled || !approved} onClick={() => void apply()}>
              Confirm shared series
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="space-y-2 border border-line p-3 text-sm">
            <p>{error}</p>
            {attempted && (
              <>
                <p>
                  Do not repeat an uncertain save. Reload the current record and inspect its history
                  before another decision. Reloading discards this draft.
                </p>
                <Button variant="secondary" onClick={onRefresh}>
                  Reload current record
                </Button>
              </>
            )}
          </div>
        )}
      </form>
    </section>
  )
}
