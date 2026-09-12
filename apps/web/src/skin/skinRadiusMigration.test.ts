import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The control-radius migration PROGRESS METER.
//
// ── WHY THIS EXISTS SEPARATELY FROM THE ESLINT RULE ─────────────────────────────────────────────
// `skin/no-hardcoded-control-radius` (eslint-rules/) forbids a hardcoded radius on an element that
// ALREADY carries `.skin-control` / `.skin-field`. That is precise and has no false positives — but
// it is structurally blind to un-migrated code, because un-migrated controls do not carry the class
// yet. Measured: it reported 0 violations against a codebase with ~192 un-migrated controls, and
// the 0 was correct.
//
// So discovery needs the opposite question — "does this element LOOK like a control while using a
// hardcoded radius?" — which is a heuristic, and heuristics need an escape hatch. Hence: this test,
// with an allowlist that shrinks to zero as the migration lands.
//
// ── THE ALLOWLIST RULE ──────────────────────────────────────────────────────────────────────────
// Every entry carries a reason, inline, and the test FAILS on an entry with an empty reason. An
// unannotated allowlist becomes a dumping ground and the meter stops meaning anything — at which
// point this file is worse than nothing, because it reports a number that no longer tracks reality.
//
// A radius is "hardcoded" here whether it is `rounded-full` or `rounded-xl`: both bypass
// `--radius-control` equally, and stopping at `rounded-full` would let the meter reach zero while
// ~54 controls still ignore the token.

const SRC = join(__dirname, '..')
const RADIUS = /\brounded-(?:none|sm|md|lg|xl|2xl|3xl|full)\b/
// `.skin-control-quiet` is deliberately NOT listed here, and that is not an oversight. `\b` sits
// between the `l` and the `-`, so `skin-control` already matches inside `skin-control-quiet` — this
// regex only ever calls `.test()`, never reads the captured name, so adding the alternative would be
// a pure no-op dressed as a functional change. Mutation testing is what showed it: removing the
// alternative from a version that had it changed nothing at all.
//
// The ESLint rule DOES list it, because that one puts the captured name in its error message, and
// without the alternative (ordered before `control`) it tells the reader the element carries
// `skin-control` — a class it does not have.
const CARRIER = /\bskin-(?:control|field|card|panel|tile|meter)\b/

/** Files whose radii are ARTWORK — SVG ornaments, star fields, spine geometry — never controls. */
const ARTWORK_FILES = [
  'components/CoverPlaceholder.tsx',
  'components/Sky.tsx',
  'components/Stars.tsx',
  'components/Spine.tsx',
  'components/SpineShelf.tsx',
  'components/Structure.tsx',
  'components/Nameplate.tsx',
  'auth/Wordmark.tsx',
  'auth/landing/SkinShowcase.tsx',
  'auth/landing/below-fold.tsx',
  'routes/LabRoute.tsx',
  'routes/LabStructureRoute.tsx',
]

/**
 * Known, deliberate exceptions — `'file:line-ish marker': 'why'`. Shrinks to {} as the migration
 * lands. An entry with an empty reason fails the test.
 */
const ALLOW: Record<string, string> = {
  // The h-[3px] progress tracks in SeriesRoute are NOT listed here: the control heuristic already
  // excludes them (no px-*, no h-9..12), so an entry for them would suppress nothing while implying
  // it had been considered and waived. A dead allowlist entry is the dumping-ground failure in
  // miniature — found by mutation-testing this very list.
  //
  // ReviewsPanel's review card and AppShell's mobile sheet were listed here through batch 3, as the
  // tile heuristic's only false positives. `ownsInteractiveElement` now resolves both correctly (each
  // is a <div>), so their entries were REMOVED rather than left to rot — same rule as the h-[3px]
  // tracks above: an entry that suppresses nothing implies a waiver that is no longer doing any work.
  // The two h-[3px] bars in SeriesRoute — the series progress track and its fill — are SKIPPED, not
  // pending. At 3px tall, `border-radius` clamps to half the height (1.5px), and every skin's
  // --radius-control is either >= 1.5px (999px, 3px, 2px) or 0px; the 2px and 3px skins therefore
  // render pixel-identical to `rounded-full`, and only marrow's 0px would differ on a bar already
  // too small to read a cap on. Measured, not assumed. Migrating them is churn, so they are listed
  // here rather than left to look like remaining work.
  'routes/SeriesRoute.tsx|mt-2 h-[3px] w-full overflow-hidden':
    'the series progress TRACK at 3px — border-radius clamps to 1.5px, so this renders pixel-identical to rounded-full in every skin that is not marrow',
  'routes/SeriesRoute.tsx|h-full rounded-full':
    'the fill inside that same 3px track — same clamp, same pixel-identical result',
  // The two Landing nav links below are CONTROL-SHAPED but must not take control TYPOGRAPHY: three
  // skins set --control-transform: uppercase, which would rewrite "Log in" as "LOG IN" on the landing
  // page. They want a radius without the type rider — the same gap the non-interactive chips below
  // have — so both wait on one kit decision rather than being forced into `.skin-control` early.
  'auth/Landing.tsx|font-medium text-muted hover:text-ink':
    'a mobile-menu nav text link — wants the skin radius for its hover chip, but not the uppercase that `.skin-control` carries in aphelion/umbra/almanac',
  'auth/Landing.tsx|px-2 py-2 text-[14px] font-semibold text-ink':
    'the “Log in” nav link beside it — same shape, same reason; migrating it would uppercase the word in three skins',
  // Batch 6's four. Each is interactive and control-shaped, and each renders a CONTENT word rather
  // than a button label — the §8 gap again, from the interactive side. Two of them
  // (OwnedCopies, PlannerRoute) already set `capitalize` explicitly on values that come from data,
  // so `.skin-control` would not merely restyle them, it would fight a transform the author chose.
  'book/OwnedCopies.tsx|text-[11.5px] font-semibold capitalize':
    'the paperback/hardcover toggle — data values the author explicitly capitalized; --control-transform would override that to PAPERBACK in three skins',
  'routes/PlannerRoute.tsx|text-[12.5px] font-semibold capitalize':
    'the calendar/releases tab pills — same explicit `capitalize` on data values, same override',
  'components/MoodChip.tsx|inline-flex items-center gap-1.5':
    'a mood chip — renders the mood name in the display face, italic; uppercasing reader-facing content words is a copy change, not a radius fix',
  'components/AppShell.tsx|flex flex-col items-center gap-1.5':
    'a bottom-nav tab — the five most-seen labels in the app; uppercasing “Library” in three skins is a typography change, not a radius fix, and belongs to the §8 ruling',
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.tsx') && !p.includes('.test.')) out.push(p)
  }
  return out
}

/** Interactive JSX tags. A skin CONTROL is something a reader clicks or types into; a `<span>` with
 *  the same padding is a badge, and `.skin-control` would give it control typography it should not
 *  have. Shape alone cannot tell them apart — batch 4 measured 39 shape-matches across six files, of
 *  which 11 were static `<span>`/`<div>`/`<li>`/`<p>`. */
const INTERACTIVE_TAG = /^(?:button|a|Link|input|select|textarea|summary|label)$/

/**
 * Walk BACK from a className line to the JSX tag that owns it, and report whether that tag is
 * interactive. Two cases need care, both found by measuring rather than reasoning:
 *
 *  - A `role="button"`/`onClick` on a plain <div> IS interactive — checked in the nearby window.
 *  - An extracted class CONSTANT (`const fieldClass = 'h-9 rounded-lg …'`) has no tag above it at
 *    all. Four of these exist (ContributorEditor, PlanEditor, CoverSheet, AuthScreen) plus MoodChip,
 *    and every one is genuinely a control — so the constant is resolved by finding the identifier
 *    used on an interactive tag elsewhere in the file, not by assuming either answer.
 */
function ownsInteractiveElement(lines: string[], i: number): boolean {
  const TAGS = INTERACTIVE_TAG.source.slice(4, -2)

  // The class-CONSTANT case must be tested BEFORE walking back for a tag, not after. Walking back
  // first looks safe and is wrong: AuthScreen's `inputClass` has an unrelated <span> eleven lines
  // above it, so the walk returns "not interactive" and the constant branch never runs. Four of the
  // five constants misresolved exactly that way.
  if (!/className\s*=/.test(lines[i]!)) {
    for (let j = i; j >= Math.max(0, i - 3); j--) {
      const id = /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/.exec(lines[j]!)?.[1]
      if (!id) continue
      const body = lines.join('\n')
      return new RegExp(`<(?:${TAGS})\\b[\\s\\S]{0,400}?\\b${id}\\b`).test(body)
    }
  }

  const near = lines.slice(Math.max(0, i - 3), i + 6).join('\n')
  if (/onClick|role=["']button["']|onSubmit|onChange/.test(near)) return true

  for (let j = i; j >= Math.max(0, i - 16); j--) {
    const m = /^\s*<([A-Za-z][\w.]*)/.exec(lines[j]!)
    if (m) return INTERACTIVE_TAG.test(m[1]!)
  }
  return false
}

/**
 * A FIELD, identified by tag rather than by shape. Every other branch in this file guesses from
 * padding and height, because a <button> and a <div> look identical to a line-based scan — but
 * `<input>`, `<textarea>` and `<select>` are unambiguous, so no guessing is needed or wanted.
 *
 * This branch exists because shape-guessing MISSED three textareas outright: they are block-padded
 * (`p-3`, no `px-*`) and have no fixed height, so `looksLikeControl` skipped them and `looksLikeTile`
 * wanted an interactivity signal it could not see. They had been invisible to the meter since it was
 * written — the meter read 0 while three reader-facing inputs still bypassed `--radius-control`.
 */
function looksLikeField(lines: string[], i: number): boolean {
  for (let j = i; j >= Math.max(0, i - 14); j--) {
    const m = /^\s*<([A-Za-z][\w.]*)/.exec(lines[j]!)
    if (m) return /^(?:input|textarea|select)$/.test(m[1]!)
  }
  return false
}

/**
 * A METER BAR — a progress track, or the fill inside one. Neither is a control, so every other
 * branch here misses them: no `px-*`, no `h-9..12`, no block padding, no interactive tag. They were
 * invisible to this file for its whole life, which is why the meter-bar batch had to add sight
 * before it could measure its own delta.
 *
 * A TRACK is a short, non-square, `overflow-hidden` box. A FILL is the `h-full` bar inside it,
 * carrying no padding, text or border of its own — that last clause is what keeps `h-full` from
 * matching every layout box in the app.
 */
function looksLikeMeter(line: string): boolean {
  const w = [...line.matchAll(/\bw-([\w./[\]%-]+)/g)].map((m) => m[1])
  const h = [...line.matchAll(/\bh-([\w./[\]%-]+)/g)].map((m) => m[1])
  if (w.length && h.length && w.some((x) => h.includes(x))) return false // a square pip, not a bar
  // The bracket form is bounded to SINGLE-DIGIT pixels on purpose. An unbounded `h-[\d+px]` also
  // matches `h-[54px]`, `h-[60px]` and `h-[46px]` — the cover thumbnails in SeriesStrip, SeriesRoute
  // and SeriesArranger, which are artwork frames and not bars at all. Measured: 14 hits before the
  // bound, 11 after, and the 3 it dropped were exactly those thumbnails.
  const shortBox = /\bh-(?:1|1\.5|2|2\.5|3)\b/.test(line) || /\bh-\[[1-9]px\]/.test(line)
  if (shortBox && /\boverflow-hidden\b/.test(line)) return true
  if (shortBox && !/\bpx-|\bp-[0-9]|\btext-|\bborder\b/.test(line)) return true
  return (
    /\bh-full\b/.test(line) && !/\bpx-|\bp-[0-9]|\btext-|\bborder\b|\bitems-|\bjustify-/.test(line)
  )
}

/** A CARD-SCALED pressable: block padding or a text-left body, and no control-scale px-*. Needs an
 *  interactivity signal from the surrounding lines, because the same shape describes a plain card —
 *  ReviewsPanel's review card and AppShell's mobile sheet both matched on shape alone. */
function looksLikeTile(line: string, context: string): boolean {
  const cardScaled =
    (/\bp-[0-9.]/.test(line) || /\btext-left\b/.test(line)) && !/\bpx-[0-9.]/.test(line)
  if (!cardScaled) return false
  return /<button|onClick|aria-pressed|role=["']button["']|<Link/.test(context)
}

/** Heuristic: does this line describe a CONTROL (something a reader clicks or types into)? */
function looksLikeControl(line: string): boolean {
  const w = [...line.matchAll(/\bw-([\w./[\]%-]+)/g)].map((m) => m[1])
  const h = [...line.matchAll(/\bh-([\w./[\]%-]+)/g)].map((m) => m[1])
  // a square box is a circular icon button or avatar — correct as rounded-full, not a pill
  if (w.length && h.length && w.some((x) => h.includes(x))) return false
  return /\bpx-[0-9.]/.test(line) || /\bh-(9|10|11|12)\b/.test(line)
}

describe('control-radius migration meter', () => {
  const findings: { file: string; line: number; text: string }[] = []
  const chips: { file: string; line: number; text: string }[] = []
  for (const abs of walk(SRC)) {
    const rel = abs.slice(SRC.length + 1)
    if (ARTWORK_FILES.includes(rel)) continue
    const lines = readFileSync(abs, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!RADIUS.test(line) || CARRIER.test(line)) return
      const context = lines.slice(Math.max(0, i - 9), i + 3).join('\n')
      if (
        !looksLikeControl(line) &&
        !looksLikeTile(line, context) &&
        !looksLikeField(lines, i) &&
        !looksLikeMeter(line)
      )
        return
      if (
        Object.keys(ALLOW).some((k) => {
          const [f, marker] = k.split('|')
          return rel === f && line.includes(marker!)
        })
      )
        return
      const found = { file: rel, line: i + 1, text: line.trim().slice(0, 90) }
      if (ownsInteractiveElement(lines, i)) findings.push(found)
      else chips.push(found)
    })
  }

  it('every allowlist entry states why', () => {
    for (const [k, reason] of Object.entries(ALLOW)) {
      expect(reason.trim().length, `allowlist entry "${k}" has no reason`).toBeGreaterThan(10)
    }
  })

  // TARGET: 0. Lower this as batches land — it may only ever go DOWN, which is what makes it a
  // ratchet rather than a number someone edits to make the suite green.
  const BUDGET = 0

  // The NON-INTERACTIVE population, split out in batch 4 and given its own ratchet rather than
  // dropped. Splitting a bucket out of a meter is the move that quietly makes a number look better,
  // so it gets counted here in full: these are badges, code chips, list rows and empty-state boxes
  // that match the control SHAPE but must not take control TYPOGRAPHY (--control-transform is
  // uppercase in three skins). They still hardcode a radius, so they are still drift; they are
  // simply waiting on the kit decision the batch-4 report raises — a radius-only, typography-free
  // class — rather than being forced into `.skin-control`. TARGET: 0, same as above.
  //
  // 25 = 23 chips that were inside the old 112, plus ReviewsPanel's review card and AppShell's mobile
  // sheet, which were allowlist-SUPPRESSED before and are now counted.
  //
  // The books balance, and the arithmetic is worth writing out because getting it wrong is silent:
  //   112 − 26 migrated − 23 reclassified as chips − 2 Landing nav links allowlisted = 61   (batch 4)
  //    61 − 39 migrated − 1 AppShell nav tab allowlisted = 21                                (batch 5)
  //    21 − 17 migrated − 4 content-word controls allowlisted = 0                             (batch 6)
  // A first pass set BUDGET to 63, forgetting the last term. Nothing failed — a ratchet with slack
  // still passes, it just stops catching anything, and reverting a migrated control went undetected
  // until the counts were printed directly instead of being inferred from green.
  //    25 → 30 when `looksLikeMeter` gained sight of the progress bars (6 of the 11 it found were
  //         already counted as chips, so the rise is +5, not +11)
  //    30 → 28 allowlisting SeriesRoute's two h-[3px] bars, which are pixel-identical by clamp
  //    28 → 19 migrating the nine meter bars — a delta of EXACTLY 9, measured, not derived
  const CHIP_BUDGET = 19

  it(`no more than ${BUDGET} controls still use a hardcoded radius (ratchet — lower it, never raise it)`, () => {
    const byFile = findings.reduce<Record<string, number>>((a, f) => {
      a[f.file] = (a[f.file] ?? 0) + 1
      return a
    }, {})
    const top = Object.entries(byFile)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([f, n]) => `${f} (${n})`)
      .join(', ')
    expect(
      findings.length,
      `${findings.length} controls still bypass --radius-control. Biggest: ${top}. ` +
        `If this number went DOWN, lower BUDGET to match — that is the migration meter.`,
    ).toBeLessThanOrEqual(BUDGET)
  })

  it(`no more than ${CHIP_BUDGET} non-interactive chips still use a hardcoded radius (ratchet)`, () => {
    expect(
      chips.length,
      `${chips.length} badges/chips/rows bypass the skin radius. These are NOT excused — they are ` +
        `deferred pending a radius-only kit class. Sample: ${chips
          .slice(0, 5)
          .map((c) => `${c.file}:${c.line}`)
          .join(', ')}`,
    ).toBeLessThanOrEqual(CHIP_BUDGET)
  })
})
