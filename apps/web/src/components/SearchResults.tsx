import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { splitName, type Book } from '@reverie/core'
import { CoverImage } from './CoverImage'
import { libraryMatch, type SearchResult } from '../lib/search'
import { Surface } from './Surface'
import { GoogleBooksResultLink } from './GoogleBooksAttribution'

// The shared search results surface — one visual, both surfaces (Discover grid + the shelf picker's
// list). Each result shows cover / title / author / year / series (task §1). A result already in the
// library renders its shelf state + a link to it, NOT add actions. No consensus signals anywhere.

function ResultMeta({ result }: { result: SearchResult }) {
  const author = result.authors[0] ?? ''
  return (
    <>
      <div className="break-words text-[12px] text-muted">
        {author}
        {result.year ? (
          <span style={{ color: 'var(--faint, var(--muted))' }}> · {result.year}</span>
        ) : null}
      </div>
      {result.series && (
        <div
          className="break-words text-[11px] italic"
          style={{ color: 'var(--faint, var(--muted))', fontFamily: 'var(--font-display)' }}
        >
          {result.series}
          {result.seriesPosition != null ? ` · #${result.seriesPosition}` : ''}
        </div>
      )}
    </>
  )
}

/** "On your shelf ✓" — a result already in the library, linking to its book (task §1). */
function OnShelf({ book }: { book: Book }) {
  return (
    <Link
      to="/book/$bookId"
      params={{ bookId: book.id }}
      className="skin-label inline-block rounded-full border border-line px-2.5 py-1 text-[11px] text-muted"
    >
      On your shelf ✓
    </Link>
  )
}

function coverBook(result: SearchResult) {
  const { first, last } = splitName(result.authors[0] ?? '')
  return { title: result.title, first, last, cover: result.cover }
}

export function SearchResults({
  results,
  books,
  layout = 'grid',
  renderActions,
  onPreview,
}: {
  results: SearchResult[]
  books: Book[]
  layout?: 'grid' | 'list'
  /** Discover can open details; other search surfaces retain their plain result summary. */
  onPreview?: (result: SearchResult) => void
  /** actions for a result NOT already in the library (in-library results show their shelf state) */
  renderActions: (result: SearchResult) => ReactNode
}) {
  const Preview = onPreview ? 'button' : 'div'
  if (layout === 'list') {
    return (
      <ul className="flex flex-col gap-1.5">
        {results.map((r) => {
          const inLib = libraryMatch(r, books)
          return (
            <Surface
              as="li"
              key={`${r.isbn}|${r.title}`}
              radius="card"
              tone="field"
              pad={0}
              className="flex items-center gap-3 px-2.5 py-2"
            >
              <span
                className="h-14 w-9 flex-none overflow-hidden rounded border border-line"
                style={{ background: 'var(--card)' }}
              >
                <CoverImage book={coverBook(r)} thumb />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block break-words text-[13.5px] font-semibold text-ink">
                  {r.title}
                </span>
                <ResultMeta result={r} />
              </span>
              <span className="flex-none">
                {inLib ? <OnShelf book={inLib} /> : renderActions(r)}
              </span>
              <GoogleBooksResultLink result={r} />
            </Surface>
          )
        })}
      </ul>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {results.map((r) => {
        const inLib = libraryMatch(r, books)
        return (
          <div key={`${r.isbn}|${r.title}`} className="flex min-w-0 flex-col">
            <Preview
              {...(onPreview
                ? {
                    type: 'button' as const,
                    onClick: () => onPreview(r),
                    'aria-label': `View details for ${r.title}`,
                  }
                : {})}
              className="text-left"
            >
              <div
                className="aspect-[2/3] overflow-hidden rounded-[8px] border border-line"
                style={{ background: 'var(--card)' }}
              >
                <CoverImage book={coverBook(r)} thumb />
              </div>
              <div className="mt-2 min-w-0">
                <div className="break-words text-[13px] font-semibold leading-snug text-ink">
                  {r.title}
                </div>
                <ResultMeta result={r} />
              </div>
            </Preview>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {onPreview && (
                <button
                  type="button"
                  onClick={() => onPreview(r)}
                  className="min-h-11 text-sm text-ink underline underline-offset-4"
                >
                  Book details
                </button>
              )}
              {inLib ? <OnShelf book={inLib} /> : renderActions(r)}
              <GoogleBooksResultLink result={r} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
