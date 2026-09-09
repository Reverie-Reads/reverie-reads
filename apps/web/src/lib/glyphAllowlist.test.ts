import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ALL_DECLARED_GLYPHS, GLYPH_TIERS, isWatchedGlyph } from './glyphAllowlist'

// THE PROPERTY: every symbol-range character shipping in the app is a CONSCIOUS, DECLARED choice —
// not a silent addition. `⏻` (U+23FB POWER SYMBOL) reached the sign-out button and rendered as
// tofu on Android Chrome, and nothing before this caught it because nothing was watching that
// class of character. This scans the real source tree — not a restated list — so a future glyph
// gets the same check ⏻ never had.

const SRC = join(__dirname, '../..')

/** Every non-test .ts/.tsx file under apps/web/src, recursively. */
function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (
      /\.(ts|tsx)$/.test(entry.name) &&
      !/\.test\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.endsWith('.fixture.ts')
    ) {
      out.push(full)
    }
  }
  return out
}

/** Every watched-range character actually present in the source, with one file each it appears in. */
function scanForWatchedGlyphs(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of sourceFiles(join(SRC, 'src'))) {
    const text = readFileSync(file, 'utf8')
    for (const ch of text) {
      if (isWatchedGlyph(ch) && !found.has(ch)) {
        found.set(ch, file.replace(SRC, 'apps/web'))
      }
    }
  }
  return found
}

describe('every symbol glyph shipping in the app is declared somewhere', () => {
  it('has no character in a watched Unicode range that is absent from the allowlist', () => {
    const found = scanForWatchedGlyphs()
    const undeclared = [...found.entries()].filter(([ch]) => !ALL_DECLARED_GLYPHS.has(ch))

    expect(
      undeclared,
      undeclared
        .map(
          ([ch, file]) => `  U+${ch.codePointAt(0)!.toString(16).toUpperCase()} '${ch}' in ${file}`,
        )
        .join('\n'),
    ).toEqual([])
  })

  // THE REGRESSION THIS FILE EXISTS FOR: the exact character that caused it must never be
  // reachable by an undeclared-glyph check passing silently — it has to be gone from source, or
  // explicitly declared and therefore flagged for anyone reading this file.
  it('U+23FB (the power symbol that caused the bug) is not present anywhere in source', () => {
    const found = scanForWatchedGlyphs()
    expect(found.has('⏻'), 'the fixed glyph must not have come back').toBe(false)
  })

  it('ships no text glyph from the power-symbol risk blocks', () => {
    const risky = [...scanForWatchedGlyphs()].filter(([ch]) => {
      const cp = ch.codePointAt(0)!
      return (cp >= 0x2300 && cp <= 0x23ff) || (cp >= 0x2800 && cp <= 0x28ff)
    })
    expect(risky).toEqual([])
  })

  // THE POSITIVE CONTROL. A scanner that returned nothing would pass every assertion above
  // vacuously — an "undeclared glyph" test with zero candidates to check is not a passing test,
  // it's a test that never ran. This is what would have caught `isWatchedGlyph` short-circuiting
  // to `return false`: the scan finding zero glyphs anywhere in a ~500-file source tree.
  it('the scanner actually finds glyphs — a proven one known to be in source', () => {
    const found = scanForWatchedGlyphs()
    expect(found.size, 'a scan of the real source tree found nothing at all').toBeGreaterThan(20)
    expect(found.has('→'), "'→' is used ~178 times and must be found").toBe(true)
  })

  it('the sign-out control no longer renders the power symbol as text', () => {
    const shell = readFileSync(join(SRC, 'src/components/AppShell.tsx'), 'utf8')
    expect(shell).not.toContain('⏻')
    expect(shell).toContain('PowerGlyph')
  })
})

describe('tier hygiene', () => {
  it('no glyph is declared in more than one tier', () => {
    const seen = new Map<string, string>()
    for (const [tier, entries] of Object.entries(GLYPH_TIERS)) {
      for (const ch of Object.keys(entries)) {
        expect(seen.has(ch), `${ch} already declared in ${seen.get(ch)}, also in ${tier}`).toBe(
          false,
        )
        seen.set(ch, tier)
      }
    }
  })

  it('every declared glyph carries a non-empty reason', () => {
    for (const entries of Object.values(GLYPH_TIERS)) {
      for (const [ch, reason] of Object.entries(entries)) {
        expect(reason.trim().length, `${ch} has an empty reason`).toBeGreaterThan(0)
      }
    }
  })

  it('proven glyphs are drawn only from Arrows, Math Operators, or the emoji ranges', () => {
    // The proven tier's whole claim is "these blocks are safe" — a glyph from any other block
    // sitting in this tier would be an unverified claim wearing a verified label.
    for (const ch of Object.keys(GLYPH_TIERS.proven)) {
      const cp = ch.codePointAt(0)!
      const inArrows = cp >= 0x2190 && cp <= 0x21ff
      const inMathOps = cp >= 0x2200 && cp <= 0x22ff
      expect(
        inArrows || inMathOps,
        `U+${cp.toString(16).toUpperCase()} '${ch}' is not Arrows/Math Operators`,
      ).toBe(true)
    }
  })

  it('sameRiskAsPowerSymbol glyphs are drawn only from Misc Technical or Braille Patterns', () => {
    for (const ch of Object.keys(GLYPH_TIERS.sameRiskAsPowerSymbol)) {
      const cp = ch.codePointAt(0)!
      const inMiscTechnical = cp >= 0x2300 && cp <= 0x23ff
      const inBraille = cp >= 0x2800 && cp <= 0x28ff
      expect(
        inMiscTechnical || inBraille,
        `U+${cp.toString(16).toUpperCase()} '${ch}' is not Misc Technical/Braille`,
      ).toBe(true)
    }
  })

  // THE REVERSE CHECK. ⌂ (U+2302 HOUSE) was first drafted into `unverified` on confidence — it
  // "felt" more broadly shipped than the power symbol — even though it sits in the exact same
  // Misc Technical block. This is what would have caught that: tier placement has to follow the
  // block, not a feeling about it.
  it('nothing in unverified is actually inside the same-risk blocks', () => {
    for (const ch of Object.keys(GLYPH_TIERS.unverified)) {
      const cp = ch.codePointAt(0)!
      const inMiscTechnical = cp >= 0x2300 && cp <= 0x23ff
      const inBraille = cp >= 0x2800 && cp <= 0x28ff
      expect(
        inMiscTechnical || inBraille,
        `U+${cp.toString(16).toUpperCase()} '${ch}' is in a same-risk block but tiered as merely unverified`,
      ).toBe(false)
    }
  })
})
