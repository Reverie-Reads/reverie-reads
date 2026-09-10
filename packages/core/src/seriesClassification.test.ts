import { describe, expect, it } from 'vitest'
import { classifySeriesMembership, type SeriesCatalogSnapshot } from './seriesClassification'

const hardcover = (over: Partial<SeriesCatalogSnapshot> = {}): SeriesCatalogSnapshot => ({
  source: 'hardcover',
  series: 'The Sequence',
  sourceRef: 'hc-series-7',
  memberCount: 3,
  entries: [
    { title: 'First Book', author: 'Ada Reader', position: 1 },
    { title: 'Second Book', author: 'Ada Reader', position: 2 },
    { title: 'Third Book', author: 'Ada Reader', position: 3 },
  ],
  ...over,
})

const input = (over: Record<string, unknown> = {}) => ({
  title: 'Second Book',
  author: 'Ada Reader',
  candidateSeries: 'The Sequence',
  candidatePosition: 99,
  candidateSource: 'hardcover',
  candidateSourceRef: 'hc-book-2',
  identityConfidence: 'high' as const,
  snapshots: [hardcover()],
  ...over,
})

describe('series classification keeps identity and membership evidence separate', () => {
  it('does not count translations and sets at one ordinal as independent series context', () => {
    const result = classifySeriesMembership(
      input({
        title: 'First Book',
        snapshots: [
          hardcover({
            memberCount: 99,
            entries: ['First Book', 'Translated First', 'First Book Box Set'].map((title) => ({
              title,
              author: 'Ada Reader',
              position: 1,
            })),
          }),
        ],
      }),
    )
    expect(result.outcome).toBe('review')
    expect(result.count).toBeNull()
    expect(result.evidence.at(-1)?.memberCount).toBeNull()
  })

  it.each([
    ['Second Book: First and Second Book Box Set', 'Ada Reader'],
    ['Second Book', 'A. Reader'],
  ])(
    'requires exact Hardcover title/full author, not loose bundle/subtitle or initial matching',
    (title, author) => {
      const result = classifySeriesMembership(
        input({ snapshots: [hardcover({ entries: [{ title, author, position: 2 }] })] }),
      )
      expect(result.outcome).toBe('unresolved')
    },
  )

  it('accepts a matched relational membership and takes its position, not the search label position', () => {
    const result = classifySeriesMembership(input())
    expect(result.outcome).toBe('found')
    expect(result.membershipConfidence).toBe('high')
    expect(result.position).toBe(2)
    expect(result.count).toBeNull()
    expect(result.sourceRef).toBe('hc-series-7')
    expect(result.evidence.some((e) => e.kind === 'relational_membership')).toBe(true)
  })

  it('does not accept a search result series label when the relational source lacks the book', () => {
    const result = classifySeriesMembership(
      input({
        snapshots: [
          hardcover({ entries: [{ title: 'Another Book', author: 'Ada Reader', position: 1 }] }),
        ],
      }),
    )
    expect(result.outcome).toBe('unresolved')
    expect(result.series).toBeNull()
    expect(result.membershipConfidence).toBe('low')
  })

  it('keeps a provider outage retryable instead of turning the label into truth', () => {
    const result = classifySeriesMembership(
      input({ snapshots: [hardcover({ entries: [], unavailable: true })] }),
    )
    expect(result.outcome).toBe('unresolved')
    expect(result.reason).toMatch(/unavailable/i)
    // Match the real wire contract exercised by corpus_series_discovery_test.sql.
    expect(result).toMatchObject({
      matched: true,
      series: null,
      position: null,
      count: null,
      identityConfidence: 'high',
      membershipConfidence: 'low',
      source: 'hardcover',
    })
    expect(result.evidence.map(({ kind }) => kind)).toEqual([
      'candidate_label',
      'provider_unavailable',
    ])
  })

  it('routes a one-member or newly started series to administrator review', () => {
    const result = classifySeriesMembership(
      input({
        title: 'First Book',
        snapshots: [
          hardcover({
            memberCount: 1,
            entries: [{ title: 'First Book', author: 'Ada Reader', position: 1 }],
          }),
        ],
      }),
    )
    expect(result.outcome).toBe('review')
    expect(result.membershipConfidence).toBe('medium')
  })

  it('does not let Fantastic Fiction promote a singleton automatically', () => {
    const one = [{ title: 'First Book', author: 'Ada Reader', position: 1 }]
    const result = classifySeriesMembership(
      input({
        title: 'First Book',
        snapshots: [
          hardcover({ memberCount: 1, entries: one }),
          {
            source: 'fantasticfiction',
            series: 'The Sequence',
            sourceRef: 'https://www.fantasticfiction.com/a/ada-reader/the-sequence/',
            memberCount: 1,
            entries: one,
          },
        ],
      }),
    )
    expect(result.outcome).toBe('review')
    expect(result.reason).toMatch(/Fantastic Fiction/i)
    expect(
      result.evidence.find((evidence) => evidence.source === 'fantasticfiction')?.memberCount,
    ).toBeNull()
  })

  it('does not use a Fantastic Fiction ordinal to upgrade another source singleton', () => {
    const result = classifySeriesMembership(
      input({
        title: 'First Book',
        snapshots: [
          hardcover({
            memberCount: 1,
            entries: [{ title: 'First Book', author: 'Ada Reader', position: 1 }],
          }),
          {
            source: 'fantasticfiction',
            series: 'The Sequence',
            sourceRef: 'https://www.fantasticfiction.com/a/ada-reader/the-sequence/',
            entries: [{ title: 'First Book', author: 'Ada Reader', position: 2 }],
          },
        ],
      }),
    )
    expect(result.outcome).toBe('review')
    expect(result.membershipConfidence).toBe('medium')
  })

  it('accepts an author-supplied relational membership as primary evidence', () => {
    const result = classifySeriesMembership(
      input({
        title: 'First Book',
        snapshots: [
          hardcover({
            source: 'author',
            sourceRef: 'https://author.example/reading-order',
            memberCount: 1,
            orderType: 'recommended',
            entries: [{ title: 'First Book', author: 'Ada Reader', position: 1 }],
          }),
        ],
      }),
    )
    expect(result.outcome).toBe('found')
    expect(result.evidence.at(-1)?.orderType).toBe('recommended')
  })

  it('routes conflicting relational series to review with primary sources controlling the proposal', () => {
    const result = classifySeriesMembership(
      input({
        snapshots: [
          hardcover(),
          hardcover({
            source: 'publisher',
            series: 'Publisher Sequence',
            sourceRef: 'https://publisher.example/sequence',
          }),
        ],
      }),
    )
    expect(result.outcome).toBe('review')
    expect(result.series).toBe('Publisher Sequence')
    expect(result.reason).toMatch(/disagree/i)
  })

  it('records no-series only as an observation for a positively matched book', () => {
    const result = classifySeriesMembership(input({ candidateSeries: '', snapshots: [] }))
    expect(result.outcome).toBe('no_series')
    expect(result.series).toBeNull()
    expect(result.reason).toMatch(/not a standalone ruling/i)
  })

  it('refuses to classify when the underlying book identity is weak', () => {
    const result = classifySeriesMembership(input({ identityConfidence: 'low' }))
    expect(result.outcome).toBe('unresolved')
    expect(result.matched).toBe(false)
    expect(result.membershipConfidence).toBe('none')
  })

  it('does not treat two different authors with the same surname as the same relationship', () => {
    const result = classifySeriesMembership(
      input({
        author: 'Ada Reader',
        snapshots: [
          hardcover({
            entries: [{ title: 'Second Book', author: 'Grace Reader', position: 2 }],
          }),
        ],
      }),
    )
    expect(result.outcome).toBe('unresolved')
    expect(result.reason).toMatch(/No relational source/i)
  })

  it('does not erase a title-significant hyphen while normalizing subtitles', () => {
    const result = classifySeriesMembership(
      input({
        title: 'Spider-Man Returns',
        snapshots: [
          hardcover({
            entries: [{ title: 'Spider-Woman Returns', author: 'Ada Reader', position: 2 }],
          }),
        ],
      }),
    )
    expect(result.outcome).toBe('unresolved')
  })
})
