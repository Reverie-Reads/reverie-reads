import { it, expect } from 'vitest'
import { releaseBrowseGroups } from './releaseBrowse'
import type { ReleaseHit } from './releases'
const now = new Date('2026-09-20T12:00:00Z')
const hit = (pub: string): ReleaseHit => ({
  title: pub,
  authors: ['Author'],
  isbn: '',
  cover: '',
  pub,
  release: { source: 'hardcover', precision: 'day', checkedAt: now.toISOString() },
})
it('rechecks a cached shelf against the current date and never invents partial publication days', () => {
  expect(
    releaseBrowseGroups(
      [
        '2026-06-21',
        '2026-06-22',
        '2026-09-20',
        '2026-09-21',
        '2027-03-22',
        '2027-03-23',
        '2026',
        '2026-09',
        '2026-02-30',
      ].map(hit),
      now,
    ),
  ).toEqual({
    recent: [hit('2026-09-20'), hit('2026-06-22')],
    upcoming: [hit('2026-09-21'), hit('2027-03-22')],
  })
})
