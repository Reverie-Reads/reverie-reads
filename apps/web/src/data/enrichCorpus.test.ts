import { describe, expect, it } from 'vitest'
import type { EnrichResult } from '../lib/enrich'
import {
  corpusCoverNeedsDurableOwnership,
  corpusPatchFromEnrichment,
  corpusSeriesCheckDue,
  corpusSweepCandidateSnapshot,
  corpusWorkIsIncomplete,
  corpusWorkShouldCheck,
  personalCoverIsReviewed,
  personalCoverCorpusReviewKey,
  parseCorpusShadowSuggestionPacket,
  type CorpusEnrichmentWork,
} from './enrichCorpus'

const digestJson = async (value: unknown) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

const completeWork = (over: Partial<CorpusEnrichmentWork> = {}): CorpusEnrichmentWork => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'A Complete Work',
  authorText: 'Ada Reader',
  contributors: [{ name: 'Ada Reader', role: 'author', position: 0 }],
  series: '',
  position: null,
  pages: 320,
  publicationYear: 2025,
  publisher: 'Warm House',
  language: 'en',
  description: 'A description.',
  isbns: ['9780306406157'],
  genre: 'fantasy',
  genres: ['fantasy'],
  cover:
    'https://project.test/storage/v1/object/public/covers/w/11111111-1111-4111-8111-111111111111/rev1.webp',
  enrichedAt: null,
  seriesCheckState: 'no_series',
  seriesCheckedAt: '2026-08-31T12:00:00Z',
  ...over,
})

describe('corpus enrichment eligibility', () => {
  it('treats each objective field the aggregator can fill as a real corpus gap', () => {
    expect(corpusWorkIsIncomplete(completeWork())).toBe(false)
    for (const patch of [
      { cover: '' },
      { isbns: [] },
      { publicationYear: null },
      { pages: null },
      { publisher: '' },
      { language: '' },
      { description: '' },
      { genre: '' },
      { contributors: [] },
      { series: 'Known Series', position: null },
    ] satisfies Partial<CorpusEnrichmentWork>[]) {
      expect(corpusWorkIsIncomplete(completeWork(patch)), JSON.stringify(patch)).toBe(true)
    }
  })

  it('does not call an absent series a metadata gap after sources were checked', () => {
    expect(corpusWorkIsIncomplete(completeWork({ series: '', position: null }))).toBe(false)
  })

  it('uses an independent, recheckable series-discovery clock', () => {
    const now = Date.parse('2026-08-31T12:00:00Z')
    expect(
      corpusSeriesCheckDue(
        { seriesCheckState: 'unknown', seriesCheckedAt: null },
        now,
      ),
    ).toBe(true)
    expect(
      corpusSeriesCheckDue(
        { seriesCheckState: 'unresolved', seriesCheckedAt: '2026-07-31T12:00:00Z' },
        now,
      ),
    ).toBe(true)
    expect(
      corpusSeriesCheckDue(
        { seriesCheckState: 'no_series', seriesCheckedAt: '2026-07-31T12:00:00Z' },
        now,
      ),
    ).toBe(false)
    expect(
      corpusSeriesCheckDue(
        { seriesCheckState: 'review', seriesCheckedAt: '2020-01-01T00:00:00Z' },
        now,
      ),
    ).toBe(false)
  })

  it('distinguishes durable corpus covers from reader-owned and upstream URLs', () => {
    expect(corpusCoverNeedsDurableOwnership(completeWork().cover)).toBe(false)
    expect(
      corpusCoverNeedsDurableOwnership(
        'https://project.test/storage/v1/object/public/covers/u/reader/book/rev1.webp',
      ),
    ).toBe(true)
    expect(corpusCoverNeedsDurableOwnership('https://covers.example.test/book.webp')).toBe(true)
    expect(
      corpusCoverNeedsDurableOwnership(
        'https://books.google.com/books/content?id=abc&printsec=frontcover&img=1',
      ),
    ).toBe(false)
    expect(
      corpusCoverNeedsDurableOwnership(
        'https://books.google.evil.example/books/content?id=attacker',
      ),
    ).toBe(true)
  })

  it('uses short retries while high-value identity is missing and longer retries once present', () => {
    const now = Date.parse('2026-08-31T12:00:00Z')
    const twoDaysAgo = '2026-08-29T12:00:00Z'
    const fourDaysAgo = '2026-08-27T12:00:00Z'
    const twentyDaysAgo = '2026-08-11T12:00:00Z'
    const fortyDaysAgo = '2026-07-22T12:00:00Z'
    expect(corpusWorkShouldCheck(completeWork({ cover: '', enrichedAt: twoDaysAgo }), now)).toBe(false)
    expect(corpusWorkShouldCheck(completeWork({ cover: '', enrichedAt: fourDaysAgo }), now)).toBe(true)
    expect(
      corpusWorkShouldCheck(
        completeWork({
          cover: 'https://project.test/storage/v1/object/public/covers/u/reader/book/rev1.webp',
          enrichedAt: fourDaysAgo,
        }),
        now,
      ),
    ).toBe(true)
    expect(corpusWorkShouldCheck(completeWork({ description: '', enrichedAt: twentyDaysAgo }), now)).toBe(false)
    expect(corpusWorkShouldCheck(completeWork({ description: '', enrichedAt: fortyDaysAgo }), now)).toBe(true)
  })

  it('snapshots no more than 400 works while retaining the full eligible count', () => {
    const rows = Array.from({ length: 401 }, (_, index) => {
      const id = `a0000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      const work = completeWork({ id, seriesCheckState: 'unknown', seriesCheckedAt: null })
      return {
        id: work.id,
        title: work.title,
        author_text: work.authorText,
        contributors: work.contributors,
        series: work.series,
        position: work.position,
        pages: work.pages,
        pub_y: work.publicationYear,
        publisher: work.publisher,
        language: work.language,
        description: work.description,
        isbns: work.isbns,
        genre: work.genre,
        genres: work.genres,
        cover_url: work.cover,
        enriched_at: work.enrichedAt,
        series_check_state: work.seriesCheckState,
        series_checked_at: work.seriesCheckedAt,
      }
    })

    expect(corpusSweepCandidateSnapshot(rows)).toEqual({
      total: 401,
      workIds: rows.slice(0, 400).map(({ id }) => id),
    })
  })
})

describe('personal cover corpus review state', () => {
  it('scopes cached review state to the exact book, corpus work, and cover', () => {
    expect(personalCoverCorpusReviewKey('book-a', 'work-a', 'cover-a')).toEqual([
      'personal-cover-corpus-review',
      'book-a',
      'work-a',
      'cover-a',
    ])
  })

  it('turns on only when the exact personal cover URL is an accepted option', () => {
    const options = [
      { url: 'https://covers.example/first.webp', source: 'upload' },
      { url: 'https://covers.example/second.webp', source: 'camera' },
    ]

    expect(personalCoverIsReviewed(options, 'https://covers.example/second.webp')).toBe(true)
    expect(personalCoverIsReviewed(options, 'https://covers.example/unreviewed.webp')).toBe(false)
    expect(personalCoverIsReviewed(options, '')).toBe(false)
  })

  it('fails closed on malformed cover-option state', () => {
    expect(personalCoverIsReviewed(null, 'https://covers.example/first.webp')).toBe(false)
    expect(personalCoverIsReviewed({ url: 'https://covers.example/first.webp' }, 'https://covers.example/first.webp')).toBe(false)
    expect(personalCoverIsReviewed([null, 'url', { source: 'upload' }], 'https://covers.example/first.webp')).toBe(false)
  })
})

describe('corpus shadow suggestion staging packet', () => {
  it('accepts only a hash-bound packet whose counts reconcile', async () => {
    const core = {
      schemaVersion: 2 as const,
      purpose: 'corpus-series-shadow-suggestion-staging-packet' as const,
      createdAt: '2026-09-16T00:00:00.000Z',
      project: 'abcdefghijklmnopqrst',
      sourceManifest: { sha256: 'a'.repeat(64), historicalSha256: 'b'.repeat(64) },
      counts: {
        resolvedDecisions: 1,
        stageable: 1,
        removalReviews: 1,
        manualReview: 0,
        batches: 2,
      },
      stageable: [{ workId: 'work-1' }],
      removalReviews: [{ workId: 'work-2' }],
      manualReview: [],
      mutationBoundary: 'private_staging_packet_no_supabase_or_corpus_writer',
    }
    const packet = { ...core, packetSha256: await digestJson(core) }
    await expect(parseCorpusShadowSuggestionPacket(packet)).resolves.toEqual(packet)
    await expect(
      parseCorpusShadowSuggestionPacket({ ...packet, stageable: [{ workId: 'changed' }] }),
    ).rejects.toThrow('hash')
  })
})

describe('corpus enrichment patch', () => {
  it('carries every objective field returned by the aggregator into the audited RPC patch', () => {
    const result: EnrichResult = {
      title: 'A Work',
      authors: ['Ada Reader', 'Bea Writer'],
      author: 'Ada Reader',
      series: 'The Sequence',
      seriesPosition: 2,
      publisher: 'Warm House',
      pubY: 2025,
      pubM: 6,
      pubD: 12,
      pageCount: 321,
      isbn10: '0306406152',
      isbn13: '9780306406157',
      isbn: '9780306406157',
      isbns: ['9780306406157', '9780140328721'],
      language: 'en',
      genre: 'fantasy',
      genres: ['fantasy', 'romance'],
      description: 'A description.',
      cover: 'https://covers.openlibrary.org/b/id/1-L.jpg',
      workId: 'OLW1',
      editionId: 'OLE1',
      provenance: {
        cover: { source: 'openlibrary', at: '2026-08-31T00:00:00Z' },
        pageCount: { source: 'openlibrary', at: '2026-08-31T00:00:00Z' },
      },
      source: 'openlibrary',
      confidence: 'high',
    }
    expect(corpusPatchFromEnrichment(result)).toEqual({
      contributors: [
        { name: 'Ada Reader', role: 'author', position: 0 },
        { name: 'Bea Writer', role: 'author', position: 1 },
      ],
      authorText: 'Ada Reader, Bea Writer',
      pages: 321,
      pubY: 2025,
      pubM: 6,
      pubD: 12,
      publisher: 'Warm House',
      language: 'en',
      description: 'A description.',
      isbns: ['9780306406157', '9780140328721', '9780306406157', '9780306406157', '0306406152'],
      genre: 'fantasy',
      genres: ['fantasy', 'romance'],
      externalWorkId: 'OLW1',
      editionId: 'OLE1',
      provenance: result.provenance,
      confidence: 'high',
    })
  })
})
