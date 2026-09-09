import { useMemo, useState } from 'react'
import { createRoute, Link } from '@tanstack/react-router'
import {
  authorOf,
  choosePlaceholderCoverPatch,
  coverCandidates,
  coverResolutionLabel,
  isStoredCoverUrl,
  keepCurrentCoverPatch,
  personalCoverConcern,
  PERSONAL_COVER_CONCERN_LABELS,
  type Book,
  type CoverMeasurement,
} from '@reverie/core'
import { rootRoute } from './RootRoute'
import { useBooks, useUpdateBook } from '../data/books'
import { clearCoverBroken, useBrokenCoverIds } from '../data/brokenCovers'
import { CoverImage } from '../components/CoverImage'
import { CoverSheet } from '../components/CoverSheet'
import { LibraryNavigation } from '../components/LibraryNavigation'
import { PageHeader } from '../components/PageHeader'
import { Surface } from '../components/Surface'
import { Button } from '../components/Button'

const PAGE_SIZE = 20
const FILTERS = {
  attention: 'Needs attention',
  automatic: 'Automatic covers',
  chosen: 'Chosen by you',
  all: 'All covers',
} as const
type CoverFilter = keyof typeof FILTERS
interface CoverStudioSearch {
  state: CoverFilter
  q: string
  page: number
  book?: string
}

function safeHttpUrl(raw?: string): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

function sourceName(source?: string): string {
  if (source === 'camera') return 'Photograph of your copy'
  if (source === 'upload') return 'Your uploaded image'
  if (source === 'google') return 'Google Books'
  if (source === 'openlibrary') return 'Open Library'
  if (source === 'hardcover') return 'Hardcover'
  if (source === 'url') return 'A link you chose'
  return 'Source not recorded'
}

function filterBook(
  filter: CoverFilter,
  book: Book,
  concern: ReturnType<typeof personalCoverConcern>,
) {
  if (filter === 'attention') return concern != null
  if (filter === 'automatic') return !!book.cover && !book.coverUserChosen
  if (filter === 'chosen') return !!book.coverUserChosen
  return true
}

const CONCERN_ORDER: Record<NonNullable<ReturnType<typeof personalCoverConcern>>, number> = {
  broken: 0,
  missing: 1,
  uncertain: 2,
  soft: 3,
}

function currentQueueMeasurement(
  book: Book,
  measurement: CoverMeasurement | undefined,
): CoverMeasurement | null {
  if (!measurement || !book.cover) return null
  const candidates = coverCandidates(book.cover, { size: 'thumb', storedThumb: book.coverThumb })
  return candidates.includes(measurement.url) ? measurement : null
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Surface tone="card" radius="card" pad={2}>
      <div
        className="text-[28px] font-semibold leading-none text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {value}
      </div>
      <div className="mt-2 text-[11px] uppercase tracking-[0.14em] text-muted">{label}</div>
    </Surface>
  )
}

function CoverQueueItem({
  book,
  active,
  concern,
  search,
  onMeasure,
}: {
  book: Book
  active: boolean
  concern: ReturnType<typeof personalCoverConcern>
  search: CoverStudioSearch
  onMeasure: (image: CoverMeasurement) => void
}) {
  return (
    <li>
      <Link
        to="/covers"
        search={{ ...search, book: book.id }}
        aria-current={active ? 'true' : undefined}
        className="skin-tile flex min-w-0 gap-3 border border-line p-3 text-ink"
        style={{ background: active ? 'var(--field)' : 'var(--card-solid)' }}
      >
        <span className="block h-[84px] w-14 flex-none overflow-hidden border border-line">
          <CoverImage book={book} thumb onResolved={(image) => onMeasure(image)} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-[14px] font-semibold leading-5">
            {book.title}
          </span>
          <span className="mt-0.5 block break-words text-[12px] text-muted">
            {authorOf(book) || 'Author not recorded'}
          </span>
          <span
            className="mt-2 block text-[11.5px] font-semibold"
            style={{ color: concern ? 'var(--accent-ink)' : 'var(--muted)' }}
          >
            {concern
              ? PERSONAL_COVER_CONCERN_LABELS[concern]
              : book.coverUserChosen
                ? book.cover
                  ? 'Chosen by you'
                  : 'Room placeholder chosen'
                : 'Cover in place'}
          </span>
        </span>
      </Link>
    </li>
  )
}

function CoverStudioDetail({
  book,
  broken,
  measurement,
  onStatus,
}: {
  book: Book
  broken: boolean
  measurement: CoverMeasurement | null
  onStatus: (message: string) => void
}) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [detailObservation, setDetailObservation] = useState<{
    cover: string
    image: CoverMeasurement
  } | null>(null)
  const detailMeasurement = detailObservation?.cover === book.cover ? detailObservation.image : null
  const update = useUpdateBook(book.id)
  const concern = personalCoverConcern(book, {
    broken,
    measurement: measurement ?? detailMeasurement,
  })
  const sourceUrl = safeHttpUrl(book.coverSourceUrl)
  const stored = !!book.cover && isStoredCoverUrl(book.cover)
  const quality = book.cover ? coverResolutionLabel(detailMeasurement) : 'Room placeholder'
  const settle = (patch: Partial<Book>, message: string) =>
    update.mutate(
      { id: book.id, patch },
      {
        onSuccess: () => {
          clearCoverBroken(book.id)
          onStatus(message)
        },
      },
    )

  return (
    <Surface tone="card" radius="panel" pad={4} raised className="min-w-0">
      <div className="grid min-w-0 gap-6 sm:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
        <div className="mx-auto w-full max-w-[240px]">
          <div
            className="skin-card aspect-[2/3] overflow-hidden border border-line"
            style={{ background: 'var(--field)', boxShadow: 'var(--shadow)' }}
          >
            <CoverImage
              book={book}
              onResolved={(image) => setDetailObservation({ cover: book.cover, image })}
            />
          </div>
          <p className="mt-2 text-center text-[12px] text-muted">
            {quality}
            {detailMeasurement ? ` · ${detailMeasurement.width} × ${detailMeasurement.height}` : ''}
          </p>
        </div>

        <div className="min-w-0">
          <div className="skin-label text-[11px]" style={{ color: 'var(--accent-ink)' }}>
            {concern ? PERSONAL_COVER_CONCERN_LABELS[concern] : 'This cover is settled'}
          </div>
          <h2
            className="mt-2 break-words text-[28px] font-semibold leading-[1.12] text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            {book.title}
          </h2>
          <p className="mt-1 break-words text-[14px] text-muted">
            {authorOf(book) || 'Author not recorded'}
          </p>

          <Surface tone="field" radius="card" pad={2} className="mt-5 text-[13px]">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] uppercase tracking-[0.13em] text-muted">Source</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {book.cover ? sourceName(book.coverSource) : 'No image source'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.13em] text-muted">Shown as</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {!book.cover
                    ? 'Your room’s placeholder'
                    : stored
                      ? 'Saved in Reverie'
                      : 'Linked image'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.13em] text-muted">Choice</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {book.coverUserChosen
                    ? 'Chosen by you'
                    : book.cover
                      ? 'Added automatically'
                      : 'No choice made yet'}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-[0.13em] text-muted">Edition</dt>
                <dd className="mt-1 font-semibold text-ink">
                  {book.isbn ? `ISBN ${book.isbn}` : 'ISBN not recorded'}
                </dd>
              </div>
            </dl>
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block min-h-11 py-3 font-semibold underline underline-offset-4"
              >
                View image source
              </a>
            ) : null}
          </Surface>

          <p className="mt-4 text-[13px] leading-relaxed text-muted">
            A choice you make here is kept with this copy. Automatic enrichment will not replace it.
            Choosing an edition can also offer its ISBN, format, year, and page count separately.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => setSheetOpen(true)}>
              {book.cover ? 'Choose another cover' : 'Add a cover'}
            </Button>
            {book.cover && !book.coverUserChosen && !broken ? (
              <Button
                variant="secondary"
                disabled={update.isPending}
                onClick={() =>
                  settle(keepCurrentCoverPatch(), 'This cover is now protected as your choice.')
                }
              >
                Keep this cover
              </Button>
            ) : null}
            {book.cover || !book.coverUserChosen ? (
              <Button
                variant="ghost"
                disabled={update.isPending}
                onClick={() =>
                  settle(
                    choosePlaceholderCoverPatch(),
                    'This room’s placeholder is now your cover choice.',
                  )
                }
              >
                Use this room’s placeholder
              </Button>
            ) : null}
          </div>
          {update.isError ? (
            <p role="alert" className="mt-3 text-[13px] text-primary">
              The cover choice could not be saved. Try again.
            </p>
          ) : null}
          <Link
            to="/book/$bookId"
            params={{ bookId: book.id }}
            className="mt-5 inline-block min-h-11 py-3 text-[13px] text-muted underline underline-offset-4"
          >
            Open the complete book record
          </Link>
        </div>
      </div>
      {sheetOpen ? <CoverSheet book={book} onClose={() => setSheetOpen(false)} /> : null}
    </Surface>
  )
}

function CoverStudioPage() {
  const { data: books, isPending, isError, refetch } = useBooks()
  const brokenIds = useBrokenCoverIds()
  const search = coverStudioRoute.useSearch()
  const navigate = coverStudioRoute.useNavigate()
  const [measurements, setMeasurements] = useState<Record<string, CoverMeasurement>>({})
  const [status, setStatus] = useState('')

  const observe = (id: string, image: CoverMeasurement) =>
    setMeasurements((current) => {
      const previous = current[id]
      if (
        previous &&
        previous.url === image.url &&
        previous.width === image.width &&
        previous.height === image.height
      )
        return current
      return { ...current, [id]: image }
    })

  const concerns = useMemo(
    () =>
      new Map(
        (books ?? []).map((book) => [
          book.id,
          personalCoverConcern(book, {
            broken: brokenIds.has(book.id),
            measurement: currentQueueMeasurement(book, measurements[book.id]),
          }),
        ]),
      ),
    [books, brokenIds, measurements],
  )
  const query = search.q.trim().toLocaleLowerCase()
  const filtered = useMemo(
    () =>
      (books ?? [])
        .filter((book) => {
          if (!filterBook(search.state, book, concerns.get(book.id) ?? null)) return false
          if (!query) return true
          return `${book.title} ${authorOf(book)} ${book.isbn}`.toLocaleLowerCase().includes(query)
        })
        .sort((a, b) => {
          if (search.state === 'attention') {
            const aConcern = concerns.get(a.id)
            const bConcern = concerns.get(b.id)
            if (aConcern && bConcern && CONCERN_ORDER[aConcern] !== CONCERN_ORDER[bConcern]) {
              return CONCERN_ORDER[aConcern] - CONCERN_ORDER[bConcern]
            }
          }
          return a.title.localeCompare(b.title) || authorOf(a).localeCompare(authorOf(b))
        }),
    [books, concerns, query, search.state],
  )
  const pageStart = search.page * PAGE_SIZE
  const page = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const selected = search.book ? (books ?? []).find((book) => book.id === search.book) : undefined
  const attentionCount = [...concerns.values()].filter(Boolean).length
  const chosenCount = (books ?? []).filter((book) => book.coverUserChosen).length
  const coveredCount = (books ?? []).filter((book) => book.cover).length

  return (
    <section className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <PageHeader
        eyebrow="Your copies, cared for"
        title="Cover Studio"
        description="Photograph the book on your shelf, choose the right edition, or keep a room-made placeholder. Every choice stays with your copy."
        showDescriptionOnMobile
        actions={
          <Link
            to="/add"
            className="skin-control skin-btn-secondary hidden min-h-11 items-center px-4 text-[14px] sm:flex"
          >
            Add a book
          </Link>
        }
      />
      <LibraryNavigation current="covers" className="mb-6 mt-4" />

      {status ? (
        <p
          role="status"
          className="mb-5 border border-line p-3 text-[13px] text-ink"
          style={{ background: 'var(--card-solid)' }}
        >
          {status}
        </p>
      ) : null}

      <div
        className={`mb-6 grid-cols-3 gap-2 sm:max-w-xl sm:gap-3 ${selected ? 'hidden lg:grid' : 'grid'}`}
      >
        <Stat label="Need a look" value={attentionCount} />
        <Stat label="Chosen by you" value={chosenCount} />
        <Stat label="With artwork" value={coveredCount} />
      </div>

      {isPending ? (
        <p className="py-10 text-center text-[14px] text-muted">Opening your shelves…</p>
      ) : null}
      {isError ? (
        <Surface tone="card" radius="card" pad={3} className="max-w-xl">
          <p role="alert" className="text-[14px] text-ink">
            Your covers could not be opened.
          </p>
          <Button variant="secondary" className="mt-3" onClick={() => void refetch()}>
            Try again
          </Button>
        </Surface>
      ) : null}

      {!isPending && !isError ? (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.7fr)]">
          <div className={`min-w-0 ${selected ? 'hidden lg:block' : ''}`}>
            <form
              className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const q = String(new FormData(event.currentTarget).get('coverQuery') ?? '').trim()
                setStatus('')
                void navigate({ search: { ...search, q, page: 0, book: undefined } })
              }}
            >
              <label className="block text-[13px] font-semibold text-ink">
                Find a book
                <input
                  key={search.q}
                  type="search"
                  name="coverQuery"
                  defaultValue={search.q}
                  maxLength={200}
                  className="skin-field mt-2 min-h-11 w-full px-3 text-[16px]"
                  placeholder="Title, author, or ISBN"
                />
              </label>
              <Button variant="secondary" type="submit">
                Search
              </Button>
            </form>

            <label className="mt-4 block text-[13px] font-semibold text-ink">
              Show
              <select
                value={search.state}
                className="skin-field mt-2 min-h-11 w-full px-3 text-[16px]"
                onChange={(event) => {
                  setStatus('')
                  void navigate({
                    search: {
                      ...search,
                      state: event.target.value as CoverFilter,
                      page: 0,
                      book: undefined,
                    },
                  })
                }}
              >
                {Object.entries(FILTERS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <p className="my-4 text-[12px] text-muted">
              {filtered.length} {filtered.length === 1 ? 'book' : 'books'} · {FILTERS[search.state]}
            </p>
            {!page.length ? (
              <Surface
                tone="bare"
                radius="card"
                pad={3}
                className="border-dashed text-[13px] text-muted"
              >
                {pageStart > 0
                  ? 'No books remain on this page. Return to the previous page.'
                  : query
                    ? 'No covers match this search.'
                    : search.state === 'attention'
                      ? 'Nothing is waiting here. Browse automatic covers to inspect image quality.'
                      : 'No books are in this view.'}
              </Surface>
            ) : (
              <ul aria-label="Personal cover queue" className="space-y-2">
                {page.map((book) => (
                  <CoverQueueItem
                    key={book.id}
                    book={book}
                    active={book.id === search.book}
                    concern={concerns.get(book.id) ?? null}
                    search={search}
                    onMeasure={(image) => observe(book.id, image)}
                  />
                ))}
              </ul>
            )}
            <nav
              aria-label="Cover queue pages"
              className="mt-4 flex items-center justify-between gap-2"
            >
              <Button
                variant="secondary"
                disabled={!search.page}
                onClick={() =>
                  void navigate({ search: { ...search, page: search.page - 1, book: undefined } })
                }
              >
                Previous
              </Button>
              <span className="text-[12px] text-muted">Page {search.page + 1}</span>
              <Button
                variant="secondary"
                disabled={(search.page + 1) * PAGE_SIZE >= filtered.length}
                onClick={() =>
                  void navigate({ search: { ...search, page: search.page + 1, book: undefined } })
                }
              >
                Next
              </Button>
            </nav>
          </div>

          <div className={`min-w-0 ${selected ? '' : 'hidden lg:block'}`}>
            {selected ? (
              <>
                <Link
                  to="/covers"
                  search={{ ...search, book: undefined }}
                  className="mb-3 inline-flex min-h-11 items-center py-3 text-[13px] text-muted underline underline-offset-4 lg:hidden"
                >
                  Back to cover queue
                </Link>
                <CoverStudioDetail
                  key={selected.id}
                  book={selected}
                  broken={brokenIds.has(selected.id)}
                  measurement={currentQueueMeasurement(selected, measurements[selected.id])}
                  onStatus={setStatus}
                />
              </>
            ) : (
              <Surface tone="card" radius="panel" pad={5} raised className="text-center">
                <div className="mx-auto max-w-[190px] rotate-[-1.5deg]">
                  <div
                    className="skin-card aspect-[2/3] overflow-hidden border border-line"
                    style={{ boxShadow: 'var(--shadow)' }}
                  >
                    <CoverImage
                      book={{ title: 'A Place on Your Shelf', first: 'Your', last: 'Library' }}
                      reportErrors={false}
                    />
                  </div>
                </div>
                <h2
                  className="mt-5 text-[26px] font-semibold text-ink"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Make each copy feel like yours.
                </h2>
                <p className="mx-auto mt-2 max-w-[46ch] text-[14px] leading-relaxed text-muted">
                  Choose a book from the queue. You can photograph the copy you hold, compare
                  editions, upload artwork you own, or settle into this room’s placeholder.
                </p>
              </Surface>
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}

export const coverStudioRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'covers',
  validateSearch: (raw: Record<string, unknown>) => ({
    state: (Object.keys(FILTERS).includes(String(raw.state))
      ? raw.state
      : 'attention') as CoverFilter,
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    page: Math.max(0, Math.min(5000, Number.isInteger(Number(raw.page)) ? Number(raw.page) : 0)),
    book: typeof raw.book === 'string' && raw.book.length <= 100 ? raw.book : undefined,
  }),
  component: CoverStudioPage,
})
