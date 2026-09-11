import { describe, expect, it } from 'vitest'
import type { Book } from '@reverie/core'
import {
  batchCount,
  batchOf,
  dedupeHits,
  DISCOVER_BATCH,
  fetchDiscover,
  isOwned,
  ownedKeys,
  sortByTaste,
  visibleHits,
  type DiscoverHit,
} from './discover'

const hit = (h: Partial<DiscoverHit>): DiscoverHit => ({
  title: '',
  authors: [],
  cover: '',
  isbn: '',
  pub: '',
  ...h,
})

const book = (b: { title: string; isbn?: string; author?: string }): Book =>
  ({
    title: b.title,
    isbn: b.isbn ?? '',
    contributors: b.author ? [{ name: b.author, role: 'author' }] : [],
  }) as unknown as Book

describe('discover — reviewed shelf', () => {
  it('normalizes genre aliases without making a provider request', async () => {
    const shelf = await fetchDiscover('Sci-Fi')
    expect(shelf.length).toBeGreaterThan(0)
    expect(shelf.every((candidate) => candidate.source !== 'google')).toBe(true)
    expect(
      shelf.every(
        (candidate) => !candidate.cover || candidate.cover.includes('covers.openlibrary.org'),
      ),
    ).toBe(true)
    expect(await fetchDiscover('gardening')).toEqual([])
  })
})

describe('discover — dedupe', () => {
  it('collapses by ISBN and by title+author; keeps genuinely distinct hits', () => {
    const hits = [
      hit({ title: 'Fourth Wing', authors: ['Rebecca Yarros'], isbn: '9781649374042' }),
      hit({ title: 'Fourth Wing (Special)', authors: ['Rebecca Yarros'], isbn: '9781649374042' }),
      hit({ title: 'Fourth Wing', authors: ['Rebecca Yarros'] }), // no isbn — same title/author
      hit({ title: 'Iron Flame', authors: ['Rebecca Yarros'], isbn: '9781649374172' }),
    ]
    const out = dedupeHits(hits)
    expect(out.map((h) => h.title)).toEqual(['Fourth Wing', 'Iron Flame'])
  })
})

describe('discover — ownership', () => {
  const owned = ownedKeys([
    book({
      title: 'A Court of Thorns and Roses',
      isbn: '978-1-63557-556-9',
      author: 'Sarah J. Maas',
    }),
    book({ title: 'King of Wrath', author: 'Ana Huang' }),
  ])

  it('matches by ISBN regardless of formatting', () => {
    expect(isOwned(hit({ title: 'ACOTAR (any edition)', isbn: '9781635575569' }), owned)).toBe(true)
  })

  it('matches by title + first author, case- and punctuation-insensitive', () => {
    expect(isOwned(hit({ title: 'KING OF WRATH', authors: ['ana huang'] }), owned)).toBe(true)
    expect(
      isOwned(hit({ title: 'A Court of Thorns & Roses…', authors: ['Sarah J Maas'] }), owned),
    ).toBe(false) // '&' ≠ 'and' — aliasing stays out of v1
  })

  it('does not claim strangers', () => {
    expect(
      isOwned(
        hit({ title: 'King of Pride', authors: ['Ana Huang'], isbn: '9781728289731' }),
        owned,
      ),
    ).toBe(false)
  })
})

describe('discover — taste ordering (Tier 2b)', () => {
  const a = hit({ title: 'A', authors: ['X'], isbn: '1111111111' })
  const b = hit({ title: 'B', authors: ['X'], isbn: '2222222222' })
  const c = hit({ title: 'C', authors: ['X'], isbn: '3333333333' })

  it('scored hits sort closest-first; unscored keep catalog order behind them', () => {
    const out = sortByTaste([a, b, c], { [`1111111111`]: 0.71, [`3333333333`]: 0.9 })
    expect(out.map((x) => x.hit.title)).toEqual(['C', 'A', 'B'])
    expect(out[0]?.taste).toBeCloseTo(0.9)
    expect(out[2]?.taste).toBeUndefined()
  })

  it('no scores at all → pure catalog order, no annotations', () => {
    const out = sortByTaste([a, b, c], {})
    expect(out.map((x) => x.hit.title)).toEqual(['A', 'B', 'C'])
    expect(out.every((x) => x.taste == null)).toBe(true)
  })
})

describe('discover — batching and cycling', () => {
  const pool = (n: number, from = 0): DiscoverHit[] =>
    Array.from({ length: n }, (_, i) => hit({ title: `T${i + from}`, isbn: `isbn${i + from}` }))
  const titles = (hits: DiscoverHit[]) => hits.map((h) => h.title)

  it('a full pool divides into whole batches of DISCOVER_BATCH', () => {
    const p = pool(60)
    expect(batchCount(p)).toBe(3)
    expect(batchOf(p, 0)).toHaveLength(DISCOVER_BATCH)
    expect(batchOf(p, 1)).toHaveLength(DISCOVER_BATCH)
    expect(batchOf(p, 2)).toHaveLength(DISCOVER_BATCH)
  })

  it('consecutive batches are DISJOINT — the no-duplicates claim, stated as a set', () => {
    const p = pool(60)
    const seen = new Set<string>()
    for (let i = 0; i < batchCount(p); i++) {
      for (const h of batchOf(p, i)) {
        expect(seen.has(h.title), `${h.title} repeated within one pass`).toBe(false)
        seen.add(h.title)
      }
    }
    // and one pass covers the pool exactly
    expect(seen.size).toBe(60)
  })

  it('cycles: past the last batch it wraps to the first rather than dead-ending', () => {
    const p = pool(60)
    expect(titles(batchOf(p, 3))).toEqual(titles(batchOf(p, 0)))
    expect(titles(batchOf(p, 4))).toEqual(titles(batchOf(p, 1)))
    // negative-safe, so an index can never land out of range
    expect(titles(batchOf(p, -1))).toEqual(titles(batchOf(p, 2)))
  })

  it('a short pool is one batch — the curated fn-down path and an old fn returning 12', () => {
    for (const n of [8, 11, 12, 20]) {
      const p = pool(n)
      expect(batchCount(p), `${n} hits`).toBe(1)
      expect(batchOf(p, 0)).toHaveLength(n)
      // cycling a single batch returns the same batch, never empty
      expect(titles(batchOf(p, 1))).toEqual(titles(batchOf(p, 0)))
    }
  })

  it('an uneven pool keeps a short final batch rather than overlapping to pad it', () => {
    const p = pool(45)
    expect(batchCount(p)).toBe(3)
    expect(batchOf(p, 2)).toHaveLength(5)
    // the short batch is the TAIL, not a wrapped window — no repeats
    expect(titles(batchOf(p, 2))).toEqual(['T40', 'T41', 'T42', 'T43', 'T44'])
  })

  it('an empty pool has no batches and yields an empty batch', () => {
    expect(batchCount([])).toBe(0)
    expect(batchOf([], 0)).toEqual([])
    expect(batchOf([], 3)).toEqual([])
  })

  describe('visibleHits — the imported toggle, filtered BEFORE chunking', () => {
    const owned = ownedKeys([book({ title: 'T0' }), book({ title: 'T1' }), book({ title: 'T2' })])

    it('off: the pool passes through untouched', () => {
      const p = pool(30)
      expect(visibleHits(p, owned, false)).toHaveLength(30)
    })

    it('on: drops what the reader already shelves', () => {
      const p = pool(30)
      const v = visibleHits(p, owned, true)
      expect(v).toHaveLength(27)
      expect(titles(v)).not.toContain('T0')
      expect(titles(v)).not.toContain('T1')
    })

    it('TYPICAL ATTRITION: the first batch stays full even when the owned books cluster in it', () => {
      // The failure this orders against: chunk first and this reader — who owns nine of the first
      // twenty — gets a batch of eleven that looks like a short shelf rather than a filtered one.
      const p = pool(40)
      const heavy = ownedKeys(Array.from({ length: 9 }, (_, i) => book({ title: `T${i}` })))
      const v = visibleHits(p, heavy, true)
      expect(v).toHaveLength(31)
      expect(batchOf(v, 0)).toHaveLength(DISCOVER_BATCH) // full, not 11
      expect(titles(batchOf(v, 0))).not.toContain('T0')
      expect(batchCount(v)).toBe(2)
    })

    it('a reader who owns the whole pool sees no batches, not an empty grid of one', () => {
      const p = pool(5)
      const all = ownedKeys(Array.from({ length: 5 }, (_, i) => book({ title: `T${i}` })))
      const v = visibleHits(p, all, true)
      expect(v).toEqual([])
      expect(batchCount(v)).toBe(0)
    })

    it('does not mutate the pool it is given', () => {
      const p = pool(5)
      visibleHits(p, owned, true)
      expect(p).toHaveLength(5)
    })
  })
})
