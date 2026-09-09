import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from './adaptive'
import { SKINS, type SkinId } from './skins'
import { SKIN_TOKENS, type Tok } from './skinTokens.fixture'
import { STATE_PILL_TOKENS, STATE_PILL_TOKEN_FIELDS } from './statePill'

// The state pill (borrowed / DNF) is the ONE surface the accessibility sweep structurally cannot
// check: axe does not measure text over an image, and the pill sits on arbitrary cover art. That is
// exactly how the marks it replaces shipped failing — `rgba(0,0,0,0.45)` over white artwork
// composites to #8c8c8c, where the nine skins' accents measure 1.1–2.7:1 and white ink reaches only
// ~3.2:1. Nothing was red, because nothing was looking.
//
// So this test is the whole guarantee, and it is keyed off the SKINS registry rather than a list:
// a tenth skin with no SKIN_TOKENS row fails here before it can ship a pill nobody can read. The
// e2e sweep covers four skins; this covers all nine, in both modes.
//
// It also pins the TOKEN NAMES, not just the colours. Measuring `--card-solid` while the component
// quietly renders `rgba(...)` would be a green test over a broken pill, so the assertions below and
// the component's styling read from the same STATE_PILL_TOKENS object.

const AA_NORMAL = 4.5 // the pill's WORD carries the meaning — held to body-copy legibility
const AA_GRAPHICAL = 3 // the leading glyph is decoration beside the word — the 3:1 non-text bar
const MODES = ['dark', 'light'] as const

describe('state pill — the material is the tokens the components actually use', () => {
  it('is solid, never a translucent scrim over cover art', () => {
    // The defect this branch exists to fix, asserted directly: any rgba()/transparent surface is a
    // scrim whose contrast depends on the artwork behind it, which no test can bound.
    expect(STATE_PILL_TOKENS.surface).toBe('var(--card-solid)')
    expect(STATE_PILL_TOKENS.surface).not.toMatch(/rgba?\(|transparent|color-mix/)
  })

  it('names the token fields this test measures, so the two cannot drift', () => {
    expect(STATE_PILL_TOKENS.label).toBe('var(--ink)')
    expect(STATE_PILL_TOKENS.accent).toBe('var(--mark-accent)')
    expect(STATE_PILL_TOKEN_FIELDS).toEqual({
      surface: 'cardSolid',
      label: 'ink',
      accent: 'markAccent',
    })
  })
})

describe('state pill contrast — legible at every skin × mode, over any cover', () => {
  const ratioOf = (fg: string, bg: string): number => {
    const f = parseColor(fg)
    const b = parseColor(bg)
    expect(f && b, `unparseable colour: ${fg} on ${bg}`).toBeTruthy()
    return contrastRatio(f!, b!)
  }

  for (const skin of Object.keys(SKINS) as SkinId[]) {
    for (const mode of MODES) {
      const key = `${skin}/${mode}` as const
      const tokens: Tok | undefined = SKIN_TOKENS[key]

      it(`${key} has tokens recorded`, () => {
        expect(tokens, `add a SKIN_TOKENS row for ${key}`).toBeDefined()
      })

      it(`${key} · pill word (${STATE_PILL_TOKEN_FIELDS.label} on ${STATE_PILL_TOKEN_FIELDS.surface}) clears ${AA_NORMAL}:1`, () => {
        const fg = tokens[STATE_PILL_TOKEN_FIELDS.label]
        const bg = tokens[STATE_PILL_TOKEN_FIELDS.surface]
        const ratio = ratioOf(fg, bg)
        expect(ratio, `${key}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_NORMAL,
        )
      })

      it(`${key} · pill glyph (${STATE_PILL_TOKEN_FIELDS.accent} on ${STATE_PILL_TOKEN_FIELDS.surface}) clears ${AA_GRAPHICAL}:1`, () => {
        const fg = tokens[STATE_PILL_TOKEN_FIELDS.accent]
        const bg = tokens[STATE_PILL_TOKEN_FIELDS.surface]
        const ratio = ratioOf(fg, bg)
        expect(ratio, `${key}: ${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
          AA_GRAPHICAL,
        )
      })
    }
  }
})

describe('state pill — pills are never distinguished by colour alone', () => {
  it('every kind carries distinct text, over one shared accent', async () => {
    const { STATE_PILL_LABEL, STATE_PILL_SPOKEN, STATE_PILL_GLYPH } = await import('./statePill')
    // One accent token for all of them: colour is skin voice, not meaning. If colour ever became
    // the differentiator, a monochrome or colour-blind reader would lose the distinction entirely.
    const labels = Object.values(STATE_PILL_LABEL)
    expect(new Set(labels).size, `labels must be distinct: ${labels.join(', ')}`).toBe(
      labels.length,
    )
    expect(STATE_PILL_SPOKEN.dnf).not.toBe(STATE_PILL_SPOKEN.borrowed)
    expect(STATE_PILL_GLYPH.dnf).not.toBe(STATE_PILL_GLYPH.borrowed)
    // and the spoken form of DNF is the expansion, not the initialism
    expect(STATE_PILL_SPOKEN.dnf).toBe('did not finish')
  })

  it('Read is a pill kind but carries no accessible-name entry — that asymmetry is deliberate', async () => {
    const { STATE_PILL_LABEL, STATE_PILL_SPOKEN } = await import('./statePill')
    // `read` renders in the shared slot and shares the material, but it is announced by the pill
    // itself rather than by the control's name — so it must NOT appear in the spoken map, or the
    // card would say it twice. Asserting the actual asymmetry, not a proxy for it.
    expect(Object.keys(STATE_PILL_LABEL)).toContain('read')
    expect(Object.keys(STATE_PILL_SPOKEN)).not.toContain('read')
    expect(Object.keys(STATE_PILL_SPOKEN).sort()).toEqual(['borrowed', 'dnf'])
  })
})

describe('cover-sized state phrasing', () => {
  it('announces the visible read state without changing the narrow-surface suffix', async () => {
    const { coverStateSuffix, stateSuffix } = await import('./statePill')
    const read = {
      readStatus: 'Read' as const,
      reads: [],
      ownership: 'owned' as const,
      borrowed: false,
      wishlist: false,
    }
    expect(coverStateSuffix(read)).toBe(', read')
    expect(stateSuffix(read)).toBe('')
  })

  it('keeps DNF ahead of borrowed and never calls an abandoned logged attempt read', async () => {
    const { coverStateSuffix } = await import('./statePill')
    expect(
      coverStateSuffix({
        readStatus: 'DNF',
        reads: [{ date: '2026-01-01', format: '', rating: 0, notes: '' }],
        ownership: 'unowned',
        borrowed: true,
        wishlist: false,
      }),
    ).toBe(', did not finish, borrowed')
  })
})
