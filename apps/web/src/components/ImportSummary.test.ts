import { describe, expect, it } from 'vitest'
import { summaryHeadline, summaryNotices } from './importSummaryCopy'
import type { ImportExportResult } from '../data/importLibrary'

const base: ImportExportResult = {
  profile: 'generic',
  added: 40,
  merged: 3,
  review: [],
  ingested: [],
  ignoredGlobalOrder: 0,
  outcomes: [],
  truncatedIsbns: 0,
  bookIds: [],
  extras: {
    tbrPlaced: 0,
    shelvesCreated: [],
    shelved: 0,
    noCover: 0,
    noIsbn: 0,
    unplacedNotes: 0,
    tropeLikeShelves: [],
  },
}
const withExtras = (e: Partial<ImportExportResult['extras']>): ImportExportResult => ({
  ...base,
  extras: { ...base.extras, ...e },
})

describe('ImportSummary copy', () => {
  it('presents the legacy import profile with the current product name', () => {
    expect(summaryHeadline({ ...base, profile: 'reverie' })).toBe(
      'Detected your Midniht export — brought in 40 new, and folded 3 into what you had.',
    )
  })
  it('headline states what the import did', () => {
    expect(summaryHeadline(base)).toBe(
      'Detected your generic export — brought in 40 new, and folded 3 into what you had.',
    )
  })

  it('says when a supplied global-order column went unused, rather than dropping it in silence', () => {
    // WAS: the headline boasted "stitched 2 reading orders" — the subsystem that consumed the
    // column. NOW the column is parsed and deliberately not acted on, so the honest thing is to
    // say so. A reader who curated a cross-series sequence should not have to infer from an absent
    // number that we ignored it.
    const lines = summaryNotices({ ...base, ignoredGlobalOrder: 7 })
    const line = lines.find((l) => l.includes('global reading order'))
    expect(line).toBeDefined()
    expect(line).toContain('7 rows')
    expect(line).toContain("series order comes from each book's position in its series")

    // singular, and silent when the column was never supplied
    expect(
      summaryNotices({ ...base, ignoredGlobalOrder: 1 }).some((l) => l.includes('1 row carried')),
    ).toBe(true)
    expect(summaryNotices(base).some((l) => l.includes('global reading order'))).toBe(false)
  })

  it('speaks to the TBR, shelves, missing covers, and unplaced notes — pluralized', () => {
    const lines = summaryNotices(
      withExtras({
        tbrPlaced: 12,
        shelvesCreated: ['Imported TBR', 'Dark Romance', 'Fae'],
        shelved: 60,
        noCover: 142,
        unplacedNotes: 1,
      }),
    )
    expect(lines[0]).toBe('12 to-read books placed on your Imported TBR.')
    expect(lines[1]).toContain('Created 2 shelves from your Goodreads shelves: Dark Romance, Fae.') // TBR excluded
    expect(lines.find((l) => l.includes('142 books came in without a cover'))).toBeTruthy()
    expect(lines.find((l) => l.includes("we'll fetch what we can"))).toBeTruthy()
    expect(lines.find((l) => l.includes('1 review or note couldn'))).toBeTruthy()
  })

  it('notes trope-like shelves without converting, and truncated ISBNs', () => {
    const lines = summaryNotices(withExtras({ tropeLikeShelves: ['Enemies To Lovers'] }))
    expect(
      lines.find((l) => l.includes('look like tropes') && l.includes('kept as shelves')),
    ).toBeTruthy()
    expect(
      summaryNotices({ ...base, truncatedIsbns: 3 }).find((l) =>
        l.includes('3 ISBNs may be missing'),
      ),
    ).toBeTruthy()
  })

  it('is silent when nothing needs saying', () => {
    expect(summaryNotices(base)).toEqual([])
  })

  it('uses singular forms for a single item', () => {
    const lines = summaryNotices(withExtras({ tbrPlaced: 1, noCover: 1 }))
    expect(lines[0]).toBe('1 to-read book placed on your Imported TBR.')
    expect(lines.find((l) => l.startsWith('1 book came in without a cover'))).toBeTruthy()
  })
})
