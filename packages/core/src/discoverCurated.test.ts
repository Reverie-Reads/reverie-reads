import { describe, expect, it } from 'vitest'
import {
  blendCuratedPool,
  CURATED_DISCOVER,
  tierDiscoverShelf,
  type BlendableHit,
} from './discoverCurated'

// Guards from docs/tasks/task-discover-curated-candidates.md, verified against the audit's
// methodology (docs/audits/discover-recency.md): curated titles enter the pool and rank by the
// same year-tier logic as live hits (not pinned, not segregated); the four starved categories
// measurably improve their surfaced 2020+ share; the five categories left on live query are
// untouched — passthrough by reference, not just by value.

const THIS_YEAR = 2026

const hit = (title: string, pub: string, isbn = '', author = 'Live Author'): BlendableHit => ({
  title,
  authors: [author],
  cover: 'https://example.test/cover.jpg',
  isbn,
  pub,
})

/** A synthetic live pool with the audit's fn-depth shape: n hits, k of them 2020+. */
const auditPool = (n: number, recent2020: number, medianYear: number): BlendableHit[] =>
  Array.from({ length: n }, (_, i) =>
    hit(
      `Live ${i}`,
      String(i < recent2020 ? 2024 : medianYear - (i % 7)),
      `9780000${String(i).padStart(6, '0')}`,
    ),
  )

const share2020 = (hits: readonly BlendableHit[]): number =>
  hits.filter((h) => Number(h.pub.slice(0, 4)) >= 2020).length / (hits.length || 1)

const surfaced = (genre: string, live: BlendableHit[]): BlendableHit[] =>
  tierDiscoverShelf(blendCuratedPool(genre, live), THIS_YEAR).slice(0, 12)

describe('curated data integrity', () => {
  it('covers exactly the four reviewed categories with the approved counts', () => {
    expect(Object.keys(CURATED_DISCOVER).sort()).toEqual([
      'fantasy',
      'mystery',
      'romance',
      'science fiction',
    ])
    expect(CURATED_DISCOVER['romance']).toHaveLength(12)
    expect(CURATED_DISCOVER['fantasy']).toHaveLength(11)
    expect(CURATED_DISCOVER['science fiction']).toHaveLength(10)
    expect(CURATED_DISCOVER['mystery']).toHaveLength(8)
  })

  it('every record carries the fields the ranking and the add-prefill read', () => {
    for (const [genre, hits] of Object.entries(CURATED_DISCOVER)) {
      for (const h of hits) {
        expect(h.title, `${genre}: title`).toBeTruthy()
        expect(h.authors.length, `${genre} ${h.title}: authors`).toBeGreaterThan(0)
        expect(
          h.cover === '' || h.cover.startsWith('https://covers.openlibrary.org/'),
          `${genre} ${h.title}: reviewed Open Library cover or honest absence`,
        ).toBe(true)
        expect(h.isbn, `${genre} ${h.title}: isbn-13`).toMatch(/^97[89]\d{10}$/)
        expect(h.pub, `${genre} ${h.title}: pub year`).toMatch(/^\d{4}/)
        expect(h.curated, `${genre} ${h.title}: provenance`).toBe(true)
      }
    }
  })

  it('38 of the 41 are 2020+ — the three deliberate backlist picks are known and stay 3', () => {
    const all = Object.values(CURATED_DISCOVER).flat()
    expect(all).toHaveLength(41)
    const pre2020 = all.filter((h) => Number(h.pub.slice(0, 4)) < 2020)
    expect(pre2020.map((h) => h.title).sort()).toEqual([
      'A Memory Called Empire',
      'Heated Rivalry',
      'The Silent Patient',
    ])
  })

  it('no duplicate identity inside any category (ISBN and title+author both unique)', () => {
    for (const [genre, hits] of Object.entries(CURATED_DISCOVER)) {
      const isbns = hits.map((h) => h.isbn)
      const titles = hits.map((h) => `${h.title}|${h.authors[0]}`.toLowerCase())
      expect(new Set(isbns).size, `${genre} isbns`).toBe(hits.length)
      expect(new Set(titles).size, `${genre} titles`).toBe(hits.length)
    }
  })
})

describe('blendCuratedPool', () => {
  it('is a passthrough — the SAME array reference — for every category left on live query', () => {
    for (const genre of ['horror', 'literary', 'nonfiction', 'cozy', 'young adult', 'westerns']) {
      const live = auditPool(17, 2, 2001)
      expect(blendCuratedPool(genre, live)).toBe(live)
    }
  })

  it('injects the full curated set alongside live hits for an in-scope category', () => {
    const live = auditPool(17, 0, 2004)
    const pool = blendCuratedPool('romance', live)
    expect(pool).toHaveLength(17 + 12)
    expect(pool.filter((h) => h.curated)).toHaveLength(12)
  })

  it('live wins the dedupe: a book the window CAN see is never shadowed by its curated twin', () => {
    const liveOnyxByIsbn = hit('Onyx Storm (live edition)', '2025-01-21', '9781649376947')
    const liveJustForSummer = hit(
      'Just for the Summer',
      '2024-04-02',
      '9999999999999',
      'Abby Jimenez',
    )
    const pool = blendCuratedPool('romance', [liveOnyxByIsbn, liveJustForSummer])
    // same ISBN → curated Onyx Storm dropped; same title+author, different ISBN → curated dropped too
    expect(pool.filter((h) => h.title.startsWith('Onyx Storm'))).toEqual([liveOnyxByIsbn])
    expect(pool.filter((h) => h.title === 'Just for the Summer')).toEqual([liveJustForSummer])
    expect(pool).toHaveLength(2 + 12 - 2)
  })
})

describe('curated hits rank by the same logic as live hits — not pinned, not segregated', () => {
  it('a fresher live hit outranks every curated title; curated outranks older live', () => {
    const liveFresh = hit('Live 2026 Release', '2026-03-01', '9780000000001')
    const liveOld = hit('Live 2010 Backlist', '2010', '9780000000002')
    const ranked = tierDiscoverShelf(blendCuratedPool('romance', [liveFresh, liveOld]), THIS_YEAR)
    expect(ranked[0]).toBe(liveFresh) // newest-first within the fresh tier — live on top
    // curated 2024/2025 titles sit between: after the 2026 live hit, before the 2010 live hit
    expect(ranked.indexOf(liveOld)).toBe(ranked.length - 1)
    expect(ranked.slice(1, -1).every((h) => h.curated)).toBe(true)
  })

  it('interleaves by date inside the fresh tier — curated and live strictly by pub, no grouping', () => {
    const live = [
      hit('Live A', '2025-06-15', '9780000000003'),
      hit('Live B', '2024-06-15', '9780000000004'),
    ]
    const ranked = tierDiscoverShelf(blendCuratedPool('romance', live), THIS_YEAR)
    const dates = ranked.filter((h) => Number(h.pub.slice(0, 4)) >= THIS_YEAR - 2).map((h) => h.pub)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('a missing year demotes to the rest tier, never promotes', () => {
    const undated = hit('Undated', '', '9780000000005')
    const ranked = tierDiscoverShelf(blendCuratedPool('mystery', [undated]), THIS_YEAR)
    expect(ranked[ranked.length - 1]).toBe(undated)
  })
})

describe('2020+ share guard — the audit methodology, counted on the 38', () => {
  // Live pools mirror the audit's measured fn-depth composition (docs/audits/discover-recency.md §1):
  // Romance 17 hits / 0 × 2020+, Fantasy 16/0, Science fiction 19/0, Mystery 16/0. The metric is the
  // surfaced (post-tier, sliced-12) 2020+ share, exactly as the audit computed it. The three
  // pre-2020 curated picks (2019) cannot inflate the numerator — the share counts year ≥ 2020 only,
  // so the improvement below is carried entirely by the 38.
  const STARVED: [string, number, number][] = [
    ['romance', 17, 2004],
    ['fantasy', 16, 2004],
    ['science fiction', 19, 1997],
    ['mystery', 16, 2001],
  ]

  it('every starved category improves measurably; a pre-2020 curated pick never counts', () => {
    for (const [genre, n, median] of STARVED) {
      const live = auditPool(n, 0, median)
      const before = share2020(tierDiscoverShelf(live, THIS_YEAR).slice(0, 12))
      const after = share2020(surfaced(genre, live))
      expect(before, `${genre} pre-injection (audit: 0%)`).toBe(0)
      expect(after, `${genre} post-injection`).toBeGreaterThan(before)
      expect(after, `${genre} post-injection is a real shelf-level shift`).toBeGreaterThanOrEqual(
        0.5,
      )
    }
  })

  it('the categories left on live query surface EXACTLY what they surfaced before', () => {
    const UNCHANGED: [string, number, number, number][] = [
      ['horror', 17, 2, 2001],
      ['literary', 17, 2, 2014],
      ['nonfiction', 20, 3, 2007],
      ['cozy', 19, 17, 2023],
      ['young adult', 19, 8, 2018],
    ]
    for (const [genre, n, recent, median] of UNCHANGED) {
      const live = auditPool(n, recent, median)
      const before = tierDiscoverShelf(live, THIS_YEAR).slice(0, 12)
      const after = surfaced(genre, live)
      expect(after, `${genre} surfaced set unchanged`).toEqual(before)
      expect(
        after.some((h) => h.curated),
        `${genre} carries no curated hit`,
      ).toBe(false)
    }
  })
})
