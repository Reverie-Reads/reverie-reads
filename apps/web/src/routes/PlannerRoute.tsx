import { createRoute, useNavigate } from '@tanstack/react-router'
import { authorOf, formatPartialDate, type Book } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'
import { PageHeader } from '../components/PageHeader'
import { Surface } from '../components/Surface'
import { useBooks } from '../data/books'
import { useReadingHistory } from '../data/readingHistory'
import { personalReleaseWindow } from '../data/releases'
import { FromYourAuthors } from '../planner/FromYourAuthors'
import { ReadingPlan, type PlanView } from '../planner/ReadingPlan'
import '../planner/release-horizon.css'

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

function PersonalReleaseSection({
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
    <section className="release-group">
      <div className="release-group-heading">
        <h3>{title}</h3>
        <p>{note}</p>
      </div>
      <div className="release-library-grid">
        {list.map((book) => (
          <article key={book.id} className="release-library-card">
            <button
              type="button"
              onClick={() => openBook(book.id)}
              aria-label={`Open ${book.title}`}
            >
              <span className="release-library-cover">
                <CoverImage book={book} />
              </span>
              <span className="release-card-copy">
                <span className="release-date">{formatPartialDate(book.pub)}</span>
                <strong>{book.title}</strong>
                <span className="release-author">{authorOf(book)}</span>
                <span className="release-card-action">Open in my library →</span>
              </span>
            </button>
          </article>
        ))}
      </div>
    </section>
  )
}

function Releases({ books, openBook }: { books: Book[]; openBook: (id: string) => void }) {
  const { upcoming, recent, uncertain } = personalReleaseWindow(books, Date.now())
  const hasPersonalHorizon = upcoming.length > 0 || recent.length > 0 || uncertain.length > 0

  return (
    <div className="release-horizon">
      <Surface radius="panel" tone="card" pad={4} raised className="release-horizon-intro">
        <p className="plan-eyebrow">Your release horizon</p>
        <h2>See what is coming into view.</h2>
        <p>
          Follow new work from authors already at home in your library, and keep an eye on the books
          you have saved. A year or month stays open until a source confirms the day.
        </p>
      </Surface>

      <FromYourAuthors books={books} />

      <section className="release-personal" aria-labelledby="release-personal-heading">
        <header className="release-section-heading">
          <div>
            <p className="plan-eyebrow">Already in your library</p>
            <h2 id="release-personal-heading">Dates you are keeping close.</h2>
            <p>
              Only upcoming and newly arrived books appear here. Older publication history remains
              with each book.
            </p>
          </div>
        </header>
        <PersonalReleaseSection
          title="On your horizon"
          note="Nearest known dates first"
          list={upcoming.slice(0, 12)}
          openBook={openBook}
        />
        <PersonalReleaseSection
          title="Date still taking shape"
          note="A year or month overlaps today, so the exact day stays open"
          list={uncertain.slice(0, 12)}
          openBook={openBook}
        />
        <PersonalReleaseSection
          title="Recently arrived"
          note="Released in the last six months"
          list={recent.slice(0, 12)}
          openBook={openBook}
        />
        {!hasPersonalHorizon && (
          <Surface radius="card" tone="field" pad={3} className="release-status">
            No upcoming or newly arrived books are saved yet. Books you keep from the lookout above
            will appear here after you review and add them.
          </Surface>
        )}
      </section>
    </div>
  )
}

const tabDetails: Record<Tab, { label: string; note: string }> = {
  queue: { label: 'Plan', note: 'Choose what is near' },
  calendar: { label: 'Calendar', note: 'See the year and month' },
  releases: { label: 'Releases', note: 'Watch what is coming' },
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
        title="Keep your reading life close."
        description="Make a loose plan, see the year and month as they happened, or watch for books coming into view."
        descriptionIsTip
        showDescriptionOnMobile
      />

      <Surface
        radius="panel"
        tone="card"
        pad={1}
        className="plan-view-switcher"
        role="group"
        aria-label="Reading life view"
      >
        {(['queue', 'calendar', 'releases'] as const).map((item) => (
          <button key={item} type="button" onClick={() => setTab(item)} aria-pressed={tab === item}>
            <strong>{tabDetails[item].label}</strong>
            <span>{tabDetails[item].note}</span>
          </button>
        ))}
      </Surface>

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
