import { createRoute, useNavigate } from '@tanstack/react-router'
import { formatPartialDate, type Book } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'
import { PageHeader } from '../components/PageHeader'
import { Surface } from '../components/Surface'
import { useBooks } from '../data/books'
import { useReadingHistory } from '../data/readingHistory'
import { FromYourAuthors } from '../planner/FromYourAuthors'
import { ReadingPlan, type PlanView } from '../planner/ReadingPlan'

type Tab = PlanView | 'releases'

/** Retained as a named boundary for route tests and small embedded calendar consumers. */
export function PlannerCalendar({
  books,
  openBook,
}: {
  books: Book[]
  openBook: (id: string) => void
}) {
  return <ReadingPlan books={books} view="calendar" openBook={openBook} />
}

function PlannerCalendarExperience({
  books,
  openBook,
}: {
  books: Book[]
  openBook: (id: string) => void
}) {
  const history = useReadingHistory()
  return (
    <>
      {!history.data && (
        <div className="mb-4">
          <p role={history.isError ? 'alert' : 'status'} className="mb-3 text-sm text-muted">
            {history.isError
              ? 'Reading history is unavailable. Your saved plans are still here.'
              : history.isPaused
                ? 'Your saved plans are available. Connect to load reading history.'
                : 'Gathering reading history. Your saved plans are ready below.'}
          </p>
          {history.isError && <Button onClick={() => void history.refetch()}>Try again</Button>}
        </div>
      )}
      {history.data && history.isError && (
        <p role="status" className="mb-4 text-sm text-muted">
          Showing your last loaded reading history.{' '}
          <button type="button" className="underline" onClick={() => void history.refetch()}>
            Try updating again
          </button>
        </p>
      )}
      <ReadingPlan books={books} view="calendar" openBook={openBook} history={history.data} />
    </>
  )
}

function publicationOrder(book: Book): number {
  return (book.pub.y ?? 0) * 10000 + (book.pub.m ?? 13) * 100 + (book.pub.d ?? 32)
}

function isDefinitelyAhead(book: Book, today: Date): boolean {
  if (book.pub.y == null) return false
  if (book.pub.y !== today.getFullYear()) return book.pub.y > today.getFullYear()
  if (book.pub.m == null) return false
  if (book.pub.m !== today.getMonth() + 1) return book.pub.m > today.getMonth() + 1
  return book.pub.d != null && book.pub.d > today.getDate()
}

function ReleaseSection({
  title,
  note,
  list,
  openBook,
}: {
  title: string
  note: string
  list: Book[]
  openBook: (id: string) => void
}) {
  if (!list.length) return null
  return (
    <section className="mb-8">
      <h2
        className="text-[20px] font-semibold leading-tight text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {title}
      </h2>
      <p className="mb-3 mt-1 text-[13px] text-muted">{note}</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {list.map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => openBook(book.id)}
            className="text-left"
            aria-label={`Open ${book.title}`}
          >
            <div className="aspect-[2/3] overflow-hidden rounded-lg border border-line bg-field">
              <CoverImage book={book} />
            </div>
            <div className="mt-1 break-words text-[12px] font-semibold leading-snug text-ink">
              {book.title}
            </div>
            <div className="mt-0.5 text-[11px] text-primary">
              {formatPartialDate(book.pub) || 'Date unknown'}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

function Releases({ books, openBook }: { books: Book[]; openBook: (id: string) => void }) {
  const today = new Date()
  const ahead = books
    .filter((book) => isDefinitelyAhead(book, today))
    .sort((a, b) => publicationOrder(a) - publicationOrder(b))
  const aheadIds = new Set(ahead.map((book) => book.id))
  const known = books
    .filter((book) => book.pub.y != null && !aheadIds.has(book.id))
    .sort((a, b) => publicationOrder(b) - publicationOrder(a))
  const unknown = books.filter((book) => book.pub.y == null)

  return (
    <div>
      <FromYourAuthors />
      <Surface radius="panel" tone="field" pad={3} className="mb-7">
        <p className="text-[13.5px] leading-relaxed text-muted">
          Publication dates keep the precision you actually know. A year or month stays flexible;
          Reverie never turns it into the first day of the year.
        </p>
      </Surface>
      <ReleaseSection
        title="On the horizon"
        note="Books with a known future window"
        list={ahead}
        openBook={openBook}
      />
      <ReleaseSection
        title="In your release record"
        note="Known dates and partial dates"
        list={known}
        openBook={openBook}
      />
      {unknown.length > 0 && (
        <ReleaseSection
          title="Date still taking shape"
          note={`${unknown.length} books with no publication year yet`}
          list={unknown.slice(0, 18)}
          openBook={openBook}
        />
      )}
    </div>
  )
}

function PlannerScreen() {
  const navigate = useNavigate()
  const library = useBooks()
  const books = library.data
  const { tab = 'queue' } = plannerRoute.useSearch()
  const setTab = (next: Tab) =>
    void navigate({
      to: '/planner',
      search: next === 'queue' ? {} : { tab: next },
      replace: true,
    })
  const openBook = (id: string) => void navigate({ to: '/book/$bookId', params: { bookId: id } })

  return (
    <section className="mx-auto w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        eyebrow="Your reading life, ahead"
        title="Make a loose plan. Follow your curiosity."
        description="Keep the next few books close without turning them into a deadline."
        showDescriptionOnMobile
        actions={
          <Surface
            radius="control"
            tone="card"
            pad={1}
            className="flex"
            role="group"
            aria-label="Plan view"
          >
            {(['queue', 'calendar', 'releases'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setTab(item)}
                aria-pressed={tab === item}
                className="min-h-11 rounded-full px-3 py-1.5 text-[12.5px] font-semibold capitalize"
                style={
                  tab === item
                    ? { background: 'var(--accent-fill)', color: 'var(--on-primary)' }
                    : { color: 'var(--muted)' }
                }
              >
                {item}
              </button>
            ))}
          </Surface>
        }
      />

      {!books ? (
        <div className="mt-6">
          <p role={library.isError ? 'alert' : 'status'} className="mb-4 text-muted">
            {library.isError
              ? 'Your library could not be loaded.'
              : library.fetchStatus === 'paused'
                ? 'Connect to load your library.'
                : 'Loading your library…'}
          </p>
          {library.isError && <Button onClick={() => void library.refetch()}>Try again</Button>}
        </div>
      ) : tab === 'releases' ? (
        <Releases books={books} openBook={openBook} />
      ) : tab === 'calendar' ? (
        <PlannerCalendarExperience books={books} openBook={openBook} />
      ) : (
        <ReadingPlan books={books} view={tab} openBook={openBook} />
      )}
    </section>
  )
}

export const plannerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'planner',
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: search.tab === 'calendar' || search.tab === 'releases' ? search.tab : undefined,
  }),
  component: PlannerScreen,
})
