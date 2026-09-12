import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The Open Library identity guard: every OL outbound call in the enrich and covers functions must
// carry the identified-tier User-Agent, because ONE anonymous call site re-classifies the whole
// egress IP back to 1 req/s while sourcePace goes on spending the 3 req/s budget the header no
// longer buys. The budget (SOURCE_BUDGETS['ol-search'] = 180/60s) is only lawful while the header
// ships — this file is what ties them together.
//
// WHAT THIS CANNOT DO, STATED PLAINLY (same posture as sourcePace.test.ts): no Deno runner exists
// here, so nothing below executes a fetch and proves the header reached the wire. What it does
// instead is make the SOURCE tell a checkable story: a REGISTRY of every `openlibrary.org`
// occurrence across the enrich/covers/_shared sources, each classified as either a fetch site
// (must carry olHeaders) or declared data-only WITH its reason — the ownedTables principle: an
// exclusion without a written reason is the bug. A new OL call site that isn't registered fails
// loudly; so does a registered fetch site that drops the header.

const FUNCTIONS = join(__dirname, '..', '..', '..', 'supabase', 'functions')
const read = (rel: string): string => readFileSync(join(FUNCTIONS, rel), 'utf8')

/** Every line of `src` containing `openlibrary.org`, with 1-based numbers, comments included —
 *  comments are inventoried too (cheap) so a new mention anywhere forces a conscious registration. */
const olLines = (src: string): { n: number; text: string }[] =>
  src
    .split('\n')
    .map((text, i) => ({ n: i + 1, text }))
    .filter(({ text }) => text.toLowerCase().includes('openlibrary.org'))

// ── The registry. Every file that may mention openlibrary.org, and in what capacity. ───────────
// `fetches`: how many OL-URL fetch sites the file holds (each verified to carry olHeaders below).
// `dataOnly`: substrings expected on non-fetch lines, each with the reason it needs no header.
const REGISTRY: Record<
  string,
  { fetches: number; dataOnly: { marker: string; reason: string }[] }
> = {
  'enrich/index.ts': {
    // One olJson gateway for search, exact edition and every author lookup.
    fetches: 1,
    dataOnly: [],
  },
  'enrich/merge.ts': {
    fetches: 0,
    dataOnly: [
      {
        marker: 'covers.openlibrary.org/b/id/',
        reason:
          'normalizeOpenLibrary BUILDS a cover URL as record data for the client/cache — nothing fetches it server-side',
      },
    ],
  },
  'covers/index.ts': {
    // fetchSource fetches reader-supplied URLs (which can be covers.openlibrary.org) — verified to
    // carry olHeaders separately below, since the URL is dynamic and never literally "openlibrary".
    fetches: 0,
    dataOnly: [],
  },
  '_shared/coverUrl.ts': {
    fetches: 0,
    dataOnly: [
      {
        marker: 'covers\\.openlibrary\\.org',
        reason: 'the size-suffix rewrite regex — URL surgery, not a request',
      },
    ],
  },
  '_shared/sourcePace.ts': {
    fetches: 0,
    dataOnly: [
      { marker: 'covers.openlibrary.org', reason: 'budget documentation comment' },
      { marker: 'openlibrary.org/search', reason: 'budget documentation comment' },
    ],
  },
  '_shared/olIdentity.ts': {
    fetches: 0,
    dataOnly: [{ marker: 'openlibrary.org', reason: 'the identity module’s own doc comment' }],
  },
  '_shared/publicRemoteUrl.ts': {
    fetches: 0,
    dataOnly: [
      {
        marker: 'covers.openlibrary.org',
        reason: 'the exact trusted-origin classifier; the actual fetch remains in covers/index.ts',
      },
    ],
  },
}

/** Files under enrich/, covers/ and _shared/ — the scan surface the registry must cover. */
const scanSurface = (): string[] => {
  const out: string[] = []
  for (const dir of ['enrich', 'covers', '_shared']) {
    for (const f of readdirSync(join(FUNCTIONS, dir))) {
      if (f.endsWith('.ts')) out.push(`${dir}/${f}`)
    }
  }
  return out
}

describe('the OL identity itself', () => {
  const src = read('_shared/olIdentity.ts')

  it('carries the app name, the domain, and a contact email — the two things the tier requires', () => {
    const m = /export const OL_UA = '([^']+)'/.exec(src)
    expect(m, 'OL_UA must be a single-quoted string constant').toBeTruthy()
    const ua = m![1]!
    expect(ua).toMatch(/^Reverie \(reveriereads\.app; [^@\s]+@[^@\s]+\.[a-z]+\)$/)
    expect(ua).toContain('contact@reveriereads.app')
  })

  it('olHeaders always includes the User-Agent, and caller extras cannot drop it', () => {
    // The header is spread FIRST and the constant is the value — an extra key can add Accept etc.,
    // and even a caller passing its own User-Agent would have to do so by name, visibly.
    expect(src).toMatch(/'User-Agent': OL_UA/)
  })
})

describe('every openlibrary.org occurrence is registered — fetch site or declared data-only', () => {
  it('the registry covers the scan surface exactly (no unregistered file mentions OL)', () => {
    for (const rel of scanSurface()) {
      const lines = olLines(read(rel))
      if (!(rel in REGISTRY)) {
        expect(
          lines,
          `${rel} mentions openlibrary.org but is not in the guard registry — classify it: a fetch site (must carry olHeaders) or data-only (say why)`,
        ).toEqual([])
      }
    }
  })

  it('positive control: the scanner sees the known OL surface (a path typo cannot pass vacuously)', () => {
    const total = scanSurface().reduce((n, rel) => n + olLines(read(rel)).length, 0)
    expect(total).toBeGreaterThanOrEqual(6)
  })

  it('enrich/index.ts: exactly the registered fetch sites, every one through olHeaders()', () => {
    const src = read('enrich/index.ts')
    // Search, edition and contributor requests share one identified gateway. Handler tests
    // additionally inspect actual outbound headers so a source-pattern count is not the only check.
    expect((src.match(/fetchJson\(`https:\/\/openlibrary\.org/g) ?? []).length).toBe(
      REGISTRY['enrich/index.ts']!.fetches,
    )
    expect(src).toMatch(
      /fetchJson\(`https:\/\/openlibrary\.org\$\{path\}`, \{ headers: olHeaders\(\) \}\)/,
    )
  })

  it('covers/index.ts: the source-image fetch carries olHeaders (it can hit covers.openlibrary.org)', () => {
    const src = read('covers/index.ts')
    expect(src).toMatch(
      /fetchPublicRemote\([\s\S]*?url,[\s\S]*?\{ headers: olHeaders\(\{ Accept: 'image\/\*' \}\) \}/,
    )
  })

  it('data-only registrations still exist where declared (a stale registry row is itself a failure)', () => {
    for (const [rel, entry] of Object.entries(REGISTRY)) {
      const src = read(rel)
      for (const d of entry.dataOnly) {
        expect(src, `${rel}: expected data-only marker "${d.marker}" (${d.reason})`).toContain(
          d.marker,
        )
      }
    }
  })
})
