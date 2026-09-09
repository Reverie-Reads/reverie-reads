import { describe, expect, it } from 'vitest'
import type { Book } from '@reverie/core'
import {
  parseReleasePub,
  personalReleaseWindow,
  releaseDateLabel,
  releaseWindow,
  yourAuthors,
  type ReleaseHit,
} from './releases'

const book = (b: { title: string; author: string; rating?: number; fave?: boolean; isbn?: string }): Book =>
  ({
    title: b.title,
    isbn: b.isbn ?? '',
    rating: b.rating ?? 0,
    fave: b.fave ?? false,
    contributors: [{ name: b.author, role: 'author' }],
  }) as unknown as Book

const hit = (h: Partial<ReleaseHit>): ReleaseHit => ({ title: '', authors: [], cover: '', isbn: '', pub: '', ...h })

describe('yourAuthors — the derived follow list', () => {
  const books = [
    book({ title: 'ACOTAR', author: 'Sarah J. Maas', rating: 5 }),
    book({ title: 'One Meh Book', author: 'One Timer', rating: 3 }),
    book({ title: 'First', author: 'Two Timer', rating: 3 }),
    book({ title: 'Second', author: 'Two Timer' }),
    book({ title: 'Faved', author: 'Fave Author', fave: true }),
  ]

  it('derives loved authors and multi-book authors; single lukewarm books do not qualify', () => {
    expect(yourAuthors(books, {})).toEqual(['Fave Author', 'Sarah J. Maas', 'Two Timer'])
  })

  it('muted authors drop out; followed names pin in even without qualifying books', () => {
    expect(yourAuthors(books, { 'Two Timer': 'muted', 'Penn Cole': 'followed' })).toEqual([
      'Fave Author',
      'Penn Cole',
      'Sarah J. Maas',
    ])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => book({ title: `B${i}`, author: `Author ${String(i).padStart(2, '0')}`, rating: 5 }))
    expect(yourAuthors(many, {}, 20)).toHaveLength(20)
  })
})

describe('releaseWindow — upcoming/recent, owned and stale excluded', () => {
  const now = Date.parse('2026-07-06')
  const books = [book({ title: 'Owned Already', author: 'Sarah J. Maas', isbn: '9781111111111' })]
  const shelves = {
    'Sarah J. Maas': [
      hit({ title: 'Future Book', authors: ['Sarah J. Maas'], pub: '2026-09-01' }),
      hit({ title: 'Recent Book', authors: ['Sarah J. Maas'], pub: '2026-05-01' }),
      hit({ title: 'Owned Already', authors: ['Sarah J. Maas'], isbn: '9781111111111', pub: '2026-06-01' }),
      hit({ title: 'Old Backlist', authors: ['Sarah J. Maas'], pub: '2015-05-05' }),
      hit({ title: 'Undated', authors: ['Sarah J. Maas'], pub: '' }),
    ],
    'Penn Cole': [
      hit({ title: 'Sooner Future', authors: ['Penn Cole'], pub: '2026-08-01' }),
      hit({ title: 'Year Only', authors: ['Penn Cole'], pub: '2026' }),
      hit({ title: 'Future Year', authors: ['Penn Cole'], pub: '2027' }),
    ],
  }

  it('windows, owner-filters, and sorts without manufacturing a day for partial dates', () => {
    const { upcoming, recent, uncertain } = releaseWindow(shelves, books, now)
    expect(upcoming.map((r) => r.title)).toEqual(['Sooner Future', 'Future Book', 'Future Year'])
    expect(recent.map((r) => r.title)).toEqual(['Recent Book'])
    expect(uncertain.map((r) => r.title)).toEqual(['Year Only'])
  })

  it('dedupes the same title across author shelves', () => {
    const dup = { A: [hit({ title: 'Co-Written', authors: ['A'], pub: '2026-08-02' })], B: [hit({ title: 'Co-Written', authors: ['A'], pub: '2026-08-02' })] }
    const { upcoming } = releaseWindow(dup, [], now)
    expect(upcoming).toHaveLength(1)
  })
})

describe('personalReleaseWindow — the reader shelf stays focused on arrivals', () => {
  const now = Date.parse('2026-07-06T12:00:00Z')
  const saved = (title: string, pub: Book['pub']) =>
    ({ ...book({ title, author: 'Shelf Author' }), pub }) as Book

  it('separates future, recent, and current partial dates without including backlist or unknowns', () => {
    const result = personalReleaseWindow(
      [
        saved('Near Future', { y: 2026, m: 8, d: 1 }),
        saved('Far Future', { y: 2027, m: null, d: null }),
        saved('Current Month', { y: 2026, m: 7, d: null }),
        saved('Current Year', { y: 2026, m: null, d: null }),
        saved('Recently Out', { y: 2026, m: 6, d: 1 }),
        saved('Old Backlist', { y: 2015, m: 5, d: 5 }),
        saved('Unknown', { y: null, m: null, d: null }),
      ],
      now,
    )

    expect(result.upcoming.map((entry) => entry.title)).toEqual(['Near Future', 'Far Future'])
    expect(result.uncertain.map((entry) => entry.title)).toEqual([
      'Current Year',
      'Current Month',
    ])
    expect(result.recent.map((entry) => entry.title)).toEqual(['Recently Out'])
  })

  it('treats an exact release earlier today as newly arrived', () => {
    const result = personalReleaseWindow(
      [saved('Out Today', { y: 2026, m: 7, d: 6 })],
      now,
    )
    expect(result.recent.map((entry) => entry.title)).toEqual(['Out Today'])
  })
})

describe('release date input and display', () => {
  it('preserves year, month, and day precision', () => {
    expect(parseReleasePub('2027')).toEqual({ y: 2027, m: null, d: null })
    expect(parseReleasePub('2027-03')).toEqual({ y: 2027, m: 3, d: null })
    expect(parseReleasePub('2027-03-14')).toEqual({ y: 2027, m: 3, d: 14 })
    expect(releaseDateLabel('2027-03')).toBe('Mar 2027')
  })

  it('rejects calendar-invalid input', () => {
    expect(parseReleasePub('2027-02-29')).toBeNull()
    expect(parseReleasePub('March 2027')).toBeNull()
  })
})
