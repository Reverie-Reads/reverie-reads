import { useEffect, useMemo, useState } from 'react'
import { createRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { genreKey, SKINS, SKIN_ORDER, splitName, type Book, type TasteAnchors } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { useBooks } from '../data/books'
import { useLists } from '../data/lists'
import { useVoice } from '../skin/labels'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { useSearchEverywhere, useAddFromSearch } from '../data/search'
import { Chip } from '../components/Chip'
import { Modal } from '../components/Modal'
import { CoverImage } from '../components/CoverImage'
import { SearchResults } from '../components/SearchResults'
import { libraryMatch, type SearchResult } from '../lib/search'
import { DiscoverBookPreview } from '../components/DiscoverBookPreview'
import {
  batchCount,
  batchOf,
  fetchDiscover,
  hitKey,
  isOwned,
  ownedKeys,
  rankHitsByTaste,
  sortByTaste,
  visibleHits,
  type DiscoverHit,
} from '../lib/discover'
import { useWorksBrowse, workToHit } from '../data/works'
import { TasteTier } from '../components/TasteTier'
import { useTasteCalibration } from '../data/taste'
import { Surface } from '../components/Surface'
import { DiscoverExperience } from '../components/discovery/DiscoverExperience'

// Browse every catalog genre by default. A genre is a deliberate content filter, independent
// of the current room; changing appearance never changes this selection.

const GENRES: { key: string; label: string }[] = SKIN_ORDER.map((id) => ({
  key: SKINS[id].genre.toLowerCase(),
  label: SKINS[id].genre,
}))

function Card({
  hit,
  owned,
  taste,
  anchors,
  onOpen,
}: {
  hit: DiscoverHit
  onOpen: () => void
  owned: boolean
  taste?: number
  anchors?: TasteAnchors | null
}) {
  const navigate = useNavigate()
  const author = hit.authors[0] ?? ''
  const year = hit.pub.slice(0, 4)
  const { first, last } = splitName(author)

  return (
    <article className="flex min-w-0 flex-col rounded-[var(--radius-card)] border border-line bg-card p-3">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View details for ${hit.title}`}
        className="w-full text-left"
      >
        <div
          className="aspect-[2/3] overflow-hidden rounded-[8px] border border-line"
          style={{ background: 'var(--card)' }}
        >
          {/* Same cover chain as the library grid: upgraded → original → skin placeholder, with the
            Google "no image" plate rejected on load (a Discover hit has no library id → no telemetry). */}
          <CoverImage book={{ title: hit.title, first, last, cover: hit.cover }} thumb />
        </div>
        <div className="mt-2 min-w-0">
          <div className="break-words text-[13px] font-semibold leading-snug text-ink">
            {hit.title}
          </div>
          <div className="break-words text-[12px] text-muted">
            {author}
            {year ? <span style={{ color: 'var(--faint, var(--muted))' }}> · {year}</span> : null}
          </div>
          {taste != null && anchors && (
            /* Tier 2b: the named taste tier (fixed per-user anchors) — stable per book, comparable
             across shelves. The anchored % rides underneath as the drill-down (tooltip), not here. */
            <div className="mt-0.5">
              <TasteTier cos={taste} anchors={anchors} />
            </div>
          )}
        </div>
      </button>
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        <button
          type="button"
          onClick={onOpen}
          className="min-h-11 text-sm font-semibold text-ink underline underline-offset-4"
        >
          Book details
        </button>
        {owned ? (
          <Surface
            as="span"
            tone="bare"
            radius="control"
            pad={0}
            className="skin-label inline-block px-2.5 py-1 text-[11px] text-muted"
          >
            On your shelf
          </Surface>
        ) : (
          <button
            type="button"
            onClick={() =>
              void navigate({
                to: '/add',
                search: {
                  work: hit.corpusWorkId,
                  title: hit.title,
                  author: author || undefined,
                  isbn: hit.isbn || undefined,
                  cover: hit.cover || undefined,
                  pub: hit.pub || undefined,
                  // Discover is a wanting context — the add form defaults to the wishlist option.
                  want: true,
                },
              })
            }
            className="skin-control border border-line px-3 py-1 text-[12px] font-semibold text-ink"
            style={{ background: 'var(--chip)' }}
          >
            ＋ Add
          </button>
        )}
      </div>
    </article>
  )
}

/** A tiny modal listing the reader's shelves/TBRs — pick one to place an unowned copy there (task §2). */
function ShelfChooser({
  onPick,
  onClose,
}: {
  onPick: (listId: string) => void
  onClose: () => void
}) {
  const { data: lists } = useLists()
  const shelves = lists ?? []
  return (
    <Modal title="Add to a shelf" onClose={onClose}>
      {shelves.length === 0 ? (
        <p className="text-[13px] text-muted">
          You don’t have any shelves yet — make one from the Shelves tab.
        </p>
      ) : (
        <ul className="flex max-h-[50vh] flex-col gap-1.5 overflow-y-auto">
          {shelves.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => onPick(l.id)}
                className="flex w-full items-center justify-between skin-card border border-line px-3 py-2.5 text-left"
                style={{ background: 'var(--field)' }}
              >
                <span className="text-[13.5px] font-semibold text-ink">{l.name}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted">
                  {l.kind === 'tbr' ? 'TBR' : 'Shelf'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** The two add actions on a Discover search result: to the library (owned) or to a shelf (unowned).
 *  A book already shelved renders its state instead (handled by SearchResults), never these. */
function ResultActions({ result }: { result: SearchResult }) {
  const add = useAddFromSearch()
  const [chooseShelf, setChooseShelf] = useState(false)
  const busy = add.isPending
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => add.mutate({ result, possession: 'owned' })}
        className="skin-control border border-line px-3 py-1 text-[12px] font-semibold text-ink disabled:opacity-50"
        style={{ background: 'var(--chip)' }}
      >
        ＋ Add
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setChooseShelf(true)}
        className="skin-control border border-line px-3 py-1 text-[12px] font-semibold text-ink disabled:opacity-50"
        style={{ background: 'var(--field)' }}
      >
        ＋ Shelf
      </button>
      {chooseShelf && (
        <ShelfChooser
          onClose={() => setChooseShelf(false)}
          onPick={(listId) => {
            add.mutate({ result, possession: 'wishlist', listId })
            setChooseShelf(false)
          }}
        />
      )}
    </>
  )
}

/** The Discover search surface — shown only while a query is active; the taste rail returns on clear. */
function SearchSection({
  query,
  books,
  onOpen,
}: {
  query: string
  books: Book[]
  onOpen: (hit: DiscoverHit) => void
}) {
  const voice = useVoice()
  const q = useSearchEverywhere(query)
  return (
    <div>
      {q.isPending && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <div
                className="aspect-[2/3] rounded-[8px] border border-line"
                style={{ background: 'var(--card)' }}
              />
              <div className="h-3 w-3/4 rounded" style={{ background: 'var(--card)' }} />
              <div className="h-3 w-1/2 rounded" style={{ background: 'var(--card)' }} />
            </div>
          ))}
        </div>
      )}
      {q.isError && (
        <Surface radius="card" tone="bare" pad={5} className="text-center">
          <p className="text-[14px] text-ink">Search isn’t answering right now.</p>
          <p className="mt-1 text-[12.5px] text-muted">
            Usually a rate limit — it clears on its own.
          </p>
        </Surface>
      )}
      {q.isSuccess && q.data.length === 0 && (
        <Surface radius="card" tone="bare" pad={5} className="text-center">
          <p className="text-[14px] text-ink">{voice.miss}</p>
          <p className="mt-1 text-[12.5px] text-muted">Try a title, an author, or an ISBN.</p>
        </Surface>
      )}
      {q.isSuccess && q.data.length > 0 && (
        <SearchResults
          onPreview={(result) =>
            onOpen({ ...result, pub: result.year, isbn: result.isbn13 ?? result.isbn })
          }
          results={q.data}
          books={books}
          renderActions={(r) => <ResultActions result={r} />}
        />
      )}
    </div>
  )
}

function DiscoverCatalog() {
  const voice = useVoice()
  const search = discoverRoute.useSearch()
  const navigate = useNavigate()
  const genre = search.genre ?? ''
  const { data: books } = useBooks()
  const owned = ownedKeys(books ?? [])
  const [preview, setPreview] = useState<DiscoverHit | null>(null)
  // Seeded from the param, so a restored URL repopulates the box rather than only filtering.
  const [query, setQuery] = useState(search.query ?? '')
  const debounced = useDebouncedValue(query, 400)
  const searching = debounced.trim().length >= 3
  // Reuses the EXISTING 400ms debounce rather than starting a second timer: two timers over one
  // input can disagree, and the URL would then describe a search the screen is not running.
  // `genre` is spread through so writing one param never drops the other.
  useEffect(() => {
    void navigate({
      to: '/discover',
      search: { ...search, query: debounced.trim() ? debounced : undefined },
      replace: true,
    })
  }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps -- `search`/`navigate` are new objects each render; depending on them re-fires this on every navigation it causes.

  const q = useQuery({
    queryKey: ['discover', genreKey(genre)],
    queryFn: ({ signal }) => fetchDiscover(genre, signal),
    enabled: Boolean(genre),
    staleTime: 1000 * 60 * 60 * 6, // a browse shelf, not a feed — a handful of calls per session
    retry: 1,
  })

  // The pool, the reader's filter over it, and which slice of it is on screen.
  //
  // batchIndex resets to 0 whenever the GENRE or the TOGGLE changes, because both change how many
  // batches exist: sitting on batch 2 of a three-batch shelf and then hiding your library can leave
  // you pointing past the end of a one-batch list. batchOf wraps rather than returning empty, so
  // this is belt-and-braces — but landing a reader mid-shelf after they changed the shelf is the
  // wrong answer even when it renders.
  const [hideImported, setHideImported] = useState(false)
  const gkey = genreKey(genre)
  // Corpus filter row — its own text inputs, NOT the big search box above: that box replaces the
  // whole rail with SearchSection (external + library) when active, and the catalog filter must
  // narrow the shelf in place instead of navigating away from it.
  const [corpusQ, setCorpusQ] = useState('')
  const [corpusTag, setCorpusTag] = useState('')
  const corpusQDebounced = useDebouncedValue(corpusQ, 400)
  const corpus = useWorksBrowse({ genre: gkey, tag: corpusTag.trim(), q: corpusQDebounced })
  const corpusHits = (corpus.data?.pages ?? []).flat().map((work) => workToHit(work))
  const corpusVisible = hideImported ? corpusHits.filter((h) => !isOwned(h, owned)) : corpusHits
  const [batchIndex, setBatchIndex] = useState(0)
  useEffect(() => setBatchIndex(0), [gkey, hideImported])

  const visible = useMemo(
    () => visibleHits(q.data ?? [], owned, hideImported),
    // `owned` is rebuilt every render from useBooks; key on the library's identity instead so this
    // does not recompute on every keystroke in the search box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q.data, books, hideImported],
  )
  const batches = batchCount(visible)
  const batch = useMemo(() => batchOf(visible, batchIndex), [visible, batchIndex])

  // Tier 2b: score the shelf against the reader's taste centroid. Unavailability (cold start /
  // fn down / budget cut) is thrown, NOT returned — returned null would be cached as data for
  // hours and keep hiding taste after the fn recovers. Errors stay silent (catalog order) and
  // retry on the next visit; taste is an enhancement, never a gate.
  //
  // Scoped to the CURRENT BATCH, not the pool: the promise this feature makes is about the shelf in
  // front of the reader, and ranking 60 to show 20 would spend the embed budget on 40 they may
  // never see. The key already carries the batch's hit keys, so each batch's scores cache on first
  // view and cycling back is free.
  const rank = useQuery({
    queryKey: ['discover-rank', genreKey(genre), batch.map(hitKey).join('|')],
    queryFn: async () => {
      const scores = await rankHitsByTaste(batch, genre)
      if (!scores) throw new Error('taste unavailable')
      return scores
    },
    enabled: batch.length > 0,
    staleTime: 1000 * 60 * 60 * 6,
    retry: 0,
  })
  // The reader's fixed display anchors — one fetch, shared by every card (TanStack dedupes the key).
  const { data: anchors } = useTasteCalibration()
  const ordered = batch.length
    ? rank.data
      ? sortByTaste(batch, rank.data)
      : batch.map((hit) => ({ hit }) as { hit: DiscoverHit; taste?: number })
    : []

  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <h1
        className="text-[clamp(30px,4vw,44px)] leading-[1.2] text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        Discover
      </h1>
      <p className="mb-6 mt-3 max-w-[65ch] text-base leading-relaxed text-muted">
        Find a book you want to spend time with. Open a cover, read a little about it, then decide
        whether to make room on your shelf.
      </p>

      {/* Search the wider catalog — title, author, or ISBN. An active query replaces the browse rail
          below; clearing it restores the rail intact (task §4). */}
      <div className="mb-5">
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, author, or ISBN…"
            aria-label="Search the wider catalog"
            className="h-11 w-full skin-card border border-line pl-10 pr-14 text-[14px] text-ink outline-none"
            style={{ background: 'var(--field)' }}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-muted"
          >
            ⌕
          </span>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="skin-control absolute right-0 top-1/2 h-11 w-11 -translate-y-1/2 text-[13px] text-muted hover:text-ink"
            >
              ✕
            </button>
          )}
        </div>
        {query.trim().length > 0 && query.trim().length < 3 && (
          <p className="mt-1.5 text-[12px] text-muted">
            Keep typing — search starts at three letters.
          </p>
        )}
      </div>

      {/* ── search results (query active) ── */}
      {searching && <SearchSection query={debounced} books={books ?? []} onOpen={setPreview} />}

      {/* ── the taste-ranked browse rail (empty search) ── */}
      {!searching && (
        <>
          <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Browse a genre">
            <Chip
              active={!genre}
              onClick={() =>
                void navigate({
                  to: '/discover',
                  search: { ...search, browse: true, genre: undefined },
                  replace: true,
                })
              }
            >
              All genres
            </Chip>
            {GENRES.map((g) => (
              <Chip
                key={g.key}
                active={g.key === genreKey(genre)}
                onClick={() =>
                  void navigate({
                    to: '/discover',
                    search: { ...search, browse: true, genre: g.key },
                    replace: true,
                  })
                }
              >
                {g.label}
              </Chip>
            ))}
          </div>

          {/* ── the corpus browse — LEADS. A growing shared catalog: "show more" APPENDS the next
              twenty (useInfiniteQuery), deliberately unlike the external shelf's batchOf() below,
              which CYCLES a fixed cached pool and replaces twenty with the next twenty. Same page
              size, opposite accumulation; both sit on this screen, so the difference is stated. */}
          <section aria-label="Browse the catalog" className="mb-8">
            <h2 className="mb-2 text-xl font-semibold leading-snug text-ink">The shared shelves</h2>
            <p className="mb-4 text-sm leading-relaxed text-muted">
              Browse what’s here, or search above for a particular book. Your own books are marked
              so you can return to them.
            </p>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={corpusQ}
                onChange={(e) => setCorpusQ(e.target.value)}
                placeholder="Filter the catalog — title or author…"
                aria-label="Filter the catalog by title or author"
                data-testid="corpus-filter"
                className="skin-field min-h-11 min-w-[180px] flex-1 border border-line px-3 text-[13px] text-ink outline-none"
                style={{ background: 'var(--field)' }}
              />
              <input
                type="text"
                value={corpusTag}
                onChange={(e) => setCorpusTag(e.target.value)}
                placeholder="Tag…"
                aria-label="Filter the catalog by tag"
                data-testid="corpus-tag-filter"
                className="skin-field min-h-11 w-32 border border-line px-3 text-[13px] text-ink outline-none"
                style={{ background: 'var(--field)' }}
              />
              <Chip
                active={hideImported}
                onClick={() => setHideImported((v) => !v)}
                title="Hide books already in your library"
              >
                Hide what I have
              </Chip>
            </div>

            {corpus.isPending && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
                {Array.from({ length: 8 }, (_, i) => (
                  <div key={i} className="flex flex-col gap-2">
                    <div
                      className="aspect-[2/3] rounded-[8px] border border-line"
                      style={{ background: 'var(--card)' }}
                    />
                    <div className="h-3 w-3/4 rounded" style={{ background: 'var(--card)' }} />
                  </div>
                ))}
              </div>
            )}

            {corpus.isError && (
              <div
                role="alert"
                className="mb-4 rounded-[var(--radius-card)] border border-line bg-card p-4 text-sm text-muted"
              >
                <p>The shared catalog couldn’t be loaded.</p>
                <button
                  className="min-h-11 text-ink underline"
                  onClick={() => void corpus.refetch()}
                >
                  Try again
                </button>
              </div>
            )}
            {corpus.isSuccess && corpusVisible.length === 0 && (
              <p
                className="px-2 py-8 text-center text-[13.5px] text-muted"
                data-testid="corpus-empty"
              >
                {corpusHits.length > 0
                  ? 'Everything here is already on your shelf.'
                  : 'The catalog has nothing for this filter yet — it fills in as libraries are shared.'}
              </p>
            )}

            {(corpusVisible.length > 0 || corpus.hasNextPage) && (
              <>
                <div
                  className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
                  data-testid="corpus-grid"
                >
                  {corpusVisible.map((h) => (
                    <Card
                      key={`${h.title}|${h.authors[0] ?? ''}`}
                      hit={h}
                      onOpen={() => setPreview(h)}
                      owned={isOwned(h, owned)}
                    />
                  ))}
                </div>
                {corpus.hasNextPage && (
                  <div className="mt-4 text-center">
                    <button
                      type="button"
                      data-testid="corpus-show-more"
                      onClick={() => void corpus.fetchNextPage()}
                      disabled={corpus.isFetchingNextPage}
                      className="skin-control border border-line px-5 py-2 text-[13px] font-semibold text-ink disabled:opacity-50"
                      style={{ background: 'var(--chip)' }}
                    >
                      {corpus.isFetchingNextPage ? 'Fetching…' : 'Show more'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>

          {!genre ? (
            <p className="text-[14px] text-muted">
              Choose a genre to see new and notable books from the wider shelves.
            </p>
          ) : (
            <>
              {/* ── the external shelf — secondary now that the corpus leads ── */}
              <h2 className="skin-label mb-3 text-[12px] uppercase tracking-[0.18em] text-muted">
                New and notable from the wider shelves
              </h2>

              {q.isPending && (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <div
                        className="aspect-[2/3] rounded-[8px] border border-line"
                        style={{ background: 'var(--card)' }}
                      />
                      <div className="h-3 w-3/4 rounded" style={{ background: 'var(--card)' }} />
                      <div className="h-3 w-1/2 rounded" style={{ background: 'var(--card)' }} />
                    </div>
                  ))}
                </div>
              )}

              {q.isError && (
                <Surface radius="card" tone="bare" pad={5} className="text-center">
                  <p className="text-[14px] text-ink">
                    The wider shelves aren’t answering right now.
                  </p>
                  <p className="mt-1 text-[12.5px] text-muted">
                    Usually a rate limit — it clears on its own.
                  </p>
                  <button
                    type="button"
                    onClick={() => void q.refetch()}
                    className="skin-control mt-3 border border-line px-4 py-1.5 text-[13px] font-semibold text-ink"
                    style={{ background: 'var(--chip)' }}
                  >
                    Try again
                  </button>
                </Surface>
              )}

              {q.isSuccess && q.data.length === 0 && (
                <Surface radius="card" tone="bare" pad={5} className="text-center">
                  <p className="text-[14px] text-ink">{voice.miss}</p>
                  <p className="mt-1 text-[12.5px] text-muted">
                    Try another genre — the smaller shelves run thin some weeks.
                  </p>
                </Surface>
              )}

              {q.isSuccess && q.data.length > 0 && (
                <>
                  <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                    {/* the Hide-what-I-have chip lives in the corpus filter row above; one preference,
                    one control, both sections obey it */}
                    {/* Only offered when there IS another batch. A single-batch shelf — the curated
                    fn-down path, a thin genre, or an older deployed fn still returning 12 — shows
                    no control rather than a button that re-renders the same twenty. */}
                    {batches > 1 && (
                      <button
                        type="button"
                        data-testid="discover-new-batch"
                        onClick={() => setBatchIndex((i) => i + 1)}
                        className="skin-control-quiet border border-line px-3 py-1.5 text-[12.5px] text-ink"
                        style={{ background: 'var(--chip)' }}
                      >
                        New batch{' '}
                        <span className="skin-numeral text-muted">
                          {(batchIndex % batches) + 1}/{batches}
                        </span>
                      </button>
                    )}
                  </div>
                  {rank.data && (
                    <p className="mb-3 text-[12px] text-muted">
                      Closest to your taste first — learned from the books you love.
                    </p>
                  )}
                  {ordered.length === 0 ? (
                    // Reachable only with the toggle on: the pool had hits, the reader owns all of them.
                    <p
                      className="px-2 py-10 text-center text-[14px] text-muted"
                      data-testid="discover-all-owned"
                    >
                      You already have everything on this shelf. Turn off “Hide what I have” to see
                      it.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                      {ordered.map(({ hit: h, taste }) => (
                        <Card
                          key={`${h.isbn}|${h.title}`}
                          hit={h}
                          onOpen={() => setPreview(h)}
                          owned={isOwned(h, owned)}
                          taste={taste}
                          anchors={anchors}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          <p className="mt-6 text-[12px]" style={{ color: 'var(--faint, var(--muted))' }}>
            Sourced from the wider catalog — indie and KU releases can lag here. Your own shelves
            always know better.
          </p>
        </>
      )}
      {preview && (
        <DiscoverBookPreview
          hit={preview}
          book={
            (books ?? []).find(
              (book) => preview.corpusWorkId && book.corpusWorkId === preview.corpusWorkId,
            ) ??
            libraryMatch({ ...preview, source: 'google', year: preview.pub }, books ?? []) ??
            undefined
          }
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}

export function DiscoverScreen() {
  const search = discoverRoute.useSearch()
  return search.browse || search.genre || search.query ? (
    <>
      <div className="mx-auto max-w-5xl px-4 pt-6">
        <Link
          to="/discover"
          search={{}}
          className="inline-flex min-h-11 items-center text-sm text-ink underline"
        >
          ← Guided discovery
        </Link>
      </div>
      <DiscoverCatalog />
    </>
  ) : (
    <DiscoverExperience />
  )
}

export interface DiscoverSearch {
  genre?: string
  query?: string
  browse?: boolean
  saved?: boolean
  session?: string
  detail?: string
  find?: string
}
export const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'discover',
  component: DiscoverScreen,
  // Fails CLOSED for both params — a non-string (a doubled query string arrives as an array)
  // resolves to undefined rather than throwing the screen away.
  validateSearch: (s: Record<string, unknown>): DiscoverSearch => ({
    browse: s.browse === true || s.browse === 'true' ? true : undefined,
    saved: s.saved === true || s.saved === 'true' ? true : undefined,
    session:
      typeof s.session === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(s.session)
        ? s.session
        : undefined,
    detail: typeof s.detail === 'string' ? s.detail.slice(0, 1200) : undefined,
    find: typeof s.find === 'string' ? s.find.slice(0, 160) : undefined,
    genre: typeof s.genre === 'string' && s.genre.trim() ? genreKey(s.genre) : undefined,
    query: typeof s.query === 'string' && s.query.trim() ? s.query : undefined,
  }),
})
