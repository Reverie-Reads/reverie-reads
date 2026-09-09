import type { Book } from './types'
import { possessionState } from './ownership'

// State pills — the two book states that must be visible while browsing (docs/archive/task-state-pills.md).
//
// Borrowed and DNF are the states a reader can hold that nothing else on a browse surface reveals.
// DNF matters most: with the shelf model's breakdown toggle off, an abandoned book sits on a shelf
// labelled "Read", and the pill is what makes that honest rather than a lie the UI tells quietly.
//
// TWO pills, FIXED order, distinguished by SLOT and TEXT — never by colour alone. The order is
// reading order on a card: the read-status slot (top-left) is spoken and seen before the possession
// slot (bottom-right), so DNF precedes borrowed everywhere, including in accessible names and on
// spines (head before tail).

/** Did the reader abandon this book? Keyed on the recorded status, not on `isBookRead`.
 *
 *  `isBookRead` answers "finished it" and counts a logged read as proof — which is right for series
 *  progress and taste, and wrong here. A DNF book CAN carry a read-log row (you read part of it and
 *  logged the attempt), and if the pill deferred to `isBookRead` that book would wear "Read" while
 *  its recorded status says otherwise. The recorded status wins for display. */
export const isDnf = (b: Pick<Book, 'readStatus'>): boolean => b.readStatus === 'DNF'

/** Has a borrowed copy in hand. The derived possession WORD, so a book that is owned AND borrowed
 *  reads as owned — one book never wears two possession pills. */
export const isBorrowedBook = (b: Pick<Book, 'ownership' | 'borrowed' | 'wishlist'>): boolean =>
  possessionState(b) === 'borrowed'

/** Every pill the card can render. `read` is not a "state pill" in the borrowed/DNF sense — it
 *  predates them — but it shares their slot and their material, so it shares their implementation:
 *  one place to change, and one component guard covering all three rather than two of three. */
export type StatePillKind = 'dnf' | 'borrowed' | 'read'

/** Visible pill text. Short enough for a 132px card, and the abbreviation readers already use. */
export const STATE_PILL_LABEL: Record<StatePillKind, string> = {
  dnf: 'DNF',
  borrowed: 'Borrowed',
  read: 'Read',
}

/** Accessible phrasing for the two states that ride in a control's NAME (see stateSuffix). `read`
 *  is absent deliberately: its pill stays announceable in place, so adding it to the name too would
 *  say it twice — and changing that is a scope decision, not a contrast fix.
 *
 *  Not the visible text for DNF. "Dee-en-eff" tells a screen-reader user nothing; the expansion
 *  does. Safe to differ because the pill is not a control's own label — the control is the whole
 *  card/spine, and these are appended to ITS name. */
export const STATE_PILL_SPOKEN = { dnf: 'did not finish', borrowed: 'borrowed' } as const

/** The leading glyph, carried in the skin's accent. Decorative: the word beside it is the signal.
 *  `read` has none on purpose — it sits on most of the library, and adding a mark to hundreds of
 *  cards is a visual change, not the contrast fix this was. */
export const STATE_PILL_GLYPH: Record<StatePillKind, string> = {
  dnf: '⊘',
  borrowed: '⇄',
  read: '',
}

/**
 * The pill's material, as token REFERENCES rather than colours.
 *
 * SOLID, not translucent, and that is the whole point. The card marks this replaces sit on
 * `rgba(0,0,0,0.45)` over arbitrary cover art: against worst-case (white) artwork that composite is
 * #8c8c8c, where the nine skins' accents measure 1.1–2.7:1 and white ink reaches only ~3.2:1. Every
 * one of those fails AA, and nothing caught it — axe cannot measure text over an image, so the
 * translucent marks have always been structurally invisible to the sweep.
 *
 * `--card-solid` + `--ink` is the pair the registry-keyed contrast tests already pin at ≥4.5:1 for
 * all nine skins in both modes, and it does not care what is behind it. `--mark-accent` on the same
 * surface clears the 3:1 graphical bar for the glyph.
 *
 * Components MUST build pill styling from this object rather than inlining colours — statePill's
 * contrast test measures exactly these token names, and `statePill.contrast.test.ts` asserts the
 * values below are the tokens it measured. Inlining a colour in a component escapes both, which is
 * why `CoverCard` has its own component test asserting it uses this surface.
 */
export const STATE_PILL_TOKENS = {
  /** the opaque plate the pill sits on — never a translucent scrim over art */
  surface: 'var(--card-solid)',
  /** the pill's word: the signal, held to AA normal-text */
  label: 'var(--ink)',
  /** the leading glyph: skin voice, held to the 3:1 graphical bar */
  accent: 'var(--mark-accent)',
  /** the pill silhouette, so Tryst stays round and Aphelion stays squared */
  radius: 'var(--mark-radius)',
} as const

/** The SKIN_TOKENS field names the contrast test must measure, tied to the tokens above so the two
 *  cannot drift apart silently. */
export const STATE_PILL_TOKEN_FIELDS = {
  surface: 'cardSolid',
  label: 'ink',
  accent: 'markAccent',
} as const

/**
 * The state fragment appended to a browse control's accessible name, in the fixed order.
 *
 * Empty string when the book holds neither state, so callers concatenate unconditionally. On SPINES
 * this is the load-bearing channel: a 26px spine cannot carry text, so the edge marker is a
 * find-it-fast affordance and this is the actual information.
 */
export function stateSuffix(
  b: Pick<Book, 'readStatus' | 'ownership' | 'borrowed' | 'wishlist'>,
): string {
  const parts: string[] = []
  if (isDnf(b)) parts.push(STATE_PILL_SPOKEN.dnf)
  if (isBorrowedBook(b)) parts.push(STATE_PILL_SPOKEN.borrowed)
  return parts.length ? `, ${parts.join(', ')}` : ''
}

/**
 * State phrasing for a cover-sized browse tile that visibly carries the Read pill too.
 *
 * `stateSuffix` deliberately omits Read because CoverCard exposes that sibling pill directly to
 * assistive technology. Mood, trope, and Discover covers are each one labelled button, so their
 * explicit `aria-label` replaces every descendant's text. This companion keeps the visible and
 * spoken states aligned on those tiles without making every narrow spine announce ordinary Read.
 */
export function coverStateSuffix(
  b: Pick<Book, 'readStatus' | 'reads' | 'ownership' | 'borrowed' | 'wishlist'>,
): string {
  const parts: string[] = []
  if (isDnf(b)) parts.push(STATE_PILL_SPOKEN.dnf)
  else if (b.readStatus === 'Read' || b.reads.length > 0) parts.push('read')
  if (isBorrowedBook(b)) parts.push(STATE_PILL_SPOKEN.borrowed)
  return parts.length ? `, ${parts.join(', ')}` : ''
}
