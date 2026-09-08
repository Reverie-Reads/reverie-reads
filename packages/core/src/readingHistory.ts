import type { Book, PartialDate } from './types'
import { bookGenres } from './genreNormalize'
import { bylineAuthors } from './seriesIndex'
import { bookTropeNames } from './tropes'

/** Persisted completions, supplied separately from the base book query's unhydrated reads. */
export interface ReadingLog {
  id: string
  bookId: string
  date: string | null
  format: string | null
  rating: number | null
  notes: string | null
}

export interface RecordedRead extends ReadingLog {
  book: Book
  finished: PartialDate
}

export interface ReadingHistory {
  records: RecordedRead[]
  years: number[]
  markedRead: Book[]
  stopped: Book[]
  knownReadBooks: Book[]
}

/** No Date constructor: exact dates stay in the reader's calendar, never shift with timezone.
 * The current database stores an exact date or null. Coarser input can be represented without
 * inventing a day if an importer/storage adapter gains that capability later. */
function finishDate(value: string | null): PartialDate {
  const unknown = { y: null, m: null, d: null }
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(value ?? '')
  if (!match) return unknown
  const y = Number(match[1])
  const m = match[2] ? Number(match[2]) : null
  const d = match[3] ? Number(match[3]) : null
  if (y < 1 || (m !== null && (m < 1 || m > 12))) return unknown
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  if (d !== null && (m === null || d < 1 || d > (days[m - 1] ?? 0))) return unknown
  return { y, m, d }
}

export function buildReadingHistory(
  books: readonly Book[],
  logs: readonly ReadingLog[],
): ReadingHistory {
  const byBook = new Map(books.map((book) => [book.id, book]))
  const seen = new Set<string>()
  const records: RecordedRead[] = []
  for (const log of logs) {
    const book = byBook.get(log.bookId)
    // Removed/out-of-scope books and repeated transport rows cannot inflate a personal summary.
    if (!book || seen.has(log.id)) continue
    seen.add(log.id)
    records.push({ ...log, book, finished: finishDate(log.date) })
  }
  records.sort((a, b) => {
    const ad = a.finished,
      bd = b.finished
    return (
      (bd.y ?? 0) - (ad.y ?? 0) ||
      (bd.m ?? 0) - (ad.m ?? 0) ||
      (bd.d ?? 0) - (ad.d ?? 0) ||
      a.id.localeCompare(b.id)
    )
  })
  const loggedIds = new Set(records.map((read) => read.bookId))
  return {
    records,
    years: [
      ...new Set(records.flatMap((read) => (read.finished.y === null ? [] : [read.finished.y]))),
    ].sort((a, b) => b - a),
    markedRead: books.filter((book) => book.readStatus === 'Read' && !loggedIds.has(book.id)),
    stopped: books.filter((book) => book.readStatus === 'DNF'),
    knownReadBooks: books.filter((book) => loggedIds.has(book.id) || book.readStatus === 'Read'),
  }
}

export interface ReadingBucket {
  label: string
  records: RecordedRead[]
}

function buckets(
  records: RecordedRead[],
  labels: (read: RecordedRead) => string[],
): ReadingBucket[] {
  const grouped = new Map<string, ReadingBucket>()
  for (const read of records) {
    const seen = new Set<string>()
    for (const rawLabel of labels(read)) {
      const label = rawLabel.trim().replace(/\s+/g, ' ')
      const key = label.toLocaleLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      const group = grouped.get(key) ?? { label, records: [] }
      group.records.push(read)
      grouped.set(key, group)
    }
  }
  return [...grouped.values()].sort(
    (a, b) => b.records.length - a.records.length || a.label.localeCompare(b.label),
  )
}

/** One scope for every chart. Repetitions are derived from log counts, not a guessed first-read
 * date or the current book status. Undated context may make a year's return count a lower bound. */
export function summarizeReadingHistory(history: ReadingHistory, year: number | 'all') {
  const records = history.records.filter((read) => year === 'all' || read.finished.y === year)
  const distinctBooks = [...new Map(records.map((read) => [read.bookId, read.book])).values()]
  let returns = 0
  let returnsAreMinimum = false
  const returnBookIds = new Set<string>()
  const selectedCounts = new Map<string, number>()
  const contextByBook = new Map<string, RecordedRead[]>()
  for (const read of records)
    selectedCounts.set(read.bookId, (selectedCounts.get(read.bookId) ?? 0) + 1)
  for (const read of history.records) {
    const group = contextByBook.get(read.bookId) ?? []
    group.push(read)
    contextByBook.set(read.bookId, group)
  }
  for (const book of distinctBooks) {
    const selectedCount = selectedCounts.get(book.id) ?? 0
    const context = contextByBook.get(book.id) ?? []
    const earlier =
      year !== 'all' && context.some((read) => read.finished.y !== null && read.finished.y < year)
    const count = Math.max(0, selectedCount - (earlier ? 0 : 1))
    returns += count
    if (context.length > 1) returnBookIds.add(book.id)
    if (year !== 'all' && !earlier && context.some((read) => read.finished.y === null))
      returnsAreMinimum = true
  }
  return {
    records,
    distinctBooks,
    returns,
    returnsAreMinimum,
    returnContext: history.records.filter((read) => returnBookIds.has(read.bookId)),
    undated: history.records.filter((read) => read.finished.y === null),
    months: Array.from({ length: 12 }, (_, i) =>
      records.filter((read) => read.finished.m === i + 1),
    ),
    withoutMonth: records.filter((read) => read.finished.m === null),
    genres: buckets(records, (read) => {
      const genres = bookGenres(read.book)
      return genres.length ? genres : ['Not recorded']
    }),
    formats: buckets(records, (read) => {
      const format = read.format?.trim()
      const canonical: Record<string, string> = {
        paperback: 'Paperback',
        hardcover: 'Hardcover',
        ebook: 'Ebook',
        'e-book': 'Ebook',
        audiobook: 'Audiobook',
        'kindle unlimited': 'Kindle Unlimited',
        'special edition': 'Special Edition',
      }
      return [format ? (canonical[format.toLowerCase()] ?? format) : 'Not recorded']
    }),
    authors: buckets(records, (read) => {
      const authors = bylineAuthors(read.book).map((author) => author.name)
      return authors.length ? authors : ['Not recorded']
    }),
    tropes: buckets(records, (read) => {
      const tropes = bookTropeNames(read.book)
      return tropes.length ? tropes : ['Not recorded']
    }),
    moods: buckets(records, (read) => {
      const moods = read.book.moods.map((mood) => mood.name)
      return moods.length ? moods : ['Not recorded']
    }),
  }
}
