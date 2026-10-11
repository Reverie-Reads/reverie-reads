import { bookGuidance } from './contentGuidance'
import type { Book } from './types'
import { isBookRead } from './filters'
import { buildTasteProfile, tasteFit, type TasteProfile } from './tasteProfile'

// Genre-agnostic "vibe matcher" — Tier 0 rewrite (2026-07, owner-approved).
//
// The old scorer was a hand-tuned linear formula (tags×14 + subgenre×6 + rating×2 + unread+20 …):
// magic numbers, exact-string tags where a rare tag counted the same as a ubiquitous one, no series
// awareness, rereads punished as "already read", DNFs accidentally REWARDED (no logged reads → the
// unread bonus), and a bare number out — nothing to explain a pick with.
//
// This version keeps the same inputs (a quiz/mood profile + the reader's own library) but:
//  · every component is NORMALIZED to 0..1 and blended through named WEIGHTS → the score is 0..100
//    and each pick carries structured REASONS (the UI renders copy; core returns data);
//  · shared tags are RARITY-WEIGHTED against the reader's own library (a shared rare tag says far
//    more than a shared ubiquitous one — TF-IDF in spirit, df from the library);
//  · SERIES MOMENTUM: the next unread book of a series the reader is loving gets a strong boost;
//    book N of a series they haven't started is suppressed instead of ranked like book 1;
//  · NOVELTY and QUALITY are separated: unread still leads, but a much-reread book is a love
//    signal, not "seen it" — and DNF is finally a real negative on both axes.
// Absent optional signals (no target darkness, empty cravings) sit at a 0.5 NEUTRAL so a missing
// signal never advantages or tanks a book. Pure + deterministic throughout.

export interface MatchProfile {
  /** weight per subgenre/genre name the reader leaned toward in the quiz */
  subWeights: Record<string, number>
  /** tags the reader is craving (matched against book.tags, case-insensitive) */
  wantTags: string[]
  /**
   * Desired DARKNESS 0..5, or null for no preference.
   *
   * Renamed from `targetIntensity` when the two axes were split (owner ruling, 2026-08-21). The
   * quiz has always been this field's only producer, and its question — "How intense do you want
   * it?", answered "Gentle & comforting" through "As extreme as it gets" — was darkness language
   * scoring against the SPICE column. Renaming rather than keeping both is what stops the profile
   * carrying a field nothing fills. Spice is simply not scored: nothing asks about it.
   */
  targetDarkness: number | null
}

export type MatchReasonKey =
  | 'tags'
  | 'tasteTags'
  | 'subgenre'
  | 'tasteWorld'
  | 'darkness'
  | 'quality'
  | 'novelty'
  | 'series'

export interface MatchReason {
  key: MatchReasonKey
  /** the normalized component value, 0..1 (0.5 = neutral/no signal) */
  value: number
  /** this component's share of the final score (weight × value, in score points) */
  contribution: number
  /** which craved tags this book actually carries (key === 'tags') */
  matchedTags?: string[]
  /** the book's tags the reader demonstrably loves (key === 'tasteTags') */
  lovedTags?: string[]
  /** series detail (key === 'series') */
  series?: {
    name: string
    position: number | null
    lovedEarlier: boolean
    unstartedEarlier: boolean
  }
}

export interface MatchScore {
  /** 0..100 — a real percentage of the weighted blend, not a vanity clamp */
  score: number
  /** every component, sorted by contribution (desc) — the UI's "why this pick" source */
  reasons: MatchReason[]
}

interface SeriesState {
  readPositions: number[]
  /** mean of the reader's OWN ratings across the series' read books (rated ones), else null */
  avgReadRating: number | null
}

export interface MatchContext {
  /** lowercased tag → rarity weight 0..1 (1 = rarest in this library) */
  tagRarity: Record<string, number>
  /** series name → the reader's progress in it */
  series: Record<string, SeriesState>
  /** the LEARNED standing taste (Tier 1) — ratings/rereads/faves/DNFs distilled per tag + world */
  taste?: TasteProfile
  /** feedback capture: bookId → epoch-ms the reader said "not tonight" (decays over 60 days) */
  dismissedAt?: Record<string, number>
  /** the clock the context was built with (injected for determinism) */
  now: number
}

/** Named weights — Σ = 1, so the blended score reads as a percentage. Tuned, not sacred: they live
 *  in ONE place precisely so they can be argued with (and later learned from feedback). */
export const MATCH_WEIGHTS: Record<MatchReasonKey, number> = {
  tags: 0.25, // the quiz's cravings — the loudest single voice (absorbed the retired archetype's 0.05)
  tasteTags: 0.13, // …but the LEARNED tag taste now speaks alongside it
  subgenre: 0.1,
  tasteWorld: 0.07,
  darkness: 0.12,
  quality: 0.08,
  novelty: 0.15,
  series: 0.1,
}

const NEUTRAL = 0.5

const positionOf = (b: Book): number | null =>
  typeof b.position === 'number' ? b.position : Number(b.position) || null

/** Precompute the library-derived signals (tag rarity + series progress) once per match run. */
export function buildMatchContext(
  books: readonly Book[],
  opts: { dismissedAt?: Record<string, number>; now?: number } = {},
): MatchContext {
  const now = opts.now ?? Date.now()
  const df = new Map<string, number>()
  for (const b of books) {
    for (const t of new Set(b.tags.map((x) => x.toLowerCase()))) df.set(t, (df.get(t) ?? 0) + 1)
  }
  const n = Math.max(1, books.length)
  const tagRarity: Record<string, number> = {}
  // idf, normalized so a tag on exactly one book = 1.0 and a tag on every book stays small-but-nonzero
  const denom = Math.log(1 + n)
  for (const [t, d] of df) tagRarity[t] = Math.log(1 + n / d) / denom

  const series: Record<string, SeriesState> = {}
  for (const b of books) {
    if (!b.series || !isBookRead(b)) continue
    const st = (series[b.series] ??= { readPositions: [], avgReadRating: null })
    const pos = positionOf(b)
    if (pos != null) st.readPositions.push(pos)
    if (b.rating > 0)
      st.avgReadRating = st.avgReadRating == null ? b.rating : (st.avgReadRating + b.rating) / 2
  }
  return {
    tagRarity,
    series,
    taste: buildTasteProfile(books, { now }),
    dismissedAt: opts.dismissedAt,
    now,
  }
}

/** Score one book against a reader profile + library context. Pure + deterministic. */
export function scoreMatch(b: Book, p: MatchProfile, ctx?: MatchContext): MatchScore {
  const reasons: MatchReason[] = []
  const add = (key: MatchReasonKey, value: number, extra?: Partial<MatchReason>) => {
    const v = Math.max(0, Math.min(1, value))
    reasons.push({
      key,
      value: v,
      contribution: Math.round(MATCH_WEIGHTS[key] * v * 1000) / 10,
      ...extra,
    })
  }

  // tags — rarity-weighted overlap of the cravings with the book's own tags
  if (p.wantTags.length) {
    const bookTags = new Set(b.tags.map((t) => t.toLowerCase()))
    const rarity = (t: string) => ctx?.tagRarity[t.toLowerCase()] ?? NEUTRAL
    const matched = p.wantTags.filter((t) => bookTags.has(t.toLowerCase()))
    const wantedWeight = p.wantTags.reduce((s, t) => s + rarity(t), 0)
    const matchedWeight = matched.reduce((s, t) => s + rarity(t), 0)
    add('tags', wantedWeight > 0 ? matchedWeight / wantedWeight : 0, { matchedTags: matched })
  } else {
    add('tags', NEUTRAL)
  }

  // subgenre/genre — the profile's lean, normalized to its own strongest lean
  const subValues = Object.values(p.subWeights)
  if (subValues.length) {
    const maxW = Math.max(...subValues, 1)
    add('subgenre', (p.subWeights[b.subgenre] ?? p.subWeights[b.genre] ?? 0) / maxW)
  } else {
    add('subgenre', NEUTRAL)
  }

  // learned taste (Tier 1) — the standing baseline under the quiz's mood: how this book's tags
  // and world sit with what the reader actually rates, rereads, faves — and DNFs
  const fit = ctx?.taste?.signalCount ? tasteFit(b, ctx.taste) : null
  if (fit) {
    add('tasteTags', fit.tagFit, fit.lovedTags.length ? { lovedTags: fit.lovedTags } : undefined)
    add('tasteWorld', fit.worldFit)
  } else {
    add('tasteTags', NEUTRAL)
    add('tasteWorld', NEUTRAL)
  }

  // darkness — distance to target. UNKNOWN sits at 0.75: mildly neutral, a deliberate change from
  // the old "no penalty" (which let a no-data book tie a perfect fit). Reads bookGuidance(b).darkness since the
  // split; every existing book is null here until a reader assesses it, so most books take the
  // 0.75 unknown branch rather than being scored against a heat value that answered a different
  // question.
  const darkness = bookGuidance(b).darkness
  if (p.targetDarkness == null) add('darkness', NEUTRAL)
  else if (darkness == null) add('darkness', 0.75)
  else add('darkness', 1 - Math.abs(darkness - p.targetDarkness) / 5)

  // quality — the reader's OWN verdicts: rating, rereads as a love signal, DNF as a real negative
  const dnf = b.readStatus === 'DNF'
  let quality = b.rating > 0 ? b.rating / 5 : 0.55
  if (b.reads.length >= 2) quality = Math.min(1, quality + 0.15)
  if (dnf) quality = 0.15
  add('quality', quality)

  // novelty — unread leads; reads may resurface as rereads; DNF is not "fresh", it's rejected.
  // "Not tonight" feedback folds in here: a fresh dismissal floors novelty and recovers over 60 days.
  const read = isBookRead(b)
  let novelty = dnf ? 0.05 : read ? 0.3 : b.readStatus === 'Reading' ? 0.55 : 1
  const dismissedTs = ctx?.dismissedAt?.[b.id]
  if (dismissedTs != null && ctx) {
    const days = Math.max(0, (ctx.now - dismissedTs) / 86_400_000)
    if (days < 60) novelty = Math.min(novelty, 0.1 + 0.4 * (days / 60))
  }
  add('novelty', novelty)

  // series momentum — the single highest-value library signal
  const pos = positionOf(b)
  const st = b.series ? ctx?.series[b.series] : undefined
  if (b.series && !read && !dnf) {
    const earlierRead =
      !!st &&
      st.readPositions.length > 0 &&
      (pos == null || st.readPositions.some((rp) => rp < pos))
    const lovedEarlier = earlierRead && (st?.avgReadRating ?? 0) >= 4
    const unstartedEarlier = pos != null && pos > 1 && !st?.readPositions.length
    const value = lovedEarlier ? 1 : earlierRead ? 0.7 : unstartedEarlier ? 0.15 : NEUTRAL
    add('series', value, {
      series: { name: b.series, position: pos, lovedEarlier, unstartedEarlier },
    })
  } else {
    add('series', NEUTRAL)
  }

  const score = Math.round(reasons.reduce((s, r) => s + MATCH_WEIGHTS[r.key] * r.value, 0) * 100)
  reasons.sort((a, z) => z.contribution - a.contribution)
  return { score, reasons }
}
