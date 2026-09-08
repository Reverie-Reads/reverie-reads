import { describe, expect, it } from 'vitest'
import { findDuplicateGroups, mergeBooks, type LibraryState } from './merge'
import { makeBook } from './book.fixture'
import { possessionPatch, possessionState } from './ownership'
import type { PlanDate, PossessionState } from './types'

const alpha = makeBook({
  id: 'a',
  title: 'Iron Flame',
  last: 'Yarros',
  tags: ['Dragon Riders'],
  reads: [{ date: '2025-01-01', format: 'ebook', rating: 4, notes: '' }],
  cover: 'a.jpg',
  rating: 4,
  owned: { physical: 'paperback', ebook: false, audiobook: false },
})
const beta = makeBook({
  id: 'b',
  title: 'Iron Flame',
  last: 'Yarros',
  tags: ['Enemies to Lovers'],
  reads: [
    { date: '2025-01-01', format: 'paperback', rating: 0, notes: '' }, // duplicate date
    { date: '2025-06-01', format: 'paperback', rating: 5, notes: '' },
  ],
  fave: true,
  intensity: 5,
  owned: { physical: false, ebook: true, audiobook: false },
})

const initial: LibraryState = {
  books: [alpha, beta],
  tbrs: [{ id: 't1', name: 'Priority TBR', priority: true, ids: ['b'] }],
  collections: [{ id: 'c1', name: 'Faves', ids: ['a', 'b'] }],
}

describe('mergeBooks', () => {
  it('unions reads (dedup by date), tags; ORs fave; maxes intensity; remaps lists; drops loser', () => {
    const next = mergeBooks(initial, 'a', ['b'])

    expect(next.books).toHaveLength(1)
    const [m] = next.books
    if (!m) throw new Error('expected a merged book')

    expect(m.id).toBe('a')
    expect(m.reads.map((r) => r.date).sort()).toEqual(['2025-01-01', '2025-06-01'])
    expect(new Set(m.tags)).toEqual(new Set(['Dragon Riders', 'Enemies to Lovers']))
    expect(m.fave).toBe(true)
    expect(m.intensity).toBe(5)
    expect(m.owned).toEqual({ physical: 'paperback', ebook: true, audiobook: false }) // union
    expect(m.readStatus).toBe('Read') // reads present => Read

    // list memberships remapped onto the primary and deduped
    expect(next.tbrs[0]?.ids).toEqual(['a'])
    expect(next.collections[0]?.ids).toEqual(['a'])
  })

  it('does not mutate the input state', () => {
    const snapshot = JSON.stringify(initial)
    mergeBooks(initial, 'a', ['b'])
    expect(JSON.stringify(initial)).toBe(snapshot)
  })

  it('returns the same state when the primary is missing', () => {
    expect(mergeBooks(initial, 'missing', ['b'])).toBe(initial)
  })
})

describe('findDuplicateGroups', () => {
  it('groups by normalized title + author', () => {
    const groups = findDuplicateGroups(initial.books)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  it('ignores singletons', () => {
    expect(findDuplicateGroups([alpha])).toHaveLength(0)
  })
})

describe('possession on merge', () => {
  const state = (
    a: Parameters<typeof makeBook>[0],
    b: Parameters<typeof makeBook>[0],
  ): LibraryState => ({
    books: [makeBook(a), makeBook(b)],
    tbrs: [],
    collections: [],
  })

  /** Merge two records described by their possession WORD and read the survivor's word back. */
  const mergeWords = (a: PossessionState, b: PossessionState): PossessionState => {
    const next = mergeBooks(
      state(
        { id: 'a', title: 'T', ...possessionPatch(a) },
        { id: 'b', title: 'T', ...possessionPatch(b) },
      ),
      'a',
      ['b'],
    )
    return possessionState(next.books.find((x) => x.id === 'a')!)
  }

  it('one owned copy makes the merged record owned', () => {
    expect(mergeWords('wishlist', 'owned')).toBe('owned')
  })

  it('two wishlist copies stay wishlist', () => {
    expect(mergeWords('wishlist', 'wishlist')).toBe('wishlist')
  })

  it('borrowed loses to owned but beats wishlist (strongest possession wins)', () => {
    expect(mergeWords('borrowed', 'owned')).toBe('owned')
    expect(mergeWords('wishlist', 'borrowed')).toBe('borrowed')
  })

  it('a borrowed copy SURVIVES a merge with an owned one — the old model dropped it', () => {
    // Under the four-state enum this collapsed to 'owned' and the fact that a borrowed copy was
    // also in hand was lost. The word is still 'owned'; the flag is the new information.
    const next = mergeBooks(
      state(
        { id: 'a', title: 'T', ...possessionPatch('borrowed') },
        { id: 'b', title: 'T', ...possessionPatch('owned') },
      ),
      'a',
      ['b'],
    )
    const survivor = next.books.find((x) => x.id === 'a')!
    expect(survivor.ownership).toBe('owned')
    expect(survivor.borrowed).toBe(true)
  })
})

describe('merge unions subgenres', () => {
  it('keeps the primary book’s order first and mirrors the single field', () => {
    const primary = makeBook({
      id: 'p',
      title: 'Primary',
      subgenre: 'Epic Fantasy',
      subgenres: ['Epic Fantasy', 'Romantasy'],
    })
    const loser = makeBook({
      id: 'l',
      title: 'Dupe',
      subgenre: 'Dark Fantasy',
      subgenres: ['Dark Fantasy', 'Romantasy'],
    })
    const state: LibraryState = { books: [primary, loser], tbrs: [], collections: [] }
    const merged = mergeBooks(state, 'p', ['l']).books[0]!
    expect(merged.subgenres).toEqual(['Epic Fantasy', 'Romantasy', 'Dark Fantasy'])
    expect(merged.subgenre).toBe('Epic Fantasy')
  })
})

describe('merge unions genres', () => {
  it('collapses casing variants without collapsing distinct descriptive labels', () => {
    const primary = makeBook({
      id: 'p',
      title: 'Primary',
      genres: ['romance', 'Thriller'],
    })
    const loser = makeBook({
      id: 'l',
      title: 'Duplicate',
      genres: ['Romance', 'Mystery', 'thriller'],
    })
    const merged = mergeBooks({ books: [primary, loser], tbrs: [], collections: [] }, 'p', ['l'])
      .books[0]!

    expect(merged.genres).toEqual(['romance', 'Thriller', 'mystery'])
  })
})

describe('merge keeps series provenance attached to the winning value', () => {
  it('takes the loser claim when its series fills a blank primary', () => {
    const primary = makeBook({
      id: 'p',
      title: 'Duplicate',
      series: '',
      seriesClaim: { origin: 'unknown' },
    })
    const loser = makeBook({
      id: 'l',
      title: 'Duplicate',
      series: 'Imported Saga',
      seriesClaim: { origin: 'import', source: 'series_column', confidence: 'high' },
    })

    const merged = mergeBooks({ books: [primary, loser], tbrs: [], collections: [] }, 'p', ['l'])
      .books[0]!

    expect(merged.series).toBe('Imported Saga')
    expect(merged.seriesClaim).toEqual({
      origin: 'import',
      source: 'series_column',
      confidence: 'high',
    })
  })

  it('keeps the primary claim when its series survives', () => {
    const primary = makeBook({
      id: 'p',
      title: 'Duplicate',
      series: 'Reader Saga',
      seriesClaim: { origin: 'reader', source: 'book_edit' },
    })
    const loser = makeBook({
      id: 'l',
      title: 'Duplicate',
      series: 'Imported Saga',
      seriesClaim: { origin: 'import', source: 'series_column' },
    })

    const merged = mergeBooks({ books: [primary, loser], tbrs: [], collections: [] }, 'p', ['l'])
      .books[0]!
    expect(merged.seriesClaim).toEqual({ origin: 'reader', source: 'book_edit' })
  })
})

describe('plan union — one object, never assembled from parts', () => {
  // Only the plan varies across these cases, so the helper takes just that — no spread over
  // `makeBook`'s required id/title, which is what tsc objected to when this was written loosely.
  const lib = (primaryPlan: PlanDate, loserPlan: PlanDate): LibraryState => ({
    books: [
      makeBook({ id: 'p', title: 'T', last: 'X', plan: primaryPlan }),
      makeBook({ id: 'l', title: 'T', last: 'X', plan: loserPlan }),
    ],
    tbrs: [],
    collections: [],
  })
  const noPlan = (): PlanDate => ({ y: null, m: null, d: null })

  it('a primary with a plan keeps it when the loser has none', () => {
    const merged = mergeBooks(lib({ y: 2026, m: 3, d: 14 }, noPlan()), 'p', ['l']).books[0]!
    expect(merged.plan).toEqual({ y: 2026, m: 3, d: 14 })
  })

  it('a plan-less primary adopts the loser’s whole plan', () => {
    const merged = mergeBooks(lib(noPlan(), { y: 2027, m: 1, d: 5 }), 'p', ['l']).books[0]!
    expect(merged.plan).toEqual({ y: 2027, m: 1, d: 5 })
  })

  // THE OBJECT-LEVEL DISCRIMINATOR, and the reason this rule is not three `??`s. The primary has
  // said "sometime in 2026" and nothing more. A per-field fill would borrow the loser's month and
  // day and produce March 14th 2026 — a date neither reader ever chose, presented as the plan.
  // Matches merge_books_authoritative, which decides once and moves all five columns together.
  it('a year-only primary is NOT completed from the loser’s month and day', () => {
    const merged = mergeBooks(lib({ y: 2026, m: null, d: null }, { y: 2026, m: 3, d: 14 }), 'p', [
      'l',
    ]).books[0]!
    expect(merged.plan).toEqual({ y: 2026, m: null, d: null })
  })

  it('neither side planning leaves the merged book unplanned', () => {
    const merged = mergeBooks(lib(noPlan(), noPlan()), 'p', ['l']).books[0]!
    expect(merged.plan).toEqual({ y: null, m: null, d: null })
  })

  // The stale-cache shape, on the client side of the boundary. When the cached primary carries no
  // plan, the union has nothing to carry forward and the payload sent to the merge RPC is all-null.
  // That is CORRECT here and is precisely why the RPC cannot treat an incoming null as an
  // instruction: `take_plan` reads the STORED row, sees a plan the client never knew about, and
  // declines the write. Covered end-to-end in supabase/tests/merge_plan_test.sql; this pins the
  // client half — that core produces the null rather than inventing something to send.
  it('a stale primary with no cached plan sends an empty plan, not a guess', () => {
    const merged = mergeBooks(lib(noPlan(), noPlan()), 'p', ['l']).books[0]!
    expect(merged.plan.y).toBeNull()
    expect(merged.plan.m).toBeNull()
    expect(merged.plan.d).toBeNull()
  })

  it('a primary Soon plan keeps its membership and intention when the loser has a date', () => {
    const state = lib(noPlan(), { y: 2027, m: 1, d: 5 })
    state.books[0]!.planPosition = 1000
    state.books[0]!.planIntention = 'When the mood comes.'
    state.books[1]!.planPosition = 2000
    const merged = mergeBooks(state, 'p', ['l']).books[0]!
    expect(merged.plan).toEqual(noPlan())
    expect(merged.planPosition).toBe(1000)
    expect(merged.planIntention).toBe('When the mood comes.')
  })

  it('an unplanned primary adopts the loser’s complete Soon plan', () => {
    const state = lib(noPlan(), noPlan())
    state.books[1]!.planPosition = 2000
    state.books[1]!.planIntention = 'For a rainy afternoon.'
    const merged = mergeBooks(state, 'p', ['l']).books[0]!
    expect(merged.plan).toEqual(noPlan())
    expect(merged.planPosition).toBe(2000)
    expect(merged.planIntention).toBe('For a rainy afternoon.')
  })
})
