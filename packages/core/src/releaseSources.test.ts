import { describe, expect, it } from 'vitest'
import {
  hardcoverEditionToRelease,
  mergeAuthorReleases,
  prhTitleToRelease,
  releaseDatePrecision,
  type ReleaseHit,
} from '../../../supabase/functions/releases/source'

const checkedAt = '2026-09-07T12:00:00.000Z'

const release = (
  source: ReleaseHit['release']['source'],
  pub: string,
  overrides: Partial<ReleaseHit> = {},
): ReleaseHit => ({
  title: 'A Future Book',
  authors: ['An Author'],
  cover: '',
  isbn: '',
  pub,
  release: {
    source,
    precision: releaseDatePrecision(pub) ?? 'day',
    checkedAt,
    confirmedBy: [source],
  },
  ...overrides,
})

describe('release source normalization', () => {
  it('accepts only real flexible dates', () => {
    expect(releaseDatePrecision('2027')).toBe('year')
    expect(releaseDatePrecision('2027-03')).toBe('month')
    expect(releaseDatePrecision('2028-02-29')).toBe('day')
    expect(releaseDatePrecision('2027-02-29')).toBeNull()
    expect(releaseDatePrecision('2027-13')).toBeNull()
  })

  it('maps a Hardcover edition without using a square audiobook tile as its cover', () => {
    const hit = hardcoverEditionToRelease(
      {
        isbn_13: '9781980036135',
        edition_format: 'Audiobook',
        release_date: '2026-10-27',
        cached_image: { url: 'https://example.com/square.jpg', width: 3000, height: 3000 },
        publisher: { name: 'Recorded Books' },
        country: { code2: 'us' },
        book: {
          title: 'A Court of Splintered Harmony',
          slug: 'a-court-of-splintered-harmony',
          release_date: '2026-10-27',
          cached_image: { url: 'https://example.com/jacket.jpg', width: 1600, height: 2400 },
          contributions: [{ author: { name: 'Sarah J. Maas' } }],
        },
      },
      checkedAt,
    )
    expect(hit).toMatchObject({
      title: 'A Court of Splintered Harmony',
      cover: 'https://example.com/jacket.jpg',
      pub: '2026-10-27',
      release: {
        source: 'hardcover',
        publisher: 'Recorded Books',
        formats: ['Audiobook'],
        territory: 'US',
        kind: 'new_work',
      },
    })
  })

  it('rejects a PRH contributor mismatch and maps an exact author', () => {
    const payload = {
      isbn: '9780140067484',
      title: 'The Puzzle Palace',
      author: 'James Bamford',
      onsale: '2026-11-03',
      seoFriendlyUrl: '/books/321214/the-puzzle-palace-by-james-bamford/9780140067484',
      format: { description: 'Trade Paperback' },
    }
    expect(prhTitleToRelease(payload, 'Someone Else', checkedAt)).toBeNull()
    expect(prhTitleToRelease(payload, 'James Bamford', checkedAt)).toMatchObject({
      isbn: '9780140067484',
      cover: 'https://images.randomhouse.com/cover/9780140067484',
      release: {
        source: 'prh',
        sourceUrl:
          'https://www.penguinrandomhouse.com/books/321214/the-puzzle-palace-by-james-bamford/9780140067484',
        formats: ['Trade Paperback'],
      },
    })
  })

  it('does not pass provider-controlled off-domain links to the client', () => {
    const hit = prhTitleToRelease(
      {
        isbn: '9780140067484',
        title: 'The Puzzle Palace',
        author: 'James Bamford',
        onsale: '2026-11-03',
        seoFriendlyUrl: 'https://example.com/not-prh',
        _links: [{ rel: 'icon', href: 'https://example.com/not-a-cover.jpg' }],
      },
      'James Bamford',
      checkedAt,
    )
    expect(hit?.cover).toBe('https://images.randomhouse.com/cover/9780140067484')
    expect(hit?.release.sourceUrl).toBeUndefined()
  })
})

describe('mergeAuthorReleases', () => {
  const now = Date.parse('2026-09-07T12:00:00.000Z')

  it('keeps one useful event per work and prefers the nearest future date', () => {
    const merged = mergeAuthorReleases(
      [release('hardcover', '2027-05-01'), release('prh', '2026-10-01')],
      now,
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.pub).toBe('2026-10-01')
  })

  it('prefers publisher data for the same date and records independent confirmation', () => {
    const merged = mergeAuthorReleases(
      [
        release('hardcover', '2026-10-01', {
          cover: 'https://example.com/cover.jpg',
          release: {
            source: 'hardcover',
            precision: 'day',
            formats: ['Hardcover'],
            checkedAt,
          },
        }),
        release('prh', '2026-10-01', {
          isbn: '9780000000002',
          release: {
            source: 'prh',
            precision: 'day',
            formats: ['Ebook'],
            checkedAt,
          },
        }),
      ],
      now,
    )
    expect(merged[0]).toMatchObject({
      isbn: '9780000000002',
      cover: 'https://example.com/cover.jpg',
      release: {
        source: 'prh',
        formats: ['Hardcover', 'Ebook'],
        confirmedBy: ['prh', 'hardcover'],
      },
    })
  })

  it('orders upcoming, uncertain current-year, then newest recent work', () => {
    const merged = mergeAuthorReleases(
      [
        release('prh', '2026', { title: 'Date Taking Shape' }),
        release('hardcover', '2026-07-01', { title: 'Already Out' }),
        release('hardcover', '2026-10-01', { title: 'Coming Soon' }),
      ],
      now,
    )
    expect(merged.map((hit) => hit.title)).toEqual([
      'Coming Soon',
      'Date Taking Shape',
      'Already Out',
    ])
  })
})
