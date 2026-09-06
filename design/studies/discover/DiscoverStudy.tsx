import { useEffect, useRef, useState } from 'react'
import { SKINS, SKIN_ORDER, type SkinId } from '@reverie/core'
import { Button } from '../../../apps/web/src/components/Button'
import { Modal } from '../../../apps/web/src/components/Modal'
import { ReverieMark } from '../../../apps/web/src/components/ReverieMark'
import { SkinAtmosphereCanvas } from '../../../apps/web/src/components/SkinAtmosphereCanvas'
import { loadSkinFont } from '../../../apps/web/src/skin/fonts'
import specificationUrl from './DISCOVER_READING_DECISION.md?url'
import {
  anchors,
  books,
  directions,
  moods,
  reasonFor,
  selectBooks,
  type Direction,
  type StudyBook,
} from './catalog'

type Scenario = 'returning' | 'new' | 'empty' | 'unavailable' | 'series'
type Screen = 'choose' | 'results' | 'search'
type Copy = { wishlist?: boolean; owned?: boolean; borrowed?: boolean }
type Session = {
  direction: Direction
  anchor: string
  moods: string[]
  genre: string
  ids: string[]
}

function Glyph({ name }: { name: string }) {
  const paths: Record<string, string> = {
    book: 'M12 5C8 2 4 3 2 4v15c4-1 7 0 10 2m0-16c4-3 8-2 10-1v15c-4-1-7 0-10 2V5',
    moon: 'M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z',
    compass: 'm16 8-3 5-5 3 3-5 5-3M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    search: 'M20 20l-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    bookmark: 'M6 3h12v18l-6-4-6 4V3',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
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
  small = false,
}: {
  book: { title: string; cover: string }
  small?: boolean
}) {
  const [failed, setFailed] = useState(false)
  return (
    <div className={`study-cover ${small ? 'small-cover' : ''}`}>
      {failed ? (
        <span className="cover-fallback">{book.title}</span>
      ) : (
        <img
          alt=""
          src={book.cover}
          onError={() => setFailed(true)}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
    </div>
  )
}

function relation(copy?: Copy) {
  const labels = [
    copy?.owned && 'Owned',
    copy?.borrowed && 'Borrowed',
    copy?.wishlist && 'On your wishlist',
  ].filter(Boolean)
  return labels.length ? labels.join(' · ') : 'New to your library'
}

export function DiscoverStudy() {
  const params = new URLSearchParams(location.search)
  const initialSkin = params.get('skin') as SkinId
  const [skin, setSkin] = useState<SkinId>(SKIN_ORDER.includes(initialSkin) ? initialSkin : 'folio')
  const [mode, setMode] = useState<'light' | 'dark'>(
    params.get('mode') === 'dark' ? 'dark' : 'light',
  )
  const [scenario, setScenario] = useState<Scenario>('returning')
  const [screen, setScreen] = useState<Screen>('choose')
  const [direction, setDirection] = useState<Direction>('anchor')
  const [anchor, setAnchor] = useState('left-hand')
  const [chosenMoods, setChosenMoods] = useState<string[]>(['Reflective'])
  const [genre, setGenre] = useState('Fantasy')
  const [query, setQuery] = useState('')
  const [session, setSession] = useState<Session | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [copies, setCopies] = useState<Record<string, Copy>>({})
  const [detail, setDetail] = useState<string | null>(null)
  const [showSaved, setShowSaved] = useState(false)
  const [saved, setSaved] = useState<Session[]>([])
  const [notice, setNotice] = useState('')
  const heading = useRef<HTMLHeadingElement>(null)
  const detailRef = useRef<string | null>(null)

  useEffect(() => {
    document.documentElement.dataset.skin = skin
    document.documentElement.dataset.mode = mode
    loadSkinFont(skin)
    const url = new URL(location.href)
    url.searchParams.set('skin', skin)
    url.searchParams.set('mode', mode)
    history.replaceState(history.state, '', url)
  }, [skin, mode])

  useEffect(() => {
    history.replaceState({ study: true, screen: 'choose', session: null }, '')
    const back = (event: PopStateEvent) => {
      detailRef.current = event.state?.detail ?? null
      setDetail(event.state?.detail ?? null)
      setShowSaved(false)
      if (event.state?.study) {
        setScreen(event.state.screen)
        setSession(event.state.session)
        if (event.state.session) {
          setDirection(event.state.session.direction)
          setAnchor(event.state.session.anchor)
          setChosenMoods(event.state.session.moods)
          setGenre(event.state.session.genre)
        }
      }
    }
    window.addEventListener('popstate', back)
    return () => window.removeEventListener('popstate', back)
  }, [])

  const navigate = (next: Screen, nextSession = session) => {
    setScreen(next)
    setSession(nextSession)
    history.pushState({ study: true, screen: next, session: nextSession }, '')
    requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true })
      heading.current?.scrollIntoView({ block: 'start' })
    })
  }
  const openDetail = (id: string) => {
    detailRef.current = id
    setDetail(id)
    history.pushState({ study: true, screen, session, detail: id }, '')
  }
  const closeDetail = () => {
    if (detailRef.current) {
      detailRef.current = null
      setDetail(null)
      history.back()
    }
  }
  const begin = () => {
    const selected = selectBooks(direction, anchor, chosenMoods, genre).filter(
      (b) => scenario !== 'series' || b.id !== 'earthsea',
    )
    const next = {
      direction,
      anchor,
      moods: [...chosenMoods],
      genre,
      ids: selected.map((b) => b.id),
    }
    setDismissed([])
    setNotice('')
    navigate('results', next)
  }
  const chooseScenario = (value: Scenario) => {
    setScenario(value)
    setDismissed([])
    setQuery('')
    setAnchor('left-hand')
    setChosenMoods(['Reflective'])
    setGenre('Fantasy')
    setNotice('')
    setCopies(value === 'series' ? { earthsea: { owned: true } } : {})
    setSaved([])
    setShowSaved(false)
    setDetail(null)
    detailRef.current = null
    setSession(null)
    setScreen('choose')
    setDirection(value === 'new' ? 'mood' : 'anchor')
    history.replaceState({ study: true, screen: 'choose', session: null }, '')
  }
  const toggleMood = (mood: string) => {
    if (chosenMoods.includes(mood)) setChosenMoods(chosenMoods.filter((m) => m !== mood))
    else if (chosenMoods.length < 2) setChosenMoods([...chosenMoods, mood])
    else setNotice('Choose up to two moods. Remove one to try another.')
  }
  const setCopy = (id: string, kind: keyof Copy) => {
    setCopies((current) => ({ ...current, [id]: { ...current[id], [kind]: !current[id]?.[kind] } }))
    setNotice('Sample library updated. Your real library is unchanged.')
  }
  const candidates =
    screen === 'search'
      ? books.filter((b) =>
          `${b.title} ${b.author}`.toLowerCase().includes(query.trim().toLowerCase()),
        )
      : books.filter((b) => session?.ids.includes(b.id))
  const ordered =
    screen === 'results'
      ? (session?.ids ?? []).flatMap((id) => candidates.filter((b) => b.id === id))
      : candidates
  const resultCount =
    scenario === 'empty'
      ? 0
      : ordered.filter((b) => screen === 'search' || !dismissed.includes(b.id)).length
  const resultLabel = `${resultCount} ${resultCount === 1 ? 'book' : 'books'}`
  const chosenBook = books.find((b) => b.id === detail)
  const canStart = direction !== 'mood' || chosenMoods.length > 0
  const currentReason = (book: StudyBook) =>
    screen === 'search'
      ? 'Found in the sample catalog.'
      : reasonFor(
          book,
          session?.direction ?? direction,
          session?.anchor ?? anchor,
          session?.moods ?? chosenMoods,
          session?.genre ?? genre,
        )
  const visibleSession = session
    ? { ...session, ids: session.ids.filter((id) => !dismissed.includes(id)) }
    : null
  const isSaved =
    visibleSession && saved.some((s) => JSON.stringify(s) === JSON.stringify(visibleSession))

  return (
    <>
      <a className="study-skip" href="#discover-main">
        Skip to Discover
      </a>
      <div className="study-tools">
        <div className="study-caption">
          <strong>Discover</strong>
          <span>Interaction study · sample library · changes reset on refresh</span>
        </div>
        <div className="study-options">
          <label>
            Room
            <select value={skin} onChange={(e) => setSkin(e.target.value as SkinId)}>
              {SKIN_ORDER.map((id) => (
                <option key={id} value={id}>
                  {SKINS[id].label}
                </option>
              ))}
            </select>
          </label>
          <Button variant="secondary" onClick={() => setMode(mode === 'light' ? 'dark' : 'light')}>
            {mode === 'light' ? 'Try Night' : 'Try Day'}
          </Button>
          <label>
            Scenario
            <select value={scenario} onChange={(e) => chooseScenario(e.target.value as Scenario)}>
              <option value="returning">Returning reader</option>
              <option value="new">Empty library</option>
              <option value="empty">No good matches</option>
              <option value="unavailable">Catalog unavailable</option>
              <option value="series">Verified series gap</option>
            </select>
          </label>
          <Button variant="ghost" onClick={() => chooseScenario('returning')}>
            Reset sample
          </Button>
        </div>
      </div>

      <div className="study-atmosphere">
        <SkinAtmosphereCanvas skin={skin} mode={mode} />
      </div>
      <div className="discover-shell">
        <header className="study-app-header">
          <div className="study-wordmark">
            <ReverieMark />
            <span>Reverie</span>
          </div>
          <span className="library-caption">Your personal library</span>
          <Button variant="secondary" onClick={() => setShowSaved(true)}>
            <Glyph name="bookmark" />
            Saved here <span className="saved-count">{saved.length}</span>
          </Button>
        </header>
        <main id="discover-main" className="discover-main">
          <div className="discover-intro">
            <p className="eyebrow">A little beyond your shelves</p>
            <h1 ref={heading} tabIndex={-1}>
              Discover
            </h1>
            <p>
              Find a book you want to spend time with.
              <br className="desktop-break" /> Start with something you love, or follow a feeling.
            </p>
          </div>
          <form
            className="discover-search"
            onSubmit={(event) => {
              event.preventDefault()
              setNotice('')
              navigate('search')
            }}
          >
            <Glyph name="search" />
            <label className="sr-only" htmlFor="catalog-query">
              Search this sample catalog by title or author
            </label>
            <input
              id="catalog-query"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Have a book in mind? Search title or author"
            />
            <Button variant="secondary" type="submit">
              Search
            </Button>
          </form>

          {screen === 'choose' ? (
            <>
              <section className="directions" aria-label="Choose a way to discover">
                {directions.map((item, index) => (
                  <button
                    className={`direction skin-card ${direction === item.id ? 'selected' : ''}`}
                    aria-pressed={direction === item.id}
                    onClick={() => {
                      setDirection(item.id)
                      setNotice('')
                    }}
                    key={item.id}
                  >
                    <div className="direction-top">
                      <Glyph name={item.glyph} />
                      <span>0{index + 1}</span>
                    </div>
                    <h2>{item.title}</h2>
                    <p>{item.description}</p>
                    <span className="direction-indicator">
                      {direction === item.id ? 'Your starting point' : 'Explore this way'}{' '}
                      <span aria-hidden="true">{direction === item.id ? '✓' : '→'}</span>
                    </span>
                  </button>
                ))}
              </section>
              <section className="selection-panel skin-panel" aria-label="Set your starting point">
                <div className="selection-copy">
                  <span className="eyebrow">
                    {direction === 'anchor'
                      ? 'A familiar place to begin'
                      : direction === 'mood'
                        ? 'How do you want to feel?'
                        : 'Follow your curiosity'}
                  </span>
                  <h2>
                    {direction === 'anchor'
                      ? scenario === 'new'
                        ? 'A book you know is enough.'
                        : 'Which book stayed with you?'
                      : direction === 'mood'
                        ? 'What are you in the mood for?'
                        : 'Which shelf calls to you?'}
                  </h2>
                  <p>
                    {direction === 'anchor'
                      ? 'Choose a starting book. It doesn’t have to be one you own.'
                      : direction === 'mood'
                        ? 'Choose one or two. A mood is an invitation, not a promise.'
                        : 'Choose a genre to explore. You can always come back to familiar ground.'}
                  </p>
                </div>
                <div className="selection-controls">
                  {direction === 'anchor' ? (
                    <div className="anchor-list">
                      {anchors.map((a) => (
                        <button
                          key={a.id}
                          aria-pressed={anchor === a.id}
                          onClick={() => setAnchor(a.id)}
                          className={`anchor-choice skin-card ${anchor === a.id ? 'selected' : ''}`}
                        >
                          <Cover book={a} small />
                          <span>
                            <strong>{a.title}</strong>
                            <span>{a.author}</span>
                            <small>
                              {scenario !== 'new' && a.id === 'left-hand'
                                ? 'A favourite in your sample library'
                                : 'A starting book you can choose'}
                            </small>
                          </span>
                          <span aria-hidden="true" className="choice-check">
                            {anchor === a.id ? '✓' : '○'}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : direction === 'mood' ? (
                    <div className="mood-options">
                      {moods.map((m) => (
                        <Button
                          key={m}
                          variant={chosenMoods.includes(m) ? 'primary' : 'secondary'}
                          aria-pressed={chosenMoods.includes(m)}
                          onClick={() => toggleMood(m)}
                        >
                          {m}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <div className="mood-options">
                      {['Fantasy', 'Science fiction', 'Nonfiction'].map((g) => (
                        <Button
                          key={g}
                          variant={genre === g ? 'primary' : 'secondary'}
                          aria-pressed={genre === g}
                          onClick={() => setGenre(g)}
                        >
                          {g}
                        </Button>
                      ))}
                    </div>
                  )}
                  <div className="begin-row">
                    <Button disabled={!canStart} onClick={begin}>
                      Find a few books <Glyph name="arrow" />
                    </Button>
                    <span>
                      A small shortlist.
                      <br />
                      Room to decide.
                    </span>
                  </div>
                </div>
              </section>
              {scenario === 'series' ? (
                <section className="series-invitation skin-card">
                  <div>
                    <p className="eyebrow">A story you’ve started</p>
                    <h2>There’s more of Earthsea.</h2>
                    <p>You have A Wizard of Earthsea. The next book is The Tombs of Atuan.</p>
                  </div>
                  <Button variant="secondary" onClick={() => openDetail('tombs')}>
                    See the next book <Glyph name="arrow" />
                  </Button>
                </section>
              ) : null}
            </>
          ) : (
            <section aria-label="Discovery results" className="results-area">
              <div className="results-heading">
                <div>
                  <button className="text-action" onClick={() => navigate('choose')}>
                    ← Change direction
                  </button>
                  <h2>
                    {screen === 'search'
                      ? query.trim()
                        ? `Results for “${query.trim()}”`
                        : 'Browse the sample catalog'
                      : 'A few books to sit with.'}
                  </h2>
                  <p>
                    {screen !== 'search' && scenario !== 'unavailable' ? `${resultLabel} · ` : null}
                    {screen === 'search'
                      ? `${resultLabel} in this small sample catalog.`
                      : session?.direction === 'anchor'
                        ? `Starting from ${anchors.find((a) => a.id === session.anchor)?.title}.`
                        : session?.direction === 'mood'
                          ? session.moods.join(' + ')
                          : `A visit to ${session?.genre.toLowerCase()}.`}
                  </p>
                </div>
                {session &&
                screen === 'results' &&
                scenario !== 'empty' &&
                scenario !== 'unavailable' &&
                ordered.some((b) => !dismissed.includes(b.id)) ? (
                  <Button
                    variant="secondary"
                    disabled={Boolean(isSaved)}
                    onClick={() => {
                      setSaved([
                        ...saved,
                        { ...session, ids: session.ids.filter((id) => !dismissed.includes(id)) },
                      ])
                      setNotice(
                        'Shortlist saved here. Saving a shortlist doesn’t add its books to your library.',
                      )
                    }}
                  >
                    <Glyph name="bookmark" />
                    {isSaved ? 'Shortlist saved' : 'Save shortlist'}
                  </Button>
                ) : null}
              </div>
              {scenario === 'unavailable' ? (
                <div className="empty-panel skin-panel" role="status">
                  <Glyph name="book" />
                  <h3>The wider shelves are quiet for now.</h3>
                  <p>
                    The catalog couldn’t be reached. Your library and saved shortlists are still
                    here.
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setScenario('returning')
                      setNotice('The sample catalog is available again.')
                    }}
                  >
                    Try again
                  </Button>
                </div>
              ) : scenario === 'empty' || ordered.length === 0 ? (
                <div className="empty-panel skin-panel" role="status">
                  <Glyph name="compass" />
                  <h3>No good matches just yet.</h3>
                  <p>
                    {screen === 'search'
                      ? 'Try another title or author. This review catalog contains four sample books.'
                      : 'Try one mood or a different starting book. There’s room to choose when something fits.'}
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setScenario('returning')
                      navigate('choose')
                    }}
                  >
                    Adjust my starting point
                  </Button>
                </div>
              ) : (
                <div className="book-shortlist">
                  {ordered.map((book, index) => (
                    <article className="recommendation skin-card" key={book.id}>
                      {screen === 'results' && dismissed.includes(book.id) ? (
                        <div className="dismissed-card">
                          <Glyph name="book" />
                          <h3>Set aside for now.</h3>
                          <p>
                            {book.title} is out of this shortlist. Your taste and library are
                            unchanged.
                          </p>
                          <Button
                            variant="secondary"
                            onClick={() => setDismissed(dismissed.filter((id) => id !== book.id))}
                          >
                            Undo
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="book-number">
                            <span>0{index + 1}</span>
                            <span>{relation(copies[book.id])}</span>
                          </div>
                          <button
                            className="open-cover"
                            aria-label={`Read about ${book.title}`}
                            onClick={() => openDetail(book.id)}
                          >
                            <Cover book={book} />
                          </button>
                          <div className="book-copy">
                            <p className="book-genre">
                              {book.genre} · {book.year}
                            </p>
                            <h3>
                              <button onClick={() => openDetail(book.id)}>{book.title}</button>
                            </h3>
                            <p className="book-author">{book.author}</p>
                            <p className="book-description">{book.description}</p>
                          </div>
                          <div className="book-reason">
                            <Glyph name="compass" />
                            <p>{currentReason(book)}</p>
                          </div>
                          <div className="book-actions">
                            <Button onClick={() => openDetail(book.id)}>Read about it</Button>
                            {screen === 'results' ? (
                              <Button
                                variant="ghost"
                                onClick={() => {
                                  setDismissed([...dismissed, book.id])
                                  setNotice(
                                    `${book.title} set aside for this session. Undo is available in its place.`,
                                  )
                                }}
                              >
                                Not this time
                              </Button>
                            ) : null}
                          </div>
                        </>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <p className="end-note">
                There’s no need to choose today. Keep the books that interest you and return when
                you’re ready.
              </p>
            </section>
          )}
          <div className="discover-foot">
            <p>Something already on your shelves?</p>
            <a href="https://reveriereads.app/match" target="_blank" rel="noreferrer">
              Choose from your library in Next read ↗
            </a>
          </div>
          <div className="study-notice" role="status" aria-live="polite">
            {notice}
          </div>
        </main>
      </div>
      <footer className="study-footer">
        <p>
          <strong>About this study.</strong> Sample matches and reading history are authored for
          design review. Book summaries link to author or publisher sources. Mood labels are
          editorial interpretations for this preview. No account data is read or written.
        </p>
        <a href={specificationUrl}>Read the interaction specification</a>
      </footer>

      {chosenBook ? (
        <Modal title={chosenBook.title} onClose={closeDetail} wide>
          <div className="detail-layout">
            <Cover book={chosenBook} />
            <div>
              <p className="eyebrow">
                {chosenBook.genre} · {chosenBook.year}
              </p>
              <p className="detail-author">{chosenBook.author}</p>
              <p className="detail-relation">{relation(copies[chosenBook.id])}</p>
              <p className="detail-description">{chosenBook.description}</p>
              <a className="source-link" href={chosenBook.source} target="_blank" rel="noreferrer">
                About this book · {chosenBook.sourceLabel} ↗
              </a>
            </div>
          </div>
          <div className="detail-reason">
            <p className="eyebrow">Why this is here</p>
            <p>
              {scenario === 'series' && chosenBook.id === 'tombs'
                ? 'The second Earthsea book, following A Wizard of Earthsea in your sample library.'
                : currentReason(chosenBook)}
            </p>
            {scenario === 'series' && chosenBook.id === 'tombs' ? (
              <a
                className="source-link"
                href="https://www.ursulakleguin.com/the-books-of-earthsea"
                target="_blank"
                rel="noreferrer"
              >
                See the author’s reading order ↗
              </a>
            ) : null}
          </div>
          <div className="detail-actions">
            <Button onClick={() => setCopy(chosenBook.id, 'wishlist')}>
              {copies[chosenBook.id]?.wishlist ? 'Remove from wishlist' : 'Add to wishlist'}
            </Button>
            <Button variant="secondary" onClick={closeDetail}>
              {screen === 'results'
                ? 'Back to shortlist'
                : screen === 'search'
                  ? 'Back to search'
                  : 'Back to Discover'}
            </Button>
          </div>
          <details className="copy-options">
            <summary>I already have a copy</summary>
            <p>These choices are independent. You can own one edition and borrow another.</p>
            <div>
              <Button
                variant="secondary"
                aria-pressed={Boolean(copies[chosenBook.id]?.owned)}
                onClick={() => setCopy(chosenBook.id, 'owned')}
              >
                {copies[chosenBook.id]?.owned ? '✓ I own a copy' : 'I own a copy'}
              </Button>
              <Button
                variant="secondary"
                aria-pressed={Boolean(copies[chosenBook.id]?.borrowed)}
                onClick={() => setCopy(chosenBook.id, 'borrowed')}
              >
                {copies[chosenBook.id]?.borrowed ? '✓ I borrowed it' : 'I borrowed it'}
              </Button>
            </div>
          </details>
          <p className="detail-sample" role="status">
            Sample only · {relation(copies[chosenBook.id])}. Changes reset when you refresh.
          </p>
        </Modal>
      ) : null}

      {showSaved ? (
        <Modal title="Saved here" onClose={() => setShowSaved(false)} wide>
          <p className="saved-intro">
            A little space to keep your possibilities. These shortlists stay in this study until you
            refresh.
          </p>
          {saved.length === 0 ? (
            <p className="empty-saved">
              No shortlists yet. Find a few books, then save the ones you want to come back to.
            </p>
          ) : (
            saved.map((s, index) => (
              <section className="saved-session" key={index}>
                <div className="saved-covers">
                  {s.ids.map((id) => (
                    <Cover key={id} book={books.find((b) => b.id === id)!} small />
                  ))}
                </div>
                <h3>
                  {s.direction === 'anchor'
                    ? `From ${anchors.find((a) => a.id === s.anchor)?.title}`
                    : s.direction === 'mood'
                      ? s.moods.join(' + ')
                      : s.genre}
                </h3>
                <p>{s.ids.length} books · A saved shortlist</p>
                <div className="detail-actions">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setDismissed([])
                      setScenario('returning')
                      setShowSaved(false)
                      navigate('results', s)
                    }}
                  >
                    Return to this shortlist
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setSaved(saved.filter((_, i) => i !== index))}
                  >
                    Remove shortlist
                  </Button>
                </div>
              </section>
            ))
          )}
          <p className="detail-sample">
            Saving or removing a shortlist does not change your copies or wishlist.
          </p>
        </Modal>
      ) : null}
    </>
  )
}
