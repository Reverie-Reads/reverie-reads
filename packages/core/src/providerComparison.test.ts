import { describe, expect, it } from 'vitest'
import { projectProviderComparison, validProviderComparisonContext } from './providerComparison'
import { providerComparisonFixture } from './providerComparison.fixture'

const parse = (dto: unknown) => {
  const { context, now } = providerComparisonFixture()
  return projectProviderComparison(dto, context, now)
}
const result = (dto: ReturnType<typeof providerComparisonFixture>['dto'], i: number) => {
  const r = dto.results[i]
  if (!r || r.status !== 'matched') throw new Error('synthetic fixture must be matched')
  return r
}

describe('draft provider display boundary', () => {
  it('admits two observations without choosing a value and derives safe source links', () => {
    const { dto } = providerComparisonFixture()
    const view = parse(JSON.parse(JSON.stringify(dto)))!
    expect(view.joint).toBe('agreement')
    expect(view.cards.map((c) => c.pages)).toEqual([312, 312])
    expect(view.cards.map((c) => c.sourceUrl)).toEqual([
      'https://books.google.com/books?id=synthetic_volume',
      'https://openlibrary.org/isbn/9780306406157',
    ])
    expect(view.cards[0]!.language).toBe('unknown')
    expect(view.cards[0]!.binding).toBeNull()
    expect(Object.keys(view)).toEqual(['isbn', 'expiresAt', 'joint', 'cards'])
  })
  it('keeps Google visible beside an Open Library title rejection, without upgrading the joint', () => {
    const { dto } = providerComparisonFixture()
    dto.results[1] = {
      provider: 'openlibrary',
      endpoint: 'isbn_edition',
      status: 'identity_review',
      reason: 'title_mismatch',
      observedAt: dto.acquiredAt,
    }
    dto.joint = 'identity_review'
    const view = parse(dto)!
    expect(view.joint).toBe('identity_review')
    expect(view.cards[0]!.pages).toBe(312)
    expect(view.cards[1]!.pages).toBeNull()
    expect(view.cards[1]!.sourceUrl).toBeNull()
    expect(view.cards[1]!.status).toContain('cannot explain the cause')
  })
  it.each(['isbn', 'title', 'fullAuthors', 'uniqueEdition', 'language'])(
    'withholds fields when the %s attestation fails',
    (key) => {
      const { dto } = providerComparisonFixture()
      Object.assign(result(dto, 0).checks, { [key]: false })
      const view = parse(dto)!
      expect(view.joint).toBe('identity_review')
      expect(view.cards[0]!.pages).toBeNull()
      expect(view.cards[0]!.sourceUrl).toBeNull()
      expect(view.cards[1]!.pages).toBe(312)
    },
  )
  it.each([
    { pages: 0 },
    { pages: -1 },
    { pages: 20001 },
    { pages: 1.5 },
    { pages: 'SECRET' },
    { binding: 'SECRET' },
    { endpoint: 'search' },
    { sourceId: 'https://evil.test/SECRET' },
    { targetIsbn: '9780140328721' },
    { sourceUrl: 'https://evil.test/SECRET' },
    { rawBody: 'SECRET' },
    { toJSON: () => ({ leaked: 'SECRET' }) },
    { observedAt: '2026-09-09T12:00:01.000Z' },
    { observedAt: '2026-09-09T11:59:29.000Z' },
  ])('rejects malformed/forged source fields %j without exposing them', (patch) => {
    const { dto } = providerComparisonFixture()
    Object.assign(dto.results[0]!, patch)
    const view = parse(dto)!
    expect(view.cards[0]!.pageState).toBe('withheld')
    expect(view.cards[1]!.pages).toBe(312)
    expect(JSON.stringify(view)).not.toContain('SECRET')
  })
  it.each([
    { version: 2 },
    { rawBody: 'SECRET' },
    { snapshotHash: 'bad' },
    { revision: 2 },
    { workId: '00000000-0000-4000-8000-000000000002' },
    { isbn: '9780140328721' },
    { fingerprint: 'c'.repeat(64) },
    { expiresAt: '2026-09-09T12:05:00.001Z' },
    { expiresAt: '2026-09-09T12:00:00.000Z' },
    { acquiredAt: '2026-09-09T12:00:01.000Z' },
    { acquiredAt: '2026-02-30T00:00:00.000Z' },
    { joint: 'automatic' },
  ])('refuses malformed, stale, or mismatched envelope %j', (patch) => {
    const { dto } = providerComparisonFixture()
    expect(parse({ ...dto, ...patch })).toBeNull()
  })
  it.each(['unknown', 'openlibrary'])('refuses unknown/duplicate provider %s', (provider) => {
    const { dto } = providerComparisonFixture()
    Object.assign(dto.results[0]!, { provider })
    expect(parse(dto)).toBeNull()
  })
  it('refuses missing, extra, or reversed sources and a forged Open Library identifier', () => {
    const { dto } = providerComparisonFixture()
    for (const results of [
      [],
      dto.results.slice(1),
      [...dto.results, dto.results[0]],
      [...dto.results].reverse(),
    ])
      expect(parse({ ...dto, results })).toBeNull()
    result(dto, 1).sourceId = '9780140328721'
    expect(parse(dto)!.cards[1]!.pages).toBeNull()
  })
  it('does not promote incomplete authors or no exact edition to standalone', () => {
    const { dto } = providerComparisonFixture()
    dto.results[1] = {
      provider: 'openlibrary',
      endpoint: 'isbn_edition',
      status: 'unavailable',
      reason: 'incomplete_authors',
      observedAt: dto.acquiredAt,
    }
    dto.joint = 'incomplete'
    expect(parse(dto)!.cards[0]!.pages).toBe(312)
    expect(parse(dto)!.joint).toBe('incomplete')
    dto.results[1] = {
      provider: 'openlibrary',
      endpoint: 'isbn_edition',
      status: 'not_found',
      reason: 'no_exact_edition',
      observedAt: dto.acquiredAt,
    }
    dto.joint = 'one_source'
    expect(parse(dto)!.joint).toBe('one_source')
    expect(JSON.stringify(parse(dto))).not.toContain('standalone')
  })
  it('refuses optimistic and pessimistic inconsistent joint claims rather than silently rewriting them', () => {
    const { dto } = providerComparisonFixture()
    dto.joint = 'identity_review'
    expect(parse(dto)).toBeNull()
    result(dto, 1).pages = 420
    dto.joint = 'agreement'
    expect(parse(dto)).toBeNull()
    dto.joint = 'pages_differ'
    expect(parse(dto)!.cards.map((c) => c.pages)).toEqual([312, 420])
  })
  it('distinguishes unknown pages, one available extent, and no admitted observations', () => {
    const { dto } = providerComparisonFixture()
    result(dto, 0).pages = null
    dto.joint = 'one_source'
    expect(parse(dto)!.cards[0]!.pageState).toBe('unknown')
    result(dto, 1).pages = null
    dto.joint = 'missing_pages'
    expect(parse(dto)!.joint).toBe('missing_pages')
    dto.results = dto.results.map((r) => ({
      provider: r.provider,
      endpoint: r.endpoint,
      status: 'not_found',
      reason: 'no_exact_edition',
      observedAt: dto.acquiredAt,
    }))
    dto.joint = 'no_observations'
    expect(parse(dto)!.cards.every((c) => c.pageState === 'withheld')).toBe(true)
  })
  it.each([
    ['audiobook', null, 'audio'],
    ['audiobook', 'paperback', 'format_review'],
    ['paperback', 'hardcover', 'format_review'],
    ['ebook', 'paperback', 'format_review'],
  ] as const)('does not present pages as comparable for %s/%s', (a, b, joint) => {
    const { dto } = providerComparisonFixture()
    result(dto, 0).binding = a
    result(dto, 1).binding = b
    dto.joint = joint
    const view = parse(dto)!
    expect(view.joint).toBe(joint)
    expect(view.cards.map((c) => c.binding)).toEqual([a, b])
    expect(view.cards.map((c) => c.pages)).toEqual([null, null])
  })
  it('does not suppress an audio warning beside an unavailable provider', () => {
    const { dto } = providerComparisonFixture()
    result(dto, 0).binding = 'audiobook'
    dto.results[1] = {
      provider: 'openlibrary',
      endpoint: 'isbn_edition',
      status: 'unavailable',
      reason: 'unavailable',
      observedAt: dto.acquiredAt,
    }
    dto.joint = 'incomplete'
    expect(parse(dto)!.joint).toBe('incomplete')
    expect(parse(dto)!.cards[0]!.pageState).toBe('not_applicable')
  })
  it('rejects wrong status/reason pairs and values smuggled into rejected records', () => {
    const { dto } = providerComparisonFixture()
    Object.assign(dto.results[0]!, { status: 'not_found', reason: 'title_mismatch', pages: 9876 })
    const view = parse(dto)!
    expect(view.cards[0]!.pages).toBeNull()
    expect(JSON.stringify(view)).not.toContain('9876')
  })
  it.each(['0306406152', '9780306406158', '', 'garbage9780306406157'])(
    'requires an explicit canonical checksum-valid ISBN: %s',
    (isbn) => {
      const { context } = providerComparisonFixture()
      expect(validProviderComparisonContext({ ...context, isbn })).toBe(false)
    },
  )
  it('does not mutate input or invoke serialization hooks; getter errors are contained', () => {
    const { dto } = providerComparisonFixture()
    const before = JSON.stringify(dto)
    parse(dto)
    expect(JSON.stringify(dto)).toBe(before)
    expect(
      parse({
        ...dto,
        toJSON() {
          throw new Error('SECRET')
        },
      }),
    ).toBeNull()
    expect(
      parse({
        get version() {
          throw new Error('SECRET')
        },
      }),
    ).toBeNull()
  })
})
