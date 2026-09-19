import { describe, expect, it } from 'vitest'
import { GUEST_CATALOG } from './catalog'

describe('landing guest catalog covers', () => {
  it('uses distinct owner-selected local or exact-ISBN Open Library covers', () => {
    const covers = GUEST_CATALOG.map((book) => book.cover)
    expect(new Set(covers)).toHaveLength(GUEST_CATALOG.length)
    for (const book of GUEST_CATALOG) {
      expect(book.isbn).toMatch(/^97[89]\d{10}$/)
      expect(book.cover).toBe(
        book.key === 'jane-eyre' || book.key === 'left-hand-of-darkness'
          ? `/landing-covers/${book.key}-${book.isbn}.webp`
          : `https://covers.openlibrary.org/b/isbn/${book.isbn}-L.jpg?default=false`,
      )
    }
  })
})
