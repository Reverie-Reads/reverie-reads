import { useEffect, useState } from 'react'
import { Stars } from '../../../components/Stars'
import { useGuestLibrary } from './context'
import { writingField, primary } from './styles'

export function GuestReadingRecord() {
  const { state, dispatch } = useGuestLibrary()
  const book =
    state.books.find((item) => item.id === state.selected) ??
    state.books.find((item) => item.readStatus === 'Reading') ??
    state.books[0]
  if (!book)
    return (
      <p className="p-5 text-sm leading-relaxed text-ink">
        Add a book in the guest library above, then keep a note here.
      </p>
    )
  const note =
    book.readStatus === 'Read'
      ? (book.reads.at(-1)?.notes ?? '')
      : (state.pendingNotes[book.id] ?? '')
  return (
    <RecordForm
      key={book.id}
      title={book.title}
      notes={note}
      rating={book.rating}
      onSave={(notes, rating) => dispatch({ type: 'save', id: book.id, notes, patch: { rating } })}
    />
  )
}
function RecordForm({
  title,
  notes: initialNotes,
  rating: initialRating,
  onSave,
}: {
  title: string
  notes: string
  rating: number
  onSave: (note: string, rating: number) => void
}) {
  const [notes, setNotes] = useState(initialNotes)
  const [rating, setRating] = useState(initialRating)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setNotes(initialNotes)
    setRating(initialRating)
  }, [initialNotes, initialRating])
  return (
    <form
      className="skin-panel space-y-4 border border-line bg-[color:var(--card-solid)] p-3 text-ink min-[360px]:p-5 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(notes, rating)
        setSaved(true)
      }}
    >
      <p className="text-xs font-semibold uppercase tracking-widest text-muted">
        From your guest library
      </p>
      <h3
        className="break-words text-[clamp(28px,3vw,38px)] leading-[1.25]"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {title}
      </h3>
      <div>
        <p className="mb-2 text-sm font-semibold">Your rating</p>
        <Stars
          value={rating}
          step={0.5}
          onChange={(value) => {
            setRating(value)
            setSaved(false)
          }}
        />
      </div>
      <label className="block text-sm font-semibold">
        A thought to return to
        <textarea
          className={writingField}
          rows={5}
          maxLength={5000}
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value)
            setSaved(false)
          }}
          placeholder="What would you want to remember?"
        />
      </label>
      <p className="text-sm leading-relaxed text-muted">
        Save a note here, then open this book in the guest library above. It follows the book
        through every room.
      </p>
      <button className={primary}>{saved ? 'Note saved' : 'Save this note'}</button>
    </form>
  )
}
