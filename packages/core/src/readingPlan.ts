import { formatPartialDate, hasDate } from './partialDate'
import type { Book } from './types'

export const READING_PLAN_POSITION_STEP = 1000

export type ReadingPlanBook = Pick<Book, 'id' | 'title' | 'plan' | 'planPosition' | 'addedTs'>

/** A position is deliberate queue membership. A dated pre-migration book remains a plan too. */
export function isReadingPlan(book: Pick<Book, 'plan' | 'planPosition'>): boolean {
  return book.planPosition != null || hasDate(book.plan)
}

function partialDateKey(book: Pick<Book, 'plan'>): number {
  if (!hasDate(book.plan)) return Number.MAX_SAFE_INTEGER
  return (book.plan.y ?? 0) * 10000 + (book.plan.m ?? 0) * 100 + (book.plan.d ?? 0)
}

/**
 * Queue order is total even during a rolling migration: explicit positions lead, then legacy dated
 * plans use their real precision, added time, title, and id. No missing month or day is invented.
 */
export function sortReadingPlans<T extends ReadingPlanBook>(books: readonly T[]): T[] {
  return books
    .filter(isReadingPlan)
    .slice()
    .sort((a, b) => {
      if (a.planPosition != null && b.planPosition != null) {
        const positioned = a.planPosition - b.planPosition
        if (positioned) return positioned
      } else if (a.planPosition != null) return -1
      else if (b.planPosition != null) return 1

      return (
        partialDateKey(a) - partialDateKey(b) ||
        a.addedTs - b.addedTs ||
        a.title.localeCompare(b.title) ||
        a.id.localeCompare(b.id)
      )
    })
}

function effectivePositions(books: readonly ReadingPlanBook[]): Map<string, number> {
  const positionedMax = Math.max(0, ...books.map((book) => book.planPosition ?? 0))
  let fallback = 0
  return new Map(
    books.map((book) => [
      book.id,
      book.planPosition ?? positionedMax + ++fallback * READING_PLAN_POSITION_STEP,
    ]),
  )
}

/** Append a new plan after every explicit and rolling-migration fallback entry. */
export function nextReadingPlanPosition(books: readonly ReadingPlanBook[]): number {
  const ordered = sortReadingPlans(books)
  const positions = effectivePositions(ordered)
  return (
    Math.max(0, ...ordered.map((book) => positions.get(book.id) ?? 0)) + READING_PLAN_POSITION_STEP
  )
}

/**
 * Return the single new position needed to move an item one visual slot. The other rows keep their
 * keys, so an interrupted or offline write cannot leave half a renumber persisted.
 */
export function movedReadingPlanPosition(
  books: readonly ReadingPlanBook[],
  index: number,
  direction: -1 | 1,
): number | null {
  const ordered = sortReadingPlans(books)
  const target = index + direction
  if (index < 0 || index >= ordered.length || target < 0 || target >= ordered.length) return null

  const positions = effectivePositions(ordered)
  const moved = ordered[index]!
  const rest = ordered.filter((book) => book.id !== moved.id)
  const previous = rest[target - 1]
  const next = rest[target]
  const previousPosition = previous ? positions.get(previous.id)! : null
  const nextPosition = next ? positions.get(next.id)! : null

  if (previousPosition == null && nextPosition == null) return READING_PLAN_POSITION_STEP
  if (previousPosition == null) return nextPosition! - READING_PLAN_POSITION_STEP
  if (nextPosition == null) return previousPosition + READING_PLAN_POSITION_STEP
  return (previousPosition + nextPosition) / 2
}

export function readingPlanDateLabel(book: Pick<Book, 'plan'>): string {
  return formatPartialDate(book.plan) || 'Soon'
}
