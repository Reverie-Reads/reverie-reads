import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

describe('catalog metadata review text and fields across the skin registry', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const) {
      it(`${skin}/${mode} keeps evidence, labels, and actions readable`, () => {
        const tokens = SKIN_TOKENS[`${skin}/${mode}`]
        expect(tokens).toBeDefined()
        for (const fg of [tokens.ink, tokens.muted])
          for (const bg of [tokens.cardSolid, tokens.fieldOnCard]) {
            expect(contrastRatio(parseColor(fg)!, parseColor(bg)!)).toBeGreaterThanOrEqual(4.5)
          }
        expect(
          contrastRatio(parseColor(tokens.onPrimary)!, parseColor(tokens.accentFill)!),
        ).toBeGreaterThanOrEqual(4.5)
      })
    }
})
