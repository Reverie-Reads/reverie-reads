import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

// Reflect paints its journal directly on the page; dialogs use the existing card surface.
// Chart marks use the same muted token as text, with a visible numeric label on every mark.
const css = readFileSync(
  new URL('../../../apps/web/src/stats/reflect.css', import.meta.url),
  'utf8',
)
describe('Reflect text and chart marks across every reading room', () => {
  it('keeps both chart marks bound to the tested token', () => {
    const view = readFileSync(
      new URL('../../../apps/web/src/stats/ReflectScreen.tsx', import.meta.url),
      'utf8',
    )
    expect(view).not.toContain('text-primary')
    expect(css.match(/background: var\(--muted\)/g)).toHaveLength(2)
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
