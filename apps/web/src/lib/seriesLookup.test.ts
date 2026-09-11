import { expect, it } from 'vitest'
import { hardcoverSeriesLookupTarget } from './seriesLookup'

it.each(['hardcover:42', 'hardcover:book:42'])('accepts explicit book locator %s', (ref) => {
  expect(hardcoverSeriesLookupTarget(' Fourth Book ', 'Ada Reader', ref)).toEqual({
    title: 'Fourth Book',
    hardcoverBookId: 42,
  })
})

it.each([
  undefined,
  '42',
  'hardcover:series:42',
  'hardcover:edition:42',
  'openlibrary:42',
  'hardcover:0',
  'hardcover:01',
  'hardcover:-1',
  'hardcover:1.5',
  'hardcover:2147483648',
  'hardcover:42junk',
  'hardcover:42\n',
])('rejects non-book locator %s', (ref) => {
  expect(hardcoverSeriesLookupTarget('Fourth Book', 'Ada Reader', ref)).toBeUndefined()
})

it('requires a bounded title and full author for provider revalidation', () => {
  expect(hardcoverSeriesLookupTarget('', 'Ada Reader', 'hardcover:42')).toBeUndefined()
  expect(hardcoverSeriesLookupTarget('Fourth Book', '', 'hardcover:42')).toBeUndefined()
  expect(hardcoverSeriesLookupTarget('x'.repeat(501), 'Ada Reader', 'hardcover:42')).toBeUndefined()
  expect(
    hardcoverSeriesLookupTarget('Fourth Book', 'x'.repeat(301), 'hardcover:42'),
  ).toBeUndefined()
})
