// Per-stage wall-clock timing for the enrichment sweep.
//
// ORDERED SPANS, NOT A TOTALS MAP. `ol-search` is consumed TWICE per book — once by the 3a title
// search, once by the 3b adapter — and the two cost very different amounts: the first pays whatever
// gap is left over from the previous book, the second pays a gap measured from the first, moments
// earlier in the same request. Summing them into one `ol-search: 1400ms` is exactly what hides the
// answer. So spans are a list, in call order, with repeats kept apart.
//
// ALWAYS COLLECTED, CONDITIONALLY RETURNED. Timing is a `performance.now()` pair per span — tens of
// nanoseconds against stages measured in hundreds of milliseconds. Collecting unconditionally means
// a traced request and an untraced one execute the identical code path, so the measurement cannot be
// distorted by the act of asking for it. Only the serialization into the response is gated.

export interface Span {
  /** dotted stage name, e.g. `pace.ol-search.wait` | `fetch.google` | `normalize.decode.source` */
  s: string
  ms: number
}

export class Trace {
  readonly spans: Span[] = []

  /** Record a span that was timed by the caller. */
  mark(stage: string, ms: number): void {
    this.spans.push({ s: stage, ms: Math.round(ms * 10) / 10 })
  }

  /** Time an async stage, recording it even if it throws (a failed fetch still cost wall time). */
  async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
    const t0 = performance.now()
    try {
      return await fn()
    } finally {
      this.mark(stage, performance.now() - t0)
    }
  }

  /** Time a synchronous stage — the magick-wasm decodes, which are CPU and not awaited. */
  sync<T>(stage: string, fn: () => T): T {
    const t0 = performance.now()
    try {
      return fn()
    } finally {
      this.mark(stage, performance.now() - t0)
    }
  }

  totalMs(): number {
    return Math.round(this.spans.reduce((a, s) => a + s.ms, 0) * 10) / 10
  }
}

/** True when the caller asked for timings back. Any other value leaves the response shape unchanged. */
export const wantsTrace = (input: unknown): boolean =>
  !!input && typeof input === 'object' && (input as { trace?: unknown }).trace === true
