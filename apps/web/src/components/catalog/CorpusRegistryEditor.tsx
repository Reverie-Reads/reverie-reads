import { useRef, useState } from 'react'
import { normalizeIsbn, type PubDate } from '@reverie/core'
import { parseReleasePub } from '../../data/releases'
import {
  catalogError,
  useCorpusRecord,
  useSaveCorpusRecord,
  type CorpusEdition,
  type CorpusEditionDetails,
  type CorpusRecord,
  type CorpusRecordChange,
} from '../../data/corpusEditions'
import { Button } from '../Button'
import { CorpusGuidance, EditionFacts } from './CorpusRecordSummary'
import { editionPublicationLabel } from '../../data/corpusMetadataReview'

const fieldClass = 'skin-field mt-1 min-h-11 w-full min-w-0 border border-line px-3 py-2 text-base'
const list = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ),
]
function pubText(pub?: PubDate | null) {
  return pub?.y == null ? '' : editionPublicationLabel(pub)
}
type EditionDraft = {
  id: string
  isbn: string
  title: string
  statement: string
  format: string
  publisher: string
  language: string
  pages: string
  publication: string
}
const emptyEdition = (): EditionDraft => ({
  id: crypto.randomUUID(),
  isbn: '',
  title: '',
  statement: '',
  format: '',
  publisher: '',
  language: '',
  pages: '',
  publication: '',
})

export function CorpusRegistryEditor({
  workId,
  blocked,
  onDirtyChange,
  onSaved,
}: {
  workId: string
  blocked: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: (message: string) => void
}) {
  const [open, setOpen] = useState(false)
  const query = useCorpusRecord(workId, open)
  return (
    <section className="my-5 border-t border-line pt-4">
      <button
        type="button"
        aria-expanded={open}
        className="min-h-11 text-left font-semibold underline underline-offset-4"
        onClick={() => setOpen(true)}
      >
        Edit shared genres, guidance & editions
      </button>
      {open &&
        (query.isPending ? (
          <p>Loading shared editions…</p>
        ) : query.isError ? (
          <div role="alert">
            <p>
              Shared editions could not be loaded. The updated catalog migration must be available.
            </p>
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Retry catalog details
            </Button>
          </div>
        ) : (
          <RegistryWorkspace
            key={workId}
            record={query.data}
            blocked={blocked}
            onDirtyChange={onDirtyChange}
            onSaved={onSaved}
          />
        ))}
    </section>
  )
}
function RegistryWorkspace({
  record: loaded,
  blocked,
  onDirtyChange,
  onSaved,
}: {
  record: CorpusRecord
  blocked: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: (message: string) => void
}) {
  // Keep the reviewed snapshot with the draft. A background response must never rebase it.
  const [record] = useState(loaded)
  const [action, setAction] = useState<CorpusRecordChange['action'] | null>(null)
  const [edition, setEdition] = useState(emptyEdition)
  const [genres, setGenres] = useState(
    [...new Set([record.genre, ...record.genres].filter(Boolean))].join(', '),
  )
  const [subs, setSubs] = useState(
    [...new Set([record.subgenre, ...record.subgenres].filter(Boolean))].join(', '),
  )
  const [spice, setSpice] = useState(record.spice == null ? '' : String(record.spice))
  const [darkness, setDarkness] = useState(record.darkness == null ? '' : String(record.darkness))
  const [removeIsbn, setRemoveIsbn] = useState('')
  const [reportId, setReportId] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<CorpusRecordChange | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)
  const save = useSaveCorpusRecord()
  const inflight = useRef(false)
  function begin(next: CorpusRecordChange['action']) {
    if (blocked || action) return
    setAction(next)
    onDirtyChange(true)
    setError('')
    setPreview(null)
    setConfirmed(false)
  }
  function edit(e?: CorpusEdition) {
    if (blocked || action) return
    setEdition(
      e
        ? {
            id: e.id,
            isbn: e.isbn || '',
            title: e.details.title || '',
            statement: e.details.statement || '',
            format: e.details.format || '',
            publisher: e.details.publisher || '',
            language: e.details.language || '',
            pages: e.details.pages == null ? '' : String(e.details.pages),
            publication: pubText(e.details.publication),
          }
        : emptyEdition(),
    )
    begin('edition')
  }
  function prepare() {
    setError('')
    if (!/^https:\/\/[^\s/?#@]+([/?#][^\s]*)?$/.test(sourceUrl.trim()) || !note.trim()) {
      setError('Add an HTTPS evidence link and a brief explanation.')
      return
    }
    let change: CorpusRecordChange
    if (action === 'edition') {
      if (
        edition.isbn.trim() &&
        (!/^[0-9Xx -]{1,32}$/.test(edition.isbn.trim()) || !normalizeIsbn(edition.isbn))
      ) {
        setError('Enter a valid ISBN-10 or ISBN-13, or leave it blank.')
        return
      }
      const pages = edition.pages.trim() ? Number(edition.pages) : null
      const pub = edition.publication.trim() ? parseReleasePub(edition.publication.trim()) : null
      if (
        (pages != null && (!Number.isInteger(pages) || pages < 1 || pages > 20000)) ||
        (edition.publication.trim() && !pub)
      ) {
        setError('Use 1–20000 pages and a publication date as YYYY, YYYY-MM or YYYY-MM-DD.')
        return
      }
      change = {
        action,
        value: {
          id: edition.id,
          isbn: normalizeIsbn(edition.isbn) || null,
          details: {
            title: edition.title.trim() || null,
            statement: edition.statement.trim() || null,
            format: (edition.format || null) as CorpusEditionDetails['format'],
            publisher: edition.publisher.trim() || null,
            language: edition.language.trim() || null,
            pages,
            publication: pub,
          },
        },
      }
    } else if (action === 'guidance')
      change = {
        action,
        value: {
          genres: list(genres).map((g) => g.toLowerCase()),
          subgenres: list(subs),
          spice: spice === '' ? null : Number(spice),
          darkness: darkness === '' ? null : Number(darkness),
        },
      }
    else if (action === 'remove_isbn' && removeIsbn)
      change = { action, value: { isbn: removeIsbn } }
    else if (action === 'resolve_report' && reportId) change = { action, value: { reportId } }
    else return
    setPreview(change)
    setConfirmed(false)
  }
  async function apply() {
    if (!preview || !confirmed || blocked || inflight.current || attempted) return
    inflight.current = true
    setAttempted(true)
    try {
      await save.mutateAsync({ record, change: preview, sourceUrl, note })
      onDirtyChange(false)
      onSaved('Shared catalog change saved. Personal books and copies were preserved.')
    } catch (e) {
      setError(catalogError(e))
    } finally {
      inflight.current = false
    }
  }
  const text = (label: string, key: keyof Omit<EditionDraft, 'id' | 'format'>) => (
    <label className="block text-sm">
      {label}
      <input
        className={fieldClass}
        value={edition[key]}
        maxLength={key === 'isbn' ? 32 : 1000}
        onChange={(e) => setEdition({ ...edition, [key]: e.target.value })}
      />
    </label>
  )
  return (
    <div className="mt-3 min-w-0 space-y-4">
      <CorpusGuidance record={record} />
      {!action && (
        <Button variant="secondary" disabled={blocked} onClick={() => begin('guidance')}>
          Edit shared guidance
        </Button>
      )}
      <h3 className="font-semibold">Published editions</h3>
      <p className="text-sm text-muted">
        Each edition has its own ISBN and publication facts. Details awaiting review stay
        unverified. Your readers’ individual copies are private.
      </p>
      {!record.editions.length && <p className="text-sm">No editions recorded yet.</p>}
      <ul className="space-y-3">
        {record.editions.map((e) => (
          <li key={e.id} className="skin-tile border border-line p-3">
            <p className="mb-3 text-sm font-semibold">
              {e.details.title || record.title} ·{' '}
              {e.reviewed ? 'Administrator reviewed' : 'Not reviewed'}
            </p>
            <EditionFacts edition={e} />
            {!action && (
              <Button
                variant="secondary"
                className="mt-3"
                disabled={blocked}
                onClick={() => edit(e)}
              >
                Edit edition {e.isbn || 'without ISBN'}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {!action && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={blocked} onClick={() => edit()}>
            Add a published edition
          </Button>
          {record.isbns.length > 0 && (
            <Button
              variant="secondary"
              disabled={blocked}
              onClick={() => {
                setRemoveIsbn(record.isbns[0]!)
                begin('remove_isbn')
              }}
            >
              Remove an incorrect ISBN
            </Button>
          )}
        </div>
      )}
      {record.reports.length > 0 && (
        <section>
          <h3 className="font-semibold">Reader ISBN reports</h3>
          <ul className="mt-2 space-y-3">
            {record.reports.map((r) => (
              <li key={r.id} className="border border-line p-3 text-sm">
                <p>
                  Reported ISBN: {r.isbn || 'Missing'}
                  {r.proposed_isbn && ` · Suggested: ${r.proposed_isbn}`}
                </p>
                <p className="mt-2 whitespace-pre-wrap break-words">{r.note}</p>
                {!action && (
                  <Button
                    variant="secondary"
                    disabled={blocked}
                    onClick={() => {
                      setReportId(r.id)
                      begin('resolve_report')
                    }}
                  >
                    Resolve report
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {action && (
        <form
          className="space-y-4 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault()
            prepare()
          }}
        >
          <h3 className="font-semibold">
            {preview
              ? 'Review catalog change'
              : action === 'edition'
                ? 'Published edition details'
                : action === 'guidance'
                  ? 'Shared guidance'
                  : action === 'remove_isbn'
                    ? 'Remove an incorrect assignment'
                    : 'Resolve reader report'}
          </h3>
          {!preview ? (
            <>
              {action === 'edition' && (
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  {text('ISBN', 'isbn')}
                  {text('Edition title (if different)', 'title')}
                  {text('Edition statement', 'statement')}
                  <label className="block text-sm">
                    Format
                    <select
                      className={fieldClass}
                      value={edition.format}
                      onChange={(e) => setEdition({ ...edition, format: e.target.value })}
                    >
                      <option value="">Unknown</option>
                      {['hardcover', 'paperback', 'ebook', 'audiobook', 'other'].map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  {text('Publisher', 'publisher')}
                  {text('Language', 'language')}
                  {text('Pages', 'pages')}
                  {text('Published (YYYY, YYYY-MM or YYYY-MM-DD)', 'publication')}
                </div>
              )}
              {action === 'guidance' && (
                <>
                  <label className="block text-sm">
                    Genres, separated by commas
                    <input
                      className={fieldClass}
                      value={genres}
                      onChange={(e) => setGenres(e.target.value)}
                      maxLength={3600}
                    />
                  </label>
                  <label className="block text-sm">
                    Subgenres, separated by commas
                    <input
                      className={fieldClass}
                      value={subs}
                      onChange={(e) => setSubs(e.target.value)}
                      maxLength={6000}
                    />
                  </label>
                  {(
                    [
                      ['Spice / sexual content', spice, setSpice],
                      ['Darkness / emotional intensity', darkness, setDarkness],
                    ] as const
                  ).map(([label, value, set]) => (
                    <label key={label} className="block text-sm">
                      {label}
                      <select
                        className={fieldClass}
                        value={value}
                        onChange={(e) => set(e.target.value)}
                      >
                        <option value="">Not assessed</option>
                        {[0, 1, 2, 3, 4, 5].map((n) => (
                          <option key={n} value={n}>
                            {n}/5
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <p className="text-sm text-muted">
                    Use evidence for this work. No genre implies a spice level; unassessed is
                    different from zero. Readers’ own assessments are preserved.
                  </p>
                </>
              )}
              {action === 'remove_isbn' && (
                <label className="block text-sm">
                  Incorrect ISBN
                  <select
                    className={fieldClass}
                    value={removeIsbn}
                    onChange={(e) => setRemoveIsbn(e.target.value)}
                  >
                    {record.isbns.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block text-sm">
                Evidence link
                <input
                  type="url"
                  className={fieldClass}
                  value={sourceUrl}
                  maxLength={2000}
                  onChange={(e) => setSourceUrl(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                Explanation
                <textarea
                  className={fieldClass}
                  rows={3}
                  maxLength={1200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              <Button type="submit" variant="secondary" disabled={blocked}>
                Review change
              </Button>
            </>
          ) : (
            <>
              {preview.action === 'edition' && (
                <>
                  <p className="text-sm">
                    ISBN:{' '}
                    {record.editions.find((e) => e.id === preview.value.id)?.isbn || 'Not recorded'}{' '}
                    → {preview.value.isbn || 'Not recorded'}
                  </p>
                  <EditionFacts
                    edition={{
                      id: preview.value.id,
                      work_id: record.id,
                      isbn: preview.value.isbn,
                      details: preview.value.details,
                      reviewed: true,
                      revision: 1,
                      source_url: sourceUrl,
                    }}
                  />
                  <p className="text-sm text-muted">
                    Blank fields are saved as unknown. A replaced ISBN is removed from this work’s
                    automatic assignments.
                  </p>
                </>
              )}
              {preview.action === 'guidance' && (
                <CorpusGuidance
                  record={{
                    ...record,
                    ...preview.value,
                    genre: preview.value.genres[0] || null,
                    subgenre: preview.value.subgenres[0] || null,
                  }}
                />
              )}
              {preview.action === 'remove_isbn' && (
                <p className="text-sm">
                  Remove {preview.value.isbn} from {record.title}. Keep the edition record and
                  history, with its ISBN unassigned. Personal copies are unchanged.
                </p>
              )}
              {preview.action === 'resolve_report' && (
                <p className="text-sm">
                  Mark this report resolved. This does not change an ISBN or edition; apply any
                  correction first.
                </p>
              )}
              <p className="break-words text-sm">{note}</p>
              <a
                className="inline-block break-all text-sm underline"
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
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
                I checked the work, exact edition and proposed changes against the evidence.
              </label>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!confirmed || blocked || attempted} onClick={() => void apply()}>
                  Save shared change
                </Button>
                <Button variant="secondary" disabled={attempted} onClick={() => setPreview(null)}>
                  Back to draft
                </Button>
              </div>
            </>
          )}
          {error && (
            <div role="alert" className="text-sm">
              <p>{error}</p>
              {attempted && (
                <p className="mt-2">
                  Keep a copy of this draft, then reload the catalog record before another attempt.
                  The original snapshot is no longer safe to reuse.
                </p>
              )}
            </div>
          )}
          <Button
            variant="secondary"
            disabled={save.isPending}
            onClick={() => {
              setAction(null)
              setPreview(null)
              setAttempted(false)
              setError('')
              onDirtyChange(false)
            }}
          >
            Discard this draft
          </Button>
        </form>
      )}
      {record.history.length > 0 && (
        <details>
          <summary className="min-h-11 cursor-pointer text-sm">Recent catalog changes</summary>
          <ul className="space-y-2 text-sm">
            {record.history.map((h) => (
              <li key={h.id}>
                <time>{new Date(h.created_at).toLocaleString()}</time> ·{' '}
                {h.action.replace('_', ' ')}
                <p className="whitespace-pre-wrap break-words">{h.note}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
