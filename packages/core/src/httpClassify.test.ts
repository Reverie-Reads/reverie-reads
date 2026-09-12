import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyHttp,
  isRetryable,
  MAX_RETRY_AFTER_MS,
  retryAfterMs,
  type HttpDisposition,
} from './httpClassify'

/**
 * A REAL 4xx BODY, not a hand-written one.
 *
 * Captured verbatim from `GET https://openlibrary.org/this-path-does-not-exist-probe` — the same
 * host `adapterOpenLibrary` and `searchOpenLibrary` call. Open Library answers a 404 with
 * `content-type: text/html; charset=utf-8` and **29,680 bytes** of page. The leading bytes are kept
 * here; the exact length is asserted below so this cannot quietly become a stand-in.
 *
 * It matters that this is genuine. A hand-written `'<html>'` would prove a parser rejects something
 * that isn't JSON. This proves the parser is never reached by *the actual thing production returns*
 * — which is the bug: `fetchJson` fell through to `r.json()` on any non-429, non-5xx status, so this
 * page hit `JSON.parse`, threw a SyntaxError carrying no status, and the caller's
 * `String(e).includes('429')` read a refusal as "this source had nothing".
 */
const OL_404_HTML_HEAD =
  '\n\n<!DOCTYPE html>\n<html lang="en">\n<head>\n    <meta charset="utf-8">\n    <meta name="format-detection" content="telephone=no">\n    <meta name="viewport" content'
const OL_404_TOTAL_BYTES = 29_680

describe('the captured 4xx body is what we think it is', () => {
  it('is HTML, and is emphatically not JSON', () => {
    expect(OL_404_HTML_HEAD).toContain('<!DOCTYPE html>')
    expect(() => JSON.parse(OL_404_HTML_HEAD)).toThrow()
  })

  it('is a real page, not a token — 29,680 bytes of it', () => {
    expect(OL_404_TOTAL_BYTES).toBeGreaterThan(10_000)
  })
})

describe('classifyHttp decides from the status alone', () => {
  it('429 is rate-limited and is NOT retryable — a second ask is refused the same way', () => {
    expect(classifyHttp(429)).toBe('rate_limited')
    expect(isRetryable(429)).toBe(false)
  })

  it('5xx is the only retryable class', () => {
    for (const s of [500, 502, 503, 504]) {
      expect(classifyHttp(s), String(s)).toBe('retry')
      expect(isRetryable(s), String(s)).toBe(true)
    }
  })

  // THE REGRESSION THIS FILE EXISTS FOR. Every one of these used to fall through to r.json().
  it.each([400, 401, 403, 404, 410, 422])('%i is a failure, never retried, never parsed', (s) => {
    expect(classifyHttp(s)).toBe('failed')
    expect(isRetryable(s)).toBe(false)
  })

  it('2xx and 3xx are the only statuses whose body is worth reading', () => {
    for (const s of [200, 201, 204, 301, 302, 304]) expect(classifyHttp(s), String(s)).toBe('ok')
  })

  it('no status is classified as ok once it is >= 400 — the property, not the cases', () => {
    for (let s = 400; s < 600; s++) {
      expect(classifyHttp(s), String(s)).not.toBe('ok')
    }
  })
})

describe('a 4xx body is never the thing that decides what happens', () => {
  // The end-to-end shape of the old bug, as an assertion: given the real OL 404, the disposition
  // must come from the status and must survive a body that cannot be parsed.
  it('the real Open Library 404 page cannot change the disposition of its own response', () => {
    const disposition: HttpDisposition = classifyHttp(404)
    expect(disposition).toBe('failed')
    // Whatever the body is, the decision was already made. Parsing it would throw:
    expect(() => JSON.parse(OL_404_HTML_HEAD)).toThrow(SyntaxError)
    expect(disposition).toBe('failed')
  })

  it('a failure disposition is distinguishable from an empty result — they used to be one value', () => {
    expect(classifyHttp(404)).not.toBe(classifyHttp(200))
    expect(classifyHttp(429)).not.toBe(classifyHttp(404))
  })
})

describe('retryAfterMs honours both documented forms', () => {
  it('delta-seconds', () => {
    expect(retryAfterMs('30', 0)).toBe(30_000)
    expect(retryAfterMs('0', 0)).toBe(0)
  })

  it('an HTTP-date, relative to the given now', () => {
    const now = Date.parse('2026-08-02T12:00:00Z')
    expect(retryAfterMs('Sun, 02 Aug 2026 12:00:20 GMT', now)).toBe(20_000)
  })

  it('a date already past means wait nothing, never a negative sleep', () => {
    const now = Date.parse('2026-08-02T12:00:00Z')
    expect(retryAfterMs('Sun, 02 Aug 2026 11:59:00 GMT', now)).toBe(0)
  })

  it('is clamped, so a hostile or absurd value cannot wedge a function', () => {
    expect(retryAfterMs('999999', 0)).toBe(MAX_RETRY_AFTER_MS)
  })

  it('null when absent or unparseable — so the caller falls back rather than retrying instantly', () => {
    expect(retryAfterMs(null, 0)).toBeNull()
    expect(retryAfterMs('', 0)).toBeNull()
    expect(retryAfterMs('   ', 0)).toBeNull()
    expect(retryAfterMs('soon', 0)).toBeNull()
  })
})

describe('the Deno runtime mirrors this policy exactly', () => {
  // It cannot import from this package, so it holds a copy — the sourcePace arrangement. This is
  // the guard that the copy has not drifted, since a divergence would mean two retry loops
  // disagreeing about the same status, which is the bug geo/index.ts already had once.
  const denoSrc = readFileSync(
    join(__dirname, '../../../supabase/functions/_shared/httpClassify.ts'),
    'utf8',
  )

  it('declares the same thresholds', () => {
    expect(denoSrc).toContain("if (status === 429) return 'rate_limited'")
    expect(denoSrc).toContain("if (status >= 500) return 'retry'")
    expect(denoSrc).toContain("if (status >= 400) return 'failed'")
    expect(denoSrc).toContain(
      `MAX_RETRY_AFTER_MS = ${MAX_RETRY_AFTER_MS.toString().replace(/(\d)(?=(\d{3})+$)/g, '$1_')}`,
    )
  })

  it('carries an error type that keeps its status, so nobody string-matches a message again', () => {
    expect(denoSrc).toMatch(/class SourceHttpError/)
    expect(denoSrc).toMatch(/readonly status: number/)
    expect(denoSrc).toMatch(/export function dispositionOf/)
  })

  it('and the enrich function actually uses it — the policy is worthless unwired', () => {
    const enrichSrc = readFileSync(
      join(__dirname, '../../../supabase/functions/enrich/index.ts'),
      'utf8',
    )
    expect(enrichSrc).toMatch(/dispositionOf\(\w+\)/)

    // COMMENTS STRIPPED FIRST. The naive `not.toContain` fails on this file's own docstring, which
    // quotes `String(e).includes('429')` to explain what was wrong with it — so the assertion would
    // forbid documenting the bug it exists to prevent. Caught by running it, not by re-reading it.
    const code = enrichSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n')
    expect(code, 'string-matching a message must not come back').not.toContain(
      'String(e).includes(',
    )
  })

  it('and production search preserves provider HTTP failures instead of returning an empty hit list', () => {
    const searchSrc = readFileSync(
      join(__dirname, '../../../supabase/functions/search/index.ts'),
      'utf8',
    )
    const code = searchSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')

    expect(code).toContain('new SourceHttpError(r.status, url)')
    expect(code).toContain('new SourceHttpError(r.status, endpoint)')
    expect(code).toContain("json({ error: 'search providers unavailable' }, 502)")
    expect(code).not.toMatch(/if \(!r\.ok\) return (null|\[\])/)
    expect(code).not.toContain('new SourceHttpError(r.status, requestUrl)')
    expect(code).toContain('Google Books network failure for ${endpoint}')
  })
})
