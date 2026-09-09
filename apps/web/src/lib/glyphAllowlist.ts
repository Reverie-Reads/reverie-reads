/**
 * Every symbol/dingbat/technical-block character allowed to appear as UI chrome, and what's known
 * about each one rendering on Android.
 *
 * WHY THIS EXISTS. the power symbol (U+23FB) on the sign-out button rendered as tofu on Android
 * Chrome — Miscellaneous Technical's "power symbols" sub-range (U+23FB–U+23FE, added Unicode 6.0)
 * has patchy Android coverage: Roboto doesn't carry it, and it isn't emoji-presentation, so it
 * falls to whatever symbol-fallback font (or none) the OEM shipped. It slipped in unnoticed
 * because nothing checked a new glyph against known-risky ranges before it reached a component.
 *
 * WHY SKIN DOESN'T CHANGE THE ANSWER. All nine skins' custom webfonts are Google Fonts Latin
 * subsets, verified (via Google Fonts' own `unicode-range` descriptors for Hanken Grotesk, tryst's
 * sans — the widest of the nine) to stop around U+206F plus a few isolated math arrows. None of
 * them carry Arrows, Math Operators, Dingbats, or Misc Technical. So EVERY symbol glyph in this
 * app already falls through to the OS regardless of skin — the risk is a platform question, not a
 * per-skin one, and a glyph that's safe in one skin is safe in all nine, and vice versa.
 *
 * TIERS, not a flat allowlist, because most of the app's existing ~90 symbol glyphs have never
 * been checked against Android and auditing all of them by hand is its own piece of work (tracked
 * in docs/backlog/BACKLOG.md, not done here). Declaring them is still worth doing NOW: it is the
 * difference between "an unverified glyph" being a known, listed thing versus a silent addition
 * nobody chose to think about — which is exactly how U+23FB got in.
 *
 *   proven      Arrows (U+2190–U+21FF) and Math Operators (U+2200–U+22FF) — the blocks the
 *               pre-existing state-pill glyphs (⇄ ⊹ ⊘) come from, reported clean in production,
 *               and the same blocks Hanken Grotesk's own subset partially reaches (U+2191/2193/
 *               2212/2215) — plus real emoji, which Android renders via the system-wide
 *               Noto Color Emoji font regardless of the page's own fonts.
 *   sameRiskAsPowerSymbol   Misc Technical (U+2300–U+23FF) and Braille Patterns (U+2800–U+28FF) —
 *               the exact block families the power symbol came from. The remaining UI characters
 *               in these ranges were replaced with inline SVG; this tier stays empty so a future
 *               reintroduction cannot hide inside an old exception.
 *   unverified  Everything else already shipping: Box Drawing, Dingbats, Geometric Shapes, Misc
 *               Symbols, Supplemental Arrows-A. Plausibly fine — General Punctuation and basic
 *               filled shapes are near-universal — but not checked against a real Android device
 *               and not to be treated as proven by this file's existence.
 *
 * THE GUARD (glyphAllowlist.test.ts) scans every non-test source file for characters in the
 * ranges below and fails if one isn't declared in ANY tier. A new glyph must be added here,
 * consciously, in the tier that's actually true of it — the test cannot be satisfied by silence.
 */

/** Unicode blocks worth checking. Outside these, don't bother — Latin text isn't the risk. */
export const WATCHED_RANGES: readonly [number, number][] = [
  [0x2000, 0x2bff], // General Punctuation → Misc Symbols and Arrows
  [0x2800, 0x28ff], // Braille Patterns
  [0x1f300, 0x1faff], // Emoji & pictographs
]

/**
 * Ordinary prose typography, not icon glyphs — en/em dash, curly quotes, ellipsis. These sit in
 * General Punctuation alongside the actual risk (Arrows, Misc Technical, etc.) but are copy, not
 * chrome: every browser/OS ships them because Word documents and web copy depend on it. Excluding
 * them keeps the guard about the thing it exists for, instead of flagging every dash in the app.
 */
const PROSE_PUNCTUATION = new Set(['–', '—', '‘', '’', '“', '”', '…'])

const PROVEN: Record<string, string> = {
  '→': 'Arrows — rightwards; the app-wide "continue/next" mark',
  '←': 'Arrows — leftwards; back',
  '↔': 'Arrows — left-right; bidirectional',
  '↗': 'Arrows — north-east; external link',
  '↑': 'Arrows — up',
  '↓': 'Arrows — down',
  '↻': 'Arrows — clockwise open circle; refresh',
  '⇄': 'Arrows — proven in production via StatePill (borrowed)',
  '≥': 'Math Operators — greater-or-equal',
  '≤': 'Math Operators — less-or-equal',
  '≠': 'Math Operators — not-equal',
  '≈': 'Math Operators — approximately',
  '≡': 'Math Operators — identical-to',
  '≣': 'Math Operators — strictly-equivalent',
  '∅': 'Math Operators — empty set',
  '⊹': 'Math Operators — proven in production (wishlist mark)',
  '⊘': 'Math Operators — proven in production, StatePill (DNF)',
  '−': 'Math Operators — minus sign (not hyphen)',
}

/** Same block families as the removed power symbol. Shipping source must keep this tier empty. */
const SAME_RISK_AS_POWER_SYMBOL: Record<string, string> = {}

/** Shipping today; not yet checked against a real Android device. */
const UNVERIFIED: Record<string, string> = {
  '─': 'Box Drawing — JustFinishedSheet divider (504 uses)',
  '🌶': 'Emoji — CoverCard spice-level mark',
  '№': 'Letterlike Symbols U+2116 — CoverPlaceholder catalog-card number',
  '✓': 'Dingbats — AuthScreen check mark',
  '✕': 'Dingbats — Landing dismiss mark',
  '❦': 'Dingbats — CoverPlaceholder ornament',
  '▲': 'Geometric Shapes — SeriesArranger reorder',
  '▼': 'Geometric Shapes — SeriesArranger reorder',
  '♥': 'Misc Symbols — FilterPanel favorite',
  '❖': 'Dingbats — Nameplate ornament',
  '‸': 'General Punctuation — CoverPlaceholder caret',
  '✦': 'Dingbats — AppShell skin mark',
  '★': 'Misc Symbols — BookmarkGlyph rating star (text fallback)',
  '•': 'General Punctuation — bullet',
  '📅': 'Emoji — calendar',
  '📚': 'Emoji — books',
  '📖': 'Emoji — open book',
  '🔒': 'Emoji — lock',
  '✨': 'Dingbats — sparkles (emoji-presentation)',
  '📱': 'Emoji — mobile phone',
  '🎧': 'Emoji — headphone',
  '◀': 'Geometric Shapes — CoverImage nav',
  '▶': 'Geometric Shapes — CoverImage nav',
  '☾': 'Misc Symbols — ThemeToggle moon',
  '☀': 'Misc Symbols — ThemeToggle sun',
  '›': 'General Punctuation — PlannerRoute chevron',
  '‹': 'General Punctuation — PlannerRoute chevron',
  '♡': 'Misc Symbols — BookDetailRail unfavorited heart',
  '◐': 'Geometric Shapes — AppShell theme-system mark',
  '✉': 'Dingbats — AuthScreen envelope (emoji-presentation)',
  '○': 'Geometric Shapes — AuthScreen radio',
  '⚙': 'Misc Symbols — AppShell settings gear',
  '▣': 'Geometric Shapes — Nameplate mark',
  '📷': 'Emoji — camera',
  '⟲': 'Supplemental Arrows-A — MoodRoute rotate',
  '▾': 'Geometric Shapes — LabRoute disclosure',
  '🔗': 'Emoji — link',
  '🙈': 'Emoji — see-no-evil (AuthScreen password toggle)',
  '👁': 'Emoji — eye (AuthScreen password toggle)',
  '🗝': 'Emoji — old key (WelcomeScreen)',
  '🕯': 'Emoji — candle (WelcomeScreen)',
  '✶': 'Dingbats — BookDetailRail ornament',
  '▦': 'Geometric Shapes — AppShell nav',
  '◫': 'Geometric Shapes — AppShell nav',
  '◷': 'Geometric Shapes — AppShell nav',
  '◔': 'Geometric Shapes — AppShell nav',
  '✧': 'Dingbats — AppShell nav',
  '❀': 'Dingbats — AppShell nav',
  '☞': 'Misc Symbols — AppShell nav',
  '⟩': 'Misc Math Symbols-A — AppShell',
  '⟨': 'Misc Math Symbols-A — AppShell',
  '⋯': 'General Punctuation — AppShell overflow',
  '🗓': 'Emoji — spiral calendar (PlannerRoute)',
  '🔓': 'Emoji — open lock (SkinGalleryRoute)',
  '✎': 'Dingbats — SeriesRoute edit (emoji-adjacent)',
  '⟳': 'Supplemental Arrows-A — SeriesRoute reload',
  '🔁': 'Emoji — repeat (StatsRoute)',
  '🔥': 'Emoji — fire (StatsRoute)',
  '🕑': 'Emoji — clock (IndieScreen)',
  '📍': 'Emoji — pushpin (IndieScreen)',
  '🔎': 'Emoji — magnifying glass (AddRoute)',
  '⚠': 'Misc Symbols — SettingsRoute warning (emoji-presentation)',
  '🔍': 'Emoji — magnifying glass (SettingsRoute)',
  '🧹': 'Emoji — broom (SettingsRoute)',
  '⬇': 'Misc Symbols and Arrows — SettingsRoute export',
  '⬆': 'Misc Symbols and Arrows — SettingsRoute import',
  '👥': 'Emoji — busts in silhouette (ClubsRoute)',
  '💘': 'Emoji — heart with arrow (HomeRoute)',
  '🎲': 'Emoji — game die (HomeRoute)',
  '▸': 'Geometric Shapes — SeriesIndexRoute',
  '◇': 'Geometric Shapes — skinVoice',
  '†': 'General Punctuation — skinVoice dagger',
  '✱': 'Dingbats — skinVoice ornament',
}

export const GLYPH_TIERS = {
  proven: PROVEN,
  sameRiskAsPowerSymbol: SAME_RISK_AS_POWER_SYMBOL,
  unverified: UNVERIFIED,
} as const

/** Every declared glyph, any tier — what the guard checks new source against. */
export const ALL_DECLARED_GLYPHS: ReadonlySet<string> = new Set([
  ...Object.keys(PROVEN),
  ...Object.keys(SAME_RISK_AS_POWER_SYMBOL),
  ...Object.keys(UNVERIFIED),
])

/** True for a character worth checking — inside a watched Unicode range. */
export function isWatchedGlyph(ch: string): boolean {
  if (PROSE_PUNCTUATION.has(ch)) return false
  const cp = ch.codePointAt(0)
  if (cp === undefined) return false
  return WATCHED_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi)
}
