import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contrastRatio, mixSrgb, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS } from './skinTokens.fixture'

const css = readFileSync(join(__dirname, '../../../apps/web/src/styles/tokens.css'), 'utf8')
const appearance = readFileSync(
  join(__dirname, '../../../apps/web/src/design/beardAppearance.ts'),
  'utf8',
)
const palette = Object.fromEntries(
  [...css.matchAll(/(--beard-[a-z-]+):\s*(#[a-f0-9]+);/g)].map((m) => [m[1], m[2]]),
)
const colors = [...appearance.matchAll(/hair:\s*'(--[^']+)',\s*ground:\s*'(--[^']+)'/g)].map(
  (m) => [m[1]!, m[2]!] as const,
)
const rainbowStops = [
  ...new Set([...appearance.matchAll(/'(--beard-rainbow-[a-z]+)'/g)].map((m) => m[1]!)),
]

describe('Bearded Mode choices, tasks and portraits across every room', () => {
  for (const skin of Object.keys(SKINS) as SkinId[])
    for (const mode of ['light', 'dark'] as const)
      it(`${skin}/${mode}: legible task text, focus and every selectable beard`, () => {
        const tokens = SKIN_TOKENS[`${skin}/${mode}`]
        expect(tokens).toBeDefined()
        for (const foreground of [tokens.ink, tokens.muted])
          expect(
            contrastRatio(parseColor(foreground)!, parseColor(tokens.cardSolid)!),
          ).toBeGreaterThanOrEqual(4.5)
        expect(
          contrastRatio(parseColor(tokens.onPrimary)!, parseColor(tokens.accentFill)!),
        ).toBeGreaterThanOrEqual(4.5)
        expect(colors.length).toBeGreaterThanOrEqual(9)
        for (const [hair, ground] of colors) {
          const foreground = hair === '--ink' ? tokens.ink : palette[hair]
          const background = ground === '--card-solid' ? tokens.cardSolid : palette[ground]
          expect(foreground, hair).toBeDefined()
          expect(background, ground).toBeDefined()
          expect(
            contrastRatio(parseColor(foreground!)!, parseColor(background!)!),
            hair,
          ).toBeGreaterThanOrEqual(3)
        }
        expect(rainbowStops.length).toBe(6)
        for (const token of rainbowStops) {
          expect(palette[token], token).toBeDefined()
          expect(
            contrastRatio(parseColor(palette[token]!)!, parseColor(palette['--beard-charcoal']!)!),
            token,
          ).toBeGreaterThanOrEqual(3)
        }
        for (let index = 1; index < rainbowStops.length; index++) {
          for (const weight of [0.25, 0.5, 0.75]) {
            const shade = mixSrgb(
              palette[rainbowStops[index - 1]!]!,
              palette[rainbowStops[index]!]!,
              weight,
            )
            expect(
              contrastRatio(parseColor(shade)!, parseColor(palette['--beard-charcoal']!)!),
            ).toBeGreaterThanOrEqual(3)
          }
        }
      })
})
