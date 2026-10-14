import { useRef, useState } from 'react'
import { EDITION_FORMAT_LABELS, type Book } from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import {
  catalogError,
  useCorpusRecord,
  useCorpusUpdateTime,
  usePushCorpusRecord,
  type CorpusRecord,
} from '../data/corpusEditions'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import {
  bookCorpusOptions,
  selectedCorpusChanges,
  CORPUS_PUSH_FIELDS,
  type CorpusPushField,
} from './corpusPush'

export function AdminCorpusPush({ book }: { book: Book }) {
  const { session } = useAuth()
  const admin = useCorpusAdminStatus()
  if (!admin.data || !session || !book.corpusWorkId) return null
  return (
    <CorpusPushControl key={`${session.user.id}/${book.id}/${book.corpusWorkId}`} book={book} />
  )
}

function CorpusPushControl({ book }: { book: Book }) {
  const workId = book.corpusWorkId || ''
  const updated = useCorpusUpdateTime(workId, true)
  const [request, setRequest] = useState<Book | null>(null)
  const record = useCorpusRecord(workId, !!request)
  const [notice, setNotice] = useState('')
  const timestamp = updated.data && Number.isFinite(Date.parse(updated.data)) ? updated.data : null
  return (
    <div className="mt-3 min-w-0 space-y-2">
      <Button
        variant="secondary"
        onClick={() => {
          setNotice('')
          setRequest(book)
        }}
      >
        Push to corpus
      </Button>
      <p className="text-xs text-muted" aria-live="polite">
        {updated.isPending ? (
          'Checking last corpus update…'
        ) : timestamp ? (
          <>
            Corpus last updated:{' '}
            <time dateTime={timestamp}>{new Date(timestamp).toLocaleString()}</time>
          </>
        ) : (
          'Last corpus update is unavailable.'
        )}
      </p>
      {updated.isError && (
        <Button variant="ghost" onClick={() => void updated.refetch()}>
          Retry update status
        </Button>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {request &&
        (record.data ? (
          <PushReview
            book={request}
            initialRecord={record.data}
            onReload={async () => {
              const result = await record.refetch()
              if (!result.data || result.isError)
                throw result.error || new Error('Corpus details could not be reloaded.')
              return result.data
            }}
            onClose={() => setRequest(null)}
            onSaved={() => {
              setRequest(null)
              setNotice('Corpus update saved. Your personal book and copies are unchanged.')
            }}
          />
        ) : (
          <Modal title="Push to corpus" onClose={() => setRequest(null)}>
            {record.isError ? (
              <div role="alert">
                <p>Corpus details could not be loaded. Nothing has been pushed.</p>
                <Button variant="secondary" onClick={() => void record.refetch()}>
                  Retry corpus details
                </Button>
              </div>
            ) : (
              <p>Loading the current corpus record…</p>
            )}
          </Modal>
        ))}
    </div>
  )
}

function PushReview({
  book,
  initialRecord,
  onReload,
  onClose,
  onSaved,
}: {
  book: Book
  initialRecord: CorpusRecord
  onReload: () => Promise<CorpusRecord>
  onClose: () => void
  onSaved: () => void
}) {
  // This is a deliberate snapshot. Background refreshes cannot change what is being reviewed.
  const [record, setRecord] = useState(initialRecord)
  const [selected, setSelected] = useState<Set<CorpusPushField>>(() => new Set(CORPUS_PUSH_FIELDS))
  const [reviewMode, setReviewMode] = useState<'direct' | 'evidence'>('direct')
  const [editionId, setEditionId] = useState(
    book.copyInventory?.editions.length === 1 ? book.copyInventory.editions[0]!.id : '',
  )
  // A lost response may already have saved this UUID. Keep one retry identity per saved
  // inventory edition so switching editions cannot correct/reassign the first one's ISBN.
  const [newEditionIds] = useState(
    () =>
      new Map(
        (book.copyInventory ? book.copyInventory.editions.map((e) => e.id) : ['']).map((id) => [
          id,
          crypto.randomUUID(),
        ]),
      ),
  )
  const newEditionId = newEditionIds.get(editionId) || ''
  const [targetEditionId, setTargetEditionId] = useState('')
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [reloading, setReloading] = useState(false)
  const save = usePushCorpusRecord()
  const inflight = useRef(false)
  const busy = save.isPending || reloading
  const options = bookCorpusOptions(book, record, editionId, newEditionId, targetEditionId)
  const changes = selectedCorpusChanges(record, options, selected)
  const selectedCount = options.rows.filter((row) => selected.has(row.key)).length
  async function publish() {
    if (!changes.length || attempted || busy || inflight.current) return
    setError('')
    if (
      reviewMode === 'evidence' &&
      (!/^https:\/\/[^\s/?#@]+([/?#][^\s]*)?$/.test(source.trim()) || !note.trim())
    ) {
      setError('Add an HTTPS evidence link and a brief explanation, or use a direct admin update.')
      return
    }
    inflight.current = true
    setAttempted(true)
    try {
      await save.mutateAsync({
        record,
        changes,
        reviewMode,
        sourceUrl: reviewMode === 'evidence' ? source : '',
        note: reviewMode === 'evidence' ? note : '',
      })
      onSaved()
    } catch (e) {
      setError(catalogError(e))
    } finally {
      inflight.current = false
    }
  }
  async function reload() {
    if (busy || inflight.current) return
    setReloading(true)
    try {
      const next = await onReload()
      setRecord(next)
      setTargetEditionId(
        next.editions.some((e) => e.id === newEditionId && !e.isbn)
          ? newEditionId
          : targetEditionId === 'new' ||
              next.editions.some((e) => e.id === targetEditionId && !e.isbn)
            ? targetEditionId
            : '',
      )
      setAttempted(false)
      setError('')
    } catch (e) {
      setError(catalogError(e))
    } finally {
      setReloading(false)
    }
  }
  const field = 'skin-field mt-1 min-h-11 w-full min-w-0 px-3 py-2 text-base'
  const sourceEdition = book.copyInventory?.editions.find((e) => e.id === editionId)
  const isbnless = book.copyInventory
    ? sourceEdition && !sourceEdition.isbn.trim()
    : !book.isbn.trim()
  const isbnlessEditions = record.editions.filter((e) => !e.isbn)
  return (
    <Modal
      title="Push to corpus"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        className="min-w-0 space-y-4 break-words"
        onSubmit={(e) => {
          e.preventDefault()
          void publish()
        }}
      >
        <p className="text-sm">
          Choose which saved details from <strong>{book.title}</strong> should update the shared
          record <strong>{record.title}</strong> by {record.author}. Save personal edits before
          opening this panel.
        </p>
        <p className="text-sm text-muted">
          Changed fields are selected below. Everything saves together. Private notes, ratings,
          copies and reading history stay private.
        </p>
        <fieldset disabled={busy || attempted} className="min-w-0 space-y-4">
          {book.copyInventory && (
            <label className="block text-sm">
              Your saved edition
              <select
                className={field}
                value={editionId}
                onChange={(e) => {
                  setEditionId(e.target.value)
                  setTargetEditionId('')
                }}
              >
                <option value="">Choose an edition</option>
                {book.copyInventory.editions.map((e, i) => (
                  <option key={e.id} value={e.id}>
                    {i + 1}. {EDITION_FORMAT_LABELS[e.format]} · {e.isbn || 'No ISBN'}
                    {e.publisher ? ` · ${e.publisher}` : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isbnless && isbnlessEditions.length > 0 && (
            <label className="block text-sm">
              Published edition to update
              <select
                className={field}
                value={targetEditionId}
                onChange={(e) => setTargetEditionId(e.target.value)}
              >
                <option value="">Choose an existing edition or create one</option>
                {isbnlessEditions.map((e, i) => (
                  <option key={e.id} value={e.id}>
                    {i + 1}.{' '}
                    {[
                      e.details.title,
                      e.details.publisher,
                      e.details.statement,
                      e.details.format,
                      e.details.publication?.y,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'ISBN-less edition'}
                  </option>
                ))}
                <option value="new">Create a different published edition</option>
              </select>
              <span className="mt-1 block text-muted">
                With no ISBN, choose the exact edition to avoid creating a duplicate.
              </span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => setSelected(new Set(options.rows.map((row) => row.key)))}
            >
              Select all changes
            </Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          </div>
          {(['series', 'edition', 'guidance'] as const).map((group) => (
            <fieldset key={group} className="min-w-0 space-y-2">
              <legend className="text-sm font-semibold">
                {group === 'series'
                  ? 'Series membership'
                  : group === 'edition'
                    ? 'Published edition details'
                    : 'Genres & content guidance'}
              </legend>
              {group === 'edition' &&
                (options.edition ? (
                  <p className="text-sm text-muted">
                    {record.editions.some((e) => e.id === options.edition!.value.id)
                      ? 'Update this edition'
                      : 'Create a published edition'}
                    {' · '}
                    {options.edition.value.isbn ? `ISBN ${options.edition.value.isbn}` : 'No ISBN'}.
                    The ISBN identifies the edition for all selected details.
                  </p>
                ) : (
                  <p className="text-sm text-muted">{options.editionError}</p>
                ))}
              {options.rows
                .filter((row) => row.key.startsWith(group + '.'))
                .map((row) => (
                  <label
                    key={row.key}
                    className="flex min-h-11 min-w-0 items-start gap-3 rounded-[var(--radius-card)] border border-line p-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      aria-label={row.label}
                      checked={selected.has(row.key)}
                      onChange={(event) =>
                        setSelected((previous) => {
                          const next = new Set(previous)
                          if (event.target.checked) next.add(row.key)
                          else next.delete(row.key)
                          return next
                        })
                      }
                    />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="block font-semibold">{row.label}</span>
                      <span className="block text-muted">Shared: {row.before}</span>
                      <span className="block">Your saved value: {row.after}</span>
                    </span>
                  </label>
                ))}
              {!options.rows.some((row) => row.key.startsWith(group + '.')) &&
                (group !== 'edition' || !options.editionError) && (
                  <p className="text-sm text-muted">No different saved values to share.</p>
                )}
            </fieldset>
          ))}
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={reviewMode === 'evidence'}
              onChange={(e) => setReviewMode(e.target.checked ? 'evidence' : 'direct')}
            />
            Add supporting evidence (optional)
          </label>
          {reviewMode === 'evidence' ? (
            <>
              <label className="block text-sm">
                Evidence link
                <input
                  type="url"
                  className={field}
                  value={source}
                  maxLength={2000}
                  onChange={(e) => setSource(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Explanation
                <textarea
                  className={field}
                  rows={3}
                  value={note}
                  maxLength={1200}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </>
          ) : (
            <p className="text-sm text-muted">
              Direct admin update: no evidence link or verification checklist required. Your
              selected changes are recorded in catalog history.
            </p>
          )}
        </fieldset>
        <p className="text-sm" aria-live="polite">
          {selectedCount
            ? `${selectedCount} ${selectedCount === 1 ? 'field' : 'fields'} selected`
            : 'No changes selected.'}
        </p>
        {error && (
          <div role="alert" className="space-y-2 text-sm">
            <p>{error}</p>
            {attempted && (
              <>
                <p>
                  Your selection is retained. Reload the shared record before another attempt; saved
                  changes will no longer appear as differences.
                </p>
                <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
                  Reload corpus for review
                </Button>
              </>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={!changes.length || attempted || busy}>
            {save.isPending ? 'Saving…' : 'Save selected changes'}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
        </div>
      </form>
    </Modal>
  )
}
