import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

describe('editions and copies text and fields across all rooms', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const) {
      it(`${skin}/${mode} keeps edition labels, copy state and actions readable`, () => {
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
