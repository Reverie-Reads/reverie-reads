import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { Link } from '@tanstack/react-router'
import { bookBarcode } from '@reverie/core'
import { searchAddCatalog } from '../data/useAddSearch'
import { type SearchResult, selectedSearchIsbn } from '../lib/search'
import { Surface } from '../components/Surface'
import { DraftExitGuard } from '../components/DraftExitGuard'
import { GoogleBooksAttribution, GoogleBooksResultLink } from '../components/GoogleBooksAttribution'

export interface BulkAddRow {
  id: string
  query: string
  state: 'waiting' | 'searching' | 'matches' | 'empty' | 'failed'
  results: SearchResult[]
  bookId?: string
}

/** Lookup only. Every candidate uses the same Quick Add review, duplicate and retry path. */
export function BulkAddQueue({
  rows,
  onChange,
  onReview,
  hidden,
  guardExit,
}: {
  rows: BulkAddRow[]
  onChange: Dispatch<SetStateAction<BulkAddRow[]>>
  onReview: (row: BulkAddRow, result?: SearchResult) => void
  hidden: boolean
  guardExit: boolean
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  useEffect(
    () => () => {
      generation.current++
      request.current?.abort()
    },
    [],
  )
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const pending = rows.filter((row) => !row.bookId).length
  async function lookup(batch: BulkAddRow[]) {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    const run = ++generation.current
    setBusy(true)
    for (const item of batch) {
      if (generation.current !== run) return
      const update = (patch: Partial<BulkAddRow>) => {
        onChange((current) =>
          current.map((row) => (row.id === item.id ? { ...row, ...patch } : row)),
        )
      }
      update({ state: 'searching' })
      try {
        const results = await searchAddCatalog(item.query, controller.signal)
        if (generation.current !== run) return
        update({ state: results.length ? 'matches' : 'empty', results })
      } catch {
        if (generation.current !== run) return
        update({ state: 'failed' })
      }
    }
    if (generation.current === run) {
      request.current = null
      setBusy(false)
    }
  }
  function prepare() {
    if (request.current || !lines.length || lines.length > 200) return
    const next = lines.map((query) => ({
      id: crypto.randomUUID(),
      query,
      state: 'waiting' as const,
      results: [],
    }))
    onChange(next)
    setPage(0)
    void lookup(next)
  }
  return (
    <div hidden={hidden}>
      {pending > 0 && guardExit && <DraftExitGuard />}
      <Surface radius="panel" tone="card" pad={3} className="mt-4">
        <details open={rows.length > 0 ? true : undefined}>
          <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-ink">
            Bulk add — paste a list
          </summary>
          <p className="mt-2 text-sm text-muted">
            One title or ISBN per line, up to 200. Look up the list first, then review each book
            before adding it. Nothing is saved by a lookup.
          </p>
          {!rows.length ? (
            <>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                aria-label="Books to add, one title or ISBN per line"
                className="mt-3 w-full skin-field border border-line text-ink"
              />
              {lines.length > 200 && (
                <p role="alert" className="mt-2 text-sm text-ink">
                  Split this list into groups of 200 or fewer. No lines have been discarded.
                </p>
              )}
              <button
                type="button"
                onClick={prepare}
                disabled={busy || !lines.length || lines.length > 200}
                className="mt-3 min-h-11 skin-control skin-btn-primary px-4 text-sm"
              >
                Look up list
              </button>
            </>
          ) : (
            <>
              <p role="status" className="my-3 text-sm text-ink">
                {rows.length - pending} saved · {pending} to review
                {busy ? ' · Looking up books…' : ''}
              </p>
              <p className="mb-3 text-sm text-muted">
                This list stays only while this Add page is open. Your saved books stay in your
                library. Repeated lines are separate review items, not extra copies.
              </p>
              <ol className="space-y-3" start={page * 10 + 1}>
                {rows.slice(page * 10, page * 10 + 10).map((row) => (
                  <li
                    key={row.id}
                    className="min-w-0 border-t border-line pt-3 text-sm text-ink [overflow-wrap:anywhere]"
                  >
                    <p className="font-semibold">{row.query}</p>
                    {row.bookId ? (
                      <Link
                        to="/book/$bookId"
                        params={{ bookId: row.bookId }}
                        className="inline-flex min-h-11 items-center underline"
                      >
                        Saved · Open book
                      </Link>
                    ) : (
                      <>
                        <p className="mt-1 text-muted">
                          {
                            {
                              waiting: 'Waiting for lookup',
                              searching: 'Looking up…',
                              matches: 'Choose the matching book to review',
                              empty: 'No matches found',
                              failed: 'Lookup unavailable. Your entry is still here.',
                            }[row.state]
                          }
                        </p>
                        {row.results.map((result, index) => (
                          <div key={index}>
                            <button
                              type="button"
                              onClick={() => onReview(row, result)}
                              className="mt-2 block min-h-11 w-full skin-control border border-line px-3 py-2 text-left text-ink disabled:opacity-60"
                            >
                              <span className="block font-semibold">Review {result.title}</span>
                              <span className="block text-muted">
                                {result.authors.join(', ') || 'Author not supplied'} ·{' '}
                                {selectedSearchIsbn(result) || 'ISBN not supplied'}
                              </span>
                            </button>
                            {result.source === 'google' && (
                              <div className="mt-2 flex flex-wrap gap-3">
                                <GoogleBooksAttribution />
                                <GoogleBooksResultLink result={result} />
                              </div>
                            )}
                          </div>
                        ))}
                        {!busy && (row.state === 'failed' || row.state === 'empty') && (
                          <button
                            type="button"
                            onClick={() => void lookup([row])}
                            className="mr-3 min-h-11 text-ink underline"
                          >
                            Try lookup again
                          </button>
                        )}
                        {row.state !== 'searching' && (
                          <button
                            type="button"
                            onClick={() => onReview(row)}
                            className="min-h-11 text-ink underline"
                          >
                            {bookBarcode(row.query)
                              ? 'Enter details for this ISBN'
                              : 'Enter details manually'}
                          </button>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
              {rows.length > 10 && (
                <nav
                  aria-label="Bulk review pages"
                  className="mt-4 flex items-center justify-between gap-2 text-sm text-ink"
                >
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage(page - 1)}
                    className="min-h-11 px-2 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span>
                    {page + 1} / {Math.ceil(rows.length / 10)}
                  </span>
                  <button
                    type="button"
                    disabled={(page + 1) * 10 >= rows.length}
                    onClick={() => setPage(page + 1)}
                    className="min-h-11 px-2 disabled:opacity-50"
                  >
                    Next
                  </button>
                </nav>
              )}
              {pending === 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onChange([])
                    setText('')
                  }}
                  className="mt-3 min-h-11 text-ink underline"
                >
                  Start another list
                </button>
              )}
            </>
          )}
        </details>
      </Surface>
    </div>
  )
}
