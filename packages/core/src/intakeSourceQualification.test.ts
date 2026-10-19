import { describe, expect, it } from 'vitest'
import { getIntakeSourceQualification } from './intakeSourceQualification'

const current = '2026-10-18T12:00:00.000Z'

describe('code-owned source-use qualification', () => {
  it('separates Open Library caching guidance from downstream rights', () => {
    const result = getIntakeSourceQualification('openlibrary', current)
    expect(result.reviewState).toBe('current')
    expect(result.operations.lookup.status).toBe('conditional')
    expect(result.operations.transientReview.status).toBe('conditional')
    expect(result.operations.cache.status).toBe('documented')
    expect(result.operations.cache.scope).toContain('does not clear')
    for (const operation of ['durableFacts', 'export', 'modelInput'] as const) {
      expect(result.operations[operation].status).toBe('unverified')
      expect(result.promotionBlockers).toContain(`source_use_${operation}_unverified`)
    }
    expect(result.operations.cache.primaryUrls).toContain('https://openlibrary.org/developers/api')
  })

  it('does not treat PRH retail terms or API access as an API content license', () => {
    const result = getIntakeSourceQualification('penguin_random_house', current)
    expect(result.operations.lookup.status).toBe('conditional')
    expect(result.operations.lookup.scope).toContain('not production approval')
    expect(result.operations.transientReview.status).toBe('unverified')
    expect(result.operations.transientReview.scope).toContain('cannot be assumed')
    expect(result.operations.cache.status).toBe('unverified')
    expect(result.operations.cache.primaryUrls).toContain(
      'https://www.penguinrandomhouse.com/terms/',
    )
  })

  it('records unavailable Hardcover terms as unverified, not prohibited or permitted', () => {
    const result = getIntakeSourceQualification('hardcover', current)
    expect(result.operations.lookup.status).toBe('conditional')
    expect(result.operations.transientReview.status).toBe('unverified')
    expect(result.operations.transientReview.scope).toContain('unavailable')
    expect(result.operations.export.status).toBe('unverified')
    expect(result.operations.modelInput.status).toBe('unverified')
  })

  it.each(['openlibrary', 'hardcover', 'penguin_random_house', 'custom', '__proto__', 'toString'])(
    'never grants promotion or independent lineage to %s',
    (provider) => {
      const result = getIntakeSourceQualification(provider, current)
      expect(result.usage).toBe('review_only')
      expect(result.upstreamLineage).toBe('unverified')
      expect(result.promotionBlockers).toContain('source_review_only')
      expect(result.promotionBlockers).toContain('upstream_lineage_unverified')
      expect(result).not.toHaveProperty('eligible')
    },
  )

  it('fails closed for a custom source without echoing its possibly private locator', () => {
    const result = getIntakeSourceQualification('https://private.example/?key=secret', current)
    expect(result.provider).toBeNull()
    expect(result.reviewedAt).toBeNull()
    expect(result.reviewValidUntil).toBeNull()
    expect(result.reviewState).toBe('unknown_source')
    expect(result.promotionBlockers).toContain('source_review_unknown_source')
    expect(Object.values(result.operations).every((op) => op.status === 'unverified')).toBe(true)
    expect(JSON.stringify(result)).not.toContain('secret')
  })

  it('bounds the local freshness interval without inventing a provider license expiry', () => {
    expect(getIntakeSourceQualification('openlibrary', '2026-10-18').reviewState).toBe('current')
    expect(getIntakeSourceQualification('openlibrary', '2026-10-18T00:00:00Z').reviewState).toBe(
      'current',
    )
    expect(
      getIntakeSourceQualification('openlibrary', '2026-10-17T23:59:59.999Z').reviewState,
    ).toBe('predates_review')
    expect(
      getIntakeSourceQualification('openlibrary', '2026-11-16T23:59:59.999Z').reviewState,
    ).toBe('current')
    const expired = getIntakeSourceQualification('openlibrary', '2026-11-17')
    expect(expired.reviewState).toBe('stale')
    expect(expired.promotionBlockers).toContain('source_review_stale')
    expect(expired.usage).toBe('review_only')
    expect(expired.reviewedAt).toBe('2026-10-18T00:00:00.000Z')
  })

  it.each([
    '',
    'tomorrow',
    '2026-02-30',
    '2026-10-18T24:00:00Z',
    '2026-10-18T12:00:00',
    '99999-01-01',
  ])('holds malformed or rollover dates: %s', (asOf) => {
    const result = getIntakeSourceQualification('openlibrary', asOf)
    expect(result.reviewState).toBe('invalid_as_of')
    expect(result.promotionBlockers).toContain('source_review_invalid_as_of')
  })

  it('returns independent deeply frozen records and cannot alter later qualification', () => {
    const first = getIntakeSourceQualification('openlibrary', current)
    const second = getIntakeSourceQualification('openlibrary', current)
    expect(first).not.toBe(second)
    expect(first.operations).not.toBe(second.operations)
    expect(first.operations.cache).not.toBe(second.operations.cache)
    expect(first.operations.cache.primaryUrls).not.toBe(second.operations.cache.primaryUrls)
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.operations)).toBe(true)
    expect(Object.isFrozen(first.operations.cache)).toBe(true)
    expect(Object.isFrozen(first.operations.cache.primaryUrls)).toBe(true)
    expect(Object.isFrozen(first.promotionBlockers)).toBe(true)
    expect(() => Reflect.set(first.operations.cache, 'status', 'unverified')).not.toThrow()
    expect(first.operations.cache.status).toBe('documented')
    expect(getIntakeSourceQualification('openlibrary', current)).toEqual(second)
  })
})
