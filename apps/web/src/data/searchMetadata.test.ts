import { expect, it } from 'vitest'
import { incomingFromSearch } from './search'
import { durableEnrichment, type EnrichResult } from '../lib/enrich'
import { selectedSearchIsbn, type SearchResult } from '../lib/search'

const hit: SearchResult = { source: 'google', title: 'A Book', authors: ['A Writer', 'B Writer'], isbn: '9780306406157', cover: '', year: '1813' }
const raw = { admissionVersion: 2, title: 'A Book', authors: ['A Writer', 'B Writer'], isbn13: hit.isbn, pageCount: 321, pubY: 2010, pubM: 9, pubD: 28, cover: '', genres: [] } as unknown as EnrichResult
it('keeps selected identity, all contributors, exact pages/date and independent possession', () => {
  const incoming = incomingFromSearch(hit, 'borrowed', durableEnrichment(raw, hit.isbn))
  expect(incoming).toMatchObject({ title: hit.title, isbn: hit.isbn, pages: 321, pub: { y: 2010, m: 9, d: 28 }, ownership: 'unowned', borrowed: true, wishlist: false, series: '' })
  expect(incoming.contributors?.map((c) => c.name)).toEqual(hit.authors)
})
it('does not use a work ISBN, work year or search series as a selected-edition fact', () => {
  const work = { ...hit, source: 'hardcover' as const, series: 'A Cycle', seriesPosition: 1 }
  expect(selectedSearchIsbn(work)).toBe('')
  expect(incomingFromSearch(work, 'wishlist', durableEnrichment(raw))).toMatchObject({ isbn: '', pages: null, pub: { y: null, m: null, d: null }, series: '' })
})
it('preserves an explicit ISBN when the details service is unavailable', () => {
  expect(incomingFromSearch(hit, 'owned', null)).toMatchObject({ isbn: hit.isbn, pages: null, pub: { y: null, m: null, d: null } })
})
