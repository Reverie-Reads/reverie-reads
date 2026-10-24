/** Explicitly started, page-memory-only Add lookup counts. No reporter, storage or network. */
export type LookupResult = 'candidates' | 'empty' | 'unavailable' | 'cancelled' | 'unfinished'
export type EditionLookup =
  | 'not_requested'
  | 'exact'
  | 'empty'
  | 'identity_hold'
  | 'unavailable'
  | 'service_mismatch'
  | 'unresolved'
  | 'unobserved'
export interface LookupObservation {
  result: Exclude<LookupResult, 'unfinished'>
  edition: EditionLookup
  candidatesWithoutAuthor: boolean
}
const resultKeys: LookupResult[] = ['candidates', 'empty', 'unavailable', 'cancelled', 'unfinished']
const editionKeys: EditionLookup[] = [
  'not_requested',
  'exact',
  'empty',
  'identity_hold',
  'unavailable',
  'service_mismatch',
  'unresolved',
  'unobserved',
]
const zero = <T extends string>(keys: T[]) =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<T, number>
const blank = () => ({
  active: false,
  limit: 20,
  attempted: 0,
  pending: 0,
  queries: { text: 0, isbn: 0 },
  results: zero(resultKeys),
  editions: zero(editionKeys),
  candidatesWithoutAuthor: 0,
  latency: { under1s: 0, under3s: 0, under10s: 0, atLeast10s: 0, unobserved: 0 },
})
const freeze = (snapshot: ReturnType<typeof blank>) => {
  for (const value of Object.values(snapshot))
    if (value && typeof value === 'object') Object.freeze(value)
  return Object.freeze(snapshot)
}
export class IntakeLookupDiagnostics {
  private epoch = 0
  private snapshot = freeze(blank())
  private listeners = new Set<() => void>()
  constructor(private now: () => number = () => performance.now()) {}
  private readTime() {
    try {
      return this.now()
    } catch {
      return NaN
    }
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish() {
    this.snapshot = freeze(this.snapshot)
    for (const listener of this.listeners) {
      try {
        listener()
      } catch {
        /* diagnostics never interrupt Add */
      }
    }
  }
  start = () => {
    this.epoch++
    this.snapshot = { ...blank(), active: true }
    this.publish()
  }
  stop = () => {
    this.epoch++
    const s = this.snapshot
    this.snapshot = {
      ...s,
      active: false,
      pending: 0,
      results: { ...s.results, unfinished: s.results.unfinished + s.pending },
      editions: { ...s.editions, unobserved: s.editions.unobserved + s.pending },
      latency: { ...s.latency, unobserved: s.latency.unobserved + s.pending },
    }
    this.publish()
  }
  reset = () => {
    this.epoch++
    this.snapshot = blank()
    this.publish()
  }
  begin(kind: 'text' | 'isbn'): (observation: LookupObservation) => void {
    const s = this.snapshot
    if (!s.active || s.attempted >= s.limit || !['text', 'isbn'].includes(kind)) return () => {}
    const epoch = this.epoch
    const started = this.readTime()
    const attempted = s.attempted + 1
    this.snapshot = {
      ...s,
      attempted,
      pending: s.pending + 1,
      active: attempted < s.limit,
      queries: { ...s.queries, [kind]: s.queries[kind] + 1 },
    }
    this.publish()
    let finished = false
    return (o) => {
      if (finished || epoch !== this.epoch) return
      if (
        !o ||
        !['candidates', 'empty', 'unavailable', 'cancelled'].includes(o.result) ||
        !editionKeys.includes(o.edition) ||
        typeof o.candidatesWithoutAuthor !== 'boolean' ||
        Object.keys(o).length !== 3
      )
        return
      finished = true
      const current = this.snapshot
      const elapsed = this.readTime() - started
      const bucket =
        !Number.isFinite(elapsed) || elapsed < 0
          ? 'unobserved'
          : elapsed < 1000
            ? 'under1s'
            : elapsed < 3000
              ? 'under3s'
              : elapsed < 10000
                ? 'under10s'
                : 'atLeast10s'
      this.snapshot = {
        ...current,
        pending: current.pending - 1,
        results: { ...current.results, [o.result]: current.results[o.result] + 1 },
        editions: { ...current.editions, [o.edition]: current.editions[o.edition] + 1 },
        candidatesWithoutAuthor:
          current.candidatesWithoutAuthor + Number(o.candidatesWithoutAuthor),
        latency: { ...current.latency, [bucket]: current.latency[bucket] + 1 },
      }
      this.publish()
    }
  }
  export = () => ({
    version: 1,
    basis: 'explicit_local_add_lookup_session',
    scope: 'single_and_pasted_list_add_lookup_attempts',
    counts: structuredClone(this.snapshot),
    interpretation:
      'Attempts include retries; candidates and empty lookups do not establish book or edition correctness or catalog absence.',
    unobserved: [
      'correctWorkRetrieval',
      'correctEditionRetrieval',
      'confirmedBookAbsence',
      'confirmedEditionAbsence',
      'deliberateAddSuccess',
      'reviewRefusal',
      'correctionEffort',
      'acquisitionAndReviewCost',
      'importOutcomes',
      'latencyPercentiles',
      'providerFailureRate',
      'appWideReaderFailureRate',
    ],
  })
}
// Client-only SPA state. Disabled at load; account transitions discard it synchronously.
export const intakeLookupDiagnostics = new IntakeLookupDiagnostics()
