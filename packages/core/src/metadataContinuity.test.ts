import { describe, expect, it } from 'vitest'
import { makeBook } from './book.fixture'
import { mergeImport } from './match'
import { mergeFieldOptions, applyFieldPicks } from './mergeFieldPicker'
import { parseCsvRows } from './csv'
import { validPublicationDate } from './partialDate'

const isbn = '9780306406157'
const other = '9780143117841'
const offer = { title: 'A Book', isbn, pages: 321, pub: { y: 2010, m: 9, d: 28 } }
describe('edition metadata continuity', () => {
  it('fills pages and the whole date for an equivalent selected ISBN, then is idempotent', () => {
    const book = makeBook({
      id: 'book',
      title: 'A Book',
      isbn: '0-306-40615-2',
      pages: null,
      pub: { y: null, m: null, d: null },
    })
    const { patch } = mergeImport(book, offer)
    expect(patch).toMatchObject({ pages: 321, pub: offer.pub })
    expect(mergeImport({ ...book, ...patch }, offer).patch.pages).toBeUndefined()
  })
  it.each([other, '', '9780306406158'])(
    'does not donate fields from ISBN %s to the selected edition',
    (incomingIsbn) => {
      const book = makeBook({
        id: 'book',
        title: 'A Book',
        isbn,
        pages: null,
        pub: { y: null, m: null, d: null },
      })
      const incoming = { ...offer, isbn: incomingIsbn }
      expect(mergeImport(book, incoming).patch).not.toHaveProperty('pages')
      expect(mergeImport(book, incoming).patch).not.toHaveProperty('pub')
      expect(
        mergeFieldOptions(book, incoming).some((f) => f.key === 'pages' || f.key === 'pub'),
      ).toBe(false)
      expect(applyFieldPicks(book, incoming, { pages: true, pub: true })).not.toHaveProperty(
        'pages',
      )
    },
  )
  it('preserves reader pages and date precision even when the provider is more precise', () => {
    const book = makeBook({
      id: 'book',
      title: 'A Book',
      isbn,
      pages: 543,
      pub: { y: 2010, m: null, d: null },
    })
    expect(mergeImport(book, offer).patch).not.toHaveProperty('pages')
    expect(mergeImport(book, offer).patch).not.toHaveProperty('pub')
  })
  it.each([0, -1, 3.5, 20001, NaN])('rejects invalid page count %s', (pages) => {
    expect(
      mergeImport(makeBook({ id: 'book', title: 'A Book', isbn, pages: null }), { ...offer, pages })
        .patch,
    ).not.toHaveProperty('pages')
  })
  it('uses the imported edition year and page count, preserving additional contributors', () => {
    const [row] = parseCsvRows(
      'Title,Author,Additional Authors,ISBN13,Number of Pages,Year Published,Original Publication Year\nA Book,A Writer,B Writer,9780306406157,321,2010,1813',
    )
    expect(row?.incoming).toMatchObject({ isbn, pages: 321, pub: { y: 2010, m: null, d: null } })
    expect(row?.incoming.contributors?.map((c) => c.name)).toEqual(['A Writer', 'B Writer'])
  })
  it('does not substitute an original-work year or partially parse malformed page text', () => {
    const [row] = parseCsvRows(
      'Title,Author,Number of Pages,Original Publication Year\nA Book,A Writer,321 pages,1813',
    )
    expect(row?.incoming.pages).toBeNull()
    expect(row?.incoming.pub?.y).toBeNull()
  })
  it('rejects impossible and disconnected dates without manufacturing precision', () => {
    expect(validPublicationDate({ y: 2024, m: 2, d: 29 })).toBe(true)
    expect(validPublicationDate({ y: 2023, m: 2, d: 29 })).toBe(false)
    expect(validPublicationDate({ y: 2024, m: null, d: 1 })).toBe(false)
    expect(validPublicationDate({ y: 2024, m: null, d: null })).toBe(true)
  })
})
