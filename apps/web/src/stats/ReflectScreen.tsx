import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  authorOf,
  formatPartialDate,
  MONTH_ABBR,
  summarizeReadingHistory,
  type Book,
  type ReadingBucket,
  type ReadingHistory,
  type RecordedRead,
} from '@reverie/core'
import { useReadingHistory } from '../data/readingHistory'
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'
import { Modal } from '../components/Modal'
import './reflect.css'

type Detail = { title: string; explanation?: string; records?: RecordedRead[]; books?: Book[] }
const dateLabel = (read: RecordedRead) =>
  formatPartialDate(read.finished) || 'Finish date not recorded'

function ReadList({
  records,
  openBook,
}: {
  records: RecordedRead[]
  openBook: (id: string) => void
}) {
  const [limit, setLimit] = useState(12)
  return (
    <>
      <ul className="reflect-records">
        {records.slice(0, limit).map((read) => (
          <li key={read.id}>
            <button type="button" onClick={() => openBook(read.bookId)} className="reflect-record">
              <CoverImage book={read.book} className="reflect-small-cover object-contain" />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{read.book.title}</span>
                <span className="block text-sm text-muted">{authorOf(read.book)}</span>
                <span className="mt-1 block text-sm text-muted">
                  {dateLabel(read)} · {read.format?.trim() || 'Format not recorded'}
                </span>
                {read.rating !== null && read.rating > 0 && (
                  <span className="block text-sm text-muted">Your rating: {read.rating}/5</span>
                )}
                {read.notes?.trim() && (
                  <span className="mt-2 block whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {read.notes}
                  </span>
                )}
                <span className="mt-2 block text-sm text-ink underline underline-offset-4">
                  Open book
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {records.length > limit && (
        <Button variant="secondary" onClick={() => setLimit((n) => n + 24)}>
          Show more reads ({records.length - limit} remaining)
        </Button>
      )}
    </>
  )
}

function BookList({ books, openBook }: { books: Book[]; openBook: (id: string) => void }) {
  const [limit, setLimit] = useState(24)
  return (
    <>
      <ul className="reflect-records">
        {books.slice(0, limit).map((book) => (
          <li key={book.id}>
            <button type="button" className="reflect-record" onClick={() => openBook(book.id)}>
              <CoverImage book={book} className="reflect-small-cover object-contain" />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{book.title}</span>
                <span className="block text-sm text-muted">{authorOf(book)}</span>
                <span className="mt-2 block text-sm text-ink underline underline-offset-4">
                  Open book
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {books.length > limit && (
        <Button variant="secondary" onClick={() => setLimit((n) => n + 24)}>
          Show more books
        </Button>
      )}
    </>
  )
}

function Breakdown({
  title,
  description,
  entries,
  open,
}: {
  title: string
  description: string
  entries: ReadingBucket[]
  open: (detail: Detail) => void
}) {
  const max = Math.max(1, ...entries.map((entry) => entry.records.length))
  return (
    <section className="reflect-breakdown">
      <h2>{title}</h2>
      <p className="mb-5 text-sm leading-relaxed text-muted">{description}</p>
      {entries.length ? (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.label}>
              <button
                type="button"
                className="reflect-bar"
                onClick={() => open({ title: `${title}: ${entry.label}`, records: entry.records })}
              >
                <span className="flex justify-between gap-4">
                  <span className="capitalize">{entry.label}</span>
                  <span>
                    {entry.records.length} {entry.records.length === 1 ? 'read' : 'reads'}
                  </span>
                </span>
                <span aria-hidden="true" className="reflect-track">
                  <span style={{ width: `${(entry.records.length / max) * 100}%` }} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Your logged reads will appear here.</p>
      )}
    </section>
  )
}

/** The view accepts real, already scoped personal data; the query boundary stays outside it. */
export function ReflectView({
  history,
  openBook,
  currentYear = new Date().getFullYear(),
}: {
  history: ReadingHistory
  openBook: (id: string) => void
  currentYear?: number
}) {
  const [period, setPeriod] = useState<number | 'all'>(currentYear)
  const [detail, setDetail] = useState<Detail | null>(null)
  const summary = useMemo(() => summarizeReadingHistory(history, period), [history, period])
  const years = [
    ...new Set([currentYear, ...history.years, ...(period === 'all' ? [] : [period])]),
  ].sort((a, b) => b - a)
  const periodLabel = period === 'all' ? 'All recorded years' : String(period)
  const highlight = summary.records.find((read) => read.notes?.trim()) ?? summary.records[0]
  const maxMonth = Math.max(1, ...summary.months.map((reads) => reads.length))
  const open = (next: Detail) => setDetail(next)
  return (
    <div className="reflect">
      <header className="reflect-heading">
        <div>
          <p className="reflect-eyebrow">Your reading life · private</p>
          <h1>Reflect</h1>
          <p className="mt-3 max-w-lg text-muted">
            The books you spent time with. The thoughts you kept.
          </p>
        </div>
        <label className="flex flex-col gap-2 text-sm text-muted">
          Reading period
          <select
            aria-label="Stats year"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value === 'all' ? 'all' : Number(event.target.value))
              setDetail(null)
            }}
            className="skin-field min-h-11 border border-line bg-card px-3 text-base text-ink"
          >
            <option value="all">All recorded years</option>
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
      </header>

      {highlight ? (
        <section className="reflect-memory" aria-label="From your reading record">
          <button
            type="button"
            className="reflect-cover-button"
            onClick={() => openBook(highlight.bookId)}
            aria-label={`Open ${highlight.book.title}`}
          >
            <CoverImage book={highlight.book} className="reflect-cover object-contain" />
          </button>
          <div className="min-w-0">
            <p className="reflect-eyebrow">
              {highlight.notes?.trim() ? 'A thought you kept' : 'From your reading record'}
            </p>
            {highlight.notes?.trim() ? (
              <blockquote className="reflect-quote">{highlight.notes}</blockquote>
            ) : (
              <h2 className="reflect-quote">{highlight.book.title}</h2>
            )}
            <button
              type="button"
              className="reflect-book-link"
              onClick={() => openBook(highlight.bookId)}
            >
              {highlight.book.title}{' '}
              <span className="font-normal">· {authorOf(highlight.book)}</span>
            </button>
            <p className="mt-2 text-sm text-muted">{dateLabel(highlight)}</p>
          </div>
        </section>
      ) : (
        <section className="reflect-memory">
          <div>
            <p className="reflect-eyebrow">A place for what stays with you</p>
            <h2 className="reflect-quote">
              {history.records.length
                ? `No dated reads in ${period}.`
                : 'Your reading life begins with a book.'}
            </h2>
            <p className="max-w-xl leading-relaxed text-muted">
              Finish a book or open one in your library to log a past read. A date is optional; the
              memory still belongs here.
            </p>
            {history.records.length > 0 && (
              <Button variant="secondary" className="mt-4" onClick={() => setPeriod('all')}>
                See all recorded years
              </Button>
            )}
          </div>
        </section>
      )}

      <section aria-label={`${periodLabel} summary`}>
        <p className="reflect-eyebrow mb-3">{periodLabel} · open a number to see its record</p>
        <div className="reflect-metrics">
          <button
            type="button"
            onClick={() =>
              open({ title: `Logged reads · ${periodLabel}`, records: summary.records })
            }
          >
            <strong>{summary.records.length}</strong>
            <span>Logged reads</span>
            <small>Finished reads, including returns</small>
          </button>
          <button
            type="button"
            onClick={() =>
              open({ title: `Distinct books · ${periodLabel}`, books: summary.distinctBooks })
            }
          >
            <strong>{summary.distinctBooks.length}</strong>
            <span>Distinct books</span>
            <small>Each book counted once</small>
          </button>
          <button
            type="button"
            onClick={() =>
              open({
                title: `Return reads · ${periodLabel}`,
                records: summary.returnContext,
                explanation:
                  'The full recorded history of books you returned to, including reads outside this period. Each log after the first adds one return. An unknown date cannot establish which year a return belongs to.',
              })
            }
          >
            <strong>
              {summary.returnsAreMinimum ? '≥ ' : ''}
              {summary.returns}
            </strong>
            <span>Return reads</span>
            <small>
              {summary.returnsAreMinimum
                ? 'At least this many; some dates are missing'
                : 'Repetitions in your recorded history'}
            </small>
          </button>
        </div>
      </section>

      <section className="reflect-months-section">
        <div className="mb-6">
          <h2>Month by month</h2>
          <p className="text-sm text-muted">
            {period === 'all'
              ? 'Logged finishes grouped by month across all years.'
              : `Logged finishes in ${period}. A finish is not a measure of days spent reading.`}
          </p>
        </div>
        <div className="reflect-months">
          {summary.months.map((reads, i) => (
            <button
              type="button"
              key={i}
              onClick={() => open({ title: `${MONTH_ABBR[i]} · ${periodLabel}`, records: reads })}
              aria-label={`${MONTH_ABBR[i]}: ${reads.length} logged reads`}
            >
              <span className="text-sm">{reads.length}</span>
              <span className="reflect-month-bar" aria-hidden="true">
                <span style={{ height: `${(reads.length / maxMonth) * 100}%` }} />
              </span>
              <span className="text-sm">{MONTH_ABBR[i]}</span>
            </button>
          ))}
        </div>
        {summary.withoutMonth.length > 0 && (
          <button
            type="button"
            className="reflect-text-link mt-4"
            onClick={() =>
              open({ title: 'Reads without a recorded month', records: summary.withoutMonth })
            }
          >
            {summary.withoutMonth.length} reads have no recorded month and stay outside this chart.
          </button>
        )}
      </section>

      <div className="reflect-breakdowns">
        <Breakdown
          title="The genres you spent time with"
          description="Logged reads in this period, using the book’s current genres. A book may appear in more than one genre."
          entries={summary.genres}
          open={open}
        />
        <Breakdown
          title="How you read"
          description="The format saved on each read in this period. Missing formats stay unrecorded."
          entries={summary.formats}
          open={open}
        />
      </div>

      <section className="reflect-history">
        <h2>Your record · {periodLabel}</h2>
        <p className="mb-4 text-sm text-muted">
          Open a book to revisit its notes or add an earlier read.
        </p>
        {summary.records.length ? (
          <ReadList key={period} records={summary.records} openBook={openBook} />
        ) : (
          <p className="py-4 text-muted">No logged reads in this period.</p>
        )}
      </section>

      {(summary.undated.length > 0 ||
        history.markedRead.length > 0 ||
        history.stopped.length > 0) && (
        <aside className="reflect-context" aria-label="Outside the dated record">
          <h2>Outside the dated record</h2>
          <p className="mb-4 text-sm leading-relaxed text-muted">
            These details belong to your library as a whole. They do not add a guessed finish to the
            selected year.
          </p>
          {summary.undated.length > 0 && (
            <button
              type="button"
              className="reflect-context-link"
              onClick={() =>
                open({ title: 'Reads without a finish date', records: summary.undated })
              }
            >
              <strong>
                {summary.undated.length} undated {summary.undated.length === 1 ? 'read' : 'reads'}
              </strong>
              <span>Included in all recorded years.</span>
            </button>
          )}
          {history.markedRead.length > 0 && (
            <button
              type="button"
              className="reflect-context-link"
              onClick={() =>
                open({
                  title: 'Marked read, without a log',
                  books: history.markedRead,
                  explanation:
                    'These books are marked read. No finish, format, or number of rereads has been inferred. Open a book to add a past read if you want it in your record.',
                })
              }
            >
              <strong>
                {history.markedRead.length} {history.markedRead.length === 1 ? 'book' : 'books'}{' '}
                marked read without a log
              </strong>
              <span>Part of your library, without an invented reading session.</span>
            </button>
          )}
          {history.stopped.length > 0 && (
            <button
              type="button"
              className="reflect-context-link"
              onClick={() =>
                open({
                  title: 'Currently set aside',
                  books: history.stopped,
                  explanation:
                    'Books currently marked DNF. Earlier finished reads still count; the app does not record a date for a stopped attempt.',
                })
              }
            >
              <strong>
                {history.stopped.length} {history.stopped.length === 1 ? 'book' : 'books'} currently
                set aside
              </strong>
              <span>Your current DNF books, not a dated count of attempts.</span>
            </button>
          )}
        </aside>
      )}

      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)} wide>
          {detail.explanation && (
            <p className="mb-5 text-sm leading-relaxed text-muted">{detail.explanation}</p>
          )}
          {detail.records &&
            (detail.records.length ? (
              <ReadList records={detail.records} openBook={openBook} />
            ) : (
              <p className="text-muted">No logged reads in this selection.</p>
            ))}
          {detail.books &&
            (detail.books.length ? (
              <BookList books={detail.books} openBook={openBook} />
            ) : (
              <p className="text-muted">No books in this selection.</p>
            ))}
        </Modal>
      )}
    </div>
  )
}

export function ReflectScreen() {
  const history = useReadingHistory()
  const navigate = useNavigate()
  const openBook = (id: string) => void navigate({ to: '/book/$bookId', params: { bookId: id } })
  if (!history.data)
    return (
      <section className="reflect">
        <h1>Reflect</h1>
        <p role={history.isError ? 'alert' : 'status'} className="my-5 text-muted">
          {history.isError
            ? 'Your reading history could not be loaded. Try again when you are connected.'
            : history.isPaused
              ? 'Connect to load your reading history.'
              : 'Gathering your reading history…'}
        </p>
        {history.isError && <Button onClick={() => void history.refetch()}>Try again</Button>}
      </section>
    )
  return (
    <>
      {history.isError && (
        <div role="status" className="px-6 pt-4 text-sm text-muted">
          Showing your last loaded reading history.{' '}
          <button type="button" className="underline" onClick={() => void history.refetch()}>
            Try updating again
          </button>
        </div>
      )}
      <ReflectView history={history.data} openBook={openBook} />
    </>
  )
}
