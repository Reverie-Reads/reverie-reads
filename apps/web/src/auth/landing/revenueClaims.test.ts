import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Closes the loop on the revenue-copy guard.
//
// packages/core/src/revenueCopy.test.ts proves revenueCopy() tells the truth in both attribution
// modes. That is worth nothing if the landing page goes back to hardcoding "Midniht takes no cut"
// next to it — the copy would render regardless of mode and the core test would still pass. So this
// asserts the landing sources its money claims from revenueCopy() and states none of its own.

const SOURCE = readFileSync(join(__dirname, 'below-fold.tsx'), 'utf8')

/** Strip // and /* *\/ comments — the explanatory notes in that file legitimately discuss these
 *  phrases, and only what SHIPS to a reader matters here. */
const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NO_CUT_CLAIMS = [/takes no cut/i, /earns? nothing/i, /no commission/i]

describe('the landing states no money claim of its own', () => {
  it('derives its revenue copy from revenueCopy(buyConfig())', () => {
    expect(code).toMatch(/revenueCopy\(buyConfig\(\)\)/)
    expect(code).toMatch(/tag: MONEY\.tag/)
    expect(code).toMatch(/body: MONEY\.body/)
    expect(code).toMatch(/\{MONEY\.footer\}/)
  })

  it.each(NO_CUT_CLAIMS)('hardcodes no literal matching %s', (claim) => {
    expect(
      code,
      `below-fold.tsx hardcodes a revenue claim. It must come from revenueCopy(buyConfig()), ` +
        `or flipping VITE_BUY_ATTRIBUTION_MODE=affiliate would publish a false one.`,
    ).not.toMatch(claim)
  })
})
