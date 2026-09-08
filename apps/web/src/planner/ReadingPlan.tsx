import { useMemo, useState } from 'react'
import {
  authorOf,
  emptyDate,
  isReadingPlan,
  movedReadingPlanPosition,
  nextReadingPlanPosition,
  readingPlanDateLabel,
  sortReadingPlans,
  type Book,
  type PlanDate,
  type ReadingHistory,
} from '@reverie/core'
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'
import { Modal } from '../components/Modal'
import { Surface } from '../components/Surface'
import { useUpdateBook } from '../data/books'
import { MONTHS } from '../library/constants'
import './reading-plan.css'

export type PlanView = 'queue' | 'calendar'

type RemovedPlan = Pick<Book, 'id' | 'title' | 'plan' | 'planPosition' | 'planIntention'>
type EditorState = { book: Book; initialDate?: PlanDate }

const EMPTY_PLAN = emptyDate()
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function localToday(): PlanDate {
  const now = new Date()
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() }
}

function dateInputValue(date: PlanDate): string {
  if (date.y == null || date.m == null || date.d == null) return ''
  return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
}

function monthInputValue(date: PlanDate): string {
  if (date.y == null || date.m == null) return ''
  return `${date.y}-${String(date.m).padStart(2, '0')}`
}

function planPatch(book: Book, books: readonly Book[], date: PlanDate, intention: string) {
  return {
    plan: date,
    planPosition: book.planPosition ?? nextReadingPlanPosition(books),
    planIntention: intention.trim(),
  }
}

const removePatch = {
  plan: EMPTY_PLAN,
  planPosition: null,
  planIntention: '',
} as const

export function ReadingPlan({
  books,
  view,
  openBook,
  history,
}: {
  books: Book[]
  view: PlanView
  openBook: (id: string) => void
  history?: ReadingHistory
}) {
  const plans = useMemo(() => sortReadingPlans(books), [books])
  const reading = useMemo(
    () =>
      books
        .filter((book) => book.readStatus === 'Reading' && !book.readingNowHidden)
        .sort(
          (a, b) =>
            (a.readingPosition ?? Number.MAX_SAFE_INTEGER) -
              (b.readingPosition ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
        ),
    [books],
  )
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [pickerDate, setPickerDate] = useState<PlanDate | null>(null)
  const [removed, setRemoved] = useState<RemovedPlan | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const edit = (book: Book, initialDate?: PlanDate) => setEditor({ book, initialDate })
  const remove = (book: Book) => {
    setRemoved({
      id: book.id,
      title: book.title,
      plan: book.plan,
      planPosition: book.planPosition,
      planIntention: book.planIntention,
    })
    setAnnouncement(`${book.title} was removed from your plan. Reading history is unchanged.`)
  }

  return (
    <>
      {view === 'queue' ? (
        <div className="plan-layout">
          <CurrentReading books={reading} openBook={openBook} />
          <section aria-labelledby="plan-queue-heading" className="min-w-0">
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
              <div>
                <p className="plan-eyebrow">Your next few books</p>
                <h2 id="plan-queue-heading" className="plan-heading">
                  An open-ended plan.
                </h2>
                <p className="mt-2 max-w-[58ch] text-[14px] leading-relaxed text-muted">
                  Soon, a month, or a particular day. Nothing here is a deadline.
                </p>
              </div>
              <Button onClick={() => setPickerDate(EMPTY_PLAN)}>Add to your plan</Button>
            </div>

            {plans.length ? (
              <ol className="plan-queue" aria-label="Reading plan">
                {plans.map((book, index) => (
                  <PlanRow
                    key={book.id}
                    book={book}
                    books={plans}
                    index={index}
                    openBook={openBook}
                    edit={() => edit(book)}
                    removed={() => remove(book)}
                    restoreFailed={() => setRemoved(null)}
                    announce={setAnnouncement}
                  />
                ))}
              </ol>
            ) : (
              <Surface tone="field" radius="panel" pad={4} className="plan-empty">
                <p className="plan-eyebrow">A quiet shelf</p>
                <h3>No plans to keep up with.</h3>
                <p>Choose a book when something catches your eye. “Soon” is a complete plan.</p>
                <Button onClick={() => setPickerDate(EMPTY_PLAN)}>Leave a place for a book</Button>
              </Surface>
            )}
          </section>
        </div>
      ) : (
        <PlanCalendar
          plans={plans}
          history={history}
          openBook={openBook}
          edit={edit}
          add={(date) => setPickerDate(date)}
        />
      )}

      <Surface tone="field" radius="panel" pad={3} className="mt-8 plan-promise">
        <div>
          <p className="plan-eyebrow">A plan is a possibility</p>
          <h2>Your reading history stays yours.</h2>
        </div>
        <p>Moving or removing a plan never changes a finish, a reread, a rating, or a note.</p>
      </Surface>

      <p className="sr-only" role="status">
        {announcement}
      </p>

      {removed && (
        <UndoPlan removed={removed} clear={() => setRemoved(null)} announce={setAnnouncement} />
      )}
      {pickerDate && (
        <PlanPicker
          books={books}
          onClose={() => setPickerDate(null)}
          onChoose={(book) => {
            const initialDate = pickerDate
            setPickerDate(null)
            edit(book, initialDate)
          }}
        />
      )}
      {editor && (
        <PlanEditorDialog
          book={books.find((book) => book.id === editor.book.id) ?? editor.book}
          books={books}
          initialDate={editor.initialDate}
          onClose={() => setEditor(null)}
          onSaved={(book) => {
            setEditor(null)
            setAnnouncement(`Plan saved for ${book.title}. Reading history is unchanged.`)
          }}
          onRemoved={(book) => {
            setEditor(null)
            remove(book)
          }}
        />
      )}
    </>
  )
}

function CurrentReading({ books, openBook }: { books: Book[]; openBook: (id: string) => void }) {
  const book = books[0]
  return (
    <aside className="plan-current" aria-labelledby="plan-current-heading">
      <p className="plan-eyebrow">Reading now</p>
      {book ? (
        <div className="plan-current-reading">
          <button
            type="button"
            className="plan-current-cover"
            onClick={() => openBook(book.id)}
            aria-label={`Open ${book.title}`}
          >
            <CoverImage book={book} />
          </button>
          <div className="plan-current-copy">
            <h2 id="plan-current-heading">{book.title}</h2>
            <p>{authorOf(book)}</p>
            <div className="skin-meter mt-4 h-1.5 overflow-hidden bg-field">
              <span
                className="skin-meter block h-full bg-primary"
                style={{ width: `${Math.max(0, Math.min(100, book.progress))}%` }}
              />
            </div>
            <p className="mt-2 text-[12px] text-muted">{book.progress}% · your current place</p>
            {books.length > 1 && (
              <p className="mt-5 border-t border-line pt-4 text-[12.5px] text-muted">
                {books.length - 1} more {books.length === 2 ? 'book' : 'books'} in Reading now
              </p>
            )}
          </div>
        </div>
      ) : (
        <Surface tone="field" radius="card" pad={2}>
          <h2 id="plan-current-heading" className="text-[17px] text-ink">
            Your reading chair is open.
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Start a book when you are ready. Planning one does not start it for you.
          </p>
        </Surface>
      )}
    </aside>
  )
}

function PlanRow({
  book,
  books,
  index,
  openBook,
  edit,
  removed,
  restoreFailed,
  announce,
}: {
  book: Book
  books: Book[]
  index: number
  openBook: (id: string) => void
  edit: () => void
  removed: () => void
  restoreFailed: () => void
  announce: (message: string) => void
}) {
  const update = useUpdateBook(book.id)
  const move = (direction: -1 | 1) => {
    const position = movedReadingPlanPosition(books, index, direction)
    if (position == null) return
    update.mutate(
      { id: book.id, patch: { planPosition: position } },
      {
        onSuccess: () =>
          announce(`${book.title} moved ${direction < 0 ? 'earlier' : 'later'} in your plan.`),
      },
    )
  }
  const remove = () => {
    removed()
    update.mutate(
      { id: book.id, patch: removePatch },
      {
        onError: () => {
          restoreFailed()
          announce(`${book.title} could not be removed. Your plan was restored.`)
        },
      },
    )
  }

  return (
    <li>
      <span className="plan-order" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <button
        type="button"
        className="plan-cover"
        onClick={() => openBook(book.id)}
        aria-label={`Open ${book.title}`}
      >
        <CoverImage book={book} />
      </button>
      <div className="min-w-0">
        <p className="plan-date">{readingPlanDateLabel(book)}</p>
        <h3>{book.title}</h3>
        <p className="plan-author">{authorOf(book)}</p>
        {book.planIntention && <p className="plan-intention">{book.planIntention}</p>}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[12.5px]">
          <button type="button" className="plan-text-button" onClick={edit}>
            Edit plan
          </button>
          <button type="button" className="plan-text-button" onClick={remove}>
            Remove<span className="sr-only"> {book.title}</span>
          </button>
        </div>
      </div>
      <div className="plan-reorder">
        <button
          type="button"
          aria-label={`Move ${book.title} earlier`}
          disabled={index === 0 || update.isPending}
          onClick={() => move(-1)}
        >
          ↑
        </button>
        <button
          type="button"
          aria-label={`Move ${book.title} later`}
          disabled={index === books.length - 1 || update.isPending}
          onClick={() => move(1)}
        >
          ↓
        </button>
      </div>
    </li>
  )
}

function PlanCalendar({
  plans,
  history,
  openBook,
  edit,
  add,
}: {
  plans: Book[]
  history?: ReadingHistory
  openBook: (id: string) => void
  edit: (book: Book, initialDate?: PlanDate) => void
  add: (date: PlanDate) => void
}) {
  const [month, setMonth] = useState(() => {
    const today = new Date()
    return { y: today.getFullYear(), m: today.getMonth() }
  })
  const [selectedDay, setSelectedDay] = useState<number | null>(null)
  const first = new Date(month.y, month.m, 1).getDay()
  const days = new Date(month.y, month.m + 1, 0).getDate()
  const { exactByDay, finishedByDay, flexible } = useMemo(() => {
    const byDay = new Map<number, Book[]>()
    const readsByDay = new Map<number, ReadingHistory['records']>()
    const withoutDay: Book[] = []
    for (const book of plans) {
      if (book.plan.y === month.y && book.plan.m === month.m + 1 && book.plan.d != null) {
        const entries = byDay.get(book.plan.d) ?? []
        entries.push(book)
        byDay.set(book.plan.d, entries)
      } else if (
        book.plan.y == null ||
        (book.plan.y === month.y &&
          (book.plan.m == null || (book.plan.m === month.m + 1 && book.plan.d == null)))
      ) {
        withoutDay.push(book)
      }
    }
    for (const read of history?.records ?? []) {
      if (read.finished.y !== month.y || read.finished.m !== month.m + 1 || read.finished.d == null)
        continue
      const entries = readsByDay.get(read.finished.d) ?? []
      entries.push(read)
      readsByDay.set(read.finished.d, entries)
    }
    return { exactByDay: byDay, finishedByDay: readsByDay, flexible: withoutDay }
  }, [history, month.m, month.y, plans])
  const previous = () =>
    setMonth((value) =>
      value.m === 0 ? { y: value.y - 1, m: 11 } : { y: value.y, m: value.m - 1 },
    )
  const next = () =>
    setMonth((value) =>
      value.m === 11 ? { y: value.y + 1, m: 0 } : { y: value.y, m: value.m + 1 },
    )

  return (
    <section aria-labelledby="plan-calendar-heading" className="plan-calendar">
      <div className="plan-calendar-heading">
        <button type="button" onClick={previous} aria-label="Previous month">
          ←
        </button>
        <div>
          <p className="plan-eyebrow">A calendar for possibilities</p>
          <h2 id="plan-calendar-heading">
            {MONTHS[month.m]} {month.y}
          </h2>
        </div>
        <button type="button" onClick={next} aria-label="Next month">
          →
        </button>
      </div>
      <p className="mb-5 text-center text-[13.5px] text-muted">
        Choose a marked day to see plans and finished reads. Empty days begin a plan for that date.
      </p>
      <div className="plan-calendar-key" aria-label="Calendar key">
        <span>
          <i className="is-plan" aria-hidden="true" /> Planned
        </span>
        <span>
          <i className="is-finished" aria-hidden="true" /> Finished
        </span>
      </div>
      <div className="plan-calendar-grid">
        {DOW.map((day) => (
          <span key={day} className="plan-weekday">
            {day}
          </span>
        ))}
        {Array.from({ length: first }).map((_, index) => (
          <span key={`empty-${index}`} />
        ))}
        {Array.from({ length: days }).map((_, index) => {
          const day = index + 1
          const entries = exactByDay.get(day) ?? []
          const finished = finishedByDay.get(day) ?? []
          const total = entries.length + finished.length
          return (
            <button
              key={day}
              type="button"
              className={total ? 'has-entry' : ''}
              aria-label={`${MONTHS[month.m]} ${day}, ${month.y}: ${entries.length} planned, ${finished.length} finished${total ? ` — ${[...entries.map((book) => book.title), ...finished.map((read) => read.book.title)].join(', ')}` : ''}`}
              onClick={() =>
                total ? setSelectedDay(day) : add({ y: month.y, m: month.m + 1, d: day })
              }
            >
              <span>{day}</span>
              {total > 0 && (
                <small aria-hidden="true">
                  {entries.length > 0 && <i className="is-plan">{entries.length}</i>}
                  {finished.length > 0 && <i className="is-finished">{finished.length}</i>}
                </small>
              )}
            </button>
          )
        })}
      </div>

      <div className="mt-7 border-t border-line pt-5">
        <h3 className="text-[17px] font-semibold text-ink">Without a fixed day</h3>
        {flexible.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {flexible.map((book) => (
              <button
                key={book.id}
                type="button"
                className="plan-flexible"
                onClick={() => edit(book)}
              >
                <span>{book.title}</span>
                <small>{readingPlanDateLabel(book)} ↗</small>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[13px] text-muted">No flexible plans in this month.</p>
        )}
      </div>

      {selectedDay != null && (
        <Modal
          title={`${MONTHS[month.m]} ${selectedDay}, ${month.y}`}
          onClose={() => setSelectedDay(null)}
        >
          <div className="grid gap-2">
            {(exactByDay.get(selectedDay) ?? []).length > 0 && (
              <p className="plan-eyebrow mb-0">Planned</p>
            )}
            {(exactByDay.get(selectedDay) ?? []).map((book) => (
              <button
                key={book.id}
                type="button"
                className="plan-flexible"
                onClick={() => {
                  setSelectedDay(null)
                  edit(book)
                }}
              >
                <span>{book.title}</span>
                <small>Edit plan ↗</small>
              </button>
            ))}
            {(finishedByDay.get(selectedDay) ?? []).length > 0 && (
              <p className="plan-eyebrow mb-0 mt-3">Finished</p>
            )}
            {(finishedByDay.get(selectedDay) ?? []).map((read) => (
              <button
                key={read.id}
                type="button"
                className="plan-flexible"
                onClick={() => openBook(read.bookId)}
              >
                <span>{read.book.title}</span>
                <small>Open reading record ↗</small>
              </button>
            ))}
            <Button
              onClick={() => {
                const date = { y: month.y, m: month.m + 1, d: selectedDay }
                setSelectedDay(null)
                add(date)
              }}
            >
              Add another book
            </Button>
          </div>
        </Modal>
      )}
    </section>
  )
}

function PlanPicker({
  books,
  onClose,
  onChoose,
}: {
  books: Book[]
  onClose: () => void
  onChoose: (book: Book) => void
}) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLocaleLowerCase()
  const available = useMemo(
    () =>
      books
        .filter((book) => !isReadingPlan(book) && book.readStatus !== 'Reading')
        .filter(
          (book) =>
            !normalized ||
            book.title.toLocaleLowerCase().includes(normalized) ||
            authorOf(book).toLocaleLowerCase().includes(normalized),
        )
        .slice(0, 24),
    [books, normalized],
  )
  return (
    <Modal title="Leave a place for a book" onClose={onClose}>
      <label className="block text-[13px] font-semibold text-ink">
        Find a book in your library
        <input
          autoFocus
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Title or author"
          className="skin-field mt-2 h-11 w-full border border-line px-3 text-[16px] text-ink outline-none"
          style={{ background: 'var(--field)' }}
        />
      </label>
      <ul className="mt-4 grid max-h-[52vh] gap-2 overflow-y-auto pr-1">
        {available.map((book) => (
          <li key={book.id} className="flex items-center gap-3 border-b border-line pb-2">
            <span className="h-16 w-11 flex-none overflow-hidden rounded-sm bg-field">
              <CoverImage book={book} />
            </span>
            <span className="min-w-0 flex-1">
              <strong className="block text-[14px] leading-snug text-ink">{book.title}</strong>
              <small className="text-[12px] text-muted">{authorOf(book)}</small>
            </span>
            <Button onClick={() => onChoose(book)}>
              Choose<span className="sr-only"> {book.title}</span>
            </Button>
          </li>
        ))}
      </ul>
      {!available.length && (
        <p className="mt-4 text-[13.5px] text-muted">
          No available matches. Try another search or edit a book already in your plan.
        </p>
      )}
    </Modal>
  )
}

export function PlanEditorDialog({
  book,
  books,
  initialDate,
  onClose,
  onSaved,
  onRemoved,
}: {
  book: Book
  books: readonly Book[]
  initialDate?: PlanDate
  onClose: () => void
  onSaved: (book: Book) => void
  onRemoved: (book: Book) => void
}) {
  const update = useUpdateBook(book.id)
  const stored = isReadingPlan(book) ? book.plan : (initialDate ?? EMPTY_PLAN)
  const today = localToday()
  const [precision, setPrecision] = useState<'soon' | 'year' | 'month' | 'day'>(() =>
    stored.y == null ? 'soon' : stored.m == null ? 'year' : stored.d == null ? 'month' : 'day',
  )
  const [day, setDay] = useState(dateInputValue(stored) || dateInputValue(today))
  const [month, setMonth] = useState(monthInputValue(stored) || monthInputValue(today))
  const [year, setYear] = useState(String(stored.y ?? today.y))
  const [intention, setIntention] = useState(book.planIntention ?? '')
  const [error, setError] = useState('')

  const save = () => {
    let date = EMPTY_PLAN
    if (precision === 'day') {
      const [y, m, d] = day.split('-').map(Number)
      if (!y || !m || !d) return setError('Choose a complete day.')
      date = { y, m, d }
    } else if (precision === 'month') {
      const [y, m] = month.split('-').map(Number)
      if (!y || !m) return setError('Choose a month.')
      date = { y, m, d: null }
    } else if (precision === 'year') {
      const y = Number(year)
      if (!Number.isInteger(y) || y < 1900 || y > 2200)
        return setError('Enter a year from 1900 to 2200.')
      date = { y, m: null, d: null }
    }
    setError('')
    update.mutate(
      { id: book.id, patch: planPatch(book, books, date, intention) },
      { onSuccess: () => onSaved(book) },
    )
  }

  return (
    <Modal title="Make a little room" onClose={onClose}>
      <form
        className="plan-editor"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <div className="plan-editor-book">
          <span>
            <CoverImage book={book} />
          </span>
          <div>
            <h3>{book.title}</h3>
            <p>{authorOf(book)}</p>
          </div>
        </div>
        <fieldset>
          <legend>When might you read it?</legend>
          <div className="plan-precision">
            {(
              [
                ['soon', 'Soon'],
                ['year', 'A year'],
                ['month', 'A month'],
                ['day', 'A day'],
              ] as const
            ).map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="precision"
                  value={value}
                  checked={precision === value}
                  onChange={() => setPrecision(value)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {precision === 'day' && (
          <label>
            Planned day
            <input
              required
              type="date"
              value={day}
              onChange={(event) => setDay(event.target.value)}
            />
          </label>
        )}
        {precision === 'month' && (
          <label>
            Planned month
            <input
              required
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
          </label>
        )}
        {precision === 'year' && (
          <label>
            Planned year
            <input
              required
              type="number"
              min="1900"
              max="2200"
              value={year}
              onChange={(event) => setYear(event.target.value)}
            />
          </label>
        )}
        {precision === 'soon' && (
          <p className="plan-editor-hint">
            No date to keep. It stays in your queue until you are ready.
          </p>
        )}
        <label>
          A note to your future self <small>Optional</small>
          <textarea
            rows={3}
            maxLength={300}
            value={intention}
            onChange={(event) => setIntention(event.target.value)}
            placeholder="What draws you to this book?"
          />
        </label>
        {error && (
          <p role="alert" className="text-[13px] text-ink">
            {error}
          </p>
        )}
        {update.isError && (
          <p role="alert" className="text-[13px] text-ink">
            This plan could not be saved. Your previous plan is still here.
          </p>
        )}
        <p className="text-[12px] text-muted">This plan does not change your reading history.</p>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save plan'}
          </Button>
          <button type="button" className="plan-text-button" onClick={onClose}>
            Cancel
          </button>
          {isReadingPlan(book) && (
            <button
              type="button"
              className="plan-text-button ml-auto"
              onClick={() => {
                update.mutate(
                  { id: book.id, patch: removePatch },
                  { onSuccess: () => onRemoved(book) },
                )
              }}
            >
              Remove from plan
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}

function UndoPlan({
  removed,
  clear,
  announce,
}: {
  removed: RemovedPlan
  clear: () => void
  announce: (message: string) => void
}) {
  const update = useUpdateBook(removed.id)
  return (
    <div className="plan-undo">
      <span role="status">Removed {removed.title} from your plan.</span>
      <button
        type="button"
        disabled={update.isPending}
        onClick={() => {
          update.mutate(
            {
              id: removed.id,
              patch: {
                plan: removed.plan,
                planPosition: removed.planPosition,
                planIntention: removed.planIntention,
              },
            },
            {
              onSuccess: () => {
                clear()
                announce(`${removed.title} was restored to your plan.`)
              },
            },
          )
        }}
      >
        Undo
      </button>
      {update.isError && <span role="alert">Could not restore it yet.</span>}
    </div>
  )
}
