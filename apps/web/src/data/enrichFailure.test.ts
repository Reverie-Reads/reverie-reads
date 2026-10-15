import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Book } from '@reverie/core'

// WHAT A SWEEP IS ALLOWED TO CALL "CHECKED".
//
// `enriched_at` is a negative cache: stamping it rests the book for 3 days (30 if it came out
// complete). So the stamp is a claim that the sources were actually asked and actually answered.
//
// Three production sweeps stopped early and each reported the shape of a finished run, because
// every failure mode collapsed into `{ status: 'empty' }` — the same value the sources return when
// they genuinely have nothing. A 4xx whose body was HTML threw inside the parser, the thrown
// SyntaxError carried no status, and the book was stamped as checked on the strength of an outage.
//
// These tests pin the three things that must stay distinct: a miss is stamped, a refusal is not,
// and a failure is not — and a run that hits failures cannot report itself as clean.

const updates: { id: string; patch: Record<string, unknown> }[] = []
let outcomes: unknown[] = []
let outcomeIdx = 0
/** Nth update (1-based) that should come back with an error; 0 = never. */
let failUpdateAt = 0

vi.mock('../lib/supabase', async () => {
  const { pagedSelect } = await import('./pagedSelect.fixture')
  return {
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({
      select: () => pagedSelect([]),
      insert: () => Promise.resolve({ error: null }),
      update: (patch: Record<string, unknown>) => ({
        eq: (_c: string, id: string) => {
          updates.push({ id, patch })
          return Promise.resolve(
            failUpdateAt && updates.length === failUpdateAt
              ? { error: { message: 'permission denied for table books' } }
              : { error: null },
          )
        },
      }),
    }),
  },
  }
})
vi.mock('../lib/enrich', () => ({
  enrichBookOutcome: async () => outcomes[Math.min(outcomeIdx++, outcomes.length - 1)],
}))
vi.mock('../lib/covers', () => ({ ingestCover: async () => ({ status: 'error', code: 'x' }) }))

const { bulkComplete } = await import('./enrichLibrary')

const makeBook = (over: Partial<Book>): Book => ({
  id: 'b1', title: 'A Probe', first: 'Nell', last: 'Marrow', contributors: [],
  series: '', position: '', seriesCount: null, status: 'standalone',
  genre: 'fantasy', subgenre: '', subgenres: [], genres: [], tags: [], tropes: [], moods: [],
  intensity: null, cover: '', pages: null, isbn: '', fave: false,
  darkness: null,
  ownership: 'owned', borrowed: false, wishlist: false,
  owned: { physical: false, ebook: false, audiobook: false },
  format: '', rating: 0, readStatus: 'unset', source: '',
  pub: { y: null, m: null, d: null }, reads: [], plan: { y: null, m: null, d: null },
  progress: 0, addedTs: 0,
  ...over,
})

const run = (books: Book[]) => bulkComplete(books, () => {}, () => false)
const stamped = () => updates.filter((u) => 'enriched_at' in u.patch)

beforeEach(() => {
  updates.length = 0
  outcomeIdx = 0
  failUpdateAt = 0
  outcomes = [{ status: 'empty' }]
})

describe('only a real answer may stamp enriched_at', () => {
  it('an empty result IS stamped — the sources answered and had nothing', () => {
    // The control. Without it, "nothing is ever stamped" would pass every test below.
    return run([makeBook({ id: 'b1', cover: '' })]).then((r) => {
      expect(stamped()).toHaveLength(1)
      expect(r.nothing).toBe(1)
      expect(r.failed).toBe(0)
    })
  })

  it('retains useful partial details without stamping a failed source as checked', async () => {
    outcomes = [{ status: 'ok', data: { sourcesIncomplete: true, pageCount: 240 } }]
    const result = await run([makeBook({ id: 'b1' })])
    expect(updates[0]?.patch.pages).toBe(240)
    expect(stamped()).toHaveLength(0)
    expect(result).toMatchObject({ filled: 1, failed: 1, scanned: 0, nothing: 0 })
    expect(result.errorMessage).toContain('retryable')
  })

  it('does not send an empty update when partial results have no usable fills', async () => {
    outcomes = [{ status: 'ok', data: { sourcesIncomplete: true } }]
    const result = await run([makeBook({ id: 'b1' })])
    expect(updates).toEqual([])
    expect(result).toMatchObject({ filled: 0, failed: 1, scanned: 0, nothing: 0 })
  })

  it('counts partial attempts against the per-run ceiling', async () => {
    outcomes = [{ status: 'ok', data: { sourcesIncomplete: true } }]
    const result = await bulkComplete(
      [makeBook({ id: 'one' }), makeBook({ id: 'two' }), makeBook({ id: 'three' })],
      () => {}, () => false, { limit: 2 },
    )
    expect(result).toMatchObject({ failed: 2, scanned: 0, stopReason: 'limit' })
    expect(outcomeIdx).toBe(2)
  })

  // THE MUTATION TARGET. Drop the `outcome.status === 'failed'` branch in bulkComplete and this
  // fails: the book is stamped and negative-cached for three days because a source was unreachable.
  it('a FAILED check is never stamped — nothing was checked, so nothing may rest', async () => {
    outcomes = [{ status: 'failed', reason: 'all 2 sources failed' }]
    const r = await run([makeBook({ id: 'b1', cover: '' })])

    expect(stamped(), 'an outage must not negative-cache the book').toHaveLength(0)
    expect(r.failed).toBe(1)
    expect(r.nothing, 'a failure is not a miss').toBe(0)
  })

  // THE SECOND MUTATION TARGET, and the one the brief names: reverting the classification so a 429
  // is treated as empty makes this stamp.
  it('a RATE-LIMITED check is never stamped, and stops the run', async () => {
    outcomes = [{ status: 'rate_limited' }]
    const r = await run([makeBook({ id: 'b1', cover: '' })])

    expect(stamped(), 'a 429 must leave the book to retry next run').toHaveLength(0)
    expect(r.stopReason).toBe('rate_limited')
    expect(r.scanned).toBe(0)
  })

  it('a failure does not consume the book — scanned stays behind total, and the run says so', async () => {
    outcomes = [{ status: 'failed', reason: 'enrich 503' }]
    const r = await run([
      makeBook({ id: 'b1', cover: '' }),
      makeBook({ id: 'b2', cover: '' }),
    ])
    // Both books failed, so neither was scanned; the caller can see the gap.
    expect(r.failed).toBe(2)
    expect(r.scanned).toBe(0)
    expect(r.total).toBe(2)
    expect(r.errorMessage).toBe('enrich 503')
  })
})

describe('a run that breaks does not report the shape of one that finished', () => {
  it('a streak of failures stops the run with stopReason error, not done', async () => {
    outcomes = [{ status: 'failed', reason: 'all sources failed' }]
    const books = Array.from({ length: 12 }, (_, i) => makeBook({ id: `b${i}`, cover: '' }))
    const r = await run(books)

    expect(r.stopReason, 'an outage must not read as a completed sweep').toBe('error')
    expect(r.stopReason).not.toBe('done')
    expect(r.failed).toBeGreaterThanOrEqual(5)
    expect(r.scanned).toBe(0)
    expect(r.errorMessage).toBeTruthy()
  })

  it('one bad book does not stop a run that is otherwise working', async () => {
    // A single failure then successes: the streak counter must reset, or a flaky book kills a sweep.
    outcomes = [
      { status: 'failed', reason: 'transient' },
      { status: 'empty' },
      { status: 'empty' },
      { status: 'empty' },
    ]
    const books = Array.from({ length: 4 }, (_, i) => makeBook({ id: `b${i}`, cover: '' }))
    const r = await run(books)

    expect(r.stopReason).toBe('done')
    expect(r.failed).toBe(1)
    expect(r.scanned).toBe(3)
    expect(stamped()).toHaveLength(3)
  })

  // A WRITE THAT FAILS USED TO `throw ue`, which unwound bulkComplete and discarded every count
  // with it: the caller could say something broke but not how far the run had got. Breaking with a
  // reason keeps the progress, which is the difference between "died" and "died after 3 books".
  it('a failed write stops the run WITHOUT throwing, and the counts survive', async () => {
    outcomes = [{ status: 'empty' }]
    failUpdateAt = 3 // let two books through, fail the third
    const books = Array.from({ length: 6 }, (_, i) => makeBook({ id: `b${i}`, cover: '' }))

    const r = await bulkComplete(books, () => {}, () => false)

    expect(r.stopReason).toBe('error')
    expect(r.errorMessage).toContain('permission denied')
    expect(r.scanned, 'the two books that did land are still reported').toBe(2)
    expect(r.total).toBe(6)
  })

  it('a clean pass still reports clean — the honest case is not collateral damage', async () => {
    outcomes = [{ status: 'empty' }]
    const r = await run([makeBook({ id: 'b1', cover: '' }), makeBook({ id: 'b2', cover: '' })])

    expect(r.stopReason).toBe('done')
    expect(r.failed).toBe(0)
    expect(r.errorMessage).toBeUndefined()
    expect(r.scanned).toBe(r.total)
  })
})
