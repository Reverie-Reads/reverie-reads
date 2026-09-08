import { describe, expect, it } from 'vitest'
import type { Book } from './types'
import {
  isReadingPlan,
  movedReadingPlanPosition,
  nextReadingPlanPosition,
  readingPlanDateLabel,
  sortReadingPlans,
} from './readingPlan'

type PlanBook = Pick<Book, 'id' | 'title' | 'plan' | 'planPosition' | 'addedTs'>

const plan = (
  id: string,
  position: number | null | undefined,
  date: Book['plan'] = { y: null, m: null, d: null },
): PlanBook => ({ id, title: id, plan: date, planPosition: position, addedTs: 1 })

describe('reading plan', () => {
  it('distinguishes a deliberate Soon entry from a book with no plan', () => {
    expect(isReadingPlan(plan('none', null))).toBe(false)
    expect(isReadingPlan(plan('soon', 1000))).toBe(true)
    expect(readingPlanDateLabel(plan('soon', 1000))).toBe('Soon')
  })

  it('keeps a dated rolling-migration row visible without silently admitting undated rows', () => {
    const dated = plan('dated', null, { y: 2027, m: 3, d: null })
    expect(isReadingPlan(dated)).toBe(true)
    expect(readingPlanDateLabel(dated)).toBe('Mar 2027')
  })

  it('uses explicit preference before dates and totally orders legacy rows', () => {
    const result = sortReadingPlans([
      plan('legacy-later', null, { y: 2028, m: null, d: null }),
      plan('second', 2000),
      plan('first', 1000, { y: 2030, m: null, d: null }),
      plan('legacy-sooner', null, { y: 2027, m: null, d: null }),
      plan('not-planned', null),
    ])
    expect(result.map((book) => book.id)).toEqual([
      'first',
      'second',
      'legacy-sooner',
      'legacy-later',
    ])
  })

  it('appends after positioned and legacy entries', () => {
    expect(
      nextReadingPlanPosition([
        plan('first', 1000),
        plan('legacy', null, { y: 2027, m: null, d: null }),
      ]),
    ).toBe(3000)
  })

  it('moves one row between its new neighbours without renumbering the queue', () => {
    const books = [plan('a', 1000), plan('b', 2000), plan('c', 3000), plan('d', 4000)]
    expect(movedReadingPlanPosition(books, 2, -1)).toBe(1500)
    expect(movedReadingPlanPosition(books, 1, 1)).toBe(3500)
    expect(movedReadingPlanPosition(books, 0, -1)).toBeNull()
  })
})
