import {
  formatAuthors,
  formatPartialDate,
  SERIES_STATUS_LABELS,
  type Incoming,
} from '@reverie/core'
import { CoverImage } from '../components/CoverImage'
import { OWNERSHIP_LABELS, readStatusLabel } from '../library/constants'

/** Render the frozen submission (or the loaded result), never a second interpretation of the form. */
export function BookAddReview({ book, destination }: { book: Incoming; destination: string }) {
  const author = book.contributors?.length
    ? formatAuthors(book.contributors)
    : [book.first, book.last].filter(Boolean).join(' ')
  const date = formatPartialDate(book.pub)
  const formats =
    book.owned && (book.ownership === 'owned' || book.borrowed)
      ? [
          book.owned.physical === true ? 'Physical' : book.owned.physical,
          book.owned.ebook ? 'Ebook' : '',
          book.owned.audiobook ? 'Audiobook' : '',
        ]
          .filter(Boolean)
          .join(', ')
      : ''
  const possession =
    [
      book.ownership === 'owned' ? 'Owned' : '',
      book.borrowed ? 'Borrowed' : '',
      book.wishlist ? 'Wishlist' : '',
    ]
      .filter(Boolean)
      .join(' · ') || OWNERSHIP_LABELS.unset
  const rows = [
    ['Destination', destination],
    ['Ownership', possession],
    ...(formats ? [['Copies in hand', formats]] : []),
    ['ISBN', book.isbn || 'Not supplied'],
    ['Format', book.format || 'Not set'],
    ['Pages', book.pages == null ? 'Not supplied' : String(book.pages)],
    ['Publication date', date || 'Not supplied'],
    [
      'Genres',
      [...new Set([book.genre, ...(book.genres ?? [])].filter(Boolean))].join(', ') || 'Not set',
    ],
    ...(book.subgenres?.length ? [['Subgenres', book.subgenres.join(', ')]] : []),
    ...(book.series
      ? [
          [
            'Series',
            `${book.series}${book.position !== '' && book.position != null ? ` · Book ${book.position}` : ''}${book.seriesCount ? ` · ${book.seriesCount} books` : ''}`,
          ],
        ]
      : []),
    ['Reading status', readStatusLabel(book.readStatus ?? 'unset')],
    ...(book.series && book.status ? [['Series status', SERIES_STATUS_LABELS[book.status]]] : []),
    ...(book.fave ? [['Favorite', 'Yes']] : []),
    ...(book.progress ? [['Reading progress', `${book.progress}%`]] : []),
    ...(formatPartialDate(book.plan) ? [['Planned read', formatPartialDate(book.plan)]] : []),
    ...(book.rating ? [['Your rating', `${book.rating} / 5`]] : []),
    ...(book.intensity != null ? [['Intensity', String(book.intensity)]] : []),
    ...(book.darkness != null ? [['Darkness', String(book.darkness)]] : []),
  ]
  return (
    <div className="mt-4 min-w-0 text-sm text-ink">
      <div className="mb-4 flex items-start gap-4">
        <div className="aspect-[2/3] w-16 flex-none overflow-hidden rounded border border-line">
          <CoverImage book={{ ...book, cover: book.cover ?? '' }} thumb />
        </div>
        <div className="min-w-0 [overflow-wrap:anywhere]">
          <p className="text-lg font-semibold leading-snug">{book.title}</p>
          <p className="mt-1 text-muted">{author || 'Author not supplied'}</p>
          {book.contributors?.some((c) => c.role !== 'author') && (
            <p className="mt-1 text-muted">
              {book.contributors.map((c) => `${c.name} (${c.role.replace('_', ' ')})`).join('; ')}
            </p>
          )}
        </div>
      </div>
      <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] gap-x-4 gap-y-2 [overflow-wrap:anywhere]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {book.copyInventory?.editions.map((edition) => (
        <div key={edition.id} className="mt-3 border-t border-line pt-3">
          <p>
            {edition.label || 'Selected edition'} · {edition.format}
          </p>
          {edition.publisher && <p>Publisher: {edition.publisher}</p>}
          {edition.sourceUrl && (
            <a
              href={edition.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-ink underline"
            >
              Edition source ↗
            </a>
          )}
          <p>
            {book.copyInventory?.copies.filter((copy) => copy.editionId === edition.id).length} copy
            recorded
          </p>
        </div>
      ))}
    </div>
  )
}
