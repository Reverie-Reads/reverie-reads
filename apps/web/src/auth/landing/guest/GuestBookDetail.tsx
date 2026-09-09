import { useEffect, useState } from 'react'
import type { Book } from '@reverie/core'
import { CoverImage } from '../../../components/CoverImage'
import { Nameplate } from '../../../components/Nameplate'
import { Stars } from '../../../components/Stars'
import { useGuestLibrary } from './context'
import { field, primary, quiet, writingField } from './styles'
import { ProgressFields } from '../../../components/ReadingProgress'
import { parseProgress } from '../../../components/readingProgressValue'

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Saved state is shared between the two landing views; draft edits stay local until saved. */
export function GuestBookDetail({ book }: { book: Book }) {
  const { state, dispatch } = useGuestLibrary()
  const [rating, setRating] = useState(book.rating)
  const [progress, setProgress] = useState(String(book.progress))
  const [progressError, setProgressError] = useState<string | null>(null)
  const [format, setFormat] = useState(book.format)
  const [ownership, setOwnership] = useState(book.ownership)
  const [borrowed, setBorrowed] = useState(book.borrowed)
  const [wishlist, setWishlist] = useState(book.wishlist)
  const [owned, setOwned] = useState(book.owned)
  const [notes, setNotes] = useState(
    book.readStatus === 'Read'
      ? (book.reads.at(-1)?.notes ?? state.pendingNotes[book.id] ?? '')
      : (state.pendingNotes[book.id] ?? ''),
  )
  const savedNote =
    book.readStatus === 'Read'
      ? (book.reads.at(-1)?.notes ?? state.pendingNotes[book.id] ?? '')
      : (state.pendingNotes[book.id] ?? '')
  useEffect(() => {
    setRating(book.rating)
    setProgress(String(book.progress))
    setProgressError(null)
    setFormat(book.format)
    setOwnership(book.ownership)
    setBorrowed(book.borrowed)
    setWishlist(book.wishlist)
    setOwned(book.owned)
    setNotes(savedNote)
  }, [book, savedNote])
  function save(): boolean {
    const parsedProgress = book.readStatus === 'Reading' ? parseProgress(progress) : book.progress
    if (parsedProgress == null) {
      setProgressError('Enter a whole number from 0 to 100.')
      return false
    }
    dispatch({
      type: 'save',
      id: book.id,
      patch: { rating, progress: parsedProgress, format, ownership, borrowed, wishlist, owned },
      notes,
    })
    setProgressError(null)
    return true
  }
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-4">
        <div className="aspect-[2/3] w-20 shrink-0 overflow-hidden border border-line">
          <CoverImage book={book} reportErrors={false} />
        </div>
        <div className="min-w-0 flex-1">
          <Nameplate
            title={book.title}
            subtitle={[book.first, book.last].filter(Boolean).join(' ')}
            align="start"
          />
        </div>
      </div>
      <form
        noValidate
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <p className="text-sm font-semibold">
          {book.readStatus === 'unset'
            ? 'No reading status yet'
            : book.readStatus === 'Read'
              ? 'Finished'
              : book.readStatus === 'Reading'
                ? 'Reading now'
                : book.readStatus}
        </p>
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-semibold">Your copies</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ownership === 'owned'}
                onChange={(e) => setOwnership(e.target.checked ? 'owned' : 'unowned')}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              Owned
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={borrowed}
                onChange={(e) => setBorrowed(e.target.checked)}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              Borrowed
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={wishlist}
                onChange={(e) => setWishlist(e.target.checked)}
                className="h-5 w-5 accent-[var(--primary)]"
              />
              Wishlist
            </label>
          </div>
          {(ownership === 'owned' || borrowed) && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Physical copy
                <select
                  className={field}
                  value={owned.physical === true ? 'physical' : owned.physical || 'none'}
                  onChange={(e) =>
                    setOwned({
                      ...owned,
                      physical:
                        e.target.value === 'none'
                          ? false
                          : e.target.value === 'physical'
                            ? true
                            : (e.target.value as 'paperback' | 'hardcover'),
                    })
                  }
                >
                  <option value="none">None recorded</option>
                  <option value="physical">Physical, unspecified</option>
                  <option value="paperback">Paperback</option>
                  <option value="hardcover">Hardcover</option>
                </select>
              </label>
              <div className="flex flex-wrap items-end gap-4">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={owned.ebook}
                    onChange={(e) => setOwned({ ...owned, ebook: e.target.checked })}
                    className="h-5 w-5 accent-[var(--primary)]"
                  />
                  Ebook
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={owned.audiobook}
                    onChange={(e) => setOwned({ ...owned, audiobook: e.target.checked })}
                    className="h-5 w-5 accent-[var(--primary)]"
                  />
                  Audio
                </label>
              </div>
            </div>
          )}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-semibold">
            Reading format
            <select className={field} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Not recorded</option>
              {['Paperback', 'Hardcover', 'Ebook', 'Audiobook'].map((value) => (
                <option key={value}>{value}</option>
              ))}
              {format && !['Paperback', 'Hardcover', 'Ebook', 'Audiobook'].includes(format) && (
                <option>{format}</option>
              )}
            </select>
          </label>
        </div>
        {book.readStatus === 'Reading' && (
          <ProgressFields
            value={progress}
            error={progressError}
            onChange={(value) => {
              setProgress(value)
              setProgressError(null)
            }}
          />
        )}
        <div>
          <p className="mb-2 text-sm font-semibold">Your rating</p>
          <Stars value={rating} step={0.5} onChange={setRating} />
        </div>
        <label className="block text-sm font-semibold">
          A note to keep
          <textarea
            className={writingField}
            rows={4}
            maxLength={5000}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="A thought, a line to return to, how it made you feel…"
          />
        </label>
        <p className="text-xs leading-relaxed text-muted">
          Your guest note stays here until you refresh or reset. Finishing a book places it beside
          that read in the journal.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={quiet}>
            Save changes
          </button>
          {book.readStatus === 'Reading' ? (
            <button
              type="button"
              className={primary}
              onClick={() => {
                if (!save()) return
                dispatch({ type: 'finish', id: book.id, date: today() })
              }}
            >
              Finish this read
            </button>
          ) : (
            <button
              type="button"
              className={primary}
              onClick={() => {
                if (!save()) return
                dispatch({ type: 'start', id: book.id })
              }}
            >
              {book.reads.length ? 'Read again' : 'Start reading'}
            </button>
          )}
        </div>
      </form>
      {book.reads.length > 0 && (
        <div className="space-y-3 border-t border-line pt-4">
          <h4 className="text-sm font-semibold">Your reading history</h4>
          {book.reads.map((read, index) => (
            <div
              key={index}
              className="skin-card border border-line bg-[color:var(--card-solid)] p-3 text-sm leading-relaxed"
            >
              <p>
                {read.date || 'Date not recorded'}
                {read.format ? ` · ${read.format}` : ''}
              </p>
              {read.rating > 0 && <Stars value={read.rating} size={14} />}
              <p className="mt-2 whitespace-pre-wrap break-words">
                {read.notes || 'No note on this read.'}
              </p>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        className={quiet}
        onClick={() => dispatch({ type: 'remove', id: book.id })}
      >
        Remove from guest library
      </button>
    </div>
  )
}
