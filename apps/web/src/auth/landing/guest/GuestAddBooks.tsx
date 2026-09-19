import { useEffect, useId, useRef, useState } from 'react'
import { splitName, type Incoming, type PossessionState, possessionPatch } from '@reverie/core'
import { CoverImage } from '../../../components/CoverImage'
import { GUEST_CATALOG, catalogIncoming } from './catalog'
import { useGuestLibrary } from './context'
import { guestImport } from './state'
import { field, primary, quiet } from './styles'

export function GuestAddBooks() {
  const { state, dispatch } = useGuestLibrary()
  const [tab, setTab] = useState<'catalog' | 'manual' | 'csv'>('catalog')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [possession, setPossession] = useState<PossessionState>('unset')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  function add(rows: Incoming[], warning?: string) {
    dispatch({ type: 'add', rows, warning })
  }
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted">
        Bring a book into this room. Choose from six sample catalog titles, type one in, or try a
        small CSV.
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Ways to add books">
        {(['catalog', 'manual', 'csv'] as const).map((method) => (
          <button
            key={method}
            type="button"
            className={tab === method ? primary : quiet}
            aria-pressed={tab === method}
            onClick={() => {
              setTab(method)
              setError('')
            }}
          >
            {{ catalog: 'Sample catalog', manual: 'Enter a book', csv: 'Upload CSV' }[method]}
          </button>
        ))}
      </div>
      {tab !== 'csv' && (
        <label className="block text-sm font-semibold">
          Your copy
          <select
            value={possession}
            onChange={(e) => setPossession(e.target.value as PossessionState)}
            className={field}
          >
            <option value="unset">Decide later</option>
            <option value="owned">I own a copy</option>
            <option value="borrowed">I’m borrowing it</option>
            <option value="wishlist">On my wishlist</option>
          </select>
        </label>
      )}
      {tab === 'catalog' && (
        <>
          <label className="block text-sm font-semibold">
            Find a sample book
            <input
              className={field}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Title or author"
            />
          </label>
          <div className="space-y-2">
            {GUEST_CATALOG.filter((book) =>
              `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()),
            ).map((item) => {
              const inLibrary = state.books.some(
                (book) => book.title === item.title && `${book.first} ${book.last}` === item.author,
              )
              return (
                <label
                  key={item.key}
                  className="skin-card flex min-w-0 cursor-pointer items-center gap-3 border border-line bg-[color:var(--card-solid)] p-3"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(item.key)}
                    disabled={inLibrary}
                    onChange={(e) =>
                      setSelected((previous) =>
                        e.target.checked
                          ? [...previous, item.key]
                          : previous.filter((key) => key !== item.key),
                      )
                    }
                    className="h-5 w-5 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="aspect-[2/3] w-10 shrink-0 overflow-hidden">
                    <CoverImage book={item} reportErrors={false} thumb />
                  </span>
                  <span className="min-w-0 text-sm leading-relaxed">
                    <span className="block font-semibold text-ink">{item.title}</span>
                    <span className="block text-muted">
                      {item.author}
                      {inLibrary ? ' · In your guest library' : ''}
                    </span>
                  </span>
                </label>
              )
            })}
            {!GUEST_CATALOG.some((book) =>
              `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase()),
            ) && (
              <p className="text-sm text-muted">
                No sample titles match. Use “Enter a book” to bring your own.
              </p>
            )}
          </div>
          <button
            type="button"
            className={primary}
            disabled={!selected.length}
            onClick={() =>
              add(
                selected.map((key) => ({
                  ...catalogIncoming(key),
                  ...possessionPatch(possession),
                })),
              )
            }
          >
            Add {selected.length || ''} {selected.length === 1 ? 'book' : 'books'} to my library
          </button>
        </>
      )}
      {tab === 'manual' && (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const title = String(data.get('title') ?? '').trim()
            const author = String(data.get('author') ?? '').trim()
            if (!title) {
              setError('Give your book a title.')
              return
            }
            const { first, last } = splitName(author)
            add([
              {
                title,
                first,
                last,
                contributors: author ? [{ name: author, role: 'author', position: 0 }] : [],
                isbn: String(data.get('isbn') ?? '').trim(),
                ...possessionPatch(possession),
              },
            ])
          }}
        >
          <label className="block text-sm font-semibold">
            Book title
            <input name="title" required maxLength={300} className={field} />
          </label>
          <label className="block text-sm font-semibold">
            Author
            <input name="author" maxLength={200} className={field} />
          </label>
          <label className="block text-sm font-semibold">
            ISBN (optional)
            <input name="isbn" maxLength={20} className={field} />
          </label>
          <button className={primary}>Add this book</button>
        </form>
      )}
      {tab === 'csv' && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">
            Try a Goodreads, StoryGraph, or Reverie export. Up to 50 books and 1 MB. The file is
            read in this tab; its contents are not sent to a server. Your demo holds up to 60 books.
          </p>
          <a
            className={`${quiet} inline-flex items-center`}
            href="/guest-library-sample.csv"
            download
          >
            Download a two-book CSV
          </a>
          <label htmlFor={id} className="block text-sm font-semibold">
            Choose a CSV file
          </label>
          <input
            id={id}
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            className="block w-full min-w-0 text-sm file:mr-3 file:min-h-11 file:cursor-pointer file:border file:border-line file:bg-[color:var(--field)] file:px-3 file:text-ink"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              if (!file) return
              setError('')
              if (file.size > 1024 * 1024) {
                setError('Choose a CSV smaller than 1 MB.')
                event.target.value = ''
                return
              }
              setBusy(true)
              try {
                const result = guestImport(await file.text())
                if (active.current) add(result.rows, result.warning)
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'This file could not be read. Try the sample CSV.',
                )
              } finally {
                setBusy(false)
                if (fileRef.current) fileRef.current.value = ''
              }
            }}
          />
          {busy && <p className="text-sm">Reading your CSV…</p>}
        </div>
      )}
      <p className="text-xs leading-relaxed text-muted">
        A curated catalog sample. Selected covers from{' '}
        <a
          href="https://openlibrary.org/dev/docs/api/covers"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          Open Library
        </a>
        .
      </p>
      {error && (
        <p role="alert" className="text-sm font-semibold text-ink">
          {error}
        </p>
      )}
    </div>
  )
}
