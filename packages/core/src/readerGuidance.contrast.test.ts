import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

// Welcome choices and guide instructions use ink/muted on the page and opaque cards;
// their primary actions use onPrimary/accentFill. Check every room and both modes.
describe('Reader guidance remains readable in every room', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const) {
      it(`${skin}/${mode} preserves small instructions and action labels`, () => {
        const tokens = SKIN_TOKENS[`${skin}/${mode}`]
        expect(tokens).toBeDefined()
        for (const foreground of [tokens.ink, tokens.muted])
          for (const background of [tokens.bg0, tokens.cardSolid])
            expect(
              contrastRatio(parseColor(foreground)!, parseColor(background)!),
            ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(parseColor(tokens.onPrimary)!, parseColor(tokens.accentFill)!),
        ).toBeGreaterThanOrEqual(4.5)
      })
    }
})
