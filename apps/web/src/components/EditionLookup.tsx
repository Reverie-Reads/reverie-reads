import { useEffect, useRef, useState } from 'react'
import { findEditions, type EditionCandidate } from '../lib/enrich'

/** A bounded source list; an edition is never chosen merely because a lookup completed. */
export function EditionLookup({
  title,
  author,
  onSelect,
}: {
  title: string
  author: string
  onSelect: (edition: EditionCandidate) => void
}) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof findEditions>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => {
    request.current?.abort()
    setResult(null)
    setError('')
    setBusy(false)
    return () => request.current?.abort()
  }, [title, author])
  async function lookup() {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const response = await findEditions(title, author, controller.signal)
      if (!controller.signal.aborted) setResult(response)
    } catch (cause) {
      if (!controller.signal.aborted) setError((cause as Error).message)
    } finally {
      if (!controller.signal.aborted) setBusy(false)
    }
  }
  return (
    <section className="mt-3 text-sm text-ink" aria-label="Find an edition">
      <button
        type="button"
        className="skin-control min-h-11 border border-line px-3"
        disabled={busy || !title.trim() || !author.trim()}
        onClick={() => void lookup()}
      >
        {busy ? 'Finding editions…' : 'Find editions'}
      </button>
      <p className="mt-2">
        Compare available ISBN editions by publisher, format, language and date. Choose your copy;
        no lookup changes ownership.
      </p>
      {error && (
        <p role="alert" className="mt-2">
          {error}
        </p>
      )}
      {result && (
        <>
          <p role="status" className="mt-2">
            {result.editions.length} edition candidates from Hardcover.{' '}
            {result.limited ? 'Some records were withheld or the response limit was reached. ' : ''}
            This is not an exhaustive list. ISBN-less editions can be entered manually.
          </p>
          <ul className="mt-2 max-h-80 space-y-3 overflow-y-auto">
            {result.editions.map((e) => (
              <li
                key={e.ids?.edition || e.isbn13}
                className="rounded border border-line p-3 [overflow-wrap:anywhere]"
              >
                <p className="font-semibold">
                  {e.publisher || 'Publisher unknown'} · {e.binding || 'Format unknown'}
                </p>
                <p>
                  {e.isbn13} ·{' '}
                  {e.pubY
                    ? [e.pubY, e.pubM, e.pubD].filter((v) => v != null).join('-')
                    : 'Date unknown'}{' '}
                  · {e.language || 'Language unknown'} ·{' '}
                  {e.pageCount ? `${e.pageCount} pages` : 'Pages unknown'}
                </p>
                {e.ids?.slug && (
                  <a
                    className="underline"
                    href={`https://hardcover.app/books/${encodeURIComponent(e.ids.slug)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View source
                  </a>
                )}
                <button
                  type="button"
                  className="skin-control mt-2 block min-h-11 border border-line px-3"
                  onClick={() => onSelect(e)}
                >
                  Use ISBN {e.isbn13}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
