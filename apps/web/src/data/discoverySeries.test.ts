import { describe, expect, it } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import { makeSeriesClaim, normalizeSeriesClaim, type SeriesEntry } from '@reverie/core'
import { discoverySeriesAnchors } from './discoverySeries'
import type { SeriesListRow } from './series'
const book = makeBook({
  id: 'book',
  title: 'A beginning',
  genre: 'fantasy',
  corpusWorkId: 'f9100000-0000-4000-8000-000000000001',
  reads: [{ date: '2026-09-01', format: 'physical', rating: 0, notes: '' }],
})
const entry: SeriesEntry = {
  id: 'entry',
  bookId: 'book',
  title: book.title,
  author: 'Nell Stone',
  position: 1,
  label: null,
  source: 'manual',
  userEdited: false,
  sortUserEdited: false,
  membershipClaim: makeSeriesClaim('reader', 'fixture'),
  positionClaim: makeSeriesClaim('reader', 'fixture'),
}
const row: SeriesListRow = {
  series: {
    id: 'series',
    name: 'A journey',
    status: 'ongoing',
    source: 'manual',
    sourceRef: null,
    refreshedAt: null,
  },
  entries: [entry],
  total: 1,
  ghosts: 0,
  removed: 0,
  unreviewed: 0,
}
describe('series invitation eligibility', () => {
  it('uses completed reading history and exact structured membership', () => {
    expect(discoverySeriesAnchors([row], [book])).toHaveLength(1)
    expect(discoverySeriesAnchors([row], [{ ...book, reads: [] }])).toEqual([])
    expect(discoverySeriesAnchors([row], [{ ...book, corpusWorkId: undefined }])).toEqual([])
  })
  it('never revives a removed category or guesses around a removed slot or private order', () => {
    expect(discoverySeriesAnchors([], [book])).toEqual([])
    expect(discoverySeriesAnchors([{ ...row, removed: 1 }], [book])).toEqual([])
    expect(discoverySeriesAnchors([{ ...row, unreviewed: 1 }], [book])).toEqual([])
    expect(
      discoverySeriesAnchors([{ ...row, entries: [{ ...entry, sortUserEdited: true }] }], [book]),
    ).toEqual([])
    expect(
      discoverySeriesAnchors(
        [
          {
            ...row,
            entries: [{ ...entry, positionClaim: normalizeSeriesClaim({ origin: 'unknown' }) }],
          },
        ],
        [book],
      ),
    ).toEqual([])
  })
})
