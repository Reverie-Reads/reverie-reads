import { describe, expect, it } from 'vitest'
import {
  browseDates,
  collectReleaseBrowse,
  selectReleaseBrowse,
} from '../../../supabase/functions/releases/source'
import {
  hardcoverEditionToRelease,
  type ReleaseHit,
} from '../../../supabase/functions/releases/source'
const now = new Date('2026-09-20T23:55:00Z')
const hit = (pub: string, overrides: Partial<ReleaseHit> = {}): ReleaseHit => ({
  title: 'A book',
  authors: ['An author'],
  isbn: '',
  cover: '',
  pub,
  release: { source: 'hardcover', precision: 'day', checkedAt: now.toISOString() },
  ...overrides,
})
describe('date-based release discovery', () => {
  it('uses calendar bounds and keeps a recent and upcoming selection without old or invented dates', () => {
    expect(browseDates(now)).toEqual({
      today: '2026-09-20',
      tomorrow: '2026-09-21',
      after: '2026-06-22',
      before: '2027-03-22',
    })
    const result = selectReleaseBrowse(
      [
        '2025-10-28',
        '2026-06-21',
        '2026-06-22',
        '2026-09-20',
        '2026-09-21',
        '2027-03-22',
        '2027-03-23',
        '2026',
        '2026-09',
        '2026-02-30',
      ].map((date) => hit(date)),
      now,
    )
    expect(result.map((h) => h.pub)).toEqual([
      '2026-09-20',
      '2026-06-22',
      '2026-09-21',
      '2027-03-22',
    ])
  })
  it('deduplicates matching editions without mixing their covers or fields, retaining country and date differences', () => {
    const a = hit('2026-09-20', {
      isbn: '9780141441146',
      cover: 'publisher-cover',
      release: { source: 'prh', precision: 'day', territory: 'US', checkedAt: now.toISOString() },
    })
    const b = { ...a, cover: 'other-cover' }
    const uk = { ...b, release: { ...b.release, territory: 'GB' } }
    expect(selectReleaseBrowse([a, b, uk, { ...b, pub: '2026-10-01' }], now)).toEqual([
      a,
      uk,
      { ...b, pub: '2026-10-01' },
    ])
  })
  it('does not infer first publication from a shared year or a malformed work date', () => {
    const edition = {
      release_date: '2026-09-20',
      book: {
        title: 'A book',
        release_year: 2026,
        contributions: [{ author: { name: 'An author' } }],
      },
    }
    expect(hardcoverEditionToRelease(edition, now.toISOString())?.release.kind).toBeUndefined()
    expect(
      hardcoverEditionToRelease(
        { ...edition, book: { ...edition.book, release_date: '2026-02-30' } },
        now.toISOString(),
      )?.release.kind,
    ).toBeUndefined()
    expect(
      hardcoverEditionToRelease(
        { ...edition, book: { ...edition.book, release_year: 2025 } },
        now.toISOString(),
      )?.release.kind,
    ).toBe('new_edition')
  })
  it('keeps evidenced new books when a dense reprint batch reaches the selection cap', () => {
    const reprints = Array.from({ length: 45 }, (_, i) =>
      hit('2026-09-20', { title: `Reprint ${i}` }),
    )
    const first = hit('2026-09-19', {
      title: 'New book',
      release: {
        source: 'hardcover',
        precision: 'day',
        kind: 'new_work',
        checkedAt: now.toISOString(),
      },
    })
    const selected = selectReleaseBrowse([...reprints, first], now)
    expect(selected).toHaveLength(40)
    expect(selected).toContainEqual(first)
  })
  it('retains a complete Hardcover edition with first-publication evidence over its publisher duplicate', async () => {
    const first = hit('2026-09-20', {
      isbn: '9780141441146',
      release: {
        source: 'hardcover',
        precision: 'day',
        territory: 'US',
        kind: 'new_work',
        checkedAt: now.toISOString(),
      },
    })
    const publisher = {
      ...first,
      cover: 'different-cover',
      release: { ...first.release, source: 'prh' as const, kind: undefined },
    }
    const result = await collectReleaseBrowse(
      { hardcover: async () => [first], prh: async () => [publisher] },
      now,
    )
    expect(result.hits).toEqual([first])
  })
  it('keeps one failed source separate from successful emptiness and missing configuration', async () => {
    expect(
      await collectReleaseBrowse(
        {
          hardcover: async () => {
            throw new Error('down')
          },
          prh: async () => [hit('2026-09-21')],
        },
        now,
      ),
    ).toMatchObject({
      hits: [hit('2026-09-21')],
      providers: { hardcover: 'unavailable', prh: 'ready' },
    })
    expect(await collectReleaseBrowse({ hardcover: async () => [] }, now)).toMatchObject({
      hits: [],
      providers: { hardcover: 'ready', prh: 'not_configured' },
    })
    expect(await collectReleaseBrowse({}, now)).toMatchObject({
      providers: { hardcover: 'not_configured', prh: 'not_configured' },
    })
  })
})
