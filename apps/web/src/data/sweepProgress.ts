/**
 * How a long sweep counts itself on screen — one rule, because the library-tools sweeps render their
 * count in FOUR places (a Stop button and a running sentence, for each of "complete" and "sharpen")
 * and they must not disagree.
 *
 * ── The false zero this exists to prevent ───────────────────────────────────────────────────────
 * `runComplete` used to seed `{ scanned: 0, total: 0 }` before calling `bulkComplete`, and
 * `bulkComplete` emitted its first progress only at the BOTTOM of the loop body — after the first
 * book's whole round trip (a select of every enriched_at, an enrich call, maybe a Storage ingest, an
 * update). The real total was known before the loop and simply withheld until then. So for that
 * whole window the button read "Stop (0/0)": a Stop label, which implies the run started, next to
 * a count that says it found nothing — at the exact moment a reader has committed to a run that now
 * takes 20+ minutes under server-side pacing. It corrected itself, which made it a lie rather than a
 * bug you could see.
 *
 * A NULL total means "not counted yet" and is the only honest thing to say before the select
 * returns. It is NOT the same as a total of zero, which is a real answer: every candidate is inside
 * its recheck window, so there is genuinely nothing due. Both render without a denominator, for
 * different reasons — you cannot divide by a count you don't have, and you cannot divide by zero.
 */

/** The counted part of any sweep's progress. `total: null` = not counted yet. */
export interface SweepCount {
  scanned: number
  total: number | null
}

/**
 * The count to show mid-run: `3/120` once the denominator is real, `starting…` before it is, and a
 * bare scanned count when the total is zero.
 *
 * Never returns a string containing a zero denominator — that is the property the guard test pins.
 */
export function sweepCountText(p: SweepCount | null): string {
  if (!p || p.total === null) return 'starting…'
  // A zero total is a real answer ("nothing is due"), but `0/0` reads as failure. Show the scanned
  // count alone; the run ends immediately and the status line says "checked 0 of 0" in full words.
  if (p.total <= 0) return String(p.scanned)
  return `${p.scanned}/${p.total}`
}
