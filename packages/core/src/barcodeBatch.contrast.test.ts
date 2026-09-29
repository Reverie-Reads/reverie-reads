import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

describe('barcode capture controls across every room', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const) {
      it(`${skin}/${mode}: labels, focus and borders are visible on the solid panel`, () => {
        const t = SKIN_TOKENS[`${skin}/${mode}`]
        expect(t).toBeDefined()
        expect(contrastRatio(parseColor(t.ink)!, parseColor(t.cardSolid)!)).toBeGreaterThanOrEqual(
          4.5,
        )
        expect(
          contrastRatio(parseColor(t.muted)!, parseColor(t.cardSolid)!),
        ).toBeGreaterThanOrEqual(3)
      })
    }
})
