import { describe, expect, it } from 'vitest'
import { GUEST_CATALOG } from './catalog'

describe('landing guest catalog covers', () => {
  it('uses distinct exact-ISBN Open Library cover paths', () => {
    const covers = GUEST_CATALOG.map((book) => book.cover)
    expect(new Set(covers)).toHaveLength(GUEST_CATALOG.length)
    for (const book of GUEST_CATALOG) {
      expect(book.isbn).toMatch(/^97[89]\d{10}$/)
      expect(book.cover).toBe(
        `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg?default=false`,
      )
    }
  })
})
