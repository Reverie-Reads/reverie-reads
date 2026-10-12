import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

describe('Quick Add overview, navigation and expand control in every room', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const) {
      it(`${skin}/${mode} keeps draft information and keyboard focus readable`, () => {
        const t = SKIN_TOKENS[`${skin}/${mode}`]
        expect(t).toBeDefined()
        // book-add-overview and the shared secondary action use card-solid;
        // the active section uses field. These are the rendered foreground/background pairs.
        for (const foreground of [t.ink, t.muted])
          for (const background of [t.cardSolid, t.fieldOnCard])
            expect(
              contrastRatio(parseColor(foreground)!, parseColor(background)!),
            ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(parseColor(t.accentInk)!, parseColor(t.cardSolid)!),
        ).toBeGreaterThanOrEqual(3)
      })
    }
})
