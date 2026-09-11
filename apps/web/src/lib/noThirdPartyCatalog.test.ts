import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The guarantee this PR makes, asserted rather than described: no client-side module reaches a
 * third-party CATALOG API. Every catalog lookup goes through an Edge Function, so the reader's
 * browser (and IP) is never handed to Google Books.
 *
 * Source-level, deliberately: `assert-dist-clean.mjs` makes the same assertion on the built bundle
 * (belt and braces — that one catches a dependency dragging it in), but this one fails in the unit
 * suite the moment someone writes the fetch, which is where it is cheapest to catch.
 *
 * Fonts are NOT in scope here — not because they are an accepted external leg (they no longer
 * are: self-hosted since #288, with their own stricter dist guard), but because this test's
 * subject is the CATALOG surface: the books API and its bundled key.
 */
const SRC = join(process.cwd(), 'src')
const FORBIDDEN = [/www\.googleapis\.com\/books/i, /VITE_GOOGLE_BOOKS_KEY/]

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|tsx)$/.test(p)) yield p
  }
}

describe('no client-side third-party catalog leg', () => {
  it('no source file fetches the Google Books volumes API or reads its key', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      if (file.endsWith('noThirdPartyCatalog.test.ts')) continue
      const text = readFileSync(file, 'utf8')
      for (const re of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${file.replace(SRC, 'src')} :: ${re}`)
      }
    }
    expect(
      offenders,
      'A client-side Google Books leg is back. Route explicit reader search through the `search` ' +
        'Edge Function instead — see lib/search.ts and lib/discover.ts for why the browser must ' +
        'not make this request.',
    ).toEqual([])
  })
})
