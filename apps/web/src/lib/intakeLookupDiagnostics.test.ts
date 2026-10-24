import { describe, expect, it, vi } from 'vitest'
import { IntakeLookupDiagnostics } from './intakeLookupDiagnostics'
const observation = {
  result: 'candidates' as const,
  edition: 'not_requested' as const,
  candidatesWithoutAuthor: false,
}
describe('explicit local Add diagnostic sessions', () => {
  it('is inert until explicitly started and keeps no per-attempt record', () => {
    const clock = vi.fn(() => 0),
      d = new IntakeLookupDiagnostics(clock)
    d.begin('text')(observation)
    expect(d.getSnapshot().attempted).toBe(0)
    expect(clock).not.toHaveBeenCalled()
    expect(d.export()).not.toHaveProperty('events')
  })
  it('keeps all attempts in the denominator, including failures, cancellation and unfinished work', () => {
    const d = new IntakeLookupDiagnostics(() => 0)
    d.start()
    for (const result of ['candidates', 'empty', 'unavailable', 'cancelled'] as const)
      d.begin('text')({ ...observation, result })
    const late = d.begin('isbn')
    d.stop()
    late({ ...observation, edition: 'exact' })
    const s = d.getSnapshot()
    expect(s.attempted).toBe(5)
    expect(s.pending).toBe(0)
    expect(s.results).toEqual({
      candidates: 1,
      empty: 1,
      unavailable: 1,
      cancelled: 1,
      unfinished: 1,
    })
    expect(Object.values(s.editions).reduce((a, b) => a + b, 0)).toBe(5)
    expect(Object.values(s.latency).reduce((a, b) => a + b, 0)).toBe(5)
  })
  it('caps concurrent admission at 20 and still settles admitted work after the cap stops entry', () => {
    const d = new IntakeLookupDiagnostics(() => 0)
    d.start()
    const finish = Array.from({ length: 22 }, () => d.begin('text'))
    expect(d.getSnapshot()).toMatchObject({ active: false, attempted: 20, pending: 20 })
    finish.forEach((f) => f(observation))
    expect(d.getSnapshot()).toMatchObject({
      attempted: 20,
      pending: 0,
      results: { candidates: 20 },
    })
  })
  it('does not count duplicate completions or late work in a replacement session', () => {
    const d = new IntakeLookupDiagnostics(() => 0)
    d.start()
    const old = d.begin('isbn')
    d.reset()
    d.start()
    const current = d.begin('text')
    old({ ...observation, edition: 'exact' })
    current(observation)
    current(observation)
    expect(d.getSnapshot()).toMatchObject({
      attempted: 1,
      pending: 0,
      editions: { exact: 0 },
      results: { candidates: 1 },
    })
  })
  it('exports only immutable counts and labels unsupported metrics unobserved', () => {
    const d = new IntakeLookupDiagnostics(() => 0)
    d.start()
    const finish = d.begin('text')
    finish({ ...observation, title: 'PRIVATE TITLE' } as never)
    expect(d.getSnapshot().pending).toBe(1)
    finish(observation)
    expect(() => Object.assign(d.getSnapshot().queries, { 'PRIVATE QUERY': 1 })).toThrow()
    const report = d.export()
    expect(JSON.stringify(report)).not.toContain('PRIVATE')
    expect(report.unobserved).toContain('deliberateAddSuccess')
    expect(report.unobserved).toContain('confirmedBookAbsence')
    report.counts.results.empty = 19
    expect(d.getSnapshot().results.empty).toBe(0)
  })
  it('records bounded latency buckets, including invalid clocks, without breaking a lookup', () => {
    let now = 0
    const d = new IntakeLookupDiagnostics(() => now)
    d.start()
    for (const duration of [999, 1000, 3000, 10000, -1]) {
      now = 0
      const finish = d.begin('text')
      now = duration
      finish(observation)
    }
    expect(d.getSnapshot().latency).toEqual({
      under1s: 1,
      under3s: 1,
      under10s: 1,
      atLeast10s: 1,
      unobserved: 1,
    })
    const broken = new IntakeLookupDiagnostics(() => {
      throw new Error('clock unavailable')
    })
    broken.start()
    broken.subscribe(() => {
      throw new Error('observer failed')
    })
    expect(() => broken.begin('text')(observation)).not.toThrow()
    expect(broken.getSnapshot().latency.unobserved).toBe(1)
  })
})
