import { describe, expect, it } from 'vitest'
import { emptyDate, type PlanDate } from '@reverie/core'
import { toBook, toBookRow } from './mappers'
import type { BookRow } from './types'

/** A books row with only what `toBook` needs, plus whatever plan shape the case is about. */
function row(
  plan: Partial<
    Pick<
      BookRow,
      'plan_y' | 'plan_m' | 'plan_d' | 'plan_date' | 'plan_position' | 'plan_intention'
    >
  >,
): BookRow {
  return {
    id: 'b1',
    owner_id: 'o1',
    corpus_work_id: 'w1',
    title: 'A Book',
    author_first: null,
    author_last: null,
    authors_display: null,
    series: null,
    position: null,
    series_count: null,
    series_user_chosen: false,
    status: null,
    genre: 'Fantasy',
    subgenre: null,
    subgenres: [],
    genres: [],
    tags: [],
    intensity: null,
    darkness: null,
    cover_url: null,
    cover_thumb_url: null,
    cover_source: null,
    cover_source_url: null,
    cover_confidence: null,
    cover_user_chosen: false,
    cover_color: null,
    isbn: null,
    fave: false,
    ownership: 'unowned',
    owned_physical: null,
    owned_ebook: false,
    owned_audiobook: false,
    borrowed: false,
    wishlist: false,
    format: null,
    rating: null,
    read_status: 'Unread',
    source: null,
    pages: null,
    pub_y: null,
    pub_m: null,
    pub_d: null,
    plan_date: null,
    plan_y: null,
    plan_m: null,
    plan_d: null,
    progress: null,
    reading_position: null,
    reading_now_hidden: false,
    enriched_at: null,
    tropes_suggested_at: null,
    added_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    removed_at: null,
    removed_by: null,
    ...plan,
  }
}

/** One full turn of the loop a real edit makes: domain → columns → domain. */
function roundTrip(plan: PlanDate): PlanDate {
  const written = toBookRow({ plan })
  return toBook(
    row({
      plan_y: written.plan_y ?? null,
      plan_m: written.plan_m ?? null,
      plan_d: written.plan_d ?? null,
    }),
  ).plan
}

describe('plan round-trip through the mapper, at every precision', () => {
  it('a full day-precision plan survives write → read unchanged', () => {
    const back = roundTrip({ y: 2026, m: 3, d: 14 })
    expect(back).toEqual({ y: 2026, m: 3, d: 14 })
  })

  it('a month-only plan survives, and is NOT completed with a day on the way back', () => {
    const back = roundTrip({ y: 2026, m: 3, d: null })
    expect(back).toEqual({ y: 2026, m: 3, d: null })
  })

  it('a year-only plan survives, with month and day still null', () => {
    const back = roundTrip({ y: 2026, m: null, d: null })
    expect(back).toEqual({ y: 2026, m: null, d: null })
  })

  it('no plan round-trips as no plan', () => {
    const back = roundTrip(emptyDate())
    expect(back).toEqual(emptyDate())
  })
})

describe('plan queue fields', () => {
  it('round-trips deliberate Soon membership and a private intention', () => {
    const written = toBookRow({ planPosition: 2048, planIntention: 'For a quiet weekend.' })
    expect(written).toEqual({
      plan_position: 2048,
      plan_intention: 'For a quiet weekend.',
    })
    const book = toBook(row({ plan_position: 2048, plan_intention: 'For a quiet weekend.' }))
    expect(book.planPosition).toBe(2048)
    expect(book.planIntention).toBe('For a quiet weekend.')
  })

  it('reads a pre-migration row as unpositioned with no intention', () => {
    const book = toBook(row({}))
    expect(book.planPosition).toBeNull()
    expect(book.planIntention).toBe('')
  })
})

describe('plan_date is no longer written', () => {
  // The dual-write bought rollback safety while both representations were live. It is gone: the
  // trio is the only thing the app maintains, which is the precondition for dropping the column.
  it('a complete plan writes the trio and NOTHING else — no plan_date key at all', () => {
    const written = toBookRow({ plan: { y: 2026, m: 3, d: 14 } })
    expect(Object.keys(written).sort()).toEqual(['plan_d', 'plan_m', 'plan_y'])
    expect('plan_date' in written).toBe(false)
  })

  it('a partial plan writes the trio and no plan_date either', () => {
    expect('plan_date' in toBookRow({ plan: { y: 2026, m: 3, d: null } })).toBe(false)
    expect('plan_date' in toBookRow({ plan: { y: 2026, m: null, d: null } })).toBe(false)
  })

  it('clearing the plan clears the trio and still leaves plan_date untouched', () => {
    const written = toBookRow({ plan: emptyDate() })
    expect(written).toEqual({ plan_y: null, plan_m: null, plan_d: null })
  })

  it('leaves every plan column alone when the patch does not mention the plan', () => {
    const written = toBookRow({ title: 'Renamed' })
    expect('plan_y' in written).toBe(false)
    expect('plan_date' in written).toBe(false)
  })
})

describe('a row with no trio reads as no plan', () => {
  // Two assertions used to live here about `plan_date`: that a legacy row still read as a plan, and
  // that the trio won when both were present. Both are gone with the column (20260805010000) — a row
  // carrying only plan_date is now unconstructible, so testing it would mean building a BookRow shape
  // the database can no longer return. What survives is the half that still has meaning.
  it('an empty trio is no plan — nothing else is consulted', () => {
    expect(toBook(row({})).plan).toEqual(emptyDate())
  })
})
