# Creator-role guard and frozen comparison

Owner direction: fix the editor-as-author match, compare against new verified non-LLM references,
preserve personal data and keep ambiguous credits under review before any intake cutover.

## Change and regression evidence

The prior consumed comparison identified a Hardcover candidate that matched an editor-as-creator
query. The adapter retained the editor role correctly, but the resolver's whole-work creator list
included editors. That rule also affected cross-source work identity, existing identity checks,
series membership and diagnostics. Exact ISBN and title did not expose the mistake.

The creator list now excludes editors. Original credits, ordering, literal roles, source basis and
named parts remain intact. A separately explicit author role can establish identity even when that
person also has an editor credit. Different editors do not split an otherwise matching creator set,
but conflicting credit rosters still require review. Editor-only collections stay held, including
ISBN-only scans; no role-aware edited-collection identity is invented in this slice. Missing or
unsupported roles remain unknown. Provider mislabelling someone as an author is a separate source
quality risk, so all existing source qualification holds remain.

Four new regression assertions failed before the fix, including the real Hardcover-adapter-to-
resolver path. Afterward, all 150 targeted tests passed. The anthology development fixture now
expects review while asserting its original credits remain intact. This is an intentional coverage
tradeoff, not a renamed successful resolution. No existing writer or persisted identity key changes.

## Frozen protocol

Eight new editions across six works are paired with eight controls naming each edition's verified
editor instead of its author. Two additional ISBN-only probes repeat existing editions and do not
increase the distinct-edition denominator. Twenty-three selected reference credits check names,
roles, part scope and edition basis; they are not complete contributor rosters. No manual-source
admission arm is included: this run isolates provider acquisition and role-sensitive matching.

| Publisher reference                                                                                                       | Format    | Pages | Verified editor   |
| ------------------------------------------------------------------------------------------------------------------------- | --------- | ----: | ----------------- |
| [Emma, 9780141439587](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439587)                             | Paperback |   512 | Fiona Stafford    |
| [Emma, 9780141192475](https://penguinrandomhousehighereducation.com/book/?isbn=9780141192475)                             | Hardcover |   512 | Fiona Stafford    |
| [Middlemarch, 9780141439549](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439549)                      | Paperback |   880 | Rosemary Ashton   |
| [Wuthering Heights, 9780141439556](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439556)                | Paperback |   416 | Pauline Nestor    |
| [Wuthering Heights, 9780141040356](https://www.penguin.co.uk/books/55507/wuthering-heights-by-bronte-emily/9780141040356) | Hardcover |   416 | Pauline Nestor    |
| [Adam Bede, 9780140436648](https://penguinrandomhousehighereducation.com/book/?isbn=9780140436648)                        | Paperback |   608 | Margaret Reynolds |
| [Hard Times, 9780141439679](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439679)                       | Paperback |   368 | Kate Flint        |
| [Tess of the D'Urbervilles, 9780141439594](https://penguinrandomhousehighereducation.com/book/?isbn=9780141439594)        | Paperback |   592 | Tim Dolin         |

The Wuthering Heights paperback description explicitly credits editorial work; its hardcover editor
is independently named by the publisher's UK listing for the exact ISBN. The latter lists author and
editor, so its reference subset contains those two credits only. No role is inferred from an
introduction, notes, preface or cover-design credit. The two regional publisher sites are the same
publisher, not independent evidence origins. Dates are not compared across territories.

The agent inspected and transcribed publisher references before any provider acquisition. This is a
small purposive classic-literature frame, not independent human adjudication or population accuracy.
One candidate Middlemarch hardcover URL returned 404 and was excluded before freezing. An inspected
Sense and Sensibility edition with an introduction-only byline was not selected. Both are retained
in the exclusion manifest; no source failure is replaced after acquisition.

The manifest contains 120 prior/excluded target entries, including both target and reference
identities from every earlier consumed comparison; synthetic development fixtures are also excluded.
The runner binds code, frame and manifest hashes before one acquisition attempt. Reference answers
never enter acquisition or resolution. Permanent attempt markers survive failures and worktrees.
Provider records remain transient; reports retain codes and counts only. No model calls, ISBNdb,
production access, catalog writes or Add/scan/import cutover are part of this run.

## Results

Pending the single frozen acquisition and final local verification. Any policy change after freezing
requires another unseen comparison; this report must retain all outcomes, including failure.
