import { describe, expect, it } from 'vitest'
import { durableEnrichment, type EnrichResult } from './enrich'

const result = (overrides: Partial<EnrichResult> = {}): EnrichResult => ({
  title: 'A book',
  authors: ['A Writer'],
  author: 'A Writer',
  series: '',
  seriesPosition: null,
  publisher: '',
  pubY: null,
  pubM: null,
  pubD: null,
  pageCount: null,
  isbn10: '',
  isbn13: '',
  isbn: '',
  language: '',
  genres: [],
  description: '',
  cover: '',
  source: null,
  ...overrides,
})

describe('enrichment display boundary', () => {
  it('removes Google cover values and alternates from a historical response', () => {
    const durable = durableEnrichment(
      result({
        cover: 'https://books.google.com/books/content?id=old&img=1',
        provenance: { cover: { source: 'google', at: '2026-09-10T00:00:00Z' } },
        alternates: [
          {
            source: 'google',
            cover: 'https://books.google.com/books/content?id=alternate&img=1',
            isbn13: '',
            title: 'A book',
            author: 'A Writer',
          },
          {
            source: 'openlibrary',
            cover: 'https://covers.openlibrary.org/b/isbn/9780306406157-L.jpg?default=false',
            isbn13: '9780306406157',
            title: 'A book',
            author: 'A Writer',
          },
        ],
      }),
    )

    expect(durable.cover).toBe('')
    expect(durable.alternates?.map((alternate) => alternate.source)).toEqual(['openlibrary'])
  })

  it('checks the image host when historical provenance is missing or mislabeled', () => {
    const durable = durableEnrichment(
      result({
        cover: 'https://books.googleusercontent.com/books/content?id=old&img=1',
        provenance: { cover: { source: 'manual', at: '2026-09-10T00:00:00Z' } },
        alternates: [
          {
            source: 'manual',
            cover: 'https://books.google.com/books/content?id=mislabeled&img=1',
            isbn13: '',
            title: 'A book',
            author: 'A Writer',
          },
        ],
      }),
    )

    expect(durable.cover).toBe('')
    expect(durable.alternates).toEqual([])
  })
})
