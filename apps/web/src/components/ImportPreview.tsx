import { useMemo, useState } from 'react'
import {
  countTruncatedIsbns,
  matchBook,
  parseCSV,
  parseCsvRows,
  parseImport,
  type Book,
} from '@reverie/core'
import { Modal } from './Modal'
import { BookAddReview } from '../book/BookAddReview'

/** Uses the same profile-dependent parsers as importDetectedExport; selecting a file writes nothing. */
export function ImportPreview({
  text,
  books,
  destination,
  autoMerge,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  text: string
  books: Book[]
  destination: string
  autoMerge: boolean
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const [page, setPage] = useState(0)
  const [attentionOnly, setAttentionOnly] = useState(false)
  const preview = useMemo(() => {
    const parsed = parseImport(text)
    const rows = parsed.profile.name === 'generic' ? parseCsvRows(text) : parsed.rows
    const grid = parseCSV(text)
    const entries = rows.map((row, index) => ({
      ...row,
      index,
      duplicate: matchBook(row.incoming, books).strength !== 'none',
      missing: !row.incoming.isbn || ![row.incoming.first, row.incoming.last].some(Boolean),
    }))
    return {
      entries,
      ignored: Math.max(
        0,
        grid.slice(1).filter((row) => row.some((cell) => cell.trim())).length - rows.length,
      ),
      truncated: countTruncatedIsbns(grid),
    }
  }, [text, books])
  const attention = preview.entries.filter((row) => row.duplicate || row.missing)
  const shown = attentionOnly ? attention : preview.entries
  const bookCount = `${preview.entries.length} ${preview.entries.length === 1 ? 'book' : 'books'}`
  return (
    <Modal
      title="Review your import"
      wide
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <p className="text-sm text-ink">
        {bookCount} · {destination}
      </p>
      <p className="mt-2 text-sm text-muted">
        {error
          ? 'The import stopped before every result was confirmed. Some books may already be saved. Check the result below.'
          : busy
            ? 'Importing the reviewed file. Keep this page open until its result is confirmed.'
            : 'Nothing has been imported. Review the summary or expand any book. You can cancel and correct your spreadsheet before continuing.'}
      </p>
      <p className="mt-3 text-sm text-ink">
        {attention.length} need a closer look ·{' '}
        {preview.entries.filter((row) => row.duplicate).length} possible matches in your library.
      </p>
      <p className="mt-2 text-sm text-muted">
        {autoMerge
          ? 'Exact duplicates will merge into your existing books. Similar matches wait for a separate decision.'
          : 'Existing matches wait for your decision; new books are added.'}{' '}
        Repeated rows in this file are checked during import too. A missing ISBN or author does not
        stop an import.
      </p>
      {preview.ignored > 0 && (
        <p role="status" className="mt-2 text-sm text-ink">
          {preview.ignored} rows cannot be imported because they have no recognized title.
        </p>
      )}
      {preview.truncated > 0 && (
        <p role="status" className="mt-2 text-sm text-ink">
          {preview.truncated} ISBNs may have lost a leading digit. Check the source file before
          confirming.
        </p>
      )}
      <label className="my-3 flex min-h-11 items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={attentionOnly}
          onChange={(e) => {
            setAttentionOnly(e.target.checked)
            setPage(0)
          }}
        />
        Show missing information and possible duplicates
      </label>
      <ol className="space-y-3">
        {shown.slice(page * 10, page * 10 + 10).map((row) => (
          <li key={row.index}>
            <details className="border-t border-line py-2 text-sm text-ink">
              <summary className="min-h-11 cursor-pointer py-2 [overflow-wrap:anywhere]">
                {row.incoming.title}{' '}
                {row.duplicate
                  ? '· Possible duplicate'
                  : row.missing
                    ? '· Some information missing'
                    : ''}
              </summary>
              <BookAddReview book={row.incoming} destination={destination} />
              {!!row.incoming.tags?.length && (
                <p className="mt-2">Tags: {row.incoming.tags.join(', ')}</p>
              )}
              {'shelves' in row && row.shelves.length > 0 && (
                <p className="mt-2">Shelves: {row.shelves.join(', ')}</p>
              )}
              {'unplacedNotes' in row && row.unplacedNotes && (
                <p className="mt-2">
                  A note has no reading record to attach to and will not be imported.
                </p>
              )}
              {row.incoming.reads?.map((read, index) => (
                <p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere]" key={index}>
                  Read {index + 1}: {read.date || 'Undated'} · {read.format || 'Format unknown'}
                  {read.rating ? ` · ${read.rating}/5` : ''}
                  {read.notes ? `\n${read.notes}` : ''}
                </p>
              ))}
            </details>
          </li>
        ))}
      </ol>
      {shown.length > 10 && (
        <nav
          aria-label="Import review pages"
          className="flex items-center justify-between text-sm text-ink"
        >
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
            className="min-h-11 px-2"
          >
            Previous
          </button>
          <span>
            {page + 1} / {Math.ceil(shown.length / 10)}
          </span>
          <button
            type="button"
            disabled={(page + 1) * 10 >= shown.length}
            onClick={() => setPage(page + 1)}
            className="min-h-11 px-2"
          >
            Next
          </button>
        </nav>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-ink">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !!error || !preview.entries.length}
        onClick={onConfirm}
        className="mt-4 min-h-11 w-full skin-control skin-btn-primary px-4 text-sm font-semibold"
      >
        {busy ? 'Importing…' : `Confirm import of ${bookCount}`}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onClose}
        className="mt-2 min-h-11 w-full skin-control skin-btn-secondary px-4 text-sm"
      >
        {error ? 'Close and review your library' : 'Cancel import'}
      </button>
    </Modal>
  )
}
