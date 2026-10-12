import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

describe('Administrator corpus selection in every room', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const) {
      it(`${skin}/${mode} keeps selected and shared values readable`, () => {
        const t = SKIN_TOKENS[`${skin}/${mode}`]
        expect(t).toBeDefined()
        // The native Modal uses card-solid; rows retain it for current/proposed values.
        for (const foreground of [t.ink, t.muted])
          expect(
            contrastRatio(parseColor(foreground)!, parseColor(t.cardSolid)!),
          ).toBeGreaterThanOrEqual(4.5)
      })
    }
})
