import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { discoveryRelationship, splitName, type Book } from '@reverie/core'
import { Modal } from './Modal'
import { CoverImage } from './CoverImage'
import { fetchDiscoveryDetails, plainDescription } from '../lib/discoveryDetails'
import { hitKey, type DiscoverHit } from '../lib/discover'
import { GoogleBooksAttribution, GoogleBooksResultLink } from './GoogleBooksAttribution'

export function DiscoverBookPreview({
  hit,
  book,
  onClose,
  reason,
  discoverSession,
}: {
  hit: DiscoverHit
  book?: Book
  reason?: string
  discoverSession?: string
  onClose: () => void
}) {
  const author = hit.authors.join(', ')
  const { first, last } = splitName(hit.authors[0] ?? '')
  const details = useQuery({
    queryKey: ['discover-details', hit.corpusWorkId ?? hitKey(hit)],
    queryFn: () => fetchDiscoveryDetails(hit),
    staleTime: 1000 * 60 * 30,
    retry: false,
  })
  const description = plainDescription(details.data?.description || hit.description || '')
  return (
    <Modal title={hit.title} onClose={onClose} wide>
      <div className="grid gap-6 sm:grid-cols-[160px_minmax(0,1fr)]">
        <div
          className="mx-auto aspect-[2/3] w-36 overflow-hidden border border-line sm:w-full"
          style={{ borderRadius: 'var(--radius-card)' }}
        >
          <CoverImage book={{ title: hit.title, first, last, cover: hit.cover }} />
        </div>
        <div className="min-w-0">
          <p className="text-lg leading-relaxed text-ink">{author || 'Author not listed'}</p>
          <dl className="mt-4 grid gap-3 text-sm leading-relaxed">
            {hit.pub && (
              <div>
                <dt className="text-muted">Published</dt>
                <dd className="text-ink">{hit.pub}</dd>
              </div>
            )}
            {hit.isbn && (
              <div>
                <dt className="text-muted">ISBN</dt>
                <dd className="break-all text-ink">{hit.isbn}</dd>
              </div>
            )}
            {details.data?.publisher && (
              <div>
                <dt className="text-muted">Publisher</dt>
                <dd className="text-ink">{details.data.publisher}</dd>
              </div>
            )}
            {details.data?.language && (
              <div>
                <dt className="text-muted">Language</dt>
                <dd className="text-ink">{details.data.language}</dd>
              </div>
            )}
          </dl>
          {book && (
            <p className="mt-4 text-sm font-semibold text-ink">{discoveryRelationship(book)}</p>
          )}
        </div>
      </div>
      {hit.source === 'google' && hit.sourceUrl && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <GoogleBooksAttribution />
          <GoogleBooksResultLink result={hit} />
        </div>
      )}
      {reason && (
        <p className="mt-6 border-l-2 border-line pl-4 text-base leading-relaxed text-muted">
          {reason}
        </p>
      )}
      <div className="mt-6 border-t border-line pt-5">
        <h3 className="text-lg font-semibold leading-snug text-ink">About this book</h3>
        {description && (
          <p className="mt-3 whitespace-pre-line text-base leading-relaxed text-ink">
            {description}
          </p>
        )}
        {details.isPending && !description ? (
          <p role="status" className="mt-3 text-sm text-muted">
            Loading the catalog description…
          </p>
        ) : details.isError ? (
          <div role="alert" className="mt-3 text-sm leading-relaxed text-muted">
            <p>
              {description
                ? 'The description from your selection is shown above. Updated details couldn’t be loaded.'
                : 'The description couldn’t be loaded. You can still keep browsing or add the book.'}
            </p>
            <button
              type="button"
              onClick={() => void details.refetch()}
              className="mt-2 min-h-11 text-ink underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        ) : !description ? (
          <p className="mt-3 text-base leading-relaxed text-ink">
            There isn’t a description in this catalog record yet.
          </p>
        ) : null}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          {hit.corpusWorkId
            ? 'Details from the shared catalog.'
            : 'Details from catalog sources; editions may differ.'}{' '}
          Opening a preview doesn’t add the book to your library.
        </p>
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-5">
        {details.data?.unavailable ? (
          <p role="status" className="text-sm text-muted">
            This catalog record is no longer available. Your saved shortlist still keeps its
            original details.
          </p>
        ) : book ? (
          <Link
            to="/book/$bookId"
            params={{ bookId: book.id }}
            className="skin-control skin-btn-primary inline-flex min-h-11 items-center px-4 text-sm font-semibold"
          >
            Open your book
          </Link>
        ) : (
          <Link
            to="/add"
            search={{
              work: hit.corpusWorkId,
              title: hit.title,
              author: hit.authors[0] || undefined,
              isbn: hit.isbn || undefined,
              cover: hit.cover || undefined,
              source: hit.source,
              sourceUrl: hit.sourceUrl,
              pub: hit.pub || undefined,
              want: true,
              discoverSession,
            }}
            className="skin-control skin-btn-primary inline-flex min-h-11 items-center px-4 text-sm font-semibold"
          >
            Add to wishlist
          </Link>
        )}
        <button
          type="button"
          onClick={onClose}
          className="skin-control skin-btn-secondary min-h-11 px-4 text-sm font-semibold"
        >
          Keep browsing
        </button>
      </div>
    </Modal>
  )
}
