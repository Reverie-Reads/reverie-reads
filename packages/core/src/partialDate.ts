import type { PartialDate } from './types'

/**
 * Month abbreviations, canonical. Lives here rather than in the web app because `formatPartialDate`
 * needs it and that function must be testable without a browser; `apps/web` re-exports it as
 * `MONTHS` so its calendar and stats labels keep the name they already use. One list, not two.
 */
export const MONTH_ABBR = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/** A date the reader has said nothing about. A factory, not a shared constant — callers store it. */
export function emptyDate(): PartialDate {
  return { y: null, m: null, d: null }
}

/** Validate a publication tuple without inventing missing precision. */
export function validPublicationDate(p: PartialDate | null | undefined): boolean {
  if (!p || !Number.isInteger(p.y) || p.y! < 1 || p.y! > 9999) return false
  if (p.m == null) return p.d == null
  if (!Number.isInteger(p.m) || p.m < 1 || p.m > 12) return false
  if (p.d == null) return true
  if (!Number.isInteger(p.d) || p.d < 1) return false
  const y = p.y!
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)
  return p.d <= ([31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][p.m - 1] ?? 0)
}

/** Has the reader stated anything at all? Precision below the year is meaningless without one. */
export function hasDate(p: PartialDate | null | undefined): boolean {
  return !!p && p.y != null
}

/**
 * Render a partial date at the highest precision it actually carries: `Mar 14, 2026`, `Mar 2026`,
 * `2026`, or `''`.
 *
 * REPLACES TWO DIVERGED COPIES of `fmtPub` (BookDetailRoute and PlannerRoute). They differed on one
 * thing — the guard on the month lookup:
 *
 *   BookDetailRoute:  `${MONTHS[p.m - 1] ?? ''} ${p.y}`   → an out-of-range month renders ' 2026'
 *   PlannerRoute:     `${MONTHS[p.m - 1]} ${p.y}`         → the same input renders 'undefined 2026'
 *
 * Neither is kept verbatim. The unguarded one can print `undefined` to a reader, which is strictly
 * worse; the guarded one prints a stray leading space, which is merely quieter about the same
 * broken data. So the rule here is one step further and states itself: render at the highest
 * precision whose parts are RENDERABLE. An unusable month falls back to the year alone rather than
 * emitting a blank where a name should be.
 *
 * Unreachable through stored data today — `books_pub_m_check` and `books_plan_m_check` both bound
 * the column to 1..12 — so this is about what the function does when handed a month the database
 * would have refused, which is exactly the case the two copies disagreed on.
 */
export function formatPartialDate(p: PartialDate | null | undefined): string {
  if (!p || p.y == null) return ''
  const month = p.m != null ? MONTH_ABBR[p.m - 1] : undefined
  if (month && p.d != null) return `${month} ${p.d}, ${p.y}`
  if (month) return `${month} ${p.y}`
  return String(p.y)
}
