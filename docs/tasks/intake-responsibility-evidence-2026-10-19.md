# Responsibility evidence and identity review — October 19, 2026

The review-only Open Library adapter previously discarded `by_statement` while treating linked
`authors[]` names as author observations. It retained `contributions[]` prose without making that
uninterpreted evidence an identity hold. Title, names and exact ISBN could therefore compare as
consistent despite an unresolved statement of editorial or other responsibility.

## Verified source contract and fix

The official [edition schema](https://openlibrary.org/type/edition) defines `by_statement` as a string
and `contributions` as separate strings, alongside author relationships. The
[work/edition field guide](https://openlibrary.org/about/work_edition) includes mixed responsibility
prose. These fields do not supply a safe general grammar for assigning names, roles or parts.

The adapter now retains a bounded literal `responsibilityStatement` separately from
`creditStatements`. Whitespace, punctuation and source order remain intact. Invalid types and
overlong values fail the observation rather than silently becoming absence. Empty/whitespace-only
bylines contain no observation. The packet validator accepts the optional field only on successful
observations, with a 1,000-code-unit limit. No database, personal book or contributor-enum change.

Either responsibility prose or unparsed contribution statements adds `responsibility_unreviewed`
to identity and dependent claim decisions, including ISBN-only intake. Title/name/ISBN diagnostics
remain visible, including actual mismatches and ambiguous initials. Linked `authors` remain labeled
provider assertions; no roles or split names are manufactured from prose. The transient viewer shows
the separate original statement as escaped inert text. Aggregate diagnostics retain counts and
review codes, never the statement. A responsibility-only hold cannot manufacture an ISBN
contradiction against a separately admitted peer; actual identity conflicts keep their gates.

This conservative rule also holds useful ordinary author bylines. It reduces automatic identity
coverage wherever such text remains uninterpreted; those candidates are unresolved, not proven
wrong books. A narrower byline grammar needs separate qualification and tests. No client assertion
clears the hold, and current values remain preserved.

## New frozen development comparison

Before Open Library acquisition, Codex inspected first-party edition references:

- [The Hexologists, ISBN 9780316443302](https://www.hachettebookgroup.com/titles/josiah-bancroft/the-hexologists/9780316443302/):
  paperback, Josiah Bancroft, 336 pages.
- [The Big Book of Science Fiction, ISBN 9781101910092](https://www.penguinrandomhouse.com/books/248846/the-big-book-of-science-fiction-by-edited-by-ann-and-jeff-vandermeer/9781101910092/):
  paperback, 1,216 pages, explicitly edited by Jeff VanderMeer and Ann Vandermeer. This establishes
  the listed role subset, not complete credits or whole-book authorship.

Five cases over **two works/editions** cover a full-author positive, invented wrong author, initials,
editor-as-author and ISBN-only editor-led intake. Publisher references, expected decisions, previous
case exclusions and code hash were frozen before the single acquisition. This is a Codex-reviewed
development comparison, not independent human gold, locked qualification or population accuracy.
No private reader/corpus or locked qualification identities were opened. A different book exposed
by a broad search before freeze was explicitly excluded from unseen references.

| Measurement                                                   | Observed result                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| Open Library transport                                        | 7 requests: 2 permitted edition redirects, 5 successful responses |
| Observed cases                                                | 5 / 5; no failures, caps or unobserved cases                      |
| Negative controls held                                        | 4 / 4                                                             |
| Editor-led controls held on unresolved responsibility         | 2 / 2                                                             |
| Full-author positive identity admitted                        | 0 / 1; held on title mismatch                                     |
| Positive held by the new responsibility rule                  | 0 / 1; no responsibility statement observed                       |
| Proposed fields, resolved works/editions, writes, model calls | 0                                                                 |

The named editor control's title and ISBN are exact; its names score exact plus formatting.
The ISBN-only control naturally has no requested title/names. Both retain responsibility holds.
The positive has exact ISBN and author agreement but fails the existing title comparison. That
failure remains retained. Because aggregate receipts do not preserve provider text, this run cannot
establish whether the title difference is formatting or wrong metadata. No relaxed title rule or
success claim follows. No retry, replacement or second acquisition of the consumed frame occurred.
The ordinary-byline coverage cost is demonstrated by synthetic tests, not estimated by this frame.

All adapters remain `review_only`; upstream independence, catalog retention, export and model-input
qualification are unchanged. Refreshed [API guidance](https://openlibrary.org/developers/api) supports
bounded human-facing lookup and recommends caching while directing bulk use to dumps. Its
[licensing statement](https://openlibrary.org/developers/licensing) does not settle every
contribution's prior rights. This stage made only those bounded Open Library requests: no
Hardcover/PRH API call, new provider, bulk harvest, stored provider payload or prose/model input.
Publisher references establish these facts, not a blanket API-use or storage grant.

Frame hash: `f69e4d7f6a54f0e51e811f0ec994a2ed2eaf3ab9708d160ba618b72131e12764`.
System hash: `c10ded418a6b46437467dbe93e40a093547e6ef9fce445f7bfc36d34d89780bf`.
Private frame, exclusions, permanent attempt marker and aggregate report remain under the operator's
`intake-responsibility-2026-10-19` receipts and Git common directory, never a catalog/import payload.

## Verification and remaining boundaries

Eighteen focused regressions cover literal/multilingual/hostile text, ordinary bylines, mixed
credits, absent/blank fields, malformed/overlong statements, independent bounds, failed-observation
rejection, ISBN-only intake, initials/ISBN conflicts, existing values and valid-peer isolation.
The actual viewer rendering check verifies escaping and the explicit hold. Whole-repository and
fresh-database browser outcomes belong in the PR verification record. Independent read-only review
found no blocking implementation or reporting discrepancy.

No production changes, Add/scan/import cutover, metadata fills or reading-history edits. Luna cost
this stage is $0. The shared durable ledger reports $50 ceiling, $20.739314750 conservative burden,
$29.260685250 remaining, no reservations/unsettled calls and unconfigured pricing. Photo/collection
intake is being developed separately. Next, investigate the retained title discrepancy without
replaying this consumed comparison and qualify only the field/use needed for a reviewed correction.
Unsupported roles, identities, editions and claims remain held.
