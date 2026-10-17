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

The single acquisition completed against commit `f56591a`, frozen at 2026-10-17 04:37 UTC
(October 16 locally). The [published lock](intake-creator-role-lock-2026-10-17.json) binds the frame,
code and exclusions. Open Library made 24 requests (eight edition redirects, sixteen successful
JSON responses); Hardcover made eight successful requests. Neither source stopped or retried a
consumed frame. The run made zero model calls, proposed fields, catalog writes or qualified
resolutions. Source-use holds remain independent of identity matching.

| Eight distinct editions / eight paired controls    | Open Library | Hardcover |
| -------------------------------------------------- | -----------: | --------: |
| Correct-author identity candidates                 |          1/8 |       8/8 |
| Correct-author identities held with an observation |          2/8 |       0/8 |
| Correct-author identities unobserved               |          5/8 |       0/8 |
| Editor-as-creator controls held                    |          3/8 |       8/8 |
| Editor-as-creator controls unobserved              |          5/8 |       0/8 |
| False identity matches                             |            0 |         0 |
| Page/format agreements out of 16 fields            |            0 |        10 |
| Page/format disagreements                          |            1 |         5 |
| Missing or identity-withheld fields                |           15 |         1 |

Hardcover's control diagnostics are two secondary-role-only, two unknown-role and four name-mismatch
outcomes. The latter four are not observations of the named editor. Unknown-role diagnostics can
coexist with a separately observed editor credit for the same name; the original arrays remain
unchanged. The paired correct-author requests all match. This is evidence for the role boundary on
this frame, not a claim that all eight controls contained an explicit provider editor role.

Open Library's five unobserved editions comprise three malformed identities and two duplicate-credit
rejections. Two further observed identities remain mismatched. Its control set includes one exact
name diagnostic that is nevertheless held by the overall identity check; a name match alone is not
admission. All HTTP requests succeeded, so these are record-quality/admission outcomes rather than
network outages. Unobserved controls do not count as correct rejections.

All six page/format disagreements across providers concern page counts. They remain under review;
matching author and ISBN does not certify the edition's other fields. Hardcover also reports one
unknown format and unknown role labels on two distinct editions.

| Twenty-three selected reference credits | Open Library | Hardcover |
| --------------------------------------- | -----------: | --------: |
| Name/role/part observed on edition      |            1 |         0 |
| Name/role/part agrees, work basis only  |            0 |        11 |
| Unknown role                            |            0 |         2 |
| Role or part conflict                   |            0 |         3 |
| Missing                                 |            2 |         7 |
| Identity withheld                       |           20 |         0 |

The one Open Library edition-observed agreement is an author. Hardcover still supplies parent-work
credits, not verified edition credits. No secondary credit gains automatic authority. The two
ISBN-only probes match on Hardcover and are unobserved on Open Library; they repeat existing
editions. Including those repeats gives 10 positive probes and 29 credit checks, not ten independent
editions or 29 distinct reference credits.

## Verification and decision

The final unit gate passed 3,376 core tests, 1,346 web tests, 498 source-trial tests and two Workflow
tests, along with the root recovery/completion checks. Typecheck, lint and build passed. The full
fresh-database browser run completed at the default one worker with zero retries: **435 passed,
11 skipped and one failed in 58.4 minutes**. This gate is red. The failure is in an unchanged Add
recovery test: its five-second wait for an injected-error alert expired while the save was still pending.
The trace records a 4.7-second book read followed by a 1.5-second authentication check; the insert
then returned 201 and the contributor request was unfinished when the test ended. It never reached
the injected duplicate-preference failure or retry/count assertions. This is not evidence of an extra
copy. The Add route does not call the shadow resolver. Preserve the trace and failed gate; no rerun
was used to erase it. The desktop and mobile edition-credit review journeys passed, including
literal role preservation, lost-response retry, later identity revalidation and personal-history
preservation. This is local Chromium evidence, not production, WebKit or physical-device acceptance.
A private pre-test local database snapshot was retained. The standard local demonstration database
was restored successfully with 290 books, and the wrapper preserved the failed browser exit status.
Remote CI could not be inspected: the required checks connector requests a GitHub account connection.

The known explicit-editor matching defect is fixed. Keep the new resolver in shadow mode:
provider mislabelling, partial/unknown roles, edition scope, malformed records, duplicate credits and
page conflicts remain qualification gaps. Editor-led collections require a future reviewed role-aware
identity path; the lossless edition-credit handoff remains available separately. No production access,
personal-data migration or Add/scan/import cutover occurred. Any new policy tuning needs another
unseen frame; all earlier consumed comparisons remain unchanged.
