import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CORE_GENRES,
  DISCOVERY_MOODS,
  coverStateSuffix,
  dedupeDiscoveryBooks,
  discoveryBookFromReader,
  discoveryIntentLabel,
  discoveryKey,
  discoveryLibraryMatch,
  discoveryRelationship,
  parseDiscoverySession,
  splitName,
  type Book,
  type DiscoveryBook,
  type DiscoveryIntent,
  type DiscoveryMood,
} from '@reverie/core'
import { useAuth } from '../../auth/AuthProvider'
import { useBooks } from '../../data/books'
import { useSearchEverywhere } from '../../data/search'
import { useWorksLookup, workToHit } from '../../data/works'
import { createDiscoverySession } from '../../data/discovery'
import {
  discoverySessionKey,
  useRemoveDiscovery,
  useSaveDiscovery,
  useSavedDiscoveries,
} from '../../data/discoverySessions'
import { supabase } from '../../lib/supabase'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import { discoverRoute, type DiscoverSearch } from '../../routes/DiscoverRoute'
import { Button } from '../Button'
import { CoverImage } from '../CoverImage'
import { BookStateMarks } from '../BookStateMarks'
import { DiscoverBookPreview } from '../DiscoverBookPreview'
import './discovery.css'
import { SeriesInvitation } from './SeriesInvitation'

const directions = [
  {
    id: 'anchor',
    glyph: 'book',
    title: 'More like a book I loved',
    text: 'Begin with a book that stayed with you. Follow a familiar thread.',
  },
  {
    id: 'mood',
    glyph: 'moon',
    title: 'Meet me in this mood',
    text: 'A little wonder. A quieter pace. Start with how you want to feel.',
  },
  {
    id: 'genre',
    glyph: 'compass',
    title: 'Somewhere a little different',
    text: 'Leave your usual shelf for a moment. See what calls to you.',
  },
] as const

function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = {
    book: 'M12 5C8 2 4 3 2 4v15c4-1 7 0 10 2m0-16c4-3 8-2 10-1v15c-4-1-7 0-10 2V5',
    moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',
    compass: 'm16 8-3 5-5 3 3-5 5-3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    search: 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  }
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name] ?? paths.book} />
    </svg>
  )
}
function Cover({
  book,
  personal,
  small = false,
}: {
  book: DiscoveryBook
  personal?: Book
  small?: boolean
}) {
  const { first, last } = splitName(book.authors[0] ?? '')
  return (
    <div className={`discovery-cover ${small ? 'small' : ''}`}>
      <CoverImage
        book={{ title: book.title, first, last, cover: book.cover, coverThumb: book.coverThumb }}
        thumb={small}
      />
      {personal && (
        <BookStateMarks book={personal} density={small ? 'thumb' : 'cover'} showRead={!small} />
      )}
    </div>
  )
}
const errorMessage = (error: unknown) =>
  error instanceof Error
    ? error.message
    : ((error as { message?: string })?.message ?? 'Something went wrong. Please try again.')

export function DiscoverExperience() {
  const { session } = useAuth()
  return <Experience key={session?.user.id ?? 'signed-out'} ownerId={session?.user.id ?? ''} />
}
function Experience({ ownerId }: { ownerId: string }) {
  const search = discoverRoute.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  const client = useQueryClient()
  const library = useBooks()
  const books = library.data ?? []
  const [direction, setDirection] = useState<DiscoveryIntent['kind']>('anchor')
  const [anchor, setAnchor] = useState<DiscoveryBook | null>(null)
  const [moods, setMoods] = useState<DiscoveryMood[]>(['Reflective'])
  const [genre, setGenre] = useState('Fantasy')
  const [query, setQuery] = useState(search.find ?? '')
  const [chooseAnchor, setChooseAnchor] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const controller = useRef<AbortController | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const searchField = useRef<HTMLInputElement>(null)
  const openedDetail = useRef<string | null>(null)
  const closingDetail = useRef(false)
  const detailScroll = useRef(new Map<string, { x: number; y: number }>())
  useEffect(
    () =>
      router.subscribe('onRendered', (event) => {
        if (
          event.fromLocation?.pathname !== '/discover' ||
          event.toLocation.pathname !== '/discover'
        )
          return
        const key =
          new URLSearchParams(event.toLocation.searchStr).get('detail') ??
          new URLSearchParams(event.fromLocation.searchStr).get('detail')
        const position = typeof key === 'string' ? detailScroll.current.get(key) : undefined
        // Detail overlays are the same page. Restore the position captured on the actual click,
        // after the router's normal page restoration, including immediate Back after a scroll.
        if (position) window.scrollTo({ left: position.x, top: position.y, behavior: 'instant' })
      }),
    [router],
  )
  useEffect(() => {
    closingDetail.current = false
  }, [search.detail])
  const debounced = useDebouncedValue(query, 400)
  const searching = debounced.trim().length >= 3
  const external = useSearchEverywhere(searching ? debounced : '')
  const corpus = useWorksLookup(searching ? debounced : '')
  const saved = useSavedDiscoveries()
  const save = useSaveDiscovery()
  const remove = useRemoveDiscovery()
  const shortlist = useQuery({
    queryKey: discoverySessionKey(ownerId, search.session ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('discovery_sessions')
        .select('document')
        .eq('owner_id', ownerId)
        .eq('id', search.session!)
        .maybeSingle()
      if (error) throw error
      const value = parseDiscoverySession(data?.document)
      if (!value)
        throw new Error(
          'This shortlist is no longer available on this device or in your saved shortlists.',
        )
      return value
    },
    enabled: !!ownerId && !!search.session,
    staleTime: Infinity,
    gcTime: 24 * 60 * 60 * 1000,
    retry: false,
  })
  const current = search.session ? shortlist.data : undefined
  const preview = useQuery<DiscoveryBook | null>({
    queryKey: ['discovery-preview', ownerId, search.detail ?? ''],
    queryFn: () => null,
    enabled: false,
    gcTime: 24 * 60 * 60 * 1000,
  })
  const detail = search.detail
    ? (current?.picks.find((p) => discoveryKey(p.book) === search.detail)?.book ?? preview.data)
    : null
  const favourites = books
    .filter((book) => book.fave || book.rating >= 4)
    .slice(0, 3)
    .map(discoveryBookFromReader)
  const selectedAnchor = anchor ?? favourites[0]
  const hits = dedupeDiscoveryBooks([
    ...(corpus.data ?? []).map((work) => workToHit(work)),
    ...(external.data ?? []).map((hit) => ({
      title: hit.title,
      authors: hit.authors,
      isbn: hit.isbn13 || hit.isbn || '',
      cover: hit.cover,
      pub: hit.year,
      catalogSource: 'catalog' as const,
    })),
  ]).slice(0, 20)
  const activeIntent: DiscoveryIntent | null =
    direction === 'anchor'
      ? selectedAnchor
        ? { kind: 'anchor', anchor: selectedAnchor }
        : null
      : direction === 'mood'
        ? moods.length
          ? { kind: 'mood', moods }
          : null
        : { kind: 'genre', genre: genre.toLowerCase() }
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => {
    if (search.find !== undefined && search.find !== query) setQuery(search.find)
  }, [search.find]) // eslint-disable-line react-hooks/exhaustive-deps -- Browser history restores the field; typing has its own debounce.
  useEffect(() => {
    if ((search.find ?? '') === debounced.trim()) return
    void navigate({
      to: '/discover',
      search: { ...search, find: debounced.trim() || undefined },
      replace: true,
      resetScroll: false,
    })
  }, [debounced]) // eslint-disable-line react-hooks/exhaustive-deps -- Only a settled keystroke writes the query.

  const cancelPending = () => {
    controller.current?.abort()
    setBusy(false)
  }
  const routeTo = (next: DiscoverSearch) => {
    controller.current?.abort()
    setBusy(false)
    setError('')
    setQuery('')
    setNotice('')
    void navigate({ to: '/discover', search: next, resetScroll: false })
  }
  const open = (book: DiscoveryBook) => {
    const key = discoveryKey(book)
    detailScroll.current.set(key, { x: window.scrollX, y: window.scrollY })
    client.setQueryData(['discovery-preview', ownerId, key], book)
    closingDetail.current = false
    openedDetail.current = key
    void navigate({ to: '/discover', search: { ...search, detail: key }, resetScroll: false })
  }
  const close = () => {
    if (closingDetail.current) return
    closingDetail.current = true
    if (openedDetail.current === search.detail) {
      openedDetail.current = null
      window.history.back()
    } else
      void navigate({
        to: '/discover',
        search: { ...search, detail: undefined },
        replace: true,
        resetScroll: false,
      })
  }
  const begin = async () => {
    if (!activeIntent || !library.data || busy) return
    controller.current?.abort()
    const operation = new AbortController()
    controller.current = operation
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await createDiscoverySession(activeIntent, books, operation.signal)
      if (operation.signal.aborted) return
      client.setQueryData(discoverySessionKey(ownerId, result.id), result)
      setQuery('')
      await navigate({ to: '/discover', search: { session: result.id }, resetScroll: false })
      requestAnimationFrame(() => {
        heading.current?.focus({ preventScroll: true })
        heading.current?.scrollIntoView({ block: 'start', behavior: 'auto' })
      })
    } catch (e) {
      if (!operation.signal.aborted) setError(errorMessage(e))
    } finally {
      if (controller.current === operation) setBusy(false)
    }
  }
  const dismiss = (key: string, undo = false) => {
    if (!current) return
    client.setQueryData(discoverySessionKey(ownerId, current.id), {
      ...current,
      dismissed: undo
        ? current.dismissed.filter((k) => k !== key)
        : [...new Set([...current.dismissed, key])],
    })
    setNotice(
      undo
        ? 'Book returned to this shortlist.'
        : 'Set aside for this shortlist. You can undo it here.',
    )
  }
  const keep = async () => {
    if (!current) return
    try {
      await save.mutateAsync(current)
      setNotice('Shortlist saved. Its books stay separate from your library until you add them.')
    } catch (e) {
      setNotice(errorMessage(e))
    }
  }
  const showingSaved = search.saved === true
  const isSaved = current && saved.data?.some((s) => s.id === current.id)
  return (
    <section className="discover-experience">
      <header className="discovery-header">
        <div>
          <p className="discovery-eyebrow">Beyond your own shelves</p>
          <h1>Find a book to get lost in.</h1>
          <p>
            A familiar feeling, a passing mood, a door you haven’t opened. Where shall we begin?
          </p>
        </div>
        <Button variant="secondary" onClick={() => routeTo({ saved: true })}>
          Saved shortlists{saved.data?.length ? ` (${saved.data.length})` : ''}
        </Button>
      </header>
      <div className="discovery-search">
        <Glyph name="search" />
        <label className="sr-only" htmlFor="discovery-search">
          Search by title, author, or ISBN
        </label>
        <input
          ref={searchField}
          id="discovery-search"
          value={query}
          maxLength={160}
          placeholder={
            chooseAnchor
              ? 'Find a book to start from…'
              : 'Already have a book in mind? Title, author, or ISBN'
          }
          onChange={(e) => {
            cancelPending()
            setQuery(e.target.value)
          }}
        />
        {query && (
          <Button
            variant="ghost"
            aria-label="Clear search"
            onClick={() => {
              setQuery('')
              setChooseAnchor(false)
            }}
          >
            Clear
          </Button>
        )}
      </div>
      {notice && (
        <p className="discovery-notice" role="status">
          {notice}
        </p>
      )}
      {library.isError && (
        <p role="alert" className="discovery-notice">
          Your library couldn’t be loaded.{' '}
          <button className="discovery-text-action" onClick={() => void library.refetch()}>
            Try again
          </button>
        </p>
      )}
      {searching ? (
        <section aria-label="Catalog search results">
          <div className="discovery-results-heading">
            <div>
              <h2>Results for “{debounced}”</h2>
              <p>
                {chooseAnchor
                  ? 'Choose the book you want to start from.'
                  : 'Open a book to read a little more.'}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                setQuery('')
                setChooseAnchor(false)
              }}
            >
              Return to Discover
            </Button>
          </div>
          {(external.isFetching || corpus.isFetching) && (
            <p role="status">Looking through the catalog…</p>
          )}
          {(external.isError || corpus.error) && (
            <p role="alert">
              Part of the catalog couldn’t be reached.{' '}
              <button
                className="discovery-text-action"
                onClick={() => {
                  void external.refetch()
                  void corpus.refetch()
                }}
              >
                Try again
              </button>
            </p>
          )}
          <div className="discovery-search-results">
            {hits.map((book) => {
              const personal = discoveryLibraryMatch(book, books)
              return (
                <article key={discoveryKey(book)} className="discovery-search-result">
                  <button
                    onClick={() => open(book)}
                    aria-label={`View details for ${book.title}${personal ? coverStateSuffix(personal) : ''}`}
                  >
                    <Cover book={book} personal={personal} small />
                  </button>
                  <div>
                    <button className="discovery-title-button" onClick={() => open(book)}>
                      {book.title}
                    </button>
                    <p>{book.authors.join(', ')}</p>
                    <p>{discoveryRelationship(personal)}</p>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setAnchor(book)
                      setDirection('anchor')
                      setQuery('')
                      setChooseAnchor(false)
                      routeTo({})
                    }}
                  >
                    Start from this book
                  </Button>
                </article>
              )
            })}
          </div>
          {!hits.length && !external.isFetching && !corpus.isFetching && (
            <p className="discovery-empty">No books found yet. Try the full title or its ISBN.</p>
          )}
        </section>
      ) : showingSaved ? (
        <section aria-label="Saved shortlists">
          <button className="discovery-text-action" onClick={() => routeTo({})}>
            ← Find something new
          </button>
          <h2 className="discovery-section-title">A thought for another day.</h2>
          <p className="discovery-muted">
            Saved shortlists keep their order and reasons. They don’t add books to your library.
          </p>
          {saved.isPending && <p role="status">Opening your saved shortlists…</p>}
          {saved.isError && (
            <p role="alert" className="discovery-empty">
              Your saved shortlists couldn’t be loaded.{' '}
              <button className="discovery-text-action" onClick={() => void saved.refetch()}>
                Try again
              </button>
            </p>
          )}
          {saved.data?.length === 0 && (
            <p className="discovery-empty">
              When a few books catch your attention, save the shortlist here and come back whenever
              you like.
            </p>
          )}
          <div className="discovery-saved-list">
            {saved.data?.map((item) => (
              <article key={item.id}>
                <div className="discovery-saved-covers">
                  {item.picks.slice(0, 3).map((pick) => (
                    <Cover
                      key={discoveryKey(pick.book)}
                      book={pick.book}
                      personal={discoveryLibraryMatch(pick.book, books)}
                      small
                    />
                  ))}
                </div>
                <div>
                  <h3>{discoveryIntentLabel(item.intent)}</h3>
                  <p>
                    {item.picks.length} books · {new Date(item.createdAt).toLocaleDateString()}
                  </p>
                  <button
                    className="discovery-text-action"
                    onClick={() => {
                      client.setQueryData(discoverySessionKey(ownerId, item.id), item)
                      routeTo({ session: item.id })
                    }}
                  >
                    Return to these books
                  </button>
                </div>
                <Button
                  variant="ghost"
                  disabled={remove.isPending}
                  aria-label={`Remove shortlist ${discoveryIntentLabel(item.intent)}`}
                  onClick={() => {
                    void remove
                      .mutateAsync(item.id)
                      .then(() => setNotice('Shortlist removed. Your books haven’t changed.'))
                      .catch((e) => setNotice(errorMessage(e)))
                  }}
                >
                  Remove
                </Button>
              </article>
            ))}
          </div>
        </section>
      ) : search.session ? (
        <section aria-label="Discovery results">
          <div className="discovery-results-heading">
            <div>
              <button className="discovery-text-action" onClick={() => routeTo({})}>
                ← Change direction
              </button>
              <h2 ref={heading} tabIndex={-1}>
                A few books to sit with.
              </h2>
              <p>{current ? discoveryIntentLabel(current.intent) : 'Opening your shortlist…'}</p>
            </div>
            {current?.picks.some((p) => !current.dismissed.includes(discoveryKey(p.book))) && (
              <Button variant="secondary" disabled={save.isPending} onClick={() => void keep()}>
                {save.isPending ? 'Saving…' : isSaved ? 'Update saved shortlist' : 'Save shortlist'}
              </Button>
            )}
          </div>
          {shortlist.isError && (
            <div className="discovery-empty" role="alert">
              <p>{errorMessage(shortlist.error)}</p>
              <Button variant="secondary" onClick={() => routeTo({})}>
                Choose a new direction
              </Button>
            </div>
          )}
          {current?.picks.length === 0 && (
            <div className="discovery-empty">
              <h3>Nothing quite right, yet.</h3>
              <p>
                The catalog doesn’t have enough evidence for this combination. Try a different
                starting book, one mood, or another genre.
              </p>
              <Button variant="secondary" onClick={() => routeTo({})}>
                Adjust your starting point
              </Button>
            </div>
          )}
          {!!current?.picks.length && current.picks.length < 5 && (
            <p className="discovery-muted">
              {current.picks.length} books with a clear connection. A small shortlist is enough.
            </p>
          )}
          <div className="discovery-shortlist">
            {current?.picks.map((pick, index) => {
              const key = discoveryKey(pick.book)
              const personal = discoveryLibraryMatch(pick.book, books)
              return (
                <article
                  className={`discovery-recommendation ${current.dismissed.includes(key) ? 'set-aside' : ''}`}
                  key={key}
                >
                  {current.dismissed.includes(key) ? (
                    <>
                      <p className="discovery-eyebrow">Set aside</p>
                      <h3>{pick.book.title}</h3>
                      <p>Just for this shortlist.</p>
                      <Button variant="secondary" onClick={() => dismiss(key, true)}>
                        Undo
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="discovery-book-number">
                        <span>0{index + 1}</span>
                        <span>{discoveryRelationship(personal)}</span>
                      </div>
                      <button
                        className="discovery-open-cover"
                        aria-label={`View details for ${pick.book.title}${
                          personal ? coverStateSuffix(personal) : ''
                        }`}
                        onClick={() => open(pick.book)}
                      >
                        <Cover book={pick.book} personal={personal} />
                      </button>
                      <p className="discovery-eyebrow">
                        {pick.book.genre || pick.book.genres?.[0] || 'A book to explore'}
                      </p>
                      <h3>
                        <button onClick={() => open(pick.book)}>{pick.book.title}</button>
                      </h3>
                      <p className="discovery-author">
                        {pick.book.authors.join(', ') || 'Author not listed'}
                      </p>
                      <p className="discovery-reason">{pick.reason}</p>
                      <div className="discovery-book-actions">
                        <Button variant="secondary" onClick={() => open(pick.book)}>
                          Read a little more
                        </Button>
                        <button
                          className="discovery-text-action"
                          aria-label={`Not this time: ${pick.book.title}`}
                          onClick={() => dismiss(key)}
                        >
                          Not this time
                        </button>
                      </div>
                    </>
                  )}
                </article>
              )
            })}
          </div>
        </section>
      ) : (
        <>
          <div className="discovery-directions" aria-label="Ways to discover">
            {directions.map((item, index) => (
              <button
                key={item.id}
                className={`discovery-direction skin-card ${direction === item.id ? 'selected' : ''}`}
                aria-pressed={direction === item.id}
                onClick={() => {
                  cancelPending()
                  setDirection(item.id)
                }}
              >
                <span className="discovery-direction-top">
                  <Glyph name={item.glyph} />
                  <span>0{index + 1}</span>
                </span>
                <h2>{item.title}</h2>
                <p>{item.text}</p>
                <span className="discovery-direction-indicator">
                  {direction === item.id ? 'Your starting point' : 'Explore this way'}
                  <span aria-hidden="true">{direction === item.id ? '✓' : '→'}</span>
                </span>
              </button>
            ))}
          </div>
          <section className="discovery-selection skin-panel" aria-label="Set your starting point">
            <div>
              <p className="discovery-eyebrow">
                {direction === 'anchor'
                  ? 'A familiar place to begin'
                  : direction === 'mood'
                    ? 'How do you want to feel?'
                    : 'Follow your curiosity'}
              </p>
              <h2>
                {direction === 'anchor'
                  ? 'Which book stayed with you?'
                  : direction === 'mood'
                    ? 'What are you in the mood for?'
                    : 'Which shelf calls to you?'}
              </h2>
              <p>
                {direction === 'anchor'
                  ? 'Choose a starting book. It doesn’t have to be one you own.'
                  : direction === 'mood'
                    ? 'Choose one or two. A mood is an invitation, not a promise.'
                    : 'Choose a genre to explore. Your room and your reading tastes are yours to change separately.'}
              </p>
            </div>
            <div className="discovery-controls">
              {direction === 'anchor' ? (
                <>
                  <div className="discovery-anchor-list">
                    {dedupeDiscoveryBooks([...(anchor ? [anchor] : []), ...favourites])
                      .slice(0, 3)
                      .map((book) => {
                        const personal = discoveryLibraryMatch(book, books)
                        return (
                          <button
                            key={discoveryKey(book)}
                            aria-label={`Choose ${book.title}${
                              personal ? coverStateSuffix(personal) : ''
                            }`}
                            aria-pressed={
                              !!selectedAnchor &&
                              discoveryKey(selectedAnchor) === discoveryKey(book)
                            }
                            onClick={() => {
                              cancelPending()
                              setAnchor(book)
                            }}
                            className="discovery-anchor-choice skin-card"
                          >
                            <Cover book={book} personal={personal} small />
                            <span>
                              <strong>{book.title}</strong>
                              <span>{book.authors.join(', ')}</span>
                            </span>
                            <span aria-hidden="true">
                              {selectedAnchor && discoveryKey(selectedAnchor) === discoveryKey(book)
                                ? '✓'
                                : '○'}
                            </span>
                          </button>
                        )
                      })}
                  </div>
                  <button
                    className="discovery-text-action"
                    onClick={() => {
                      setChooseAnchor(true)
                      searchField.current?.focus({ preventScroll: true })
                      searchField.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
                    }}
                  >
                    {favourites.length || anchor ? 'Choose another book' : 'Find a book you know'}
                  </button>
                </>
              ) : direction === 'mood' ? (
                <div className="discovery-options">
                  {DISCOVERY_MOODS.map((mood) => (
                    <Button
                      key={mood}
                      variant={moods.includes(mood) ? 'primary' : 'secondary'}
                      aria-pressed={moods.includes(mood)}
                      onClick={() => {
                        cancelPending()
                        if (moods.includes(mood)) setMoods(moods.filter((m) => m !== mood))
                        else if (moods.length < 2) setMoods([...moods, mood])
                        else setNotice('Choose up to two moods. Deselect one to try another.')
                      }}
                    >
                      {mood}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="discovery-options">
                  {CORE_GENRES.map((g) => (
                    <Button
                      key={g}
                      variant={genre === g ? 'primary' : 'secondary'}
                      aria-pressed={genre === g}
                      onClick={() => {
                        cancelPending()
                        setGenre(g)
                      }}
                    >
                      {g}
                    </Button>
                  ))}
                </div>
              )}
              <div className="discovery-begin">
                <Button
                  disabled={!activeIntent || !library.data || busy}
                  onClick={() => void begin()}
                >
                  {busy ? 'Finding a few books…' : 'Find a few books'}
                </Button>
                {busy && (
                  <Button variant="ghost" onClick={cancelPending}>
                    Cancel
                  </Button>
                )}
                <span>
                  A small shortlist.
                  <br />
                  Room to decide.
                </span>
              </div>
              {busy && <p role="status">Following the thread through the catalog…</p>}
              {error && (
                <p role="alert">
                  {error}{' '}
                  <button className="discovery-text-action" onClick={() => void begin()}>
                    Try again
                  </button>
                </p>
              )}
            </div>
          </section>
          <SeriesInvitation onOpen={open} />
          <div className="discovery-footer">
            <p>Looking for a book already on your shelves?</p>
            <Link to="/match" className="discovery-text-action">
              Find your next read →
            </Link>
            <Link to="/discover" search={{ browse: true }} className="discovery-text-action">
              Browse the whole catalog →
            </Link>
          </div>
        </>
      )}
      {detail && (
        <DiscoverBookPreview
          hit={detail}
          book={discoveryLibraryMatch(detail, books)}
          reason={current?.picks.find((p) => discoveryKey(p.book) === search.detail)?.reason}
          discoverSession={current?.id}
          onClose={close}
        />
      )}
      {search.detail && !detail && (
        <p role="status">
          This preview is no longer available.{' '}
          <button className="discovery-text-action" onClick={close}>
            Return to the shortlist
          </button>
        </p>
      )}
    </section>
  )
}
