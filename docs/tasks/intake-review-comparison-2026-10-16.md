# Contributor evidence review comparison — October 16

## Frozen protocol

This follow-up compares the revised Open Library and Hardcover adapters on a new, purposive frame:
eight editions of four canonical works, four controls that substitute a secondary credited person
for the author, and two ISBN-only probes. The eight editions have twenty selected reference credits
covering authors, translators, an editor, introduction writers and illustrators. The two scan probes
repeat five of those credit opportunities. Narrator and named-part behavior is covered by synthetic
regression tests, not claimed as live coverage here.

Publisher listings were inspected before provider acquisition. The frame keeps each publisher's
literal title and full author spelling; transliteration/alias differences are not silently resolved.
The reference credit lists are deliberately partial. A publication-level series editor is not
assumed to be a whole-work editor. References, expected outcomes and credit answers never enter
acquisition, resolution or the read-only review view.

The private exclusion manifest includes all six previously inspected intake development targets and
the first shadow pilot's fourteen targets and fourteen reference identities; synthetic fixtures are
also excluded by the runner. The prior pilot and unrelated series qualification remain untouched.
The new frame and source tree are sealed before acquisition; there is one attempt and no automatic
retry. Provider values remain transient. Only codes, counts and scores are saved privately.

Report the eight-edition denominator separately from repeated controls and scan probes. Report
identity agreement, wrong-author-control behavior, pages/formats, selected credit observations and
source-qualified proposals separately. Work-level credit agreement is not edition qualification.
The sample is agent-reviewed and small, not a population accuracy estimate or independent human
audit. These are two sources on a new frame, not a paired old-code/new-code effect estimate.

The existing title/ISBN/name admission rules, source eligibility and unknown-lineage policy remain
unchanged. This run cannot switch Add, scanning or imports or write catalog/personal data.

## Outcome

The single sealed acquisition completed against commit `d6b6c64`: 24 Open Library requests
(eight redirects, sixteen JSON responses) and eight Hardcover requests. All transport calls
completed without HTTP failure. One Hardcover edition failed its parent-title check and is
unobserved in both its named and scan-only probes. No LLM/ISBNdb calls, production database access,
source-qualified resolutions, proposed fills or writes occurred. The run is consumed, not retried.

| Eight distinct edition queries                         | Open Library | Hardcover |
| ------------------------------------------------------ | -----------: | --------: |
| Identity candidates agreeing with references           |          5/8 |       6/8 |
| Page/format agreements, out of 16 opportunities        |            4 |         4 |
| Page/format disagreements                              |            2 |         6 |
| Missing or identity-withheld page/format opportunities |           10 |         6 |
| Secondary-credit-as-author controls held, out of four  |            2 |         4 |
| Misleading identity candidates on those controls       |            2 |         0 |

All observed page/format disagreements were page counts. The two misleading Open Library controls
substituted a translator and an introduction writer for the reference author. Those names passed
its author-based candidate comparison; the reference-credit checks separately record role conflicts.
This is contributor attribution failure on the controlled query, not evidence that two different
books were returned. Source-use qualification held both candidates and prevented promotion.

| Twenty selected reference credits across the eight editions | Open Library | Hardcover |
| ----------------------------------------------------------- | -----------: | --------: |
| Name/role observed on an edition record                     |            5 |         0 |
| Name/role agrees but only parent-work scope observed        |            0 |         6 |
| Same name, conflicting role or part scope                   |            4 |         0 |
| Missing from an identity-admitted record                    |            3 |         9 |
| Withheld because identity was not admitted                  |            8 |         5 |

These are observations of a partial reference list, not complete-credit accuracy. All five
edition-observed Open Library agreements are author credits. Hardcover supplied only parent-work
credits in this query, so even matching author credits cannot certify the selected edition.
Additional provider credits outside the reference subset were not certified.

The two scan probes repeat five reference credits. Including them produces ten positive probes:
7/10 reference-agreeing identity candidates for each source. The overall credit counts are Open
Library 7 edition-observed / 5 role conflicts / 5 missing / 8 withheld; Hardcover 7 work-scope-only /
11 missing / 7 withheld. Do not present these repeated ISBNs as ten independent editions.

The added diagnostic axes distinguish exact ISBN agreement from title or creator disagreement.
They expose unresolved title/name differences without storing the source strings or declaring an
alias verified. Four Open Library edition records carried unparsed credit statements; those remain
in-memory review material. The read-only viewer was rendered and inspected in Chrome using synthetic
fixtures, with no Save control. Live provider values were not exported or captured into screenshots.

Full unit, typecheck, lint and build checks passed: 3,340 core tests, 1,340 web tests, 498 source-trial
tests, two Workflow tests and existing recovery/completion checks, including 21 new regression tests.
The fresh-database full browser run passed with 434 passed, 11 skipped and zero failures in 43.5
minutes, using one worker and no retries. An earlier local service startup failed before browser
invocation; that failure is retained separately. After service recovery, all project services were
healthy before the normal reset and test run. The source comparison remains separate from browser
integration proof; remote CI remains unverified because its connector requires account connection.
The standard local development schema and 290-book seed were restored successfully afterward.

## Decision and next gates

Keep both sources review-only. On this frame Hardcover held all four contributor-substitution
controls, while Open Library exposed two misleading author matches. Neither source supplied usable
proof of the secondary edition credits in the selected reference subset. The unchanged lineage and
source-use gates are essential, not a completed automatic importer.

Before cutover, establish a source-qualified edition-credit path that does not equate an author
relation with primary authorship, verify unresolved aliases/title variants against authoritative
sources, add lossless persistent credit storage and a draft-bound approval handoff, cover ISBN-less
intake, and verify the eventual integration in the browser. Any matching or role-policy tuning must
be tested on another new frozen frame; this consumed comparison cannot be relabelled as unseen.
