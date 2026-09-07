import { CatalogReviewNav } from '../components/catalog/CatalogReviewNav'
import { useState } from 'react'
import { createRoute, Link } from '@tanstack/react-router'
import { coverResolutionLabel } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import {
  COVER_CONCERNS,
  COVER_REVIEW_PAGE_SIZE,
  useCatalogCoverQueue,
  type ReviewState,
} from '../data/corpusCoverReview'
import { CatalogCoverComparison } from '../components/catalog/CatalogCoverComparison'
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'

const STATES: Record<ReviewState, string> = {
  attention: 'Needs attention',
  deferred: 'For later',
  approved: 'Reviewed',
  all: 'All books',
}
function CatalogCoverReviewPage() {
  const admin = useCorpusAdminStatus()
  const search = catalogCoverReviewRoute.useSearch()
  const navigate = catalogCoverReviewRoute.useNavigate()
  const [saved, setSaved] = useState('')
  const queue = useCatalogCoverQueue(
    { state: search.state, query: search.q, offset: search.page * COVER_REVIEW_PAGE_SIZE },
    admin.data === true,
  )
  const selected = useCatalogCoverQueue(
    { state: 'all', query: '', offset: 0, workId: search.work },
    admin.data === true && !!search.work,
  )
  const work = search.work ? selected.data?.items[0] : null
  if (admin.isPending) return <p className="p-6 text-muted">Checking catalog access…</p>
  if (admin.isError)
    return (
      <div className="p-6">
        <p role="alert" className="text-ink">
          Catalog access could not be checked.
        </p>
        <Button variant="secondary" onClick={() => void admin.refetch()}>
          Try again
        </Button>
      </div>
    )
  if (!admin.data)
    return (
      <section className="mx-auto max-w-xl p-6 text-ink">
        <h1 className="text-2xl">Catalog covers</h1>
        <p className="mt-3">This workspace is available to catalog administrators.</p>
        <Link to="/library" className="mt-4 inline-block underline">
          Return to your library
        </Link>
      </section>
    )
  const returnLink = (
    <Link
      to="/catalog/covers"
      search={{ ...search, work: undefined }}
      className="skin-control inline-flex min-h-11 items-center text-sm text-ink underline underline-offset-4"
    >
      Back to review queue
    </Link>
  )
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6">
        <Link to="/review" className="text-sm text-muted underline underline-offset-4">
          Administrator review
        </Link>
        <h1
          className="mt-3 text-3xl leading-snug text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Care for the shared shelves
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Give each book a cover that belongs to it. Review the title and author, compare the
          artwork, and keep a record of your choice.
        </p>
        <CatalogReviewNav />
      </header>
      {saved && (
        <p
          role="status"
          className="mb-5 border border-line p-3 text-sm text-ink"
          style={{ background: 'var(--card-solid)' }}
        >
          {saved}
        </p>
      )}
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
        <div className={`min-w-0 ${search.work ? 'hidden lg:block' : ''}`}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const query = String(new FormData(e.currentTarget).get('catalogQuery') ?? '').trim()
              setSaved('')
              void navigate({
                search: { ...search, q: query, page: 0, work: undefined },
              })
            }}
          >
            <label className="block text-sm text-ink">
              Find a catalog book
              <input
                type="search"
                key={search.q}
                name="catalogQuery"
                defaultValue={search.q}
                maxLength={200}
                className="skin-field mt-2 min-h-11 w-full px-3 text-base"
                placeholder="Title, author, or ISBN"
              />
            </label>
            <Button variant="secondary" type="submit" className="mt-2 w-full">
              Search catalog
            </Button>
          </form>
          <label className="mt-4 block text-sm text-ink">
            Review queue
            <select
              value={search.state}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
              onChange={(e) => {
                setSaved('')
                void navigate({
                  search: {
                    ...search,
                    state: e.target.value as ReviewState,
                    page: 0,
                    work: undefined,
                  },
                })
              }}
            >
              {Object.entries(STATES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {queue.isPending ? (
            <p className="mt-5 text-sm text-muted">Opening the catalog…</p>
          ) : queue.isError ? (
            <div role="alert" className="mt-5 text-sm text-ink">
              <p>The review queue could not be loaded.</p>
              <Button variant="secondary" onClick={() => void queue.refetch()}>
                Retry queue
              </Button>
            </div>
          ) : (
            <>
              <p className="my-4 text-xs text-muted">
                {queue.data.total} {queue.data.total === 1 ? 'book' : 'books'} ·{' '}
                {STATES[search.state]}
              </p>
              {!queue.data.items.length && (
                <p className="border border-dashed border-line p-4 text-sm text-muted">
                  {queue.data.total > 0
                    ? 'No books remain on this page. Return to the previous page.'
                    : search.q
                      ? 'No books match this search.'
                      : search.state === 'attention'
                        ? 'Nothing is waiting here. Browse all books to check another cover.'
                        : 'No books in this queue yet.'}
                </p>
              )}
              <ul aria-label="Catalog cover review queue" className="space-y-2">
                {queue.data.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to="/catalog/covers"
                      search={{ ...search, work: item.id }}
                      onClick={() => setSaved('')}
                      aria-current={item.id === search.work ? 'true' : undefined}
                      className="skin-tile flex min-w-0 gap-3 border border-line p-3 text-ink"
                      style={{
                        background: item.id === search.work ? 'var(--field)' : 'var(--card-solid)',
                      }}
                    >
                      <span className="block h-[72px] w-12 flex-none overflow-hidden border border-line">
                        <CoverImage
                          book={{ title: item.title, cover: item.cover }}
                          thumb
                          reportErrors={false}
                        />
                      </span>
                      <span className="min-w-0">
                        <span className="block break-words text-sm font-semibold">
                          {item.title}
                        </span>
                        <span className="mt-1 block break-words text-xs text-muted">
                          {item.author || 'Author not recorded'}
                        </span>
                        <span className="mt-2 block text-xs text-muted">
                          {item.reason
                            ? COVER_CONCERNS[item.reason]
                            : !item.cover
                              ? 'No cover yet'
                              : item.state === 'approved'
                                ? 'Reviewed'
                                : item.measurement
                                  ? coverResolutionLabel(item.measurement)
                                  : 'Not reviewed yet'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <nav
                aria-label="Review queue pages"
                className="mt-4 flex items-center justify-between gap-2"
              >
                <Button
                  variant="secondary"
                  disabled={!search.page}
                  onClick={() =>
                    void navigate({ search: { ...search, page: search.page - 1, work: undefined } })
                  }
                >
                  Previous
                </Button>
                <span className="text-xs text-muted">Page {search.page + 1}</span>
                <Button
                  variant="secondary"
                  disabled={(search.page + 1) * COVER_REVIEW_PAGE_SIZE >= queue.data.total}
                  onClick={() =>
                    void navigate({ search: { ...search, page: search.page + 1, work: undefined } })
                  }
                >
                  Next
                </Button>
              </nav>
            </>
          )}
        </div>
        <div className="min-w-0">
          {search.work ? (
            <>
              <div className="mb-3">{returnLink}</div>
              {selected.isPending ? (
                <p className="text-sm text-muted">Opening this book…</p>
              ) : selected.isError ? (
                <div role="alert">
                  <p className="text-sm text-ink">This record could not be loaded.</p>
                  <Button variant="secondary" onClick={() => void selected.refetch()}>
                    Retry record
                  </Button>
                </div>
              ) : work ? (
                <CatalogCoverComparison
                  key={`${work.id}:${work.fingerprint}:${work.revision}`}
                  work={work}
                  onSaved={setSaved}
                  onRefresh={() => void selected.refetch()}
                />
              ) : (
                <p className="text-sm text-muted">
                  This catalog record is no longer available. Return to the queue to choose another
                  book.
                </p>
              )}
            </>
          ) : (
            <div
              className="border border-dashed border-line p-6 sm:p-10"
              style={{ background: 'var(--card-solid)' }}
            >
              <h2 className="text-xl text-ink" style={{ fontFamily: 'var(--font-display)' }}>
                One book at a time
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Choose a book from the queue. Identity concerns come first, followed by missing and
                flagged images. A small image can be the correct one; a large image can still belong
                to another book.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Keep a correct cover, propose a replacement, or leave a note for later. Your review
                is saved across visits.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

export const catalogCoverReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'catalog/covers',
  validateSearch: (raw: Record<string, unknown>) => ({
    state: (Object.keys(STATES).includes(String(raw.state))
      ? raw.state
      : 'attention') as ReviewState,
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    page: Math.max(0, Math.min(5000, Number.isInteger(Number(raw.page)) ? Number(raw.page) : 0)),
    work:
      typeof raw.work === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.work)
        ? raw.work
        : undefined,
  }),
  component: CatalogCoverReviewPage,
})
