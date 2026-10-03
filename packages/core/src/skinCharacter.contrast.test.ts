import { describe, expect, it } from 'vitest'
import { contrastRatio, mixSrgb, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { FABLE5, SKIN_TOKENS, WHITE_MARK_IN_DARK } from './skinTokens.fixture'

// Skin Character guardrail: the core kit (buttons, chips, labels, numerals on cards/bands) must clear
// WCAG AA at every skin × mode. The character tokens are shape/type/motion (no colour change), but
// this formalizes the text-on-surface combos the kit paints. Stage 1b adds the MATERIAL layer — the
// nameplate plate, the gilt/instrument eyebrow, and the card marks over their scrim — and proves the
// headline invariant: texture never buries text (text always sits on the opaque --panel-fill / a
// deep mark scrim, never the raw grain/mesh). Keyed off the SKINS registry, so a new skin with no row
// here fails loudly, not in the sweep.
//
// Mirrors apps/web/src/styles/tokens.css. cta-ink/cta-lo = primary button; ink/card-solid =
// secondary and icon controls; on-primary/accent-fill = active chip. accentInk = the Nameplate
// eyebrow; markAccent = the card-mark accent (= --accent), shown only over dark scrims.

const AA = 4.5
const UI_BOUNDARY = 3

// Token samples live in skinTokens.fixture.ts (shared with spineTint.contrast.test.ts) — a mirror of
// apps/web/src/styles/tokens.css, keyed off the SKINS registry.

const MODES = ['dark', 'light'] as const
const ratio = (a: string, b: string) => contrastRatio(parseColor(a)!, parseColor(b)!)
/** A `rgba(0,0,0,α)` scrim over a surface, the way the cover marks composite. */
const scrim = (surface: string, alpha: number) => mixSrgb('#000000', surface, alpha)

describe('skin character kit contrast (text on the kit surfaces ≥ AA, every skin × mode)', () => {
  for (const skin of Object.keys(SKINS) as SkinId[]) {
    for (const mode of MODES) {
      const t = SKIN_TOKENS[`${skin}/${mode}`]

      it(`${skin}/${mode} has tokens recorded`, () => {
        expect(t, `add a SKIN_TOKENS row for ${skin}/${mode}`).toBeDefined()
      })

      // text-on-surface pairs the kit relies on: [label, fg, bg]
      // The nameplate/stat plate uses the OPAQUE --panel-fill (= card-solid), so plate text reuses the
      // card pairs; the eyebrow adds the accent-tinted text token on that same plate.
      const pairs: [string, string, string][] = [
        ['numeral/label on card', t.ink, t.cardSolid],
        ['muted label on card', t.muted, t.cardSolid],
        ['ink on bg', t.ink, t.bg0],
        ['muted on bg', t.muted, t.bg0],
        ['button/active-chip text on accent fill', t.onPrimary, t.accentFill],
        // trope chips (trope-system): present = ink on the chip wash; pinned = on-primary on
        // accent fill with the bookmark ornament. Both states, every skin × mode.
        ['trope chip (present) on chip wash', t.ink, mixSrgb(t.ink, t.bg0, 0.08)],
        ['trope chip (pinned) on accent fill', t.onPrimary, t.accentFill],
        ['nameplate eyebrow (accent-ink) on plate', t.accentInk, t.cardSolid],
        // 1c — typed text in a search / input field. --field = a 5% ink wash over the bg; model it.
        ['input/search text on field', t.ink, mixSrgb(t.ink, t.bg0, 0.05)],
        ['book-editor section navigation on card', t.muted, t.cardSolid],
        // structural — section-header readout + accent status-tag text sit in --accent-ink on the page bg.
        ['structural readout / accent tag (accent-ink) on bg', t.accentInk, t.bg0],
        // taste tiers (taste-tiers): the named match-strength label on a card — top tier lit in the
        // skin accent (--accent-ink), the floor quieted to --muted, the middle in --ink. All three
        // over the card surface, every skin × mode (see TASTE_TIER_TOKEN in @reverie/core).
        ['taste tier — recognition (accent-ink) on card', t.accentInk, t.cardSolid],
        ['taste tier — mid (ink) on card', t.ink, t.cardSolid],
        ['taste tier — departure (muted) on card', t.muted, t.cardSolid],
      ]
      for (const [name, fg, bg] of pairs) {
        it(`${skin}/${mode} · ${name} clears ${AA}:1`, () => {
          const r = ratio(fg, bg)
          expect(
            r,
            `${skin}/${mode} ${name}: ${fg} on ${bg} = ${r.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(AA)
        })
      }

      it(`${skin}/${mode} · secondary/icon control edge clears ${UI_BOUNDARY}:1`, () => {
        const edge = mixSrgb(t.ink, t.cardSolid, 0.64)
        const r = ratio(edge, t.cardSolid)
        expect(
          r,
          `${skin}/${mode} control edge: ${edge} on ${t.cardSolid} = ${r.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(UI_BOUNDARY)
      })

      // Spine slot — Tryst (leather) + Aphelion (brushed) have a textured binding, but the title +
      // author/callsign sit CENTRED, over the opaque --card-solid base (the gradient's dark shifts live
      // at the spine edges, away from the type). So the spine text holds AA on card-solid, at the min
      // sizes (13px title / 9px author — normal text, the 4.5 floor applies). Plain-binding skins reuse
      // the card pairs above.
      if (skin === 'tryst' || skin === 'aphelion') {
        const base = t.cardSolid
        const spinePairs: [string, string, string][] = [
          ['spine title on binding', skin === 'aphelion' ? t.ink : t.accentInk, base],
          ['spine author (muted) on binding', t.muted, base],
          ['spine callsign / label (accent-ink) on binding', t.accentInk, base],
        ]
        for (const [name, fg, bg] of spinePairs) {
          it(`${skin}/${mode} · ${name} clears ${AA}:1`, () => {
            const r = ratio(fg, bg)
            expect(
              r,
              `${skin}/${mode} ${name}: ${fg} on ${bg} = ${r.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(AA)
          })
        }
      }

      // Fable 5 designed surfaces (only present for the refined/designed skins)
      const f5 = FABLE5[`${skin}/${mode}`]
      if (f5) {
        const f5pairs: [string, string, string][] = [
          ['CTA text on the CTA low surface', f5.ctaInk, f5.ctaLo],
          ['spine title on the binding (mid)', f5.spineTitle, mixSrgb(f5.spineLo, f5.spineHi, 0.5)],
          [
            'spine author on the binding (mid)',
            f5.spineMuted,
            mixSrgb(f5.spineLo, f5.spineHi, 0.5),
          ],
          ...f5.phStops.map((stop, i): [string, string, string] => [
            `placeholder title on board stop ${i}`,
            f5.phInk,
            stop,
          ]),
          ...f5.phStops.map((stop, i): [string, string, string] => [
            `placeholder author on board stop ${i}`,
            mixSrgb(f5.phMutedInk, stop, f5.phMutedAlpha),
            stop,
          ]),
        ]
        for (const [name, fg, bg] of f5pairs) {
          it(`${skin}/${mode} · ${name} clears ${AA}:1`, () => {
            const r = ratio(fg, bg)
            expect(
              r,
              `${skin}/${mode} ${name}: ${fg} on ${bg} = ${r.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(AA)
          })
        }
      }

      // Card marks composite over a dark scrim regardless of mode. The skin accent is painted only
      // where it clears AA — over a real cover (image, not measured) and over a DARK-mode placeholder;
      // over a LIGHT-mode placeholder it falls back to WHITE. Model each mode's real path:
      if (mode === 'dark') {
        it(`${skin}/dark · mark ink on the placeholder scrim clears ${AA}:1`, () => {
          // deepest scrim (placeholder) over the dark surface: rgba(0,0,0,.62) over card-solid.
          // Non-inverting skins keep light placeholders at night → the app paints white there.
          const bg = scrim(t.cardSolid, 0.62)
          const ink = WHITE_MARK_IN_DARK.has(skin) ? '#ffffff' : t.markAccent
          const r = ratio(ink, bg)
          expect(r, `mark ink ${ink} on ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
        })
      } else {
        it(`${skin}/light · white mark on the placeholder scrim clears ${AA}:1`, () => {
          const bg = scrim(t.cardSolid, 0.62)
          const r = ratio('#ffffff', bg)
          expect(r, `white mark on ${bg} = ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
        })
      }
    }
  }
})

// ── CARD SURFACE: separation and border visibility, all 18 combos ───────────────────────────────
//
// THE GAP THIS CLOSES. Nothing in this file measured the card as a SURFACE — every assertion above
// is text-on-a-surface, and all of them read `cardSolid`. Two consequences:
//   · `--card` itself was unmeasured, and it is NOT interchangeable with `--card-solid`: they
//     diverge in tryst (where --card carries alpha) and in the three Fable 5 combos where
//     --card-solid was deliberately lifted away from --card (marrow/dark, umbra/light, umbra/dark).
//   · `--line` was unmeasured entirely, in all 18. Every one is an rgba with alpha ≤ 0.45, so a
//     border that fails to separate the card from the page fails silently.
//
// Both legs are composited the way the browser paints them, which is the whole point: --card over
// --bg0 first, then --line over THAT, never --line over --bg0 directly. Measuring the authored
// colours instead would describe pixels nothing renders.
//
// THE NUMBERS ARE A RATCHET, NOT A STANDARD. Each floor is today's measured value truncated to four
// decimals — not a round threshold someone chose. Improving a combo's separation can never fail
// this; regressing one always does. Truncated rather than rounded so the floor is provably ≤ the
// measurement it came from and cannot fail on the tree that produced it.
//
// The rulings behind these values are recorded in docs/audits/skin-component-consistency.md, made
// per combo against docs/audits/card-decision-aid.html rather than against a global threshold —
// which is why almanac/light passes at a 1.0314 surface (its 1.9869 border carries it) while
// marrow/dark did NOT at 1.0402, its border then being 1.1472, the weakest in the set by a wide
// margin. RESOLVED in Track A PR 2: --line went 0.2 -> 0.45 alpha (hue unchanged), taking that
// border to 1.4606 and putting marrow/dark on the same footing as every other weak-surface combo —
// carried by its border. Its surface is untouched at 1.0402, deliberately: --card was left alone so
// the text-on-card contrast that depends on it elsewhere does not move.
const CARD_FLOORS: Record<string, { surface: number; border: number }> = {
  'tryst/light': { surface: 1.086, border: 1.5469 },
  'tryst/dark': { surface: 1.0908, border: 1.7405 },
  'grimoire/light': { surface: 1.0721, border: 1.3537 },
  'grimoire/dark': { surface: 1.1017, border: 1.4204 },
  'aphelion/light': { surface: 1.0642, border: 1.3626 },
  'aphelion/dark': { surface: 1.077, border: 1.4398 },
  'marrow/light': { surface: 1.075, border: 1.5334 },
  'marrow/dark': { surface: 1.0402, border: 1.4606 },
  'umbra/light': { surface: 1.1411, border: 1.4578 },
  'umbra/dark': { surface: 1.0455, border: 1.4036 },
  'folio/light': { surface: 1.1661, border: 1.6033 },
  'folio/dark': { surface: 1.1938, border: 1.611 },
  'hearth/light': { surface: 1.1243, border: 1.5239 },
  'hearth/dark': { surface: 2.1003, border: 1.9327 },
  'almanac/light': { surface: 1.0314, border: 1.9869 },
  'almanac/dark': { surface: 1.1443, border: 1.7913 },
  'bloom/light': { surface: 1.4548, border: 1.4269 },
  'bloom/dark': { surface: 1.1554, border: 1.7118 },
}

/**
 * Combos ruled NOT acceptable: kept out of the pass/fail floor above so the suite does not certify
 * them as fine, while still regression-guarded so a known-weak combo cannot quietly get worse.
 *
 * EMPTY, and that is the finished state — marrow/dark was the only entry and Track A PR 2 closed it
 * (--line 0.2 -> 0.45 alpha, border 1.1472 -> 1.4606). Removing it from this list was the entire
 * bookkeeping change: the normal per-combo assertions picked it up automatically, which is what the
 * closing note here promised.
 *
 * The mechanism stays for the next one. Add a combo here when it is ruled unacceptable, keep its
 * CARD_FLOORS row at whatever it currently measures, and the drift guard below holds the line while
 * the real fix is designed.
 */
const KNOWN_WEAK_COMBOS: readonly string[] = []

type Rgba4 = [number, number, number, number]
const rgba = (s: string): Rgba4 => parseColor(s)! as Rgba4
/** Composite a possibly-translucent colour over a solid backdrop, in floats.
 *  Deliberately not `mixSrgb`: that formats through `formatColor`, which quantises to 8-bit and
 *  would make the ratios disagree with the decision aid's in the fourth decimal. */
const over = (fg: Rgba4, bg: Rgba4): Rgba4 => [
  fg[0] * fg[3] + bg[0] * (1 - fg[3]),
  fg[1] * fg[3] + bg[1] * (1 - fg[3]),
  fg[2] * fg[3] + bg[2] * (1 - fg[3]),
  1,
]

describe('card surface separation and border visibility (every skin × mode)', () => {
  for (const skin of Object.keys(SKINS) as SkinId[]) {
    for (const mode of MODES) {
      const key = `${skin}/${mode}`
      const t = SKIN_TOKENS[`${skin}/${mode}`]
      const floor = CARD_FLOORS[key]
      const known = KNOWN_WEAK_COMBOS.includes(key)

      it(`${key} has a recorded floor`, () => {
        expect(floor, `add a CARD_FLOORS row for ${key}`).toBeDefined()
      })

      const measure = () => {
        const bg = rgba(t.bg0)
        const cardOnBg = over(rgba(t.card), bg)
        return {
          surface: contrastRatio(cardOnBg, bg),
          border: contrastRatio(over(rgba(t.line), cardOnBg), cardOnBg),
        }
      }

      if (!known) {
        it(`${key} card separates from the page (≥ ${floor!.surface})`, () => {
          const { surface } = measure()
          expect(
            surface,
            `${key}: --card over --bg0 measured ${surface.toFixed(4)}, below the recorded ${floor!.surface}. ` +
              `If this is a deliberate improvement elsewhere that lowered it, re-rule the combo against ` +
              `docs/audits/card-decision-aid.html — do not just lower the floor.`,
          ).toBeGreaterThanOrEqual(floor!.surface)
        })

        it(`${key} border is visible on the card (≥ ${floor!.border})`, () => {
          const { border } = measure()
          expect(
            border,
            `${key}: --line over the composited card measured ${border.toFixed(4)}, below the recorded ${floor!.border}.`,
          ).toBeGreaterThanOrEqual(floor!.border)
        })
      } else {
        // Ruled NOT acceptable — see KNOWN_WEAK_COMBOS. Still guarded against getting worse.
        it(`${key} is known-weak and has not drifted lower`, () => {
          const { surface, border } = measure()
          expect(
            surface,
            `${key} is known-weak; its surface has drifted BELOW the baseline this was recorded at`,
          ).toBeGreaterThanOrEqual(floor!.surface)
          expect(
            border,
            `${key} is known-weak (Track A PR 2 fixes it); its border has drifted BELOW ${floor!.border}`,
          ).toBeGreaterThanOrEqual(floor!.border)
        })
      }
    }
  }

  it('every KNOWN_WEAK_COMBOS entry is a real combo with a recorded floor', () => {
    for (const key of KNOWN_WEAK_COMBOS) {
      expect(
        CARD_FLOORS[key],
        `${key} is listed known-weak but has no floor recorded`,
      ).toBeDefined()
      expect(
        SKIN_TOKENS[key as keyof typeof SKIN_TOKENS],
        `${key} is listed known-weak but is not a skin/mode that exists`,
      ).toBeDefined()
    }
  })
})
