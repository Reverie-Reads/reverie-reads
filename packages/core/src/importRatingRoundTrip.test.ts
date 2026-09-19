import { describe, expect, it } from 'vitest'
import { importCsv } from './csv'
import { parseImport } from './importMap'
import { snapHalfRating } from './rating'
import { makeBook } from './book.fixture'

/**
 * The half-star round trip — the assertion that matters after #287: rate 4.5 in the app, export,
 * re-import, and it must come back 4.5, not 5. Three Math.round calls on the import path predated
 * half stars and inflated every half up; these tests drive the two REAL entry points the app calls
 * (parseImport for the Midniht-template shape, importCsv for Goodreads/StoryGraph), not the parser
 * alone — the parser was never the thing anyone doubted.
 *
 * The fixture grid: 0 (unrated), 0.5 (the smallest half), 3.75 (StoryGraph rates in QUARTER stars
 * and its export carries them — snapped to the app's half grid), 4.5 (the #287 headline case),
 * 5 (the ceiling), and blank (must stay UNRATED, never become 0-as-a-rating... which in this app's
 * model are the same value, 0 — asserted anyway so the semantics are pinned, not assumed).
 */

const TEMPLATE_HEAD = 'Title,Author,ISBN,Status,Rating,Date Read,Tags,Owned'
const row = (title: string, rating: string) => `${title},Ann Author,,Read,${rating},2026-01-01,,Yes`

describe('Midniht template path (parseImport → rowToImported)', () => {
  it('half and quarter stars survive: 0.5 stays, 3.75 snaps to 4, 4.5 STAYS 4.5', () => {
    const csv = [
      TEMPLATE_HEAD,
      row('Zero', '0'),
      row('Half', '0.5'),
      row('Quarter', '3.75'),
      row('HalfHigh', '4.5'),
      row('Top', '5'),
      row('Blank', ''),
    ].join('\n')
    const { rows } = parseImport(csv)
    const byTitle = Object.fromEntries(rows.map((r) => [r.incoming.title, r.incoming.rating]))
    expect(byTitle).toEqual({
      Zero: undefined, // 0 is OMITTED from Incoming (`...(rating ? {rating} : {})`) — absent IS
      Half: 0.5, //       unrated at this layer, and an absent field can never clobber on merge
      Quarter: 4, // StoryGraph quarter-star, snapped to the app's half grid
      HalfHigh: 4.5, // the #287 case — was silently inflated to 5 before this fix
      Top: 5,
      Blank: undefined, // blank stays unrated, not 0-as-a-rating
    })
  })

  it('out-of-range input clamps instead of importing an impossible rating', () => {
    const csv = [TEMPLATE_HEAD, row('Over', '7'), row('Under', '-1')].join('\n')
    const { rows } = parseImport(csv)
    expect(rows.map((r) => r.incoming.rating)).toEqual([5, undefined]) // -1 clamps to 0 → absent
  })
})

const gr = (title: string, rating: string) => `${title},Ann Author,${rating},2026/01/01,read,2020`
const GR_HEAD = 'Title,Author,My Rating,Date Read,Exclusive Shelf,Original Publication Year'
const SG_HEAD = 'Title,Authors,Star Rating,Last Date Read,Read Status,Year Published'

describe('Goodreads/StoryGraph path (importCsv)', () => {
  it('StoryGraph quarter stars snap to the half grid; halves survive untouched', () => {
    const csv = [SG_HEAD, gr('A', '0.5'), gr('B', '3.75'), gr('C', '4.5'), gr('D', '')].join('\n')
    const out = importCsv([], csv)
    const byTitle = Object.fromEntries(out.books.map((b) => [b.title, b.rating]))
    expect(byTitle).toEqual({ A: 0.5, B: 4, C: 4.5, D: 0 })
  })

  it('a blank/0 incoming rating never clobbers an existing half-star rating (merge keeps 4.5)', () => {
    const existing = [
      makeBook({
        id: 'b1',
        title: 'Kept',
        first: 'Ann',
        last: 'Author',
        rating: 4.5,
        readStatus: 'Read',
      }),
    ]
    const csv = [GR_HEAD, gr('Kept', '0')].join('\n')
    const out = importCsv(existing, csv)
    expect(out.books.find((b) => b.title === 'Kept')?.rating).toBe(4.5)
  })
})

describe('snapHalfRating — the one named coercion', () => {
  it.each([
    [0, 0],
    [0.5, 0.5],
    [1.25, 1.5],
    [3.75, 4],
    [4.5, 4.5],
    [4.75, 5],
    [5, 5],
    [7, 5],
    [-2, 0],
    [NaN, 0],
  ])('%s → %s', (input, want) => {
    expect(snapHalfRating(input)).toBe(want)
  })
})
