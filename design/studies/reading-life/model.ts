import { books, anchors } from '../discover/catalog'

/** Fictional reading and planning data. Public book facts/covers reuse the reviewed Discover study.
 * Dates stay at their recorded precision. No account data, API client, or persistence. */
export const catalog = [...books, anchors[0]!]
export function book(id: string) {
  const found = catalog.find((b) => b.id === id)
  if (!found) throw new Error(`Unknown study book: ${id}`)
  return found
}
export type Period = '2026' | '2025' | 'all'
export type Scenario = 'settled' | 'starting'
export type Read = {
  id: string
  bookId: string
  outcome: 'finished' | 'stopped'
  date: string | null
  format: 'Print' | 'Ebook' | 'Audio' | null
  reread: boolean
  note?: string
}
export type Plan = { bookId: string; date: string; intention: string }
export const histories: Record<Scenario, Read[]> = {
  settled: [
    {
      id: 'r1',
      bookId: 'earthsea',
      outcome: 'finished',
      date: '2025-04-18',
      format: 'Print',
      reread: false,
    },
    {
      id: 'r2',
      bookId: 'left-hand',
      outcome: 'finished',
      date: '2025-11-09',
      format: 'Ebook',
      reread: false,
    },
    {
      id: 'r3',
      bookId: 'psalm',
      outcome: 'finished',
      date: '2026-01-12',
      format: 'Print',
      reread: false,
    },
    {
      id: 'r4',
      bookId: 'tombs',
      outcome: 'finished',
      date: '2026-03-24',
      format: 'Print',
      reread: false,
    },
    {
      id: 'r5',
      bookId: 'left-hand',
      outcome: 'stopped',
      date: '2026-04-09',
      format: 'Audio',
      reread: true,
    },
    {
      id: 'r6',
      bookId: 'earthsea',
      outcome: 'finished',
      date: '2026-06-20',
      format: 'Audio',
      reread: true,
    },
    {
      id: 'r7',
      bookId: 'psalm',
      outcome: 'finished',
      date: '2026-08-30',
      format: 'Ebook',
      reread: true,
      note: 'I came back to this when everything felt hurried. I want to remember that rest does not have to be earned.',
    },
    {
      id: 'r8',
      bookId: 'sweetgrass',
      outcome: 'finished',
      date: null,
      format: null,
      reread: false,
    },
  ],
  starting: [],
}
export const initialPlans: Record<Scenario, Plan[]> = {
  settled: [
    { bookId: 'tombs', date: '', intention: 'Return to the labyrinth, when the mood comes.' },
    { bookId: 'left-hand', date: '2026-09', intention: 'Try it again, this time in print.' },
    { bookId: 'earthsea', date: '2026-10-04', intention: 'A familiar book for a quiet Sunday.' },
  ],
  starting: [],
}
export const monthNames = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
export function dateLabel(date: string | null) {
  if (date === null) return 'Date not recorded'
  if (!date) return 'Whenever you’re ready'
  const [year, month, day] = date.split('-').map(Number)
  if (!month) return `${year}`
  return `${day ? `${day} ` : ''}${monthNames[month - 1]} ${year}`
}
export function inPeriod(read: Read, period: Period) {
  return period === 'all' || read.date?.startsWith(period) === true
}
export function summary(reads: Read[], period: Period) {
  const included = reads.filter((r) => inPeriod(r, period))
  const finished = included.filter((r) => r.outcome === 'finished')
  return {
    included,
    finished,
    unique: new Set(finished.map((r) => r.bookId)).size,
    rereads: finished.filter((r) => r.reread).length,
    stopped: included.filter((r) => r.outcome === 'stopped'),
    undated: reads.filter((r) => r.date === null),
  }
}
