import type { ProviderComparisonContext, ProviderComparisonDTO } from './providerComparison'

/** Synthetic display-only attestations. Never provider responses, gold truth, or acquisition input. */
export function providerComparisonFixture(now = Date.parse('2026-09-09T12:00:00.000Z')) {
  const context: ProviderComparisonContext = {
    workId: '00000000-0000-4000-8000-000000000001',
    isbn: '9780306406157',
    fingerprint: 'a'.repeat(64),
    revision: 1,
  }
  const dto: ProviderComparisonDTO = {
    ...context,
    version: 1,
    snapshotHash: 'b'.repeat(64),
    acquiredAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 60000).toISOString(),
    joint: 'agreement',
    results: (['google', 'openlibrary'] as const).map((provider) => ({
      provider,
      endpoint: provider === 'google' ? 'volume_detail' : 'isbn_edition',
      status: 'matched',
      sourceId: provider === 'google' ? 'synthetic_volume' : context.isbn,
      targetIsbn: context.isbn,
      observedAt: new Date(now).toISOString(),
      checks: {
        isbn: true,
        title: true,
        fullAuthors: true,
        uniqueEdition: true,
        language: 'unknown',
      },
      pages: 312,
      binding: null,
    })),
  }
  return { now, context, dto }
}
