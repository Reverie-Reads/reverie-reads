import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

// Reflect paints its journal on the page and on opaque card surfaces. Its book-stack and bar marks
// are decorative: every value also has a visible ink/muted label and an accessible button name.
const css = readFileSync(
  new URL('../../../apps/web/src/stats/reflect.css', import.meta.url),
  'utf8',
)
describe('Reflect text and chart marks across every reading room', () => {
  it('keeps meaning in tested text tokens instead of a colour-only chart mark', () => {
    const view = readFileSync(
      new URL('../../../apps/web/src/stats/ReflectScreen.tsx', import.meta.url),
      'utf8',
    )
    expect(view).not.toContain('text-primary')
    expect(view).toContain('aria-label={`${MONTH_ABBR[index]}: ${reads.length} logged reads`}')
    expect(view).toContain('aria-label={`${entry.label} ${entry.records.length}')
    expect(css).toContain('color: var(--ink)')
    expect(css).toContain('color: var(--muted)')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const) {
      it(`${skin}/${mode} keeps journal text and figures readable`, () => {
        const tokens = SKIN_TOKENS[`${skin}/${mode}`]
        expect(tokens).toBeDefined()
        for (const foreground of [tokens.ink, tokens.muted])
          for (const background of [tokens.bg0, tokens.cardSolid]) {
            expect(
              contrastRatio(parseColor(foreground)!, parseColor(background)!),
            ).toBeGreaterThanOrEqual(4.5)
          }
      })
    }
})
