import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { splitName } from '@reverie/core'
import { useBooks } from '../data/books'
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

function ReleaseCard({ r }: { r: AuthorRelease }) {
  const navigate = useNavigate()
  const { first, last } = splitName(r.author)
  const release = r.release
  const format = release?.formats?.slice(0, 2).join(' · ')
  const edition = release?.kind === 'new_edition' ? 'New edition' : ''
  const detail = [edition, format].filter(Boolean).join(' · ')
  const confirmations = release?.confirmedBy?.length ?? 0

  return (
    <article className="min-w-0">
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
        className="block w-full text-left"
        aria-label={`Track ${r.title} in your library`}
      >
        <div
          className="aspect-[2/3] overflow-hidden rounded-lg border border-line"
          style={{ background: 'var(--field)' }}
        >
          <CoverImage book={{ title: r.title, first, last, cover: r.cover }} thumb />
        </div>
        <div className="mt-1 break-words text-[12px] font-semibold leading-snug text-ink">
          {r.title}
        </div>
        <div className="break-words text-[11px] leading-snug text-muted">{r.author}</div>
        <div className="mt-0.5 text-[11px] font-semibold text-primary">
          {releaseDateLabel(r.pub) || r.pub}
        </div>
        {detail && <div className="text-[10.5px] leading-snug text-muted">{detail}</div>}
      </button>
      {release && (
        <div className="mt-1 text-[10px] leading-snug text-muted">
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
        </div>
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
  return (
    <div className="mb-6">
      <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
      <p className="mb-2 text-[12.5px] text-muted">{sub}</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
        {list.slice(0, 12).map((release) => (
          <ReleaseCard key={`${release.isbn}|${release.title}|${release.pub}`} r={release} />
        ))}
      </div>
    </div>
  )
}

function TrackRelease({ suggestedAuthor }: { suggestedAuthor?: string }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState(suggestedAuthor ?? '')
  const [pub, setPub] = useState('')
  const [error, setError] = useState<string | null>(null)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !author.trim()) {
      setError('Add the title and author.')
      return
    }
    if (!parseReleasePub(pub)) {
      setError('Use YYYY, YYYY-MM, or YYYY-MM-DD for the release date.')
      return
    }
    void navigate({
      to: '/add',
      search: { title: title.trim(), author: author.trim(), pub: pub.trim(), want: true },
    })
  }

  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => {
          if (!open && !author && suggestedAuthor) setAuthor(suggestedAuthor)
          setOpen((value) => !value)
          setError(null)
        }}
        aria-expanded={open}
        className="skin-control border border-line px-3 py-2 text-[12.5px] font-semibold text-ink"
        style={{ background: 'var(--field)' }}
      >
        {open ? 'Close release form' : 'Track a release you heard about'}
      </button>
      {open && (
        <Surface radius="card" tone="field" pad={3} className="mt-3">
          <form onSubmit={submit} noValidate>
            <h3 className="text-[15px] font-semibold text-ink">Add it to your horizon</h3>
            <p className="mb-3 mt-1 text-[12px] text-muted">
              A year or month is enough. Reverie keeps the date as flexible as the information you
              have.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Title"
                aria-label="Release title"
                className="h-10 skin-card border border-line px-3 text-[13px] text-ink outline-none"
                style={{ background: 'var(--card)' }}
              />
              <input
                value={author}
                onChange={(event) => setAuthor(event.target.value)}
                placeholder="Author"
                aria-label="Release author"
                className="h-10 skin-card border border-line px-3 text-[13px] text-ink outline-none"
                style={{ background: 'var(--card)' }}
              />
              <input
                value={pub}
                onChange={(event) => setPub(event.target.value)}
                placeholder="YYYY, YYYY-MM, or full date"
                aria-label="Release date"
                aria-invalid={error?.startsWith('Use YYYY') || undefined}
                className="h-10 skin-card border border-line px-3 text-[13px] text-ink outline-none"
                style={{ background: 'var(--card)' }}
              />
            </div>
            {error && (
              <p role="alert" className="mt-2 text-[12px] text-accent-ink">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="skin-control skin-btn-primary mt-3 h-10 px-4 text-[13px] font-semibold"
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
export function FromYourAuthors() {
  const { data: books } = useBooks()
  const followsQ = useAuthorFollows()
  const setFollow = useSetFollow()
  const follows = followsQ.data ?? {}
  const authors = yourAuthors(books ?? [], follows)
  const shelves = useAuthorReleases(authors)
  const { upcoming, recent, uncertain } = releaseWindow(shelves, books ?? [], Date.now())
  const [manageOpen, setManageOpen] = useState(false)

  return (
    <div className="mb-8">
      <ReleaseSection
        title="Coming soon from your authors"
        sub="Release dates from the catalog — tap a book to keep it on your horizon"
        list={upcoming}
      />
      <ReleaseSection
        title="New from your authors"
        sub="Out in the last six months"
        list={recent}
      />
      <ReleaseSection
        title="Dates still taking shape"
        sub="The catalog gives a year or month, so Reverie will not invent a day"
        list={uncertain}
      />

      <TrackRelease suggestedAuthor={authors[0]} />

      {authors.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setManageOpen((open) => !open)}
            className="text-[12.5px] font-semibold text-primary"
          >
            {manageOpen ? 'Hide your authors' : `Your authors (${authors.length}) — manage`}
          </button>
          {manageOpen && (
            <div className="mt-2 flex flex-wrap gap-2">
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
          )}
        </>
      )}
      {authors.length > 0 &&
        upcoming.length === 0 &&
        recent.length === 0 &&
        uncertain.length === 0 && (
          <p className="mt-3 text-[12.5px] text-muted">
            Nothing new from your authors right now. Indie dates often appear first in newsletters,
            so you can add one above and keep the date flexible.
          </p>
        )}
      {authors.length === 0 && (
        <p className="mt-3 text-[12.5px] text-muted">
          As your library grows, authors you love and return to will appear here automatically.
        </p>
      )}
    </div>
  )
}
