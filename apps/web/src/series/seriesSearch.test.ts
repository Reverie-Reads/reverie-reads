import { describe, expect, it } from 'vitest'
import { matchesSeriesSearch } from './seriesSearch'
describe('series search', () => {
  it('finds words across series, book and author fields regardless of order, case or accents', () => {
    expect(matchesSeriesSearch('ROWLING potter', ['Harry Potter', 'J.K. Rowling'])).toBe(true)
    expect(
      matchesSeriesSearch('gabriel solitude', [
        'One Hundred Years of Solitude',
        'Gabriel García Márquez',
      ]),
    ).toBe(true)
    expect(matchesSeriesSearch('garcia', ['Gabriel García Márquez'])).toBe(true)
    expect(matchesSeriesSearch('missing potter', ['Harry Potter', 'J.K. Rowling'])).toBe(false)
  })
})
