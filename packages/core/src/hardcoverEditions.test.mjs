import { describe, expect, it } from 'vitest'
import {
  equivalentIsbn10,
  hardcoverEditionRecord,
  hardcoverWorkRecord,
} from '../../../supabase/functions/enrich/hardcoverEditions'
const identity = { title: 'The Quiet Observatory', author: 'Alex Example', isbn: '9780306406157' }
const book = {
  id: 5,
  title: identity.title,
  contributions: [{ contribution: 'Author', author: { name: identity.author } }],
}
const edition = {
  id: 3,
  book,
  title: identity.title,
  compilation: false,
  isbn_13: identity.isbn,
  isbn_10: '0306406152',
  pages: 250,
  release_date: '2020-02',
  physical_format: 'Paperback',
}
describe('edition identity', () => {
  it('accepts equivalent identifiers and preserves partial dates', () => {
    expect(equivalentIsbn10(identity.isbn)).toBe('0306406152')
    expect(hardcoverEditionRecord(edition, identity)).toMatchObject({
      isbn13: identity.isbn,
      pageCount: 250,
      pubY: 2020,
      pubM: 2,
      pubD: null,
    })
  })
  it.each([
    { title: 'Another book' },
    { isbn_10: 'invalid' },
    { compilation: true },
    {
      book: {
        ...book,
        contributions: [{ contribution: 'Narrator', author: { name: identity.author } }],
      },
    },
    { book: { ...book, contributions: [...book.contributions, { author: null }] } },
    { book: { ...book, contributions: Array.from({ length: 33 }, () => book.contributions[0]) } },
  ])('rejects incomplete or mismatching identity %j', (extra) => {
    expect(hardcoverEditionRecord({ ...edition, ...extra }, identity)).toBeNull()
  })
  it('does not treat a parent book page count as edition pages', () => {
    expect(
      hardcoverEditionRecord({ ...edition, pages: null, book: { ...book, pages: 888 } }, identity)
        ?.pageCount,
    ).toBeNull()
  })
  it('does not choose between duplicate exact work identities', () => {
    expect(() =>
      hardcoverWorkRecord({ data: { books: [book, { ...book, id: 6 }] } }, identity),
    ).toThrow(/Competing/)
  })
})
