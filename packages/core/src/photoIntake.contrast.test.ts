import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

const view = readFileSync(
  new URL('../../../apps/web/src/components/PhotoIntake.tsx', import.meta.url),
  'utf8',
)
const tone = view.match(/<Surface\s+tone="([^"]+)"/)?.[1]
describe('photo evidence labels and review fields in every reading room', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const)
      it(`${skin}/${mode} preserves readable qualifications, identity and error text`, () => {
        const t = SKIN_TOKENS[`${skin}/${mode}`]
        expect(t).toBeDefined()
        expect(['card', 'card-solid']).toContain(tone)
        const card = parseColor(t.card)!,
          page = parseColor(t.bg0)!
        const painted =
          tone === 'card-solid'
            ? parseColor(t.cardSolid)!
            : ([
                card[0] * card[3] + page[0] * (1 - card[3]),
                card[1] * card[3] + page[1] * (1 - card[3]),
                card[2] * card[3] + page[2] * (1 - card[3]),
                1,
              ] as [number, number, number, number])
        // Fields are transparent, secondary buttons use card-solid; measure both painted pairs.
        for (const ink of [t.ink, t.muted])
          for (const background of [painted, parseColor(t.cardSolid)!])
            expect(contrastRatio(parseColor(ink)!, background)).toBeGreaterThanOrEqual(4.5)
      })
})
