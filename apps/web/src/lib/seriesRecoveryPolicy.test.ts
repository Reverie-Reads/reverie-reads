import { describe, expect, it } from 'vitest'
import {
  classifySeriesRecoveryPayload,
  parseSeriesRecoveryManifest,
  seriesRecoveryLookupBody,
  type SeriesRecoveryWork,
} from './seriesRecoveryPolicy'

const work: SeriesRecoveryWork = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'First Book',
  author_text: 'Ada Reader',
  series: 'A Real Series',
  position: 1,
  work_id: 'hardcover:77',
  enrichment_confidence: 'high',
  fingerprint: 'a'.repeat(32),
}

describe('durable series recovery policy', () => {
  it('accepts only the exact reviewed 23-work project manifest', () => {
    const manifest = {
      version: 1 as const,
      project: 'abcdefghijklmnopqrst',
      works: Array.from({ length: 23 }, (_, index) => ({
        id: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        fingerprint: String(index % 10).repeat(32),
        reason: 'Private identity review',
      })),
    }
    expect(parseSeriesRecoveryManifest(manifest, manifest.project)).toBe(manifest)
    expect(() =>
      parseSeriesRecoveryManifest(
        { ...manifest, works: manifest.works.slice(1) },
        manifest.project,
      ),
    ).toThrow(/23-work/)
    expect(() => parseSeriesRecoveryManifest(manifest, 'wrongprojectxxxxxxxx')).toThrow(/23-work/)
  })

  it('requires the frozen high-confidence candidate and explicit Hardcover book locator', () => {
    expect(seriesRecoveryLookupBody(work)).toEqual({
      name: 'A Real Series',
      author: 'Ada Reader',
      title: 'First Book',
      hardcoverBookId: 77,
    })
    expect(seriesRecoveryLookupBody({ ...work, work_id: null })).toBeNull()
    expect(seriesRecoveryLookupBody({ ...work, enrichment_confidence: 'medium' })).toBeNull()
  })

  it('confirms only an exact title and full-author relationship with series context', () => {
    const proposal = classifySeriesRecoveryPayload(work, {
      name: 'A Real Series',
      sourceRef: '42',
      memberCount: null,
      membershipEntries: [
        { title: 'First Book', author: 'Ada Reader', position: 1 },
        { title: 'Second Book', author: 'Ada Reader', position: 2 },
      ],
    })
    expect(proposal).toMatchObject({
      result: { outcome: 'found', series: 'A Real Series', position: 1, count: null },
    })
  })

  it('defers a bounded ambiguity and stops on an actual provider outage', () => {
    expect(
      classifySeriesRecoveryPayload(work, {
        unavailable: true,
        failureCode: 'ambiguous_relationship',
        httpStatus: 200,
      }),
    ).toEqual({ deferred: 'ambiguous_relationship' })
    expect(() =>
      classifySeriesRecoveryPayload(work, {
        unavailable: true,
        failureCode: 'http_error',
        httpStatus: 403,
      }),
    ).toThrow('provider_unavailable_stop')
  })
})
