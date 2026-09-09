import { describe, expect, it } from 'vitest'
import { makeBook } from './book.fixture'
import { buildReadingHistory, summarizeReadingHistory, type ReadingLog } from './readingHistory'

const book = (id: string, patch = {}) =>
  makeBook({ id, title: id, genre: 'literary', genres: ['literary'], ...patch })
const log = (
  id: string,
  bookId: string,
  date: string | null,
  patch: Partial<ReadingLog> = {},
): ReadingLog => ({ id, bookId, date, format: null, rating: null, notes: null, ...patch })

describe('a reading history with no invented sessions', () => {
  it('keeps current DNF and legacy read flags separate from logged completions', () => {
    const books = [
      book('legacy', { readStatus: 'Read' }),
      book('stopped', { readStatus: 'DNF' }),
      book('return', { readStatus: 'DNF' }),
      book('active', { readStatus: 'Reading' }),
      book('wish', { wishlist: true }),
    ]
    const history = buildReadingHistory(books, [log('past', 'return', '2025-03-02')])
    expect(history.markedRead.map((b) => b.id)).toEqual(['legacy'])
    expect(history.stopped.map((b) => b.id)).toEqual(['stopped', 'return'])
    expect(history.knownReadBooks.map((b) => b.id)).toEqual(['legacy', 'return'])
    expect(summarizeReadingHistory(history, 2026).records).toEqual([])
    expect(summarizeReadingHistory(history, 'all').records).toHaveLength(1)
    expect(books[2]?.readStatus).toBe('DNF')
  })

  it('ignores duplicate transport rows and reads belonging to unavailable books', () => {
    const entry = log('r', 'a', '2026-01-01')
    const history = buildReadingHistory(
      [book('a')],
      [entry, entry, log('gone', 'removed', '2026-01-01')],
    )
    expect(history.records).toHaveLength(1)
    expect(entry).not.toHaveProperty('book')
  })

  it('uses calendar precision without inventing a day or shifting an exact date', () => {
    const entries = [
      log('day', 'a', '2024-02-29'),
      log('month', 'a', '2026-04'),
      log('year', 'a', '2026'),
      log('unknown', 'a', null),
      log('invalid', 'a', '2025-02-29'),
      log('bad-month', 'a', '2026-13-01'),
      log('timestamp', 'a', '2026-01-01T00:00:00Z'),
    ]
    const history = buildReadingHistory([book('a')], entries)
    expect(history.years).toEqual([2026, 2024])
    const year = summarizeReadingHistory(history, 2026)
    expect(year.records).toHaveLength(2)
    expect(year.months[3]?.map((r) => r.id)).toEqual(['month'])
    expect(year.withoutMonth.map((r) => r.id)).toEqual(['year'])
    expect(year.undated).toHaveLength(4)
    expect(history.records.find((r) => r.id === 'day')?.finished).toEqual({ y: 2024, m: 2, d: 29 })
    expect(history.records.find((r) => r.id === 'month')?.finished).toEqual({
      y: 2026,
      m: 4,
      d: null,
    })
    expect(summarizeReadingHistory(history, 'all').records).toHaveLength(7)
  })

  it('uses the same period for sessions, books, genres and the format of the read', () => {
    const history = buildReadingHistory(
      [book('a', { genres: ['Fantasy', 'fantasy', 'romance'], format: 'Hardcover' }), book('b')],
      [
        log('old', 'b', '2025-06-01', { format: 'Paperback' }),
        log('new', 'a', '2026-01-01', { format: 'eBook' }),
        log('again', 'a', '2026-03-01', { format: 'Ebook' }),
        log('undated', 'b', null),
      ],
    )
    const year = summarizeReadingHistory(history, 2026)
    expect(year.records).toHaveLength(2)
    expect(year.distinctBooks).toHaveLength(1)
    expect(year.genres.map((b) => [b.label, b.records.length])).toEqual([
      ['fantasy', 2],
      ['romance', 2],
    ])
    expect(year.formats.map((b) => [b.label, b.records.length])).toEqual([['Ebook', 2]])
    expect(
      summarizeReadingHistory(history, 'all').formats.find((b) => b.label === 'Not recorded')
        ?.records,
    ).toHaveLength(1)
  })

  it('summarizes authors, tropes, and reader-assigned moods without double-counting aliases', () => {
    const history = buildReadingHistory(
      [
        book('a', {
          contributors: [
            { name: 'Nell Stone', role: 'author', position: 0 },
            { name: 'Kai Reed', role: 'co_author', position: 1 },
          ],
          tropes: [
            { id: 'found', name: 'Found family', emphasis: 'pinned' },
            { id: 'found-again', name: 'found family', emphasis: 'present' },
          ],
          moods: [
            { id: 'hopeful', name: 'Hopeful' },
            { id: 'hopeful-again', name: 'hopeful' },
          ],
        }),
        book('b', { first: '', last: '', contributors: [], tropes: [], tags: [], moods: [] }),
      ],
      [log('one', 'a', '2026-02-01'), log('two', 'b', '2026-03-01')],
    )
    const year = summarizeReadingHistory(history, 2026)
    expect(year.authors.map((entry) => [entry.label, entry.records.length])).toEqual([
      ['Kai Reed', 1],
      ['Nell Stone', 1],
      ['Not recorded', 1],
    ])
    expect(year.tropes.map((entry) => [entry.label, entry.records.length])).toEqual([
      ['Found family', 1],
      ['Not recorded', 1],
    ])
    expect(year.moods.map((entry) => [entry.label, entry.records.length])).toEqual([
      ['Hopeful', 1],
      ['Not recorded', 1],
    ])
  })

  it('retains earlier context when counting return reads within a year', () => {
    const history = buildReadingHistory(
      [book('a'), book('b')],
      [
        log('first', 'a', '2025-12-31'),
        log('return', 'a', '2026-01-01'),
        log('first-b', 'b', '2026-04-01'),
        log('return-b', 'b', '2026-04-01'),
      ],
    )
    const year = summarizeReadingHistory(history, 2026)
    expect(year.returns).toBe(2)
    expect(year.returnsAreMinimum).toBe(false)
    expect(year.returnContext).toHaveLength(4)
    expect(summarizeReadingHistory(history, 'all').returns).toBe(2)
  })

  it('does not claim an undated read preceded the dated one', () => {
    const history = buildReadingHistory(
      [book('a')],
      [log('unknown', 'a', null), log('dated', 'a', '2026-01-01')],
    )
    expect(summarizeReadingHistory(history, 2026)).toMatchObject({
      returns: 0,
      returnsAreMinimum: true,
    })
    expect(summarizeReadingHistory(history, 'all')).toMatchObject({
      returns: 1,
      returnsAreMinimum: false,
    })
  })

  it('does not count a future repeat as a return in an earlier period', () => {
    const history = buildReadingHistory(
      [book('a')],
      [log('first', 'a', '2025-01-01'), log('later', 'a', '2026-01-01')],
    )
    expect(summarizeReadingHistory(history, 2025).returns).toBe(0)
  })
})
