import {
  isStrong,
  matchBook,
  normalizeIsbn,
  workIdentityPart,
  workKeyOf,
  type Book,
} from '@reverie/core'
import { resultToIncoming, selectedSearchIsbn, type SearchResult } from './search'
import type { WorkRow } from '../data/works'

/**
 * ADD-SEARCH TRIAGE — is this catalog result something the reader already has, something the
 * corpus already describes, or genuinely new?
 *
 * Pure on purpose: `(results, library, corpus) → labelled results`, no React, no network, no
 * ordering dependence. The reason readers re-add books they own and hand-fill books the corpus
 * could prefill is that the Add list said nothing about either; the DECIDING is the part worth
 * testing, and it is testable without a browser.
 *
 * TAKES `SearchResult[]`, NOT Add's own five-field `SearchHit[]`. The hit drops `series` and
 * `seriesPosition`, and those are exactly the fields matchBook's `title-series-pos` leg reads —
 * classifying after that truncation would silently disable one of the matcher's four legs while
 * still looking like it worked.
 *
 * NORMALIZERS ARE IMPORTED, NEVER REIMPLEMENTED (corpus-import-lib's rule, and it applies here for
 * the same reason): `workIdentityPart`, `matchBook` and `workKeyOf` are core's. A local copy
 * would drift from the importer that writes `works.work_key` and from the intake that decides a
 * duplicate, and the drift would show up as a lookup that quietly never matches.
 */

/** Which of the three states a result is in. A result can be in the library AND the corpus; the
 *  library half wins the primary action, so it leads the state and the corpus half rides along. */
export type TriageState = 'library' | 'corpus' | 'new'

export interface TriagedResult {
  result: SearchResult
  state: TriageState
  /** the reader's existing book, when `state` is 'library' — the "Open it" target */
  book: Book | null
  /** the corpus row describing this result, when there is one. Present on 'corpus' AND on
   *  'library'-plus-corpus, because the copy names both rather than dropping the corpus half. */
  work: WorkRow | null
}

/**
 * THE EMPTY-AUTHOR GUARD NOW LIVES IN CORE — this is deliberately a thin call.
 *
 * This function used to carry its own guard (#353): `matchBook`'s title-author leg keyed on
 * `norm(title) + '|' + norm(last)`, so a single-word author or a catalog row with no author at all
 * produced `` `title|` `` and matched ANY authorless library book — a false "you already own this",
 * which is the worst of the three states to get wrong because it withholds the add control for a
 * book the reader does not have. The local workaround re-asked against the library minus its
 * authorless rows.
 *
 * `feat/matchbook-hardening` moved that guard into `matchBook` itself, where every caller gets it
 * (Discover's `libraryMatch`, CSV/bulk import, this). KEEPING THE LOCAL COPY WOULD NOW BE A
 * REGRESSION, not defense in depth, and that is why it is gone rather than left as a belt:
 * `matchBook` gained a full-author leg, so a single-word author like 'Homer' is a REAL name that
 * legitimately matches a 'Homer' book. The old guard keys off `last` being empty — which is still
 * true for 'Homer' — and would retry against a library filtered to non-empty `last`, throwing away
 * the very row that correctly matched. The local guard cannot tell "no author" from "one-word
 * author"; core's can, because it asks whether the folded name is empty rather than whether the
 * surname field is.
 */
function libraryHit(r: SearchResult, library: readonly Book[]): Book | null {
  const m = matchBook(resultToIncoming(r), library)
  return isStrong(m.strength) ? m.book : null
}

/** The corpus identity of a catalog result: normalized title + normalized FULL author name — core's
 *  `workKeyOf`, the same function the corpus importer writes `works.work_key` with. Empty when the
 *  result has no author or no title, so it can never key as `` `title|` `` and collide with every
 *  authorless corpus row — the library-side trap above, on the other side of the join. */
export function resultWorkKey(r: SearchResult): string {
  const author = (r.authors[0] ?? '').trim()
  if (!workIdentityPart(author) || !workIdentityPart(r.title)) return ''
  return workKeyOf({ title: r.title, last: author })
}

/**
 * A corpus row's identity — DERIVED from its own title + author, and its stored `work_key` too.
 *
 * `works.work_key` is documented as "enrichment_cache.work_id when the work has been resolved, else
 * the normalized title|author pair" — two possible shapes in one column. Deriving gives the same
 * answer as the importer for every row the importer wrote, and still matches a row whose stored key
 * took the work_id shape; checking both means neither shape is a silent miss. Rows with no author
 * contribute only their stored key, never a `` `title|` `` derived one.
 */
export function workRowKeys(w: WorkRow): string[] {
  const author = (w.contributors ?? []).map((c) => c.name).find((n) => !!workIdentityPart(n)) ?? ''
  const derived =
    workIdentityPart(author) && workIdentityPart(w.title)
      ? workKeyOf({ title: w.title, last: author })
      : ''
  return [derived, w.work_key].filter((k): k is string => !!k)
}

/** One catalog result may expose the same edition through any of these fields. Canonicalizing here
 * makes ISBN-10 scans join the ISBN-13 values persisted on works. */
export function resultIsbn(r: SearchResult): string {
  return selectedSearchIsbn(r)
}

/**
 * Label every result.
 *
 * `corpus` may be null while its query is still in flight — results are then labelled on the
 * library alone and gain their corpus half when it resolves. That is what keeps the list from
 * waiting on a second round trip to render at all, which on a fast connection is a regression
 * nobody would see.
 */
export function triageResults(
  results: readonly SearchResult[],
  library: readonly Book[],
  corpus: readonly WorkRow[] | null | undefined,
): TriagedResult[] {
  const byKey = new Map<string, WorkRow>()
  const byIsbn = new Map<string, WorkRow>()
  const ambiguousKeys = new Set<string>()
  const ambiguousIsbns = new Set<string>()
  for (const w of corpus ?? []) {
    for (const k of workRowKeys(w)) {
      if (ambiguousKeys.has(k)) continue
      const prior = byKey.get(k)
      if (!prior) byKey.set(k, w)
      else if (prior.work_key !== w.work_key) {
        byKey.delete(k)
        ambiguousKeys.add(k)
      }
    }
    for (const raw of w.isbns ?? []) {
      const isbn = normalizeIsbn(raw)
      if (!isbn || ambiguousIsbns.has(isbn)) continue
      const prior = byIsbn.get(isbn)
      if (!prior) byIsbn.set(isbn, w)
      else if (prior.work_key !== w.work_key) {
        // Unexpected cross-work collisions are ambiguous, never "first row wins". The owner-run
        // importer rejects these before writing, but old/manual data must still fail in the safe
        // direction here: no corpus classification rather than attaching the wrong work.
        byIsbn.delete(isbn)
        ambiguousIsbns.add(isbn)
      }
    }
  }

  return results.map((result) => {
    const book = libraryHit(result, library)
    const isbn = resultIsbn(result)
    const rk = resultWorkKey(result)
    // ISBN joins still require compatible title/full-author identity. A contradictory source
    // cannot silently replace the selected bibliography with a shared-work prefill.
    // An ISBN collision is terminal. Falling through to a title match here would let the client
    // offer a corpus attachment that the SQL identity boundary must reject as ambiguous.
    const work =
      ambiguousIsbns.has(isbn) ||
      (isbn && byIsbn.has(isbn) && !workRowKeys(byIsbn.get(isbn)!).includes(rk))
        ? null
        : ((isbn ? byIsbn.get(isbn) : undefined) ??
          (rk && !ambiguousKeys.has(rk) ? byKey.get(rk) : undefined) ??
          null)
    return { result, book, work, state: book ? 'library' : work ? 'corpus' : 'new' }
  })
}

/**
 * The reader-facing line for a state. TEXT — never colour alone, never an icon alone; the state has
 * to survive greyscale, a colour-blind reader and a screen reader equally. (It also must not ride
 * `--accent-fill`, which measures 1.00:1 against `--card` in almanac/dark.)
 *
 * The both-states case NAMES both rather than silently dropping the corpus half: the library wins
 * the primary action, but "the corpus has a full record for this too" is the reason a reader might
 * still want the corpus prefill, so it stays visible.
 */
export function triageLabel(t: Pick<TriagedResult, 'state' | 'work'>): string {
  if (t.state === 'library')
    return t.work ? 'In your library · also in the corpus' : 'In your library'
  if (t.state === 'corpus') return 'In the corpus'
  return 'New to your library'
}
