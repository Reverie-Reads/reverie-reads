import { FILL_BLANK_FIELDS, mergeDifferences, mergeImport, type Incoming } from './match'
import type { Book } from './types'

/**
 * Per-field control over what a duplicate merge takes — the checkbox model behind DuplicateReview.
 *
 * ── IT CONSUMES `FILL_BLANK_FIELDS`, IT DOES NOT FORK IT ─────────────────────────────────────────
 * #302 extracted that table so a field cannot be reclassified without every consumer following.
 * This is its THIRD consumer (after `mergeImport` and `mergeDifferences`), and it reads `key`,
 * `label`, `existingBlank`, `incomingHas` and `show` from the same entries. Where the UI needed
 * something the table lacked, the answer was to derive it from those predicates — never to keep a
 * parallel list here.
 *
 * ── TWO CAPABILITIES, AND THE THIRD IS DELIBERATELY ABSENT ───────────────────────────────────────
 * `kind: 'add'`     — the reader's side is blank and the import has a value. Today it is always
 *                     taken; unchecking means "leave mine blank".
 * `kind: 'replace'` — BOTH sides are set. Today the reader's value always wins and the import's is
 *                     silently discarded (that discard is what #302's differs line narrates).
 *                     Checking this takes theirs. This is genuinely NEW capability and the reason
 *                     the feature exists — it is what the `rating` case wanted.
 *
 * NOT OFFERED: declining a tags/genres UNION. Union is additive and non-destructive — nothing is
 * lost by folding the other side in, so "don't fold" is a materially weaker need than the two
 * above, and every option on this panel is paid for on every card of a several-hundred-row import.
 * If a reader ever wants it, it belongs here as a third `kind`, not as a second surface.
 *
 * ── FIELDS THE UI MUST NOT OFFER, BECAUSE THE WRITE PATH WOULD IGNORE IT ─────────────────────────
 * `plan` moves WHOLE-OR-NOT-AT-ALL (merge_books_authoritative decides once and all five columns
 * follow), and `series_user_chosen` is DERIVED server-side rather than taken from the caller. A
 * checkbox for either would lie about what it does. They are excluded by construction below: the
 * options come from FILL_BLANK_FIELDS, which contains neither. Do not add them.
 *
 * `rating` IS offered, and deliberately — it is a fill-blank field (the engine fills a blank
 * rating, never overwrites a set one), so when both sides carry a rating this produces a 'replace'
 * row DEFAULTING TO OFF. That is the case capability 2 exists for: today a reader's 4.5 against an
 * import's 5 is discarded silently, and the only way to take the import's value is to retype it by
 * hand. Off by default means nothing moves unless a reader asks for it.
 *
 * `owned`, `fave` and `progress` are absent for a different reason: they are not in the table at
 * all, because `mergeImport` never touches them.
 */

/** One selectable field on the merge card. `take` is the ENGINE'S answer — the default. */
export interface MergeFieldOption {
  key: string
  label: string
  /** what the reader has now, rendered ('' when blank) */
  mine: string
  /** what the import offers, rendered */
  theirs: string
  /** 'add' fills a blank (default ON); 'replace' overrides a set value (default OFF) */
  kind: 'add' | 'replace'
  /** the engine's own answer, and therefore the checkbox's initial state */
  take: boolean
}

/** Selection state: field key → take it. Absent keys mean "use the engine's default". */
export type MergeFieldPicks = Readonly<Record<string, boolean>>

/**
 * The rows to render for one candidate. Only fields with something to decide appear: a field both
 * sides leave blank, or where the import offers nothing, is not a choice and would be noise.
 */
export function mergeFieldOptions(existing: Book, incoming: Incoming): MergeFieldOption[] {
  const out: MergeFieldOption[] = []
  // 'replace' rows come from `mergeDifferences` rather than a second "both set and different"
  // test written here: that predicate has subtleties (compare the RENDERED string; a field with
  // no `show` is unreportable and so unofferable — cover, status, source) and two copies of it
  // could drift apart silently. Fields it omits get no checkbox, which is the right answer: a
  // control offering to swap a value it cannot display is worse than no control.
  const contested = new Map(mergeDifferences(existing, incoming).map((d) => [d.key, d]))
  for (const f of FILL_BLANK_FIELDS) {
    if (!f.incomingHas(incoming)) continue // nothing offered — nothing to decide
    if (f.existingBlank(existing)) {
      const theirs = f.show ? f.show(incoming) : ''
      out.push({ key: f.key, label: f.label, mine: '', theirs, kind: 'add', take: true })
      continue
    }
    const d = contested.get(f.key)
    if (d)
      out.push({
        key: f.key,
        label: f.label,
        mine: d.kept,
        theirs: d.offered,
        kind: 'replace',
        take: false,
      })
  }
  return out
}

/**
 * The patch to write, given the reader's picks.
 *
 * Starts from `mergeImport`'s own result — so with no picks, or with every checkbox left at its
 * default, THE OUTPUT IS THE ENGINE'S OUTPUT, unchanged. That equivalence is the regression
 * guarantee this feature rests on: accepting a merge without touching anything must write exactly
 * what it wrote before the picker existed.
 */
export function applyFieldPicks(
  existing: Book,
  incoming: Incoming,
  picks: MergeFieldPicks = {},
): Partial<Book> {
  const patch: Partial<Book> = { ...mergeImport(existing, incoming).patch }
  for (const opt of mergeFieldOptions(existing, incoming)) {
    const take = picks[opt.key] ?? opt.take
    if (take === opt.take) continue // default — the engine already decided it
    const field = FILL_BLANK_FIELDS.find((f) => f.key === opt.key)
    if (!field) continue
    if (take) field.apply(patch as Record<string, unknown>, incoming)
    else delete (patch as Record<string, unknown>)[opt.key]
  }
  return patch
}
