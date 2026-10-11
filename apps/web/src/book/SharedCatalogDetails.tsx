import { useRef, useState } from 'react'
import { normalizeIsbn, type Book } from '@reverie/core'
import { Link } from '@tanstack/react-router'
import {
  catalogError,
  useCorpusRecord,
  useReportCorpusIsbn,
  useSelectCorpusEdition,
  type CorpusEdition,
} from '../data/corpusEditions'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import { CorpusGuidance, EditionFacts } from '../components/catalog/CorpusRecordSummary'
import { Modal } from '../components/Modal'
import { Button } from '../components/Button'
import { AdminCorpusPush } from './AdminCorpusPush'

export function SharedCatalogDetails({ book }: { book: Book }) {
  const [open, setOpen] = useState(false)
  if (!book.corpusWorkId) return null
  return (
    <section className="mt-5 min-w-0 break-words border-t border-line pt-3">
      <AdminCorpusPush book={book} />
      <button
        className="min-h-11 text-left text-sm font-semibold underline underline-offset-4"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Shared catalog & published editions
      </button>
      {open && <CatalogDetailsBody key={book.id} book={book} workId={book.corpusWorkId} />}
    </section>
  )
}
function CatalogDetailsBody({ book, workId }: { book: Book; workId: string }) {
  const record = useCorpusRecord(workId)
  const admin = useCorpusAdminStatus()
  const [reporting, setReporting] = useState(false)
  const [selected, setSelected] = useState<CorpusEdition | null>(null)
  const [notice, setNotice] = useState('')
  if (record.isPending) return <p className="py-3 text-sm">Loading catalog details…</p>
  if (record.isError)
    return (
      <div role="alert" className="py-3 text-sm">
        <p>Shared catalog details could not be loaded. Your personal book is still available.</p>
        <Button variant="secondary" onClick={() => void record.refetch()}>
          Retry shared details
        </Button>
      </div>
    )
  return (
    <div className="mt-3 space-y-4">
      <p className="text-sm text-muted">
        Shared details describe the work and its published editions. Your copies, notes and personal
        assessments stay in your library.
      </p>
      <CorpusGuidance record={record.data} />
      <h3 className="text-sm font-semibold">Published editions</h3>
      {record.data.editions.length === 0 ? (
        <p className="text-sm text-muted">No published editions have been recorded yet.</p>
      ) : (
        <ul className="space-y-3">
          {record.data.editions.map((edition) => (
            <li key={edition.id} className="skin-tile border border-line p-3">
              <p className="mb-3 text-sm font-semibold">
                {edition.details.title || record.data.title} ·{' '}
                {edition.reviewed ? 'Administrator reviewed' : 'Details not reviewed'}
              </p>
              <EditionFacts edition={edition} />
              {edition.source_url &&
                /^https:\/\/[^\s/?#@]+([/?#][^\s]*)?$/.test(edition.source_url) && (
                  <a
                    href={edition.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 block text-sm underline"
                  >
                    Edition source
                  </a>
                )}
              {edition.reviewed && !book.copyInventory && (
                <Button variant="secondary" className="mt-3" onClick={() => setSelected(edition)}>
                  Review this edition
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {book.copyInventory && (
        <p className="text-sm text-muted">
          Use Your editions & copies above to edit each individual copy. A shared edition never
          replaces that inventory.
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {record.data.reports.length > 0 && (
        <p className="text-sm">An ISBN concern is awaiting catalog review.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => setReporting(true)}>
          Report an ISBN problem
        </Button>
        {admin.data && (
          <Link
            to="/catalog/metadata"
            search={{ state: 'all', issue: 'all', q: '', page: 0, work: workId }}
            className="min-h-11 content-center text-sm underline"
          >
            Review shared catalog record
          </Link>
        )}
      </div>
      {reporting && (
        <IsbnReport
          book={book}
          workId={workId}
          onClose={() => setReporting(false)}
          onSaved={() => {
            setReporting(false)
            setNotice('ISBN concern saved for catalog review. Your personal ISBN was not changed.')
          }}
        />
      )}
      {selected && (
        <SelectEdition
          key={selected.id}
          book={book}
          edition={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null)
            setNotice(
              'Edition saved to your book. Reading history and other personal details were preserved.',
            )
          }}
        />
      )}
    </div>
  )
}
function SelectEdition({
  book,
  edition,
  onClose,
  onSaved,
}: {
  book: Book
  edition: CorpusEdition
  onClose: () => void
  onSaved: () => void
}) {
  const [original] = useState(book)
  const [error, setError] = useState('')
  const save = useSelectCorpusEdition()
  const inflight = useRef(false)
  async function apply() {
    if (inflight.current) return
    inflight.current = true
    try {
      await save.mutateAsync({ book: original, edition })
      onSaved()
    } catch (e) {
      setError(catalogError(e))
    } finally {
      inflight.current = false
    }
  }
  return (
    <Modal
      title="Review your edition"
      onClose={() => {
        if (!save.isPending) onClose()
      }}
    >
      <p className="mb-4 text-sm">
        Replace the selected ISBN, page count and publication date on {original.title} with this
        edition. Unknown values clear those fields; your other details stay unchanged.
      </p>
      <p className="mb-4 text-sm">
        ISBN: {original.isbn || 'Not recorded'} → {edition.isbn || 'Not recorded'}
      </p>
      <EditionFacts edition={edition} />
      {error && (
        <p role="alert" className="mt-3 text-sm">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button disabled={save.isPending || !!error} onClick={() => void apply()}>
          Use this edition
        </Button>
        <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
          Keep current details
        </Button>
      </div>
    </Modal>
  )
}
function IsbnReport({
  book,
  workId,
  onClose,
  onSaved,
}: {
  book: Book
  workId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [isbn, setIsbn] = useState(book.isbn || '')
  const [proposed, setProposed] = useState('')
  const [note, setNote] = useState('')
  const [review, setReview] = useState(false)
  const [error, setError] = useState('')
  const save = useReportCorpusIsbn()
  const inflight = useRef(false)
  async function submit() {
    if (inflight.current) return
    inflight.current = true
    try {
      await save.mutateAsync({ workId, isbn, proposedIsbn: proposed, note })
      onSaved()
    } catch (e) {
      setError(catalogError(e))
    } finally {
      inflight.current = false
    }
  }
  return (
    <Modal
      title="Report an ISBN problem"
      onClose={() => {
        if (!save.isPending) onClose()
      }}
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (
            proposed.trim() &&
            (!/^[0-9Xx -]{1,32}$/.test(proposed.trim()) || !normalizeIsbn(proposed))
          )
            setError('Check the replacement ISBN, or leave it blank.')
          else if (!note.trim()) setError('Describe what needs checking.')
          else {
            setError('')
            setReview(true)
          }
        }}
      >
        <p className="text-sm">
          This sends the ISBN and your explanation to catalog administrators. Include edition
          evidence, not private notes. To change only your own book, use Edit edition details.
        </p>
        {review ? (
          <div className="space-y-2 text-sm">
            <p>Reported ISBN: {isbn || 'Missing'}</p>
            <p>Suggested replacement: {proposed || 'Not supplied'}</p>
            <p className="whitespace-pre-wrap break-words">{note}</p>
            <Button disabled={save.isPending} onClick={() => void submit()}>
              Send ISBN report
            </Button>
            <Button variant="secondary" disabled={save.isPending} onClick={() => setReview(false)}>
              Back to draft
            </Button>
          </div>
        ) : (
          <>
            <label className="block text-sm">
              ISBN to check
              <input
                className="skin-field mt-1 min-h-11 w-full px-3"
                value={isbn}
                maxLength={32}
                onChange={(e) => setIsbn(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Correct ISBN, if known
              <input
                className="skin-field mt-1 min-h-11 w-full px-3"
                value={proposed}
                maxLength={32}
                onChange={(e) => setProposed(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              What needs checking?
              <textarea
                className="skin-field mt-1 w-full px-3 py-3 text-base"
                rows={4}
                value={note}
                maxLength={1200}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <Button type="submit">Review report</Button>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
