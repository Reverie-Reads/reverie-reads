import { useEffect, useState } from 'react'
import { SKINS, SKIN_ORDER, type SkinId } from '@reverie/core'
import { Modal } from '../../../apps/web/src/components/Modal'
import { ReverieMark } from '../../../apps/web/src/components/ReverieMark'
import { SkinAtmosphereCanvas } from '../../../apps/web/src/components/SkinAtmosphereCanvas'
import { loadSkinFont } from '../../../apps/web/src/skin/fonts'
import {
  book,
  catalog,
  dateLabel,
  histories,
  initialPlans,
  monthNames,
  summary,
  type Period,
  type Plan,
  type Read,
  type Scenario,
} from './model'
import specUrl from './READING_LIFE.md?url'

type View = 'reflect' | 'plan'
type Detail = { title: string; reads: Read[] }
function Cover({ id, large = false }: { id: string; large?: boolean }) {
  const b = book(id)
  const [failed, setFailed] = useState(false)
  return (
    <span className={`rl-cover ${large ? 'rl-cover-large' : ''}`}>
      {failed ? (
        <span className="rl-cover-fallback">
          {b.title}
          <small>{b.author}</small>
        </span>
      ) : (
        <img src={b.cover} alt="" onError={() => setFailed(true)} />
      )}
    </span>
  )
}
function ReadRows({ reads }: { reads: Read[] }) {
  return (
    <ul className="rl-read-list">
      {reads.map((r) => (
        <li key={r.id}>
          <Cover id={r.bookId} />
          <div>
            <h3>{book(r.bookId).title}</h3>
            <p>{book(r.bookId).author}</p>
            <p className="rl-caption">
              {r.outcome === 'stopped' ? 'Stopped' : r.reread ? 'Finished a reread' : 'Finished'} ·{' '}
              {dateLabel(r.date)} · {r.format ?? 'Format not recorded'}
            </p>
            {r.note && <blockquote>{r.note}</blockquote>}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function ReadingLifeStudy() {
  const [skin, setSkin] = useState<SkinId>(document.documentElement.dataset.skin as SkinId)
  const [mode, setMode] = useState<'light' | 'dark'>(
    document.documentElement.dataset.mode as 'light' | 'dark',
  )
  const [scenario, setScenario] = useState<Scenario>('settled')
  const [view, setView] = useState<View>('reflect')
  const [period, setPeriod] = useState<Period>('2026')
  const [plans, setPlans] = useState<Plan[]>(initialPlans.settled)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [story, setStory] = useState(false)
  const [editor, setEditor] = useState<Plan | null>(null)
  const [picker, setPicker] = useState(false)
  const [search, setSearch] = useState('')
  const [pickerDate, setPickerDate] = useState('')
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [calendar, setCalendar] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(8)
  const [removed, setRemoved] = useState<{ plan: Plan; index: number } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const reads = histories[scenario]
  const stats = summary(reads, period)
  const reflection = stats.finished.findLast((r) => r.note)
  const current = scenario === 'settled' ? 'sweetgrass' : 'psalm'
  useEffect(() => {
    document.documentElement.dataset.skin = skin
    document.documentElement.dataset.mode = mode
    loadSkinFont(skin)
    const url = new URL(location.href)
    url.searchParams.set('skin', skin)
    url.searchParams.set('mode', mode)
    history.replaceState(null, '', url)
  }, [skin, mode])
  function reset(value: Scenario) {
    setScenario(value)
    setCalendar(false)
    setCalendarMonth(8)
    setPlans(initialPlans[value])
    setRemoved(null)
    setPeriod('2026')
    setAnnouncement('Sample library reset. All changes stay in this preview.')
  }
  function remove(plan: Plan) {
    setRemoved({ plan, index: plans.findIndex((p) => p.bookId === plan.bookId) })
    setPlans(plans.filter((p) => p.bookId !== plan.bookId))
    setAnnouncement(
      `${book(plan.bookId).title} removed from the plan. Reading history is unchanged.`,
    )
  }
  function move(index: number, direction: number) {
    const next = [...plans]
    const entry = next.splice(index, 1)[0]!
    next.splice(index + direction, 0, entry)
    setPlans(next)
    setAnnouncement(
      `${book(entry.bookId).title} moved ${direction < 0 ? 'earlier' : 'later'} in your queue.`,
    )
  }
  const yearLabel = period === 'all' ? 'Your reading so far' : `Your ${period} in books`
  const available = catalog.filter(
    (b) =>
      b.id !== current &&
      !plans.some((p) => p.bookId === b.id) &&
      `${b.title} ${b.author}`.toLowerCase().includes(search.toLowerCase()),
  )
  const calendarKey = `2026-${String(calendarMonth + 1).padStart(2, '0')}`
  const days = new Date(2026, calendarMonth + 1, 0).getDate()
  const offset = (new Date(2026, calendarMonth, 1).getDay() + 6) % 7
  function openPicker(date = '') {
    setPickerDate(date)
    setSearch('')
    setPicker(true)
  }
  return (
    <>
      <div className="rl-atmosphere" aria-hidden="true" data-skin={skin} data-mode={mode}>
        <SkinAtmosphereCanvas skin={skin} mode={mode} />
      </div>
      <aside className="rl-study" aria-label="Design study controls">
        <a href={specUrl}>
          Design study <span aria-hidden="true">↗</span>
        </a>
        <label>
          Room
          <select value={skin} onChange={(e) => setSkin(e.target.value as SkinId)}>
            {SKIN_ORDER.map((s) => (
              <option key={s} value={s}>
                {SKINS[s].label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Light
          <select value={mode} onChange={(e) => setMode(e.target.value as 'light' | 'dark')}>
            <option value="light">Day</option>
            <option value="dark">Night</option>
          </select>
        </label>
        <label>
          Sample reader
          <select value={scenario} onChange={(e) => reset(e.target.value as Scenario)}>
            <option value="settled">A settled library</option>
            <option value="starting">Just beginning</option>
          </select>
        </label>
        <span className="rl-study-note">Fictional history · resets on refresh</span>
      </aside>
      <div className="rl-shell">
        <header className="rl-header">
          <a className="rl-wordmark" href="#main">
            <ReverieMark className="h-7 w-7" />
            Reverie
          </a>
          <span className="rl-private">Your private reading life</span>
          <span className="rl-room">
            {SKINS[skin].label} · {mode === 'light' ? 'Day' : 'Night'}
          </span>
        </header>
        <nav className="rl-navigation" aria-label="Reading life">
          <button aria-pressed={view === 'reflect'} onClick={() => setView('reflect')}>
            <span aria-hidden="true">◌</span> Reflect
          </button>
          <button aria-pressed={view === 'plan'} onClick={() => setView('plan')}>
            <span aria-hidden="true">☷</span> Plan
          </button>
          <span>September 7, 2026 · sample timeline</span>
        </nav>
        <main id="main">
          {view === 'reflect' ? (
            <>
              <div className="rl-title-row">
                <div>
                  <p className="rl-eyebrow">A record, gently kept</p>
                  <h1>
                    {yearLabel.split(' in books')[0]}
                    {period !== 'all' && (
                      <>
                        <br />
                        <em>in books.</em>
                      </>
                    )}
                  </h1>
                  <p className="rl-intro">
                    The stories you finished. The ones you returned to.
                    <br className="rl-desktop" /> A little of what stayed.
                  </p>
                </div>
                <label className="rl-period">
                  Reading period
                  <select value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
                    <option value="2026">2026</option>
                    <option value="2025">2025</option>
                    <option value="all">All time</option>
                  </select>
                </label>
              </div>
              {stats.finished.length ? (
                <>
                  <section className="rl-opening" aria-label="Reading highlights">
                    <div className="rl-memory">
                      <div className="rl-memory-copy">
                        <p className="rl-eyebrow">
                          {reflection ? 'A thought you kept' : 'A book you spent time with'}
                        </p>
                        <blockquote>
                          {reflection
                            ? reflection.note
                            : 'Every return to a book belongs in your reading life.'}
                        </blockquote>
                        <button
                          className="rl-text-button"
                          onClick={() =>
                            setDetail({
                              title: book((reflection ?? stats.finished.at(-1)!).bookId).title,
                              reads: [reflection ?? stats.finished.at(-1)!],
                            })
                          }
                        >
                          {book((reflection ?? stats.finished.at(-1)!).bookId).title}{' '}
                          <span aria-hidden="true">↗</span>
                        </button>
                        <p className="rl-caption">
                          {reflection ? 'Your sample note · ' : ''}
                          {dateLabel((reflection ?? stats.finished.at(-1)!).date)}
                        </p>
                      </div>
                      <button
                        className="rl-cover-button"
                        aria-label={`Open reading for ${book((reflection ?? stats.finished.at(-1)!).bookId).title}`}
                        onClick={() =>
                          setDetail({
                            title: 'From your reading history',
                            reads: [reflection ?? stats.finished.at(-1)!],
                          })
                        }
                      >
                        <Cover large id={(reflection ?? stats.finished.at(-1)!).bookId} />
                      </button>
                    </div>
                    <div className="rl-facts">
                      <button
                        onClick={() =>
                          setDetail({ title: 'Completed reads', reads: stats.finished })
                        }
                      >
                        <strong>{stats.finished.length}</strong>
                        <span>
                          completed reads<small>Across {stats.unique} distinct books</small>
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                      <button
                        onClick={() =>
                          setDetail({
                            title: 'Books you returned to',
                            reads: stats.finished.filter((r) => r.reread),
                          })
                        }
                      >
                        <strong>{stats.rereads}</strong>
                        <span>
                          rereads<small>Old company, met again</small>
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                      <button
                        onClick={() =>
                          setDetail({ title: 'Books you set aside', reads: stats.stopped })
                        }
                      >
                        <strong>{stats.stopped.length}</strong>
                        <span>
                          set aside<small>Kept separate from finishes</small>
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    </div>
                  </section>
                  <section className="rl-rhythm rl-section">
                    <div className="rl-section-heading">
                      <div>
                        <p className="rl-eyebrow">Along the way</p>
                        <h2>A rhythm of finished books.</h2>
                      </div>
                      <p>
                        Choose a month to revisit it.
                        <br />
                        Finishes, not days spent reading.
                      </p>
                    </div>
                    <div className="rl-months" aria-label="Completed reads by month">
                      {monthNames.map((name, index) => {
                        const entries = stats.finished.filter(
                          (r) => r.date && Number(r.date.split('-')[1]) === index + 1,
                        )
                        return (
                          <button
                            key={name}
                            className="rl-month"
                            aria-label={`${name}: ${entries.length} completed reads${period === 'all' ? ' across all years' : ''}`}
                            onClick={() =>
                              setDetail({
                                title: `${name}${period === 'all' ? ' across the years' : ` ${period}`}`,
                                reads: entries,
                              })
                            }
                          >
                            <span className="rl-month-stack">
                              {entries.slice(0, 4).map((r) => (
                                <span key={r.id} className="rl-book-mark" />
                              ))}
                              {!entries.length && <span className="rl-month-empty" />}
                            </span>
                            <strong>{entries.length || '–'}</strong>
                            <span>{name.slice(0, 3)}</span>
                          </button>
                        )
                      })}
                    </div>
                    {stats.undated.length > 0 && (
                      <button
                        className="rl-text-button rl-undated"
                        onClick={() =>
                          setDetail({ title: 'Without a recorded date', reads: stats.undated })
                        }
                      >
                        {stats.undated.length} undated read{' '}
                        {period === 'all'
                          ? 'included in totals, outside the chart'
                          : 'outside this year’s totals'}{' '}
                        <span aria-hidden="true">↗</span>
                      </button>
                    )}
                  </section>
                  <div className="rl-two-columns">
                    <section className="rl-section">
                      <p className="rl-eyebrow">The shelves you visited</p>
                      <h2>Where you wandered.</h2>
                      <p className="rl-section-note">
                        Genres of completed reads, including rereads.
                      </p>
                      <div className="rl-breakdown">
                        {[...new Set(stats.finished.map((r) => book(r.bookId).genre))].map(
                          (genre) => {
                            const entries = stats.finished.filter(
                              (r) => book(r.bookId).genre === genre,
                            )
                            return (
                              <button
                                key={genre}
                                onClick={() => setDetail({ title: genre, reads: entries })}
                              >
                                <span>{genre}</span>
                                <span className="rl-track">
                                  <span
                                    style={{
                                      width: `${(entries.length / stats.finished.length) * 100}%`,
                                    }}
                                  />
                                </span>
                                <strong>{entries.length}</strong>
                                <span aria-hidden="true">↗</span>
                              </button>
                            )
                          },
                        )}
                      </div>
                    </section>
                    <section className="rl-section">
                      <p className="rl-eyebrow">The way you read</p>
                      <h2>In your hands. In your ears.</h2>
                      <p className="rl-section-note">
                        The format recorded for each completed read.
                      </p>
                      <div className="rl-formats">
                        {['Print', 'Ebook', 'Audio', 'Not recorded'].map((format) => {
                          const entries = stats.finished.filter(
                            (r) => (r.format ?? 'Not recorded') === format,
                          )
                          return (
                            entries.length > 0 && (
                              <button
                                key={format}
                                onClick={() =>
                                  setDetail({ title: `${format} reads`, reads: entries })
                                }
                              >
                                <strong>{entries.length}</strong>
                                <span>{format}</span>
                                <span aria-hidden="true">↗</span>
                              </button>
                            )
                          )
                        })}
                      </div>
                    </section>
                  </div>
                  <section className="rl-year-end">
                    <div>
                      <p className="rl-eyebrow">For your eyes only</p>
                      <h2>Spend a moment with {period === 'all' ? 'your reading' : period}.</h2>
                      <p>A quiet retrospective of these books and the notes you kept.</p>
                    </div>
                    <button
                      className="rl-primary skin-control skin-btn-primary"
                      onClick={() => setStory(true)}
                    >
                      Open your retrospective <span aria-hidden="true">↗</span>
                    </button>
                  </section>
                  <section className="rl-section">
                    <div className="rl-section-heading">
                      <h2>The reading record.</h2>
                      <span>{stats.included.length} recorded reads</span>
                    </div>
                    <ReadRows reads={[...stats.included].reverse()} />
                  </section>
                </>
              ) : (
                <section className="rl-empty">
                  <span className="rl-empty-glyph" aria-hidden="true">
                    ◌
                  </span>
                  <p className="rl-eyebrow">There is room to begin</p>
                  <h2>
                    {scenario === 'starting'
                      ? 'Your reading life starts with one book.'
                      : 'No completed reads recorded here yet.'}
                  </h2>
                  <p>
                    {scenario === 'starting'
                      ? 'Finish a book or bring your reading history. This space will grow into a record of what stayed with you.'
                      : 'A quiet year still belongs in your story. Look at another period or plan what you might read next.'}
                  </p>
                  <button
                    className="rl-primary skin-control skin-btn-primary"
                    onClick={() => setView('plan')}
                  >
                    Spend time with your plan <span aria-hidden="true">→</span>
                  </button>
                </section>
              )}
            </>
          ) : (
            <>
              <div className="rl-title-row">
                <div>
                  <p className="rl-eyebrow">Leave room for a change of heart</p>
                  <h1>
                    A little space
                    <br />
                    <em>for what’s next.</em>
                  </h1>
                  <p className="rl-intro">
                    Make a loose plan. Follow your curiosity.
                    <br className="rl-desktop" /> The books will be here when you’re ready.
                  </p>
                </div>
                <button
                  className="rl-primary skin-control skin-btn-primary"
                  onClick={() => openPicker()}
                >
                  + Add to your plan
                </button>
              </div>
              <div className="rl-plan-layout">
                <section className="rl-current" aria-label="Reading now">
                  <p className="rl-eyebrow">In good company · Reading now</p>
                  <Cover id={current} large />
                  <h2>{book(current).title}</h2>
                  <p>{book(current).author}</p>
                  {scenario === 'settled' && (
                    <>
                      <div
                        className="rl-progress"
                        role="progressbar"
                        aria-label="Sample reading progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={34}
                      >
                        <span />
                      </div>
                      <p className="rl-caption">34% · sample progress</p>
                    </>
                  )}
                  <p className="rl-current-note">
                    {scenario === 'settled'
                      ? 'Taking this one slowly. A chapter, then a walk.'
                      : 'A first book to make this space your own.'}
                  </p>
                  <button
                    className="rl-text-button"
                    onClick={() => setDetail({ title: 'Reading now', reads: [] })}
                  >
                    About this sample read <span aria-hidden="true">↗</span>
                  </button>
                </section>
                <section className="rl-queue">
                  <div className="rl-section-heading">
                    <div>
                      <p className="rl-eyebrow">Your next few books</p>
                      <h2>An open-ended plan.</h2>
                    </div>
                    <div className="rl-segment" aria-label="Plan view">
                      <button aria-pressed={!calendar} onClick={() => setCalendar(false)}>
                        Queue
                      </button>
                      <button aria-pressed={calendar} onClick={() => setCalendar(true)}>
                        Calendar
                      </button>
                    </div>
                  </div>
                  <p className="rl-section-note">
                    Soon, a month, or a particular day. Nothing here is a deadline.
                  </p>
                  {calendar ? (
                    <div className="rl-calendar">
                      <div className="rl-calendar-heading">
                        <button
                          aria-label="Previous month"
                          disabled={calendarMonth === 0}
                          onClick={() => setCalendarMonth(calendarMonth - 1)}
                        >
                          ←
                        </button>
                        <h3>{monthNames[calendarMonth]} 2026</h3>
                        <button
                          aria-label="Next month"
                          disabled={calendarMonth === 11}
                          onClick={() => setCalendarMonth(calendarMonth + 1)}
                        >
                          →
                        </button>
                      </div>
                      <div className="rl-calendar-grid">
                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                          <span className="rl-weekday" key={i}>
                            {d}
                          </span>
                        ))}
                        {Array.from({ length: offset }, (_, i) => (
                          <span key={`blank-${i}`} />
                        ))}
                        {Array.from({ length: days }, (_, i) => {
                          const date = `${calendarKey}-${String(i + 1).padStart(2, '0')}`
                          const entries = plans.filter((p) => p.date === date)
                          return (
                            <button
                              key={date}
                              className={entries.length ? 'has-plan' : ''}
                              aria-label={`${dateLabel(date)}: ${entries.length ? entries.map((p) => book(p.bookId).title).join(', ') : 'no plans'}`}
                              onClick={() =>
                                entries.length ? setSelectedDay(date) : openPicker(date)
                              }
                            >
                              {i + 1}
                              {entries.length > 0 && <span aria-hidden="true">•</span>}
                            </button>
                          )
                        })}
                      </div>
                      <p className="rl-caption">
                        Choose a marked day to see its books. Empty days start a plan for that date.
                      </p>
                      <h3 className="rl-flex-heading">Without a fixed day</h3>
                      {plans
                        .filter((p) => !p.date || p.date === calendarKey || p.date === '2026')
                        .map((p) => (
                          <button
                            className="rl-flex-plan"
                            key={p.bookId}
                            onClick={() => setEditor(p)}
                          >
                            <span>{book(p.bookId).title}</span>
                            <small>{dateLabel(p.date)} ↗</small>
                          </button>
                        ))}
                      {!plans.some(
                        (p) => !p.date || p.date === calendarKey || p.date === '2026',
                      ) && <p>No flexible plans for this month.</p>}
                    </div>
                  ) : (
                    <>
                      {plans.length ? (
                        <ol className="rl-plans">
                          {plans.map((p, index) => (
                            <li key={p.bookId}>
                              <span className="rl-order">{String(index + 1).padStart(2, '0')}</span>
                              <button
                                className="rl-cover-button"
                                aria-label={`Edit plan for ${book(p.bookId).title}`}
                                onClick={() => setEditor(p)}
                              >
                                <Cover id={p.bookId} />
                              </button>
                              <div className="rl-plan-copy">
                                <span className="rl-plan-date">{dateLabel(p.date)}</span>
                                <h3>{book(p.bookId).title}</h3>
                                <p>{book(p.bookId).author}</p>
                                {p.intention && <p className="rl-intention">{p.intention}</p>}
                                <div className="rl-plan-actions">
                                  <button className="rl-text-button" onClick={() => setEditor(p)}>
                                    Edit plan
                                  </button>
                                  <button className="rl-text-button" onClick={() => remove(p)}>
                                    Remove<span className="sr-only"> {book(p.bookId).title}</span>
                                  </button>
                                </div>
                              </div>
                              <div className="rl-reorder">
                                <button
                                  aria-label={`Move ${book(p.bookId).title} earlier`}
                                  disabled={index === 0}
                                  onClick={() => move(index, -1)}
                                >
                                  ↑
                                </button>
                                <button
                                  aria-label={`Move ${book(p.bookId).title} later`}
                                  disabled={index === plans.length - 1}
                                  onClick={() => move(index, 1)}
                                >
                                  ↓
                                </button>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="rl-queue-empty">
                          <h3>No plans to keep up with.</h3>
                          <p>
                            Choose a book when something catches your eye. “Soon” is a perfectly
                            good plan.
                          </p>
                        </div>
                      )}
                      <button className="rl-add-line" onClick={() => openPicker()}>
                        + Leave a place for another book
                      </button>
                    </>
                  )}
                  {removed && (
                    <div className="rl-undo">
                      <span>Removed {book(removed.plan.bookId).title} from your plan.</span>
                      <button
                        onClick={() => {
                          setPlans((existing) => {
                            const next = existing.filter((p) => p.bookId !== removed.plan.bookId)
                            next.splice(removed.index, 0, removed.plan)
                            return next
                          })
                          setRemoved(null)
                          setAnnouncement('Plan restored.')
                        }}
                      >
                        Undo
                      </button>
                    </div>
                  )}
                </section>
              </div>
              <section className="rl-plan-footnote">
                <div>
                  <p className="rl-eyebrow">A plan is a possibility</p>
                  <h2>Your reading history stays yours.</h2>
                  <p>Moving or removing a plan never changes a finish, a reread, or a note.</p>
                </div>
                <div>
                  <p className="rl-eyebrow">On the horizon</p>
                  <h3>No dated releases in this sample.</h3>
                  <p>
                    In the app, known releases from followed authors belong here. A missing date
                    should stay unknown.
                  </p>
                </div>
              </section>
            </>
          )}
        </main>
        <footer className="rl-footer">
          <span>Reverie · A personal library that feels like home.</span>
          <span>Private reflection. Flexible plans.</span>
        </footer>
      </div>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {detail && (
        <Modal title={detail.title} onClose={() => setDetail(null)}>
          {detail.reads.length ? (
            <ReadRows reads={detail.reads} />
          ) : (
            <p className="rl-dialog-copy">
              {detail.title === 'Reading now'
                ? 'This is a fictional active read for the design study. Progress and finishing will use the app’s existing reading log in implementation; the preview does not change reading history.'
                : 'No matching reads in this selection.'}
            </p>
          )}
        </Modal>
      )}
      {story && (
        <Modal title={yearLabel} onClose={() => setStory(false)} wide>
          <div className="rl-retrospective">
            <p className="rl-eyebrow">
              A private retrospective · {period === 'all' ? 'All time' : period}
            </p>
            <h2>
              You spent time
              <br />
              <em>in other worlds.</em>
            </h2>
            <div className="rl-story-covers">
              {[...new Set(stats.finished.map((r) => r.bookId))].map((id) => (
                <Cover key={id} id={id} />
              ))}
            </div>
            <p>
              {stats.finished.length} completed reads. {stats.unique} different books.{' '}
              {stats.rereads} returns to familiar company.
            </p>
            {reflection && (
              <blockquote>
                {reflection.note}
                <cite>Your note on {book(reflection.bookId).title}</cite>
              </blockquote>
            )}
            <p className="rl-caption">Kept here, for you. No public score or share card.</p>
            <button
              className="rl-primary skin-control skin-btn-primary"
              onClick={() => {
                setStory(false)
                setView('plan')
              }}
            >
              Turn toward what’s next →
            </button>
          </div>
        </Modal>
      )}
      {selectedDay && (
        <Modal title={dateLabel(selectedDay)} onClose={() => setSelectedDay(null)}>
          <div className="rl-day-plans">
            {plans
              .filter((p) => p.date === selectedDay)
              .map((p) => (
                <button
                  className="rl-flex-plan"
                  key={p.bookId}
                  onClick={() => {
                    setSelectedDay(null)
                    setEditor(p)
                  }}
                >
                  <span>{book(p.bookId).title}</span>
                  <small>Edit plan ↗</small>
                </button>
              ))}
            <button
              className="rl-primary skin-control skin-btn-primary"
              onClick={() => {
                openPicker(selectedDay)
                setSelectedDay(null)
              }}
            >
              Add another book
            </button>
          </div>
        </Modal>
      )}
      {picker && (
        <Modal title="Leave a place for a book" onClose={() => setPicker(false)}>
          <div className="rl-picker">
            <p>
              Choose from the sample library. Books already planned or reading now are left out.
            </p>
            <label>
              Find a book
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Title or author"
              />
            </label>
            <ul>
              {available.map((b) => (
                <li key={b.id}>
                  <Cover id={b.id} />
                  <div>
                    <h3>{b.title}</h3>
                    <p>{b.author}</p>
                  </div>
                  <button
                    className="rl-primary skin-control skin-btn-primary"
                    onClick={() => {
                      setPicker(false)
                      setEditor({ bookId: b.id, date: pickerDate, intention: '' })
                    }}
                  >
                    Choose<span className="sr-only"> {b.title}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!available.length && (
              <p>No available matches. Try another search, or edit a book already in your plan.</p>
            )}
          </div>
        </Modal>
      )}
      {editor && (
        <PlanEditor
          plan={editor}
          onClose={() => setEditor(null)}
          onSave={(p) => {
            setPlans((existing) =>
              existing.some((e) => e.bookId === p.bookId)
                ? existing.map((e) => (e.bookId === p.bookId ? p : e))
                : [...existing, p],
            )
            setEditor(null)
            setAnnouncement(`Plan saved for ${book(p.bookId).title}. Reading history is unchanged.`)
          }}
          onRemove={
            plans.some((p) => p.bookId === editor.bookId)
              ? () => {
                  remove(editor)
                  setEditor(null)
                }
              : undefined
          }
        />
      )}
    </>
  )
}

function PlanEditor({
  plan,
  onClose,
  onSave,
  onRemove,
}: {
  plan: Plan
  onClose: () => void
  onSave: (plan: Plan) => void
  onRemove?: () => void
}) {
  const [precision, setPrecision] = useState(
    plan.date.length === 10
      ? 'day'
      : plan.date.length === 7
        ? 'month'
        : plan.date.length === 4
          ? 'year'
          : 'soon',
  )
  const [day, setDay] = useState(plan.date.length === 10 ? plan.date : '2026-09-21')
  const [month, setMonth] = useState(plan.date.length >= 7 ? plan.date.slice(0, 7) : '2026-09')
  const [year, setYear] = useState(plan.date.slice(0, 4) || '2026')
  const [intention, setIntention] = useState(plan.intention)
  return (
    <Modal title="Make a little room" onClose={onClose}>
      <form
        className="rl-editor"
        onSubmit={(e) => {
          e.preventDefault()
          onSave({
            ...plan,
            date:
              precision === 'soon'
                ? ''
                : precision === 'month'
                  ? month
                  : precision === 'year'
                    ? year
                    : day,
            intention: intention.trim(),
          })
        }}
      >
        <div className="rl-editor-book">
          <Cover id={plan.bookId} />
          <div>
            <h3>{book(plan.bookId).title}</h3>
            <p>{book(plan.bookId).author}</p>
          </div>
        </div>
        <fieldset>
          <legend>When might you read it?</legend>
          <div className="rl-precision">
            {[
              ['soon', 'Soon'],
              ['year', 'A year'],
              ['month', 'A month'],
              ['day', 'A day'],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="precision"
                  value={value}
                  checked={precision === value}
                  onChange={() => setPrecision(value!)}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        {precision === 'day' && (
          <label>
            Planned day
            <input required type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
        )}
        {precision === 'month' && (
          <label>
            Planned month
            <input required type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
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
              onChange={(e) => setYear(e.target.value)}
            />
          </label>
        )}
        {precision === 'soon' && (
          <p className="rl-editor-hint">
            No date to keep. It stays in your queue until you’re ready.
          </p>
        )}
        <label>
          A note to your future self <span className="rl-caption">Optional · sample only</span>
          <textarea
            rows={3}
            maxLength={300}
            value={intention}
            onChange={(e) => setIntention(e.target.value)}
            placeholder="What draws you to this book?"
          />
        </label>
        <p className="rl-caption">This is a plan, not a change to your reading history.</p>
        <div className="rl-editor-actions">
          <button className="rl-primary skin-control skin-btn-primary" type="submit">
            Save plan
          </button>
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          {onRemove && (
            <button type="button" className="rl-text-button" onClick={onRemove}>
              Remove from plan
            </button>
          )}
        </div>
      </form>
    </Modal>
  )
}
