import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { splitName, type Book } from '@reverie/core'
import {
  parseReleasePub,
  releaseDateLabel,
  releaseWindow,
  useAuthorFollows,
  useAuthorReleases,
  useSetFollow,
  yourAuthors,
  type AuthorRelease,
  type ReleaseSource,
} from '../data/releases'
import { CoverImage } from '../components/CoverImage'
import { Chip } from '../components/Chip'
import { Surface } from '../components/Surface'

const sourceLabel: Record<ReleaseSource, string> = {
  prh: 'Publisher catalog',
  hardcover: 'Hardcover',
  google: 'Google Books',
}

function checkedLabel(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
}

function ReleaseCard({ release: r }: { release: AuthorRelease }) {
  const navigate = useNavigate()
  const { first, last } = splitName(r.author)
  const release = r.release
  const format = release?.formats?.slice(0, 2).join(' · ')
  const edition = release?.kind === 'new_edition' ? 'New edition' : ''
  const detail = [edition, format].filter(Boolean).join(' · ')
  const confirmations = release?.confirmedBy?.length ?? 0

  return (
    <article className="release-card">
      <button
        type="button"
        onClick={() =>
          void navigate({
            to: '/add',
            search: {
              title: r.title,
              author: r.author || undefined,
              isbn: r.isbn || undefined,
              cover: r.cover || undefined,
              source:
                release?.source === 'hardcover' || release?.source === 'google'
                  ? release.source
                  : undefined,
              pub: r.pub || undefined,
              want: true,
            },
          })
        }
        className="release-card-main"
        aria-label={`Keep ${r.title} on your horizon`}
      >
        <span className="release-card-cover">
          <CoverImage book={{ title: r.title, first, last, cover: r.cover }} thumb />
        </span>
        <span className="release-card-copy">
          <span className="release-date">{releaseDateLabel(r.pub) || r.pub}</span>
          <strong>{r.title}</strong>
          <span className="release-author">{r.author}</span>
          {detail && <span className="release-detail">{detail}</span>}
          <span className="release-card-action">Keep on my horizon →</span>
        </span>
      </button>
      {release && (
        <p className="release-provenance">
          {release.sourceUrl ? (
            <a
              href={release.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="underline decoration-line underline-offset-2"
            >
              {release.publisher || sourceLabel[release.source]}
            </a>
          ) : (
            release.publisher || sourceLabel[release.source]
          )}
          {confirmations > 1 ? ` · ${confirmations} sources` : ''}
          {checkedLabel(release.checkedAt) ? ` · checked ${checkedLabel(release.checkedAt)}` : ''}
        </p>
      )}
    </article>
  )
}

function ReleaseSection({
  title,
  sub,
  list,
}: {
  title: string
  sub: string
  list: AuthorRelease[]
}) {
  if (!list.length) return null
  const headingId = `release-${title.replaceAll(' ', '-').toLocaleLowerCase()}`
  return (
    <section className="release-group" aria-labelledby={headingId}>
      <div className="release-group-heading">
        <h3 id={headingId}>{title}</h3>
        <p>{sub}</p>
      </div>
      <div className="release-card-grid">
        {list.slice(0, 12).map((release) => (
          <ReleaseCard key={`${release.isbn}|${release.title}|${release.pub}`} release={release} />
        ))}
      </div>
    </section>
  )
}

type ReleasePrecision = 'year' | 'month' | 'day'

function TrackRelease({ suggestedAuthor }: { suggestedAuthor?: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState(suggestedAuthor ?? '')
  const [precision, setPrecision] = useState<ReleasePrecision>('year')
  const [year, setYear] = useState('')
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [error, setError] = useState<string | null>(null)

  function releaseValue(): string {
    if (precision === 'day') return day
    if (precision === 'month') return month
    return year.trim()
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !author.trim()) {
      setError('Add the title and author.')
      return
    }
    const pub = releaseValue()
    if (!parseReleasePub(pub)) {
      setError(
        precision === 'year'
          ? 'Choose a release year.'
          : precision === 'month'
            ? 'Choose a release month.'
            : 'Choose a release day.',
      )
      return
    }
    void navigate({
      to: '/add',
      search: { title: title.trim(), author: author.trim(), pub, want: true },
    })
  }

  return (
    <div className="release-track">
      <button
        type="button"
        onClick={() => {
          if (!open && !author && suggestedAuthor) setAuthor(suggestedAuthor)
          setOpen((value) => !value)
          setError(null)
        }}
        aria-expanded={open}
        className="skin-control border border-line px-4 py-2 text-[12.5px] font-semibold text-ink"
        style={{ background: 'var(--field)' }}
      >
        {open ? 'Close' : 'Track a release you heard about'}
      </button>
      {open && (
        <Surface radius="card" tone="field" pad={3} className="mt-3">
          <form onSubmit={submit} noValidate className="release-track-form">
            <div>
              <p className="plan-eyebrow">A note from elsewhere</p>
              <h3>Add it to your horizon</h3>
              <p>
                A year is enough. Reverie keeps the date as flexible as the information you have.
              </p>
            </div>
            <div className="release-track-fields">
              <label>
                Title
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  autoComplete="off"
                />
              </label>
              <label>
                Author
                <input
                  type="text"
                  value={author}
                  onChange={(event) => setAuthor(event.target.value)}
                  autoComplete="off"
                />
              </label>
            </div>
            <fieldset>
              <legend>How precise is the release date?</legend>
              <div className="release-precision">
                {(
                  [
                    ['year', 'Year'],
                    ['month', 'Month'],
                    ['day', 'Exact day'],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="release-precision"
                      checked={precision === value}
                      onChange={() => {
                        setPrecision(value)
                        setError(null)
                      }}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
            {precision === 'year' && (
              <label>
                Release year
                <input
                  type="number"
                  min="1000"
                  max="9999"
                  inputMode="numeric"
                  value={year}
                  onChange={(event) => setYear(event.target.value)}
                />
              </label>
            )}
            {precision === 'month' && (
              <label>
                Release month
                <input
                  type="month"
                  value={month}
                  onChange={(event) => setMonth(event.target.value)}
                />
              </label>
            )}
            {precision === 'day' && (
              <label>
                Release day
                <input type="date" value={day} onChange={(event) => setDay(event.target.value)} />
              </label>
            )}
            {error && (
              <p role="alert" className="text-[12.5px] text-accent-ink">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="skin-control skin-btn-primary min-h-11 px-4 text-[13px] font-semibold"
            >
              Continue to Add
            </button>
          </form>
        </Surface>
      )}
    </div>
  )
}

// The library derives "your authors" from loved and repeated reads. Hardcover supplies edition
// discovery, PRH confirms its own catalog when configured, and Google fills gaps. Provider results
// stay in the shared cache; the reader sees where a date came from before adding the book.
export function FromYourAuthors({ books }: { books: Book[] }) {
  const followsQ = useAuthorFollows()
  const setFollow = useSetFollow()
  const follows = followsQ.data ?? {}
  const authors = yourAuthors(books, follows)
  const releases = useAuthorReleases(authors)
  const { upcoming, recent, uncertain } = releaseWindow(releases.shelves, books, Date.now())
  const [manageOpen, setManageOpen] = useState(false)
  const hasReleases = upcoming.length > 0 || recent.length > 0 || uncertain.length > 0

  return (
    <section className="release-authors" aria-labelledby="release-authors-heading">
      <header className="release-section-heading">
        <div>
          <p className="plan-eyebrow">A little beyond your shelves</p>
          <h2 id="release-authors-heading">From authors you return to.</h2>
          <p>
            A small, source-labelled lookout for books that are coming into view. Opening one lets
            you review it before anything joins your library.
          </p>
        </div>
        {authors.length > 0 && (
          <button
            type="button"
            onClick={() => setManageOpen((open) => !open)}
            className="plan-text-button"
            aria-expanded={manageOpen}
          >
            {manageOpen
              ? 'Done'
              : `Manage ${authors.length} ${authors.length === 1 ? 'author' : 'authors'}`}
          </button>
        )}
      </header>

      {manageOpen && (
        <Surface radius="card" tone="field" pad={3} className="release-author-manager">
          <p>Mute an author to leave them out of this lookout.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {authors.map((name) => (
              <Chip
                key={name}
                active
                onClick={() => setFollow.mutate({ name, state: 'muted' })}
                title={`Mute ${name}`}
              >
                {name} ✕
              </Chip>
            ))}
            {Object.entries(follows)
              .filter(([, state]) => state === 'muted')
              .map(([name]) => (
                <Chip
                  key={name}
                  onClick={() => setFollow.mutate({ name, state: null })}
                  title={`Unmute ${name}`}
                >
                  {name} — muted
                </Chip>
              ))}
          </div>
        </Surface>
      )}

      {authors.length > 0 && releases.status === 'loading' && !hasReleases && (
        <Surface radius="card" tone="field" pad={3} className="release-status" role="status">
          Looking along the shelves for new books…
        </Surface>
      )}
      {authors.length > 0 && releases.status === 'unavailable' && !hasReleases && (
        <Surface radius="card" tone="field" pad={3} className="release-status" role="status">
          The release lookout is unavailable right now. Your saved books and plans are unchanged.
        </Surface>
      )}
      {authors.length > 0 && releases.status === 'unavailable' && hasReleases && (
        <Surface radius="card" tone="field" pad={3} className="release-status" role="status">
          Showing the release details that loaded. Some author shelves could not be refreshed.
        </Surface>
      )}

      <ReleaseSection title="Coming soon" sub="Nearest known dates first" list={upcoming} />
      <ReleaseSection title="Newly arrived" sub="Released in the last six months" list={recent} />
      <ReleaseSection
        title="Dates taking shape"
        sub="The source gives a year or month, so Reverie keeps the day open"
        list={uncertain}
      />

      {authors.length > 0 && releases.status === 'ready' && !hasReleases && (
        <Surface radius="card" tone="field" pad={3} className="release-status">
          Nothing new from your authors right now. Indie dates often appear first in newsletters, so
          you can add one below and keep the date flexible.
        </Surface>
      )}
      {authors.length === 0 && (
        <Surface radius="card" tone="field" pad={3} className="release-status">
          As your library grows, authors you love and return to will appear here automatically.
        </Surface>
      )}

      <TrackRelease suggestedAuthor={authors[0]} />
    </section>
  )
}
