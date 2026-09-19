import { describe, expect, it } from 'vitest'
import { buildBuyLinks, buyDisclosure, type BuyConfig } from './buyLinks'

const base: BuyConfig = { mode: 'store', bookshopAffiliateId: '5780', store: undefined }
const book = { title: 'Fourth Wing', first: 'Rebecca', last: 'Yarros', isbn: '0306406152' }

describe('buildBuyLinks', () => {
  it('routes print/ebook to Bookshop by canonical ISBN-13 and audio to Libro', () => {
    const links = buildBuyLinks(book, base)
    const bookshop = links.find((l) => l.provider === 'bookshop')!
    const libro = links.find((l) => l.provider === 'libro')!
    expect(bookshop.url).toBe('https://bookshop.org/book/9780306406157') // ISBN-10 promoted to 13
    expect(libro.url).toBe('https://libro.fm/search?q=9780306406157')
  })

  it('store mode never injects the app affiliate id (app earns nothing)', () => {
    const url = buildBuyLinks(book, base).find((l) => l.provider === 'bookshop')!.url
    expect(url).not.toContain('/a/5780/')
  })

  // Replaces "routes Bookshop profit through the chosen store's id when known", which asserted a
  // branch nothing in the app could reach — no OSM tag, column or type ever carried a Bookshop id,
  // so the test was false assurance about where money goes. What a chosen store ACTUALLY does is
  // add a direct link to its own shop, first in the list; Bookshop stays a plain by-ISBN link.
  it('puts the chosen store first and leaves the Bookshop link plain by-ISBN', () => {
    const links = buildBuyLinks(book, {
      ...base,
      store: { name: 'Powell’s', website: 'https://powells.com' },
    })
    expect(links[0]).toMatchObject({ provider: 'store', url: 'https://powells.com' })
    expect(links.find((l) => l.provider === 'bookshop')!.url).toBe(
      'https://bookshop.org/book/9780306406157',
    )
  })

  it('omits the store link when the chosen store has no website on file', () => {
    const links = buildBuyLinks(book, { ...base, store: { name: 'A Shop With No Site' } })
    expect(links.some((l) => l.provider === 'store')).toBe(false)
  })

  it('affiliate mode uses the app affiliate id (config flip, not a refactor)', () => {
    const url = buildBuyLinks(book, { ...base, mode: 'affiliate' }).find(
      (l) => l.provider === 'bookshop',
    )!.url
    expect(url).toBe('https://bookshop.org/a/5780/9780306406157')
  })

  it('falls back to a Bookshop search when there is no ISBN', () => {
    const url = buildBuyLinks({ title: 'Untitled', first: 'A', last: 'Author' }, base).find(
      (l) => l.provider === 'bookshop',
    )!.url
    expect(url).toContain('bookshop.org/beta-search?keywords=')
  })
})

describe('buyDisclosure', () => {
  it('states the app earns nothing in store mode and names the store', () => {
    expect(buyDisclosure(base)).toContain('Midniht earns nothing')
    expect(buyDisclosure({ ...base, store: { name: 'Powell’s' } })).toContain('Powell’s')
  })

  // The chosen store is paid by the DIRECT link only; Bookshop/Libro carry no per-store
  // attribution. The line must not merge the two into one "supports <store>" claim.
  it('does not claim the chosen store is paid by the Bookshop/Libro links', () => {
    const line = buyDisclosure({ ...base, store: { name: 'Powell’s' } })
    expect(line).toMatch(/Shopping Powell’s directly supports them/)
    expect(line).toContain('indie bookstores generally')
    expect(line).not.toMatch(/Supports Powell’s and other indies/)
  })
  it('discloses commission in affiliate mode', () => {
    expect(buyDisclosure({ ...base, mode: 'affiliate' })).toContain('commission')
  })
})
