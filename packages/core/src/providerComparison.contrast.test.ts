import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

describe('provider comparison observation and conflict text', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const)
      it(`${skin}/${mode} keeps plain-text statuses readable without color-only distinctions`, () => {
        const t = SKIN_TOKENS[`${skin}/${mode}`]
        for (const fg of [t.ink, t.muted])
          expect(contrastRatio(parseColor(fg)!, parseColor(t.cardSolid)!)).toBeGreaterThanOrEqual(
            4.5,
          )
      })
})
