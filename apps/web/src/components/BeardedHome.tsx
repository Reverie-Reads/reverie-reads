import { Link } from '@tanstack/react-router'
import { authorOf, type Book } from '@reverie/core'
import { CoverImage } from './CoverImage'
import { NavigationGlyph } from './NavigationGlyph'
import { StartBookTour } from '../guidance/BookTour'
import type { HomeModuleId } from '../design/arrangements'
import type { NavigationItem } from './navigation'

const HOME_TASKS: Record<
  Exclude<HomeModuleId, 'reading'>,
  NavigationItem & { description: string }
> = {
  'next-read': {
    to: '/match',
    icon: 'match',
    label: 'Choose my next read',
    description: 'Start with books you already have.',
  },
  priority: {
    to: '/shelves',
    icon: 'shelves',
    label: 'My priority shelves',
    description: 'Open the shelves you keep close.',
  },
  releases: {
    to: '/planner',
    icon: 'planner',
    label: 'Upcoming in my library',
    description: 'Known publication dates and your reading plans.',
  },
  year: {
    to: '/stats',
    icon: 'stats',
    label: 'My reading year',
    description: 'Your own reading history, privately.',
  },
}

/** Read-only task landing. Every consequential action uses the existing Add or personal record. */
export function BeardedHome({
  books,
  loading,
  failed,
  retry,
  reportCoverErrors = true,
  homeModules,
}: {
  books: Book[] | undefined
  loading: boolean
  failed: boolean
  retry: () => void
  reportCoverErrors?: boolean
  homeModules?: readonly HomeModuleId[]
}) {
  const reading = (books ?? [])
    .filter((book) => book.readStatus === 'Reading' && !book.readingNowHidden)
    .sort((a, b) => (a.readingPosition ?? 1e15) - (b.readingPosition ?? 1e15))
  const readingSection =
    reading.length > 0 ? (
      <section className="mt-8" aria-labelledby="bearded-reading-heading">
        <h2 id="bearded-reading-heading">Continue reading</h2>
        <div className="mt-4 grid gap-3">
          {reading.slice(0, 3).map((book) => (
            <Link
              to="/book/$bookId"
              params={{ bookId: book.id }}
              key={book.id}
              className="bearded-task"
            >
              <div className="aspect-[2/3] w-16 shrink-0 overflow-hidden rounded-[var(--radius-card)]">
                <CoverImage book={book} reportErrors={reportCoverErrors} />
              </div>
              <div className="min-w-0">
                <strong className="break-words">{book.title}</strong>
                <span className="break-words">{authorOf(book)}</span>
                <span className="underline underline-offset-4">Open book</span>
              </div>
            </Link>
          ))}
        </div>
        {reading.length > 3 && (
          <Link
            to="/library"
            className="mt-3 inline-flex min-h-12 items-center text-[16px] text-ink underline underline-offset-4"
          >
            Find your other current reads in My books
          </Link>
        )}
      </section>
    ) : null
  return (
    <section className="bearded-home">
      <h1>Your library.</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-muted">What would you like to do?</p>
      {!books && (
        <div className="mt-6 rounded-[var(--radius-panel)] border border-line bg-[color:var(--card-solid)] p-5">
          <p role={failed ? 'alert' : 'status'} className="text-[16px] text-ink">
            {failed
              ? 'Your books could not be loaded.'
              : loading
                ? 'Loading your books…'
                : 'Your books are not available yet.'}
          </p>
          {failed && (
            <button
              type="button"
              onClick={retry}
              className="skin-control skin-btn-secondary mt-3 px-4 py-3"
            >
              Try again
            </button>
          )}
        </div>
      )}
      {!homeModules && readingSection}
      <div className="mt-8 grid gap-3 sm:grid-cols-2">
        <Link to="/library" className="bearded-task">
          <NavigationGlyph name="library" className="h-8 w-8" />
          <div>
            <strong>My books</strong>
            <span>
              {books
                ? `${books.length} ${books.length === 1 ? 'book' : 'books'} in your library`
                : 'Open your library'}
            </span>
          </div>
        </Link>
        {(homeModules ?? (['next-read'] as const)).map((id) => {
          if (id === 'reading')
            return readingSection ? (
              <div key={id} className="sm:col-span-2">
                {readingSection}
              </div>
            ) : null
          const task = HOME_TASKS[id]
          return (
            <Link key={id} to={task.to} className="bearded-task">
              <NavigationGlyph name={task.icon} className="h-8 w-8" />
              <div>
                <strong>{task.label}</strong>
                <span>{task.description}</span>
              </div>
            </Link>
          )
        })}
      </div>
      <div className="mt-8 border-t border-line pt-5">
        <StartBookTour label="Show me how to add a book" quiet />
      </div>
    </section>
  )
}
