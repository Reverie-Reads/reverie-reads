import { describe, expect, it } from 'vitest'
import {
  discoverAddSearch,
  parseReleaseHandoff,
  releaseFormat,
  releaseSourceUrl,
} from './releaseHandoff'
import { pickedFromAddPrefill, validateAddSearch } from '../routes/AddRoute'
import type { DiscoverHit } from './discover'

const hit: DiscoverHit = {
  title: 'Edition handoff',
  authors: ['Nell Writer', 'Tariq Writer'],
  isbn: '9798991234504',
  pub: '2027-02',
  cover: '',
  release: {
    source: 'hardcover',
    precision: 'month',
    sourceUrl: 'https://hardcover.app/books/edition-handoff',
    formats: ['Hardback'],
    publisher: 'Example Press',
    checkedAt: '2026-09-21T00:00:00Z',
  },
}
describe('release edition handoff', () => {
  it('keeps one edition, all authors, source and date precision through route validation', () => {
    const search = discoverAddSearch(hit, undefined, { window: 'upcoming', editions: true })
    const prefill = validateAddSearch(JSON.parse(JSON.stringify(search)))
    expect(prefill).toMatchObject({ releaseWindow: 'upcoming', releaseEditions: true, want: true })
    expect(pickedFromAddPrefill(prefill)).toMatchObject({
      isbn: hit.isbn,
      pub: hit.pub,
      authors: hit.authors,
      sourceUrl: hit.release?.sourceUrl,
      edition: { format: 'hardcover', publisher: 'Example Press' },
    })
  })
  it('still clears ordinary Hardcover work-search edition fields', () => {
    const prefill = validateAddSearch({
      title: hit.title,
      authors: hit.authors,
      isbn: hit.isbn,
      pub: hit.pub,
      source: 'hardcover',
    })
    expect(pickedFromAddPrefill(prefill)).toMatchObject({ isbn: '', pub: '', edition: undefined })
  })
  it.each([
    { title: 'Different work' },
    { authors: ['Nell Writer'] },
    { isbn: '9780143117841' },
    { pub: '2027-02-01' },
  ])('does not attach a release snapshot to conflicting outer fields %j', (patch) => {
    const prefill = validateAddSearch({ ...discoverAddSearch(hit), ...patch })
    expect(pickedFromAddPrefill(prefill)).toMatchObject({ isbn: '', pub: '', edition: undefined })
  })
  it.each(
    [[], ['Collectors edition'], ['Paperback', 'Hardcover'], ['Hardcover', 'unknown']].map(
      (formats) => ({ formats }),
    ),
  )('keeps unsupported or competing formats unknown %j', ({ formats }) => {
    expect(releaseFormat(formats)).toBe('unknown')
  })
  it.each([
    'https://hardcover.app.evil.test/books/title',
    'https://evil@hardcover.app/books/title',
    'https://hardcover.app/books/title?token=secret',
    'javascript:alert(1)',
    'https://hardcover.app/auth',
  ])('rejects unsafe or unrelated source links %s', (url) => {
    expect(releaseSourceUrl(url)).toBeUndefined()
    expect(
      parseReleaseHandoff({ ...discoverAddSearch(hit).edition, sourceUrl: url }),
    ).toBeUndefined()
  })
  it('rejects impossible dates, invalid ISBNs and provider/source mismatch', () => {
    const edition = discoverAddSearch(hit).edition
    for (const patch of [{ pub: '2027-02-29' }, { isbn: '9798991234505' }, { source: 'prh' }])
      expect(parseReleaseHandoff({ ...edition, ...patch })).toBeUndefined()
  })
  it('supports a publisher release without borrowing a Hardcover search identity', () => {
    const search = discoverAddSearch({
      ...hit,
      release: {
        ...hit.release!,
        source: 'prh',
        sourceUrl: 'https://www.penguinrandomhouse.com/books/123/edition-handoff/',
        formats: ['Ebook'],
      },
    })
    expect(pickedFromAddPrefill(validateAddSearch(search))?.edition).toMatchObject({
      source: 'prh',
      format: 'ebook',
    })
  })
})
