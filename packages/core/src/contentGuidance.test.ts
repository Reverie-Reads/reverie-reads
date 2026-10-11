import { describe, expect, it } from 'vitest'
import { bookGuidance } from './contentGuidance'
import { makeBook } from './book.fixture'
import { matchesFilters, defaultFilters, sortBooks } from './filters'

describe('shared guidance defaults', () => {
  it('uses reviewed defaults without converting them to personal assessments', () => {
    const book = makeBook({
      id: 'book',
      title: 'Book',
      ownership: 'owned',
      intensity: null,
      darkness: null,
      sharedGuidance: { spice: 2, darkness: 4 },
    })
    expect(bookGuidance(book)).toEqual({ intensity: 2, darkness: 4 })
    expect(book.intensity).toBeNull()
    expect(book.darkness).toBeNull()
  })
  it('preserves zero personal overrides independently on both axes', () => {
    expect(
      bookGuidance(
        makeBook({
          id: 'book',
          title: 'Book',
          ownership: 'owned',
          intensity: 0,
          darkness: 1,
          sharedGuidance: { spice: 5, darkness: 5 },
        }),
      ),
    ).toEqual({ intensity: 0, darkness: 1 })
  })
  it('does not turn unknown into zero or infer one axis from the other', () => {
    expect(
      bookGuidance(
        makeBook({
          id: 'book',
          title: 'Book',
          ownership: 'owned',
          intensity: null,
          darkness: null,
        }),
      ),
    ).toEqual({ intensity: null, darkness: null })
    expect(
      bookGuidance(
        makeBook({
          id: 'book',
          title: 'Book',
          ownership: 'owned',
          intensity: null,
          darkness: null,
          sharedGuidance: { spice: 3, darkness: null },
        }),
      ),
    ).toEqual({ intensity: 3, darkness: null })
  })
  it('keeps library filters and sorting consistent with the displayed levels', () => {
    const shared = makeBook({
      title: 'Shared',
      ownership: 'owned',
      id: 'shared',
      intensity: null,
      darkness: null,
      sharedGuidance: { spice: 4, darkness: 3 },
    })
    const override = makeBook({
      title: 'Override',
      ownership: 'owned',
      id: 'override',
      intensity: 0,
      sharedGuidance: { spice: 5, darkness: 5 },
    })
    expect(matchesFilters(shared, { ...defaultFilters(), intensity: [4], darkness: [3] })).toBe(
      true,
    )
    expect(matchesFilters(override, { ...defaultFilters(), intensity: [5] })).toBe(false)
    expect(sortBooks([override, shared], 'intensity').map((b) => b.id)).toEqual([
      'shared',
      'override',
    ])
  })
})
