import { ReadingTips } from '../components/ReadingTips'
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
import { Button } from '../components/Button'
import { CoverImage } from '../components/CoverImage'
import { Modal } from '../components/Modal'
import { SignatureRing } from '../components/Structure'
import { useProfile } from '../data/profile'
import { useReadingHistory } from '../data/readingHistory'
import './reflect.css'

type Detail = { title: string; explanation?: string; records?: RecordedRead[]; books?: Book[] }

const dateLabel = (read: RecordedRead) =>
  formatPartialDate(read.finished) || 'Finish date not recorded'

const recorded = (entries: ReadingBucket[]) =>
  entries.filter((entry) => entry.label.toLocaleLowerCase() !== 'not recorded')

const missing = (entries: ReadingBucket[]) =>
  entries.find((entry) => entry.label.toLocaleLowerCase() === 'not recorded')

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
        <Button variant="secondary" onClick={() => setLimit((count) => count + 24)}>
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
        <Button variant="secondary" onClick={() => setLimit((count) => count + 24)}>
          Show more books
        </Button>
      )}
    </>
  )
}

function Breakdown({
  eyebrow,
  title,
  description,
  emptyCopy,
  entries,
  open,
  limit = 6,
}: {
  eyebrow: string
  title: string
  description: string
  emptyCopy: string
  entries: ReadingBucket[]
  open: (detail: Detail) => void
  limit?: number
}) {
  const known = recorded(entries)
  const unknown = missing(entries)
  const shown = known.slice(0, limit)
  const max = Math.max(1, ...shown.map((entry) => entry.records.length))
  const detailTitle = title.replace(/[.!?]+$/u, '')
  return (
    <section className="reflect-breakdown">
      <p className="reflect-eyebrow">{eyebrow}</p>
      <h2>{title}</h2>
      <p className="reflect-section-note">{description}</p>
      {shown.length ? (
        <ul className="reflect-bars">
          {shown.map((entry) => (
            <li key={entry.label}>
              <button
                type="button"
                className="reflect-bar"
                onClick={() =>
                  open({ title: `${detailTitle}: ${entry.label}`, records: entry.records })
                }
              >
                <span className="reflect-bar-label">
                  <span className={eyebrow === 'Genres' ? 'capitalize' : undefined}>
                    {entry.label}
                  </span>
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
        <p className="reflect-empty-copy">{emptyCopy}</p>
      )}
      {unknown && (
        <button
          type="button"
          className="reflect-text-link reflect-missing"
          onClick={() =>
            open({
              title: `${detailTitle}: not recorded`,
              records: unknown.records,
              explanation:
                'These reads stay in your totals. This detail is simply absent from the current book or read record.',
            })
          }
        >
          {unknown.records.length} {unknown.records.length === 1 ? 'read has' : 'reads have'} no{' '}
          {eyebrow.toLocaleLowerCase()} recorded.
        </button>
      )}
    </section>
  )
}

function CoverGathering({ books }: { books: Book[] }) {
  return (
    <div className="reflect-cover-gathering" aria-label="Books from this period">
      {books.slice(0, 7).map((book, index) => (
        <span key={book.id} style={{ zIndex: books.length - index }}>
          <CoverImage book={book} className="reflect-gathered-cover object-contain" />
        </span>
      ))}
    </div>
  )
}

/** The view accepts real, already scoped personal data; the query boundary stays outside it. */
export function ReflectView({
  history,
  openBook,
  openPlan = () => {},
  editGoal = () => {},
  goalYear = null,
  goalTarget = 0,
  currentYear = new Date().getFullYear(),
}: {
  history: ReadingHistory
  openBook: (id: string) => void
  openPlan?: () => void
  editGoal?: () => void
  goalYear?: number | null
  goalTarget?: number | null
  currentYear?: number
}) {
  const [period, setPeriod] = useState<number | 'all'>(currentYear)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [retrospectiveOpen, setRetrospectiveOpen] = useState(false)
  const summary = useMemo(() => summarizeReadingHistory(history, period), [history, period])
  const years = [
    ...new Set([currentYear, ...history.years, ...(period === 'all' ? [] : [period])]),
  ].sort((a, b) => b - a)
  const periodLabel = period === 'all' ? 'All recorded years' : String(period)
  const periodTitle = period === 'all' ? 'Your reading, in books.' : `Your ${period}, in books.`
  const highlight = summary.records.find((read) => read.notes?.trim()) ?? summary.records[0]
  const maxMonth = Math.max(1, ...summary.months.map((reads) => reads.length))
  const readsWithMonth = summary.months.reduce((total, reads) => total + reads.length, 0)
  const busiestMonth = summary.months.reduce(
    (winner, reads, index) =>
      reads.length > (summary.months[winner]?.length ?? 0) ? index : winner,
    0,
  )
  const busiestMonthCount = summary.months[busiestMonth]?.length ?? 0
  const busiestMonthIsTied =
    busiestMonthCount > 0 &&
    summary.months.filter((reads) => reads.length === busiestMonthCount).length > 1
  const topGenre = recorded(summary.genres)[0]
  const topAuthor = recorded(summary.authors)[0]
  const topTrope = recorded(summary.tropes)[0]
  const topMood = recorded(summary.moods)[0]
  const topFormat = recorded(summary.formats)[0]
  const notedReads = summary.records.filter((read) => read.notes?.trim())
  const showGoal = period === currentYear && goalYear === currentYear
  const activeGoal = showGoal ? Math.max(0, goalTarget ?? 0) : 0
  const open = (next: Detail) => setDetail(next)

  return (
    <div className="reflect">
      <header className="reflect-heading">
        <div>
          <p className="reflect-eyebrow">Reflect · your reading life is private</p>
          <h1>{periodTitle}</h1>
          <ReadingTips>
            <p className="reflect-intro">
              The stories you finished, the ones you returned to, and a little of what stayed.
            </p>
          </ReadingTips>
        </div>
        <label className="reflect-period">
          Reading period
          <select
            aria-label="Stats year"
            value={period}
            onChange={(event) => {
              setPeriod(event.target.value === 'all' ? 'all' : Number(event.target.value))
              setDetail(null)
              setRetrospectiveOpen(false)
            }}
            className="skin-field"
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
        <section className="reflect-opening" aria-label="From your reading record">
          <div className="reflect-memory">
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
          </div>
          {period === currentYear && (
            <aside className="reflect-goal" aria-labelledby="reflect-goal-title">
              {activeGoal > 0 ? (
                <SignatureRing value={summary.distinctBooks.length} max={activeGoal} size={104} />
              ) : (
                <span className="reflect-goal-mark" aria-hidden="true" />
              )}
              <div>
                <p className="reflect-eyebrow">A measure you chose</p>
                <h2 id="reflect-goal-title">Your reading goal</h2>
                <p>
                  {activeGoal > 0
                    ? `${summary.distinctBooks.length} of ${activeGoal} books in ${currentYear}. Every finished book still belongs here if the goal changes.`
                    : 'No goal is required. Set one only if it makes your reading life feel more like your own.'}
                </p>
                <button type="button" className="reflect-text-link" onClick={editGoal}>
                  {activeGoal > 0 ? 'Edit your goal' : 'Set a reading goal'}
                </button>
              </div>
            </aside>
          )}
        </section>
      ) : (
        <section className="reflect-memory reflect-memory-empty">
          <div>
            <p className="reflect-eyebrow">There is room to begin</p>
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

      <section className="reflect-summary" aria-label={`${periodLabel} summary`}>
        <p className="reflect-eyebrow">
          {periodLabel}
          <ReadingTips> · open a number to see its record</ReadingTips>
        </p>
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
                : 'Familiar books, met again'}
            </small>
          </button>
        </div>
      </section>

      <section className="reflect-months-section">
        <div className="reflect-section-heading">
          <div>
            <p className="reflect-eyebrow">Along the way</p>
            <h2>A rhythm of finished books.</h2>
          </div>
          <p>
            {readsWithMonth > 0
              ? `${MONTH_ABBR[busiestMonth]} ${busiestMonthIsTied ? 'was one of the fullest months' : 'was the fullest month'}, with ${busiestMonthCount} ${busiestMonthCount === 1 ? 'finish' : 'finishes'}. Choose a month to revisit it.`
              : 'No finish months are recorded for this period.'}
            <br />
            Finishes, never a measure of days spent reading.
          </p>
        </div>
        <div className="reflect-months" aria-label="Logged reads by month">
          {summary.months.map((reads, index) => (
            <button
              type="button"
              key={MONTH_ABBR[index]}
              onClick={() =>
                open({ title: `${MONTH_ABBR[index]} · ${periodLabel}`, records: reads })
              }
              aria-label={`${MONTH_ABBR[index]}: ${reads.length} logged reads`}
            >
              <span className="reflect-month-stack" aria-hidden="true">
                {Array.from({ length: Math.min(reads.length, 5) }, (_, marker) => (
                  <span key={marker} />
                ))}
                {reads.length === 0 && <i />}
              </span>
              <strong>{reads.length || '–'}</strong>
              <span>{MONTH_ABBR[index]}</span>
              <span
                className="reflect-month-fill"
                aria-hidden="true"
                style={{ height: `${(reads.length / maxMonth) * 100}%` }}
              />
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

      <div className="reflect-breakdowns reflect-breakdowns-primary">
        <Breakdown
          eyebrow="Genres"
          title="Where you wandered."
          description="Genres on books finished in this period. A read may belong to more than one."
          emptyCopy="Add a genre when it helps you find the book again."
          entries={summary.genres}
          open={open}
        />
        <Breakdown
          eyebrow="Authors"
          title="The voices you spent time with."
          description="Author and co-author bylines in this period. Co-authored books appear with each writer."
          emptyCopy="Authors will gather here as your reading record grows."
          entries={summary.authors}
          open={open}
        />
      </div>

      <div className="reflect-breakdowns reflect-breakdowns-personal">
        <Breakdown
          eyebrow="Tropes"
          title="The shapes that drew you in."
          description="Current tropes on the books you finished, including the ones you returned to."
          emptyCopy="No tropes are attached to these books yet."
          entries={summary.tropes}
          open={open}
          limit={5}
        />
        <Breakdown
          eyebrow="Moods"
          title="What the books left with you."
          description="Moods you assigned yourself. Reverie never infers how a book made you feel."
          emptyCopy="No reading moods are attached to these books yet."
          entries={summary.moods}
          open={open}
          limit={5}
        />
      </div>

      <section className="reflect-formats">
        <div>
          <p className="reflect-eyebrow">Formats</p>
          <h2>In your hands. In your ears.</h2>
          <p className="reflect-section-note">
            The format saved on each read. Missing formats stay unrecorded.
          </p>
        </div>
        <div className="reflect-format-grid">
          {summary.formats.map((entry) => (
            <button
              type="button"
              key={entry.label}
              aria-label={`${entry.label} ${entry.records.length} ${entry.records.length === 1 ? 'read' : 'reads'}`}
              onClick={() =>
                open({ title: `How you read: ${entry.label}`, records: entry.records })
              }
            >
              <strong>{entry.records.length}</strong>
              <span>{entry.label}</span>
            </button>
          ))}
        </div>
      </section>

      {summary.records.length > 0 && (
        <section className="reflect-keepsake">
          <div>
            <p className="reflect-eyebrow">For your eyes only</p>
            <h2>Spend a moment with {period === 'all' ? 'your reading' : period}.</h2>
            <p>
              A private retrospective made only from these books, the details you recorded, and the
              notes you chose to keep.
            </p>
            <Button onClick={() => setRetrospectiveOpen(true)} aria-haspopup="dialog">
              Open your retrospective
            </Button>
          </div>
          <CoverGathering books={summary.distinctBooks} />
        </section>
      )}

      <section className="reflect-history">
        <div className="reflect-section-heading">
          <div>
            <p className="reflect-eyebrow">The ledger</p>
            <h2>Your record · {periodLabel}</h2>
          </div>
          <ReadingTips>
            <p>Open a book to revisit its notes or add an earlier read.</p>
          </ReadingTips>
        </div>
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
          <p className="reflect-eyebrow">Kept without a guessed date</p>
          <h2>Outside the dated record</h2>
          <p className="reflect-section-note">
            These details belong to your library as a whole. They do not add a guessed finish to the
            selected year.
          </p>
          <div className="reflect-context-grid">
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
                  {history.stopped.length} {history.stopped.length === 1 ? 'book' : 'books'}{' '}
                  currently set aside
                </strong>
                <span>Your current DNF books, not a dated count of attempts.</span>
              </button>
            )}
          </div>
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

      {retrospectiveOpen && (
        <Modal
          title={period === 'all' ? 'Your reading, gathered here' : `Your ${period} in books`}
          onClose={() => setRetrospectiveOpen(false)}
          wide
        >
          <div className="reflect-retrospective">
            <p className="reflect-eyebrow">
              A private retrospective · {period === 'all' ? 'All recorded years' : period}
            </p>
            <h2>{periodTitle}</h2>

            <ul className="reflect-story-covers" aria-label="Books in this retrospective">
              {summary.distinctBooks.slice(0, 7).map((book) => (
                <li key={book.id}>
                  <button
                    type="button"
                    onClick={() => openBook(book.id)}
                    aria-label={`Open ${book.title}`}
                  >
                    <CoverImage book={book} thumb className="reflect-story-cover object-contain" />
                  </button>
                </li>
              ))}
            </ul>
            {summary.distinctBooks.length > 7 && (
              <p className="reflect-story-caption">
                Seven of {summary.distinctBooks.length} distinct books are gathered here.
              </p>
            )}
            <p className="reflect-retrospective-lead">
              {summary.records.length} logged {summary.records.length === 1 ? 'read' : 'reads'}{' '}
              across {summary.distinctBooks.length}{' '}
              {summary.distinctBooks.length === 1 ? 'book' : 'books'}.
              {summary.returns === 1 &&
                ` ${summary.returnsAreMinimum ? 'At least one' : 'One'} was a return to familiar company.`}
              {summary.returns > 1 &&
                ` ${summary.returnsAreMinimum ? 'At least ' : ''}${summary.returns} were returns to familiar company.`}
              {summary.returns === 0 &&
                summary.returnsAreMinimum &&
                ' Missing dates leave the number of returns open.'}
            </p>
            <dl className="reflect-story-facts">
              {readsWithMonth > 0 && (
                <div>
                  <dt>{busiestMonthIsTied ? 'One of the fullest months' : 'The fullest month'}</dt>
                  <dd>{MONTH_ABBR[busiestMonth]}</dd>
                </div>
              )}
              {topGenre && (
                <div>
                  <dt>Most visited genre</dt>
                  <dd className="capitalize">{topGenre.label}</dd>
                </div>
              )}
              {topAuthor && (
                <div>
                  <dt>Most-read voice</dt>
                  <dd>{topAuthor.label}</dd>
                </div>
              )}
              {topTrope && (
                <div>
                  <dt>A recurring shape</dt>
                  <dd>{topTrope.label}</dd>
                </div>
              )}
              {topMood && (
                <div>
                  <dt>A mood you kept</dt>
                  <dd>{topMood.label}</dd>
                </div>
              )}
              {topFormat && (
                <div>
                  <dt>A format in the record</dt>
                  <dd>{topFormat.label}</dd>
                </div>
              )}
              <div>
                <dt>Notes kept</dt>
                <dd>{notedReads.length}</dd>
              </div>
            </dl>
            {highlight?.notes?.trim() && (
              <blockquote className="reflect-story-note">
                {highlight.notes}
                <cite>Your note on {highlight.book.title}</cite>
              </blockquote>
            )}
            <p className="reflect-private-note">
              Kept here for you. Reverie does not create a public score or share card from this
              view.
            </p>
            <div className="reflect-story-actions">
              <Button variant="secondary" onClick={() => setRetrospectiveOpen(false)}>
                Return to your record
              </Button>
              <Button
                onClick={() => {
                  setRetrospectiveOpen(false)
                  openPlan()
                }}
              >
                Turn toward what’s next
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export function ReflectScreen() {
  const history = useReadingHistory()
  const profile = useProfile()
  const navigate = useNavigate()
  const openBook = (id: string) => void navigate({ to: '/book/$bookId', params: { bookId: id } })
  const openPlan = () => void navigate({ to: '/planner' })
  if (!history.data)
    return (
      <section className="reflect">
        <p className="reflect-eyebrow">Your reading life · private</p>
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
      <ReflectView
        history={history.data}
        openBook={openBook}
        goalYear={profile.data?.goalYear}
        goalTarget={profile.data?.goalTarget}
        editGoal={() => void navigate({ to: '/settings' })}
        openPlan={openPlan}
      />
    </>
  )
}
