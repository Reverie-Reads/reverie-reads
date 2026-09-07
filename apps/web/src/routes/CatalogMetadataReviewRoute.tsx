import { useState } from 'react'
import { createRoute, Link } from '@tanstack/react-router'
import { rootRoute } from './RootRoute'
import { useCorpusAdminStatus } from '../data/enrichCorpus'
import {
  METADATA_ISSUES,
  METADATA_PAGE_SIZE,
  useCatalogMetadataQueue,
  type MetadataIssue,
  type MetadataState,
} from '../data/corpusMetadataReview'
import { CatalogMetadataEditor } from '../components/catalog/CatalogMetadataEditor'
import { CatalogReviewNav } from '../components/catalog/CatalogReviewNav'
import { Button } from '../components/Button'

const STATES: Record<MetadataState, string> = {
  attention: 'Needs attention',
  deferred: 'For later',
  reviewed: 'Assessed',
  all: 'All books',
}
function CatalogMetadataReviewPage() {
  const admin = useCorpusAdminStatus()
  const search = catalogMetadataReviewRoute.useSearch()
  const navigate = catalogMetadataReviewRoute.useNavigate()
  const [saved, setSaved] = useState('')
  const [refresh, setRefresh] = useState(0)
  const queue = useCatalogMetadataQueue(
    {
      state: search.state,
      issue: search.issue,
      query: search.q,
      offset: search.page * METADATA_PAGE_SIZE,
    },
    admin.data === true,
  )
  const selected = useCatalogMetadataQueue(
    { state: 'all', issue: 'all', query: '', offset: 0, workId: search.work },
    admin.data === true && !!search.work,
  )
  const work = search.work ? selected.data?.items[0] : null
  if (admin.isPending) return <p className="p-6 text-muted">Checking catalog access…</p>
  if (admin.isError)
    return (
      <div className="p-6">
        <p role="alert">Catalog access could not be checked.</p>
        <Button variant="secondary" onClick={() => void admin.refetch()}>
          Try again
        </Button>
      </div>
    )
  if (!admin.data)
    return (
      <section className="mx-auto max-w-xl p-6 text-ink">
        <h1 className="text-2xl">Catalog metadata</h1>
        <p className="mt-3">This workspace is available to catalog administrators.</p>
        <Link to="/library" className="mt-4 inline-block underline">
          Return to your library
        </Link>
      </section>
    )
  const go = (patch: Partial<typeof search>) => {
    setSaved('')
    void navigate({ search: { ...search, ...patch } })
  }
  const back = (
    <Link
      to="/catalog/metadata"
      search={{ ...search, work: undefined }}
      className="skin-control inline-flex min-h-11 items-center text-sm text-ink underline"
    >
      Back to metadata queue
    </Link>
  )
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-6 text-ink sm:px-6">
      <header className="mb-6">
        <Link to="/review" className="text-sm text-muted underline">
          Administrator review
        </Link>
        <h1 className="mt-3 text-3xl leading-snug" style={{ fontFamily: 'var(--font-display)' }}>
          Care for the catalog details
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
          Help each book tell its own story. Fill missing descriptions and compare records whose
          identity needs a closer look.
        </p>
        <CatalogReviewNav />
      </header>
      {saved && (
        <p
          role="status"
          className="mb-5 border border-line p-3 text-sm"
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
              go({
                q: String(new FormData(e.currentTarget).get('query') ?? '').trim(),
                page: 0,
                work: undefined,
              })
            }}
          >
            <label className="block text-sm">
              Find a catalog book
              <input
                key={search.q}
                name="query"
                type="search"
                defaultValue={search.q}
                maxLength={200}
                className="skin-field mt-2 min-h-11 w-full px-3 text-base"
                placeholder="Title, author, or ISBN"
              />
            </label>
            <Button type="submit" variant="secondary" className="mt-2 w-full">
              Search catalog
            </Button>
          </form>
          <label className="mt-4 block text-sm">
            Review queue
            <select
              value={search.state}
              onChange={(e) =>
                go({ state: e.target.value as MetadataState, page: 0, work: undefined })
              }
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            >
              {Object.entries(STATES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-4 block text-sm">
            Metadata concern
            <select
              value={search.issue}
              onChange={(e) =>
                go({ issue: e.target.value as MetadataIssue | 'all', page: 0, work: undefined })
              }
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            >
              <option value="all">All concerns</option>
              {Object.entries(METADATA_ISSUES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {queue.isPending ? (
            <p className="mt-5 text-sm text-muted">Opening the catalog…</p>
          ) : queue.isError ? (
            <div role="alert" className="mt-5">
              <p>The metadata queue could not be loaded.</p>
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
                    : 'No books match this queue. Try another concern or browse all books.'}
                </p>
              )}
              <ul aria-label="Catalog metadata review queue" className="space-y-2">
                {queue.data.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to="/catalog/metadata"
                      search={{ ...search, work: item.id }}
                      onClick={() => setSaved('')}
                      aria-current={item.id === search.work ? 'true' : undefined}
                      className="skin-tile block min-w-0 border border-line p-3"
                      style={{
                        background: item.id === search.work ? 'var(--field)' : 'var(--card-solid)',
                      }}
                    >
                      <span className="block break-words text-sm font-semibold">{item.title}</span>
                      <span className="mt-1 block text-xs text-muted">
                        {item.author || 'Author not recorded'}
                      </span>
                      <span className="mt-2 block text-xs">
                        {item.issues.map((issue) => METADATA_ISSUES[issue]).join(' · ') ||
                          'No detected gaps'}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={search.page === 0}
                  onClick={() => go({ page: search.page - 1, work: undefined })}
                >
                  Previous page
                </Button>
                <Button
                  variant="secondary"
                  disabled={(search.page + 1) * METADATA_PAGE_SIZE >= queue.data.total}
                  onClick={() => go({ page: search.page + 1, work: undefined })}
                >
                  Next page
                </Button>
              </div>
            </>
          )}
        </div>
        <div className="min-w-0">
          {search.work ? (
            <>
              {back}
              {selected.isPending ? (
                <p className="p-4 text-sm text-muted">Opening this record…</p>
              ) : selected.isError ? (
                <div role="alert">
                  <p>This record could not be loaded.</p>
                  <Button variant="secondary" onClick={() => void selected.refetch()}>
                    Retry record
                  </Button>
                </div>
              ) : work ? (
                <CatalogMetadataEditor
                  key={`${work.id}:${refresh}`}
                  work={work}
                  onSaved={(message) => {
                    setSaved(message)
                    setRefresh((value) => value + 1)
                  }}
                  onRefresh={() => {
                    void selected.refetch().then(() => setRefresh((value) => value + 1))
                  }}
                />
              ) : (
                <p className="p-4 text-sm text-muted">
                  This catalog record is no longer available.
                </p>
              )}
            </>
          ) : (
            <div
              className="skin-card border border-line p-6"
              style={{ background: 'var(--card-solid)' }}
            >
              <h2 className="text-xl">Choose a book to review</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Identity concerns come first, then missing descriptions. The checks find exact title
                and author matches and equivalent, valid ISBNs. They do not establish that two
                records should be merged.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-muted">
                Set a record aside when evidence is missing. Changed catalog details bring an old
                assessment back for review.
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
export const catalogMetadataReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'catalog/metadata',
  validateSearch: (search: Record<string, unknown>) => ({
    state: (['attention', 'deferred', 'reviewed', 'all'].includes(String(search.state))
      ? search.state
      : 'attention') as MetadataState,
    issue: (Object.keys(METADATA_ISSUES).includes(String(search.issue)) ? search.issue : 'all') as
      | MetadataIssue
      | 'all',
    q: typeof search.q === 'string' ? search.q.slice(0, 200) : '',
    page:
      Number.isInteger(Number(search.page)) && Number(search.page) >= 0
        ? Math.min(Number(search.page), 5000)
        : 0,
    work:
      typeof search.work === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.work)
        ? search.work
        : undefined,
  }),
  component: CatalogMetadataReviewPage,
})
