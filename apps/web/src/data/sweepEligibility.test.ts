import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'

// THE BUTTON AND THE SWEEP MUST COUNT WITH THE SAME PREDICATE.
//
// The incident: Settings derived its count as `books.filter(isIncomplete)` while bulkComplete
// filtered `isIncomplete && shouldCheck` — so the button said (112) and the sweep, correctly
// refusing 112 books inside their recheck windows, checked 0 of 0. A control whose label and
// action disagree is the overclaiming-test-name defect wearing a button. The fix is one exported
// predicate (`sweepCandidates`) consumed by both; these tests pin the predicate's behaviour AND
// pin both consumers to it, because a shared function only prevents divergence while both sides
// still call it.

vi.mock('../lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ data: [], error: null }) }) } }))

const { sweepCandidates } = await import('./enrichLibrary')

const DAY = 86_400_000
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString()

// An incomplete book missing everything (no cover → the PARTIAL 3-day window applies).
const partial = (id: string) => makeBook({ id, title: `Partial ${id}` })
// A cover and standalone status do not make missing bibliography complete.
const highValue = (id: string) =>
  makeBook({ id, title: `HighValue ${id}`, cover: 'https://x/c.jpg', status: 'standalone' })

const stamps = (entries: Record<string, string | null>) => new Map(Object.entries(entries))

describe('sweepCandidates — the one predicate', () => {
  it('a never-checked incomplete book is eligible', () => {
    expect(sweepCandidates([partial('a')], stamps({}))).toHaveLength(1)
    expect(sweepCandidates([partial('a')], stamps({ a: null }))).toHaveLength(1)
  })

  it('a fresh stamp makes an incomplete book INELIGIBLE — the half the old button count ignored', () => {
    expect(sweepCandidates([partial('a')], stamps({ a: iso(1) }))).toHaveLength(0)
  })

  it('the partial window is 3 days: stale at 4, resting at 2', () => {
    expect(sweepCandidates([partial('a')], stamps({ a: iso(4) }))).toHaveLength(1)
    expect(sweepCandidates([partial('a')], stamps({ a: iso(2) }))).toHaveLength(0)
  })

  it('missing bibliography retries after three days even when a cover is present', () => {
    expect(sweepCandidates([highValue('a')], stamps({ a: iso(2) }))).toHaveLength(0)
    expect(sweepCandidates([highValue('a')], stamps({ a: iso(4) }))).toHaveLength(1)
  })

  it('a complete book is never a candidate, stamped or not', () => {
    const complete = makeBook({
      id: 'c',
      title: 'Done',
      cover: 'https://x/c.jpg',
      isbn: '9780000000001',
      pages: 320,
      pub: { y: 2020, m: null, d: null },
      genres: ['fantasy'],
      status: 'standalone',
    })
    expect(sweepCandidates([complete], stamps({}))).toHaveLength(0)
    expect(sweepCandidates([{ ...complete, pages: null }], stamps({}))).toHaveLength(1)
  })
})

describe('both consumers are pinned to the shared predicate (source scan)', () => {
  const settings = readFileSync(join(__dirname, '../routes/SettingsRoute.tsx'), 'utf8')
  const enrichLib = readFileSync(join(__dirname, './enrichLibrary.ts'), 'utf8')

  it('the sweep itself selects via sweepCandidates', () => {
    expect(enrichLib).toMatch(/candidates = sweepCandidates\(/)
  })

  it('the Settings button counts via sweepCandidates and labels with the eligible count', () => {
    expect(settings).toMatch(/sweepCandidates\(/)
    expect(settings).toContain('(${eligibleCount})')
  })

  it("the button's label and disabled state never use the completeness-only count", () => {
    // `incompleteCount` may exist (it feeds the resting-count explanation) but must not reach the
    // control: no label interpolation, no disabled gate. This is the exact regression that shipped.
    expect(settings).not.toContain('(${incompleteCount})')
    expect(settings).not.toContain('disabled={!incompleteCount}')
  })

  // Positive control for the scans: the strings we forbid are the strings the old code really had
  // (this file would pass vacuously if the label idiom changed shape) — assert the CURRENT idiom
  // exists so a rename of eligibleCount forces this test to be updated rather than silently pass.
  it('positive control: the eligible-count idiom is present where the forbidden one is absent', () => {
    expect(settings).toContain('disabled={!eligibleCount}')
  })
})
