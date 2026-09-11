import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../lib/search'
import { bulkIncomingFromSearch } from './AddRoute'

const result = (over: Partial<SearchResult> = {}): SearchResult => ({
  source: 'hardcover',
  title: 'Fourth Wing',
  authors: ['Rebecca Yarros'],
  cover: 'https://example.test/fourth-wing.jpg',
  isbn: '9781649374042',
  year: '2023',
  series: 'The Empyrean',
  seriesPosition: 1,
  ...over,
})

describe('bulk Add series evidence', () => {
  it('withholds a search label until the corpus classifier proves relational membership', () => {
    const incoming = bulkIncomingFromSearch(result(), 'fantasy', 'Epic fantasy')

    expect(incoming.series).toBe('')
    expect(incoming.position).toBe('')
    expect(incoming.status).toBe('standalone')
    expect(incoming.seriesClaim).toBeUndefined()
    expect(incoming.cover).toBe('https://example.test/fourth-wing.jpg')
  })

  it('keeps a result with no series unknown instead of inventing membership', () => {
    const incoming = bulkIncomingFromSearch(
      result({ source: 'google', series: undefined, seriesPosition: undefined }),
      'fantasy',
      'Epic fantasy',
    )

    expect(incoming.series).toBe('')
    expect(incoming.position).toBe('')
    expect(incoming.status).toBe('standalone')
    expect(incoming.seriesClaim).toBeUndefined()
    expect(incoming.cover).toBe('')
  })
})
