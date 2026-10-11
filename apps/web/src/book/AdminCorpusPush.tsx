import { useRef, useState } from 'react'
import { EDITION_FORMAT_LABELS, type Book } from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import {
  catalogError,
  useCorpusRecord,
  useCorpusUpdateTime,
  useSaveCorpusRecord,
  type CorpusRecord,
  type CorpusRecordChange,
} from '../data/corpusEditions'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { bookCorpusProposal, corpusProposalRows } from './corpusPush'

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
  const [kind, setKind] = useState<'edition' | 'guidance'>('edition')
  const [editionId, setEditionId] = useState(
    book.copyInventory?.editions.length === 1 ? book.copyInventory.editions[0]!.id : '',
  )
  const [newEditionId] = useState(() => crypto.randomUUID())
  const [source, setSource] = useState('')
  const [note, setNote] = useState('')
  const [proposal, setProposal] = useState<CorpusRecordChange | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [error, setError] = useState('')
  const [reloading, setReloading] = useState(false)
  const save = useSaveCorpusRecord()
  const inflight = useRef(false)
  const busy = save.isPending || reloading
  function prepare() {
    setError('')
    if (!/^https:\/\/[^\s/?#@]+([/?#][^\s]*)?$/.test(source.trim()) || !note.trim()) {
      setError('Add an HTTPS evidence link and a brief explanation.')
      return
    }
    try {
      setProposal(bookCorpusProposal(book, record, kind, editionId, newEditionId))
      setConfirmed(false)
    } catch (e) {
      setError(catalogError(e))
    }
  }
  async function publish() {
    if (!proposal || !confirmed || attempted || inflight.current) return
    inflight.current = true
    setAttempted(true)
    try {
      await save.mutateAsync({ record, change: proposal, sourceUrl: source, note })
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
      setRecord(await onReload())
      setProposal(null)
      setConfirmed(false)
      setAttempted(false)
      setError('')
    } catch (e) {
      setError(catalogError(e))
    } finally {
      setReloading(false)
    }
  }
  const field = 'skin-field mt-1 min-h-11 w-full min-w-0 px-3 py-2 text-base'
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
          if (!proposal) prepare()
        }}
      >
        <p className="text-sm">
          Review saved details from <strong>{book.title}</strong> for the shared record{' '}
          <strong>{record.title}</strong> by {record.author}. Save any personal edits before opening
          this review.
        </p>
        {!proposal ? (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-semibold">What would you like to share?</legend>
              {(
                [
                  ['edition', 'Published edition details'],
                  ['guidance', 'Genres & content guidance'],
                ] as const
              ).map(([value, label]) => (
                <label key={value} className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="radio"
                    name="corpus-push-kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            {kind === 'edition' && book.copyInventory && (
              <label className="block text-sm">
                Your saved edition
                <select
                  className={field}
                  value={editionId}
                  onChange={(e) => setEditionId(e.target.value)}
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
            <p className="text-sm text-muted">
              Only the selected details are shared. Unknown fields preserve existing corpus values.
              Notes, ratings, possession, copy labels and locations stay private.
            </p>
            {kind === 'guidance' && (
              <p className="text-sm text-muted">
                Your saved content assessments become shared defaults only after this review. Other
                readers keep their personal overrides.
              </p>
            )}
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
            <Button type="submit" disabled={busy}>
              Review corpus update
            </Button>
          </>
        ) : (
          <>
            <h3 className="text-sm font-semibold">Review corpus update</h3>
            {proposal.action === 'edition' && (
              <p className="text-sm">
                {record.editions.some((e) => e.id === proposal.value.id)
                  ? proposal.value.isbn
                    ? 'Update the edition with this exact ISBN.'
                    : 'Update the edition retained from your earlier attempt.'
                  : 'Create a published edition. Check that it is not already listed in the shared catalog.'}
              </p>
            )}
            <dl className="space-y-3">
              {corpusProposalRows(record, proposal).map(([label, before, after]) => (
                <div key={label} className="border-b border-line pb-2 text-sm">
                  <dt className="font-semibold">{label}</dt>
                  <dd className="mt-1 text-muted">Current: {before}</dd>
                  <dd>
                    Proposed: {after}
                    {before === after ? ' · unchanged' : ''}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="whitespace-pre-wrap text-sm">{note}</p>
            <a
              href={source.trim()}
              target="_blank"
              rel="noopener noreferrer"
              className="block break-all text-sm underline"
            >
              Evidence source
            </a>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={confirmed}
                disabled={attempted}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I verified these details and want to update the shared corpus.
            </label>
            <div className="flex flex-wrap gap-2">
              <Button disabled={!confirmed || attempted || busy} onClick={() => void publish()}>
                {save.isPending ? 'Pushing…' : 'Confirm push to corpus'}
              </Button>
              <Button
                variant="secondary"
                disabled={attempted || busy}
                onClick={() => setProposal(null)}
              >
                Back to draft
              </Button>
            </div>
          </>
        )}
        {error && (
          <div role="alert" className="space-y-2 text-sm">
            <p>{error}</p>
            {attempted && (
              <>
                <p>
                  Your draft is retained. Reload the corpus and review it again before another
                  attempt.
                </p>
                <Button variant="secondary" disabled={busy} onClick={() => void reload()}>
                  Reload corpus for review
                </Button>
              </>
            )}
          </div>
        )}
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Close
        </Button>
      </form>
    </Modal>
  )
}
