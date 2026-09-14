import { describe, expect, it } from 'vitest'
import { publicationDateError } from './publicationDate'

describe('publicationDateError', () => {
  it('accepts unknown, year-only, year-month and real complete dates', () => {
    expect(publicationDateError({ y: null, m: null, d: null })).toBeNull()
    expect(publicationDateError({ y: 2026, m: null, d: null })).toBeNull()
    expect(publicationDateError({ y: 2026, m: 9, d: null })).toBeNull()
    expect(publicationDateError({ y: 2024, m: 2, d: 29 })).toBeNull()
  })

  it('names missing precision before rejecting an impossible calendar day', () => {
    expect(publicationDateError({ y: null, m: 9, d: null })).toEqual({
      field: 'year',
      message: 'Add a publication year before a month or day.',
    })
    expect(publicationDateError({ y: 2026, m: null, d: 4 })).toEqual({
      field: 'month',
      message: 'Add a publication month before a day.',
    })
    expect(publicationDateError({ y: 2025, m: 2, d: 29 })).toEqual({
      field: 'day',
      message: 'Use a real calendar date.',
    })
  })
})
