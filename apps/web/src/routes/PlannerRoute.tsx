import { useState } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import {
  authorOf,
  formatPartialDate,
  hasDate,
  summarizeReadingHistory,
  type ReadingHistory,
  type Book,
} from '@reverie/core'
import { rootRoute } from './RootRoute'
import { CoverImage } from '../components/CoverImage'
import { FromYourAuthors } from '../planner/FromYourAuthors'
import { useBooks } from '../data/books'
import { useReadingHistory } from '../data/readingHistory'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { MONTHS } from '../library/constants'
import { Surface } from '../components/Surface'

type Tab = 'calendar' | 'releases'
/**
 * ── THE DOT ENCODING SURVIVES, AND THE NUMBER IS WHY ────────────────────────────────────────────
 * One dot per event, kept. `docs/tasks/task-calendar-cluster-scope.md` argued the encoding
 * "provably fails at 390px"; it did not, and the scope doc was reasoning from a hypothetical heavy
 * day rather than from data. MEASURED against the owner's production library:
 *
 *   · busiest single day ................ 8 events
 *   · cell capacity at 390px ............ 15 dots  (46px cell -> 5 per row x 3 rows)
 *
 * 8 < 15, so a count or a density ramp would be solving a problem nobody has, and both throw away
 * what a dot row gives free: you can see at a glance that Tuesday had three and Thursday one.
 * The number is recorded HERE, next to the encoding it justifies, so the next person inherits the
 * measurement instead of the assumption it replaced.
 *
 * THE CAP IS INSURANCE, NOT THE DESIGN. 12 leaves room for the `+n` inside the same 15-dot budget,
 * so an unforeseen 40-event day degrades to "12 dots +28" instead of bleeding out of its cell.
 * It should never fire on real data; it exists so that if it ever does, the failure is legible.
 */
const DOT_CAP = 12

/**
 * Today's marker: an underline beneath the NUMERAL, not a ring around the cell.
 *
 * The ring had to go, and the desktop shots settled it. At 1280px it became a ~134x128px gold box
 * around a numeral sitting in its top-left corner — the only rectangle on the screen, and the exact
 * shape the tile removal had just deleted. It read as a residual tile rather than a marker, and
 * width amplified it. An underline scales; a full-cell ring does not.
 *
 * ATTACHED TO THE NUMERAL, deliberately. A first pass underlined the CELL, which put the rule below
 * the dot cluster — so the more a day held, the further the marker drifted from the number it
 * marks, and on the cap day it would sit several rows below it. Bound to the numeral it stays put
 * at any density.
 *
 * `--gold`'s VALUE is untouched: 2.08:1 against --bg0 in bloom/light and 3.03:1 in folio/dark,
 * below and at the WCAG 1.4.11 floor. That is a palette decision, not a layout one, and stays the
 * owner's call — though this shape change may reduce how much rides on it.
 */
const TODAY_UNDERLINE = { boxShadow: 'inset 0 -2px 0 0 var(--gold)', paddingBottom: '1px' } as const

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function Stat({ n, label }: { n: number | string; label: string }) {
  return (
    <Surface radius="panel" tone="card" pad={2} className="text-center">
      <div className="text-[22px] font-bold text-ink">{n}</div>
      <div className="text-[11px] text-muted">{label}</div>
    </Surface>
  )
}

export function PlannerCalendar({
  books,
  openBook,
}: {
  books: Book[]
  openBook: (id: string) => void
}) {
  const query = useReadingHistory()
  return (
    <>
      {!query.data && (
        <div className="mb-4">
          <p role={query.isError ? 'alert' : 'status'} className="mb-3 text-sm text-muted">
            {query.isError
              ? 'Reading history is unavailable. Your saved plans are still here.'
              : query.isPaused
                ? 'Your saved plans are available. Connect to load reading history.'
                : 'Gathering reading history. Your saved plans are ready below.'}
          </p>
          {query.isError && <Button onClick={() => void query.refetch()}>Try again</Button>}
        </div>
      )}
      {query.data && query.isError && (
        <p role="status" className="mb-4 text-sm text-muted">
          Showing your last loaded reading history.{' '}
          <button type="button" className="underline" onClick={() => void query.refetch()}>
            Try updating again
          </button>
        </p>
      )}
      <CalendarView books={books} openBook={openBook} history={query.data} />
    </>
  )
}

function CalendarView({
  books,
  openBook,
  history,
}: {
  books: Book[]
  openBook: (id: string) => void
  history?: ReadingHistory
}) {
  const now = new Date()
  const [cal, setCal] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const [day, setDay] = useState<number | null>(null)

  const summary = history ? summarizeReadingHistory(history, cal.y) : undefined

  const map = new Map<number, { read: Book[]; plan: Book[] }>()
  const slot = (d: number) => {
    const cur = map.get(d) ?? { read: [], plan: [] }
    map.set(d, cur)
    return cur
  }
  for (const read of summary?.records ?? []) {
    if (read.finished.m === cal.m + 1 && read.finished.d !== null) {
      slot(read.finished.d).read.push(read.book)
    }
  }
  for (const b of books) {
    // A day cell needs a day. A month-only plan ("sometime in March") has none and is deliberately
    // not placed here — it still appears in "Planned reads" below. Placing it on the 1st would
    // fabricate the exact day this trio exists to stop fabricating. The calendar branch decides
    // whether month-level plans get their own band; this is the minimum that is not a lie.
    if (b.plan.y === cal.y && b.plan.m === cal.m + 1 && b.plan.d != null) {
      slot(b.plan.d).plan.push(b)
    }
  }

  const first = new Date(cal.y, cal.m, 1).getDay()
  const days = new Date(cal.y, cal.m + 1, 0).getDate()
  const isThisMonth = now.getFullYear() === cal.y && now.getMonth() === cal.m

  const uniqueYear = summary?.distinctBooks.length ?? '—'
  const readAllTime = history?.knownReadBooks.length ?? '—'
  const planned = books.filter((b) => hasDate(b.plan)).length
  // Sort key, not a formatter: a missing month or day sorts before a stated one within the same
  // year, which is where a vaguer plan belongs. Local and throwaway — the calendar branch owns this.
  const planOrder = (b: Book) => (b.plan.y ?? 0) * 10000 + (b.plan.m ?? 0) * 100 + (b.plan.d ?? 0)
  const upcoming = books.filter((b) => hasDate(b.plan)).sort((a, b) => planOrder(a) - planOrder(b))

  const prev = () => setCal((c) => (c.m === 0 ? { y: c.y - 1, m: 11 } : { y: c.y, m: c.m - 1 }))
  const next = () => setCal((c) => (c.m === 11 ? { y: c.y + 1, m: 0 } : { y: c.y, m: c.m + 1 }))
  const detail = day != null ? map.get(day) : null

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat n={uniqueYear} label={`Books in ${cal.y}`} />
        <Stat n={summary?.records.length ?? '—'} label="Reads incl. rereads" />
        <Stat n={readAllTime} label="Books read · all time" />
        <Stat n={planned} label="Planned" />
      </div>

      <div className="mb-3 flex items-center justify-center gap-4">
        <button
          type="button"
          onClick={prev}
          aria-label="Previous month"
          className="h-8 w-8 rounded-full border border-line text-ink"
        >
          ‹
        </button>
        <span className="text-[16px] font-semibold text-ink">
          {MONTHS[cal.m]} {cal.y}
        </span>
        <button
          type="button"
          onClick={next}
          aria-label="Next month"
          className="h-8 w-8 rounded-full border border-line text-ink"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {DOW.map((d) => (
          /*
           * CENTRED — header and numeral together, which is the fix the SHOTS chose over the one
           * this file previously argued for.
           *
           * With the tiles gone nothing tied a numeral to its column, exposing a ~12px
           * centre-vs-left mismatch. The first fix moved the HEADER left to meet the numerals, on
           * the reasoning that centring numerals would leave marked days' dot clusters ragged. The
           * images did not support it: at real densities (1-3 dots) the clusters centre cleanly,
           * while headers-left pulled every column's content toward its left edge and left visibly
           * more empty space on the right of the grid than the left — it read as drifting rather
           * than deliberate. Centred is better balanced and is what a calendar conventionally does.
           */
          <div key={d} className="pb-1 text-center text-[11px] text-muted">
            {d}
          </div>
        ))}
        {Array.from({ length: first }).map((_, i) => (
          <div key={`e${i}`} />
        ))}
        {Array.from({ length: days }).map((_, i) => {
          const d = i + 1
          const m = map.get(d)
          const has = !!m && m.read.length + m.plan.length > 0
          const today = isThisMonth && now.getDate() === d
          const total = (m?.read.length ?? 0) + (m?.plan.length ?? 0)
          const shownReads = m ? m.read.slice(0, DOT_CAP) : []
          const shownPlans = m ? m.plan.slice(0, Math.max(0, DOT_CAP - shownReads.length)) : []
          const overflow = total - shownReads.length - shownPlans.length

          // AN EMPTY DAY IS NOT A BOX. It draws its numeral and nothing else — no border, no fill,
          // no tile. See the header block: a month with four marks has ~27 of these, and drawing
          // them as identical bordered tiles was the screen's main visual defect.
          if (!has) {
            return (
              <div
                key={d}
                aria-hidden
                className="aspect-square p-1 text-center text-[11px]"
                style={{ color: 'var(--muted)' }}
              >
                <span style={today ? TODAY_UNDERLINE : undefined}>{d}</span>
              </div>
            )
          }
          return (
            <button
              key={d}
              type="button"
              onClick={() => setDay(d)}
              aria-label={`${MONTHS[cal.m]} ${d} — ${total} ${total === 1 ? 'entry' : 'entries'}`}
              className="aspect-square p-1 text-center"
            >
              {/* --ink, not --muted: with the tiles gone this numeral is half the has-something
                  signal, and it must read as deliberate against the empty days beside it. */}
              <div className="text-[11px] font-semibold" style={{ color: 'var(--ink)' }}>
                <span style={today ? TODAY_UNDERLINE : undefined}>{d}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                {shownReads.map((_, k) => (
                  <span
                    key={`r${k}`}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--primary)' }}
                  />
                ))}
                {shownPlans.map((_, k) => (
                  <span
                    key={`p${k}`}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ background: 'var(--violet)' }}
                  />
                ))}
                {overflow > 0 && (
                  <span className="text-[9px] leading-none" style={{ color: 'var(--muted)' }}>
                    +{overflow}
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {upcoming.length > 0 && (
        <div className="mt-6">
          <h3 className="text-[16px] font-semibold text-ink">Planned reads</h3>
          <div className="mt-2 flex flex-col gap-1.5">
            {upcoming.map((b) => (
              <button
                key={b.id}
                type="button"
                onClick={() => openBook(b.id)}
                className="flex items-center justify-between skin-card border border-line px-3 py-2 text-left"
                style={{ background: 'var(--field)' }}
              >
                <span className="text-[14px] font-semibold text-ink">{b.title}</span>
                <span className="text-[12px] text-violet">📅 {formatPartialDate(b.plan)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {detail && day != null && (
        <Modal title={`${MONTHS[cal.m]} ${day}, ${cal.y}`} onClose={() => setDay(null)}>
          {detail.read.length > 0 && (
            <>
              <div className="mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">Read</div>
              {detail.read.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => openBook(b.id)}
                  className="mb-1.5 block w-full text-left"
                >
                  <span className="text-[14px] font-semibold text-ink">{b.title}</span>
                  <span className="block text-[12px] text-muted">{authorOf(b)}</span>
                </button>
              ))}
            </>
          )}
          {detail.plan.length > 0 && (
            <>
              <div className="mb-1 mt-3 text-[11px] uppercase tracking-[0.2em] text-muted">
                Planned
              </div>
              {detail.plan.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => openBook(b.id)}
                  className="mb-1.5 block w-full text-left"
                >
                  <span className="text-[14px] font-semibold text-ink">{b.title}</span>
                  <span className="block text-[12px] text-muted">{authorOf(b)}</span>
                </button>
              ))}
            </>
          )}
        </Modal>
      )}
    </div>
  )
}

function Releases({ books, openBook }: { books: Book[]; openBook: (id: string) => void }) {
  const today = new Date()
  const key = (p: Book['pub']) => new Date(p.y ?? 0, (p.m ?? 1) - 1, p.d ?? 1).getTime()
  const dated = books.filter((b) => b.pub.y)
  const undated = books.filter((b) => !b.pub.y)
  const upcoming = dated
    .filter((b) => key(b.pub) > today.getTime())
    .sort((a, b) => key(a.pub) - key(b.pub))
  const recent = dated
    .filter((b) => key(b.pub) <= today.getTime() && (today.getTime() - key(b.pub)) / 864e5 <= 120)
    .sort((a, b) => key(b.pub) - key(a.pub))
  const past = dated
    .filter((b) => !upcoming.includes(b) && !recent.includes(b))
    .sort((a, b) => key(b.pub) - key(a.pub))

  const Section = ({ title, sub, list }: { title: string; sub: string; list: Book[] }) =>
    list.length ? (
      <div className="mb-6">
        <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
        <p className="mb-2 text-[12.5px] text-muted">{sub}</p>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {list.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => openBook(b.id)}
              className="text-left"
              aria-label={`Open ${b.title}`}
            >
              <div
                className="aspect-[2/3] overflow-hidden rounded-lg border border-line"
                style={{ background: 'var(--field)' }}
              >
                <CoverImage book={b} />
              </div>
              <div className="mt-1 break-words text-[12px] font-semibold text-ink">{b.title}</div>
              <div className="text-[11px] text-primary">📅 {formatPartialDate(b.pub)}</div>
            </button>
          ))}
        </div>
      </div>
    ) : null

  return (
    <div>
      {/* the external half: releases you DON'T own yet, from the authors your library loves */}
      <FromYourAuthors />
      <Surface radius="card" tone="card" pad={2} className="mb-4 text-[13px] text-muted">
        🗓️ Add a pub date to any book from its detail page — year only, month, or a full date. Books
        with dates appear here.
      </Surface>
      <Section title="Coming soon" sub="Upcoming releases you’re tracking" list={upcoming} />
      <Section title="Just released" sub="Out in the last few months" list={recent} />
      <Section title="By release date" sub="Everything else with a date" list={past} />
      {undated.length > 0 && (
        <Section
          title="No date yet"
          sub={`${undated.length} books — open one to add its publication date`}
          list={undated.slice(0, 18)}
        />
      )}
    </div>
  )
}

function PlannerScreen() {
  const navigate = useNavigate()
  const library = useBooks()
  const books = library.data
  // Tab lives in the ROUTE — see ShelvesRoute for the full reasoning. `undefined` = the default,
  // so /planner stays canonical and only /planner?tab=releases carries a param.
  const { tab = 'calendar' } = plannerRoute.useSearch()
  const setTab = (t: Tab) =>
    // replace: true — back should leave the page, not undo a tab click.
    void navigate({ to: '/planner', search: t === 'calendar' ? {} : { tab: t }, replace: true })
  const openBook = (id: string) => void navigate({ to: '/book/$bookId', params: { bookId: id } })

  return (
    <section className="px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1
          className="text-[22px] italic text-ink"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          Planner
        </h1>
        <Surface radius="control" tone="card" pad={1} className="flex">
          {(['calendar', 'releases'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className="rounded-full px-3 py-1.5 text-[12.5px] font-semibold capitalize"
              style={
                tab === t
                  ? { background: 'var(--accent-fill)', color: 'var(--on-primary)' }
                  : { color: 'var(--muted)' }
              }
            >
              {t}
            </button>
          ))}
        </Surface>
      </header>

      {!books ? (
        <div>
          <p role={library.isError ? 'alert' : 'status'} className="mb-4 text-muted">
            {library.isError
              ? 'Your library could not be loaded.'
              : library.fetchStatus === 'paused'
                ? 'Connect to load your library.'
                : 'Loading your library…'}
          </p>
          {library.isError && <Button onClick={() => void library.refetch()}>Try again</Button>}
        </div>
      ) : tab === 'calendar' ? (
        <PlannerCalendar books={books} openBook={openBook} />
      ) : (
        <Releases books={books ?? []} openBook={openBook} />
      )}
    </section>
  )
}

export const plannerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'planner',
  // Fails closed — unknown values resolve to the default tab rather than throwing.
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: search.tab === 'releases' ? 'releases' : undefined,
  }),
  component: PlannerScreen,
})
