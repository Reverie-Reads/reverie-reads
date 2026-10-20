# Intake source shadow pilot — October 16

The exact-ISBN adapters and independent pilot ran once against the code sealed by
[`intake-shadow-pilot-lock-2026-10-16.json`](intake-shadow-pilot-lock-2026-10-16.json).
No catalog, personal-library or reading-history writes occurred. Add, scanning and imports remain
on their existing paths. The result does **not** support a production cutover.

## Frame and evidence boundary

The private, agent-reviewed reference frame contains eight distinct editions across six works,
four deliberately wrong-author controls, and two ISBN-only probes: 14 cases total. Two edition
pairs and two unrelated works with the same title exercise identity/edition separation. The frame
was selected from inspected publisher listings before provider acquisition and excludes the prior
intake replay cases. It is a purposive pilot, not a representative sample or independent human audit.
The existing series qualification frame was not used.

References hold exact ISBN-bound pages and format plus work identity. They never enter acquisition
or resolver decisions; scoring receives them afterwards. Descriptions, complete contributor arrays,
publication-date accuracy and ISBN-less/work-search coverage are **not evaluated** here. Older
contributor regressions remain tests, not additional independent pilot observations.

The eight-edition table excludes duplicate controls and scan probes. Candidate identity agreement
is diagnostic only, separate from source qualification and approval to fill a field.

| Observation                                                             | Open Library | Hardcover |
| ----------------------------------------------------------------------- | -----------: | --------: |
| Usable identity candidates / eight edition queries                      |        1 / 8 |     5 / 8 |
| Page/format observations agreeing with references / 16 opportunities    |            1 |         4 |
| Page/format observations disagreeing with references / 16 opportunities |            1 |         4 |
| Missing or withheld page/format opportunities / 16                      |           14 |         8 |
| Wrong-author controls held / four controls                              |        3 / 4 |     4 / 4 |
| Wrong-author controls unobserved / four controls                        |        1 / 4 |     0 / 4 |
| Source-qualified work or edition resolutions                            |            0 |         0 |
| Promoted fields or production writes                                    |            0 |         0 |

All observed page/format disagreements were page counts; available format observations agreed.
Unknown format representations remain missing, not agreement. A page disagreement does not prove a
wrong edition by itself: source error, printing changes or reference drift still require review.

Across the two additional ISBN-only probes, Hardcover matched both reference identities. Open
Library matched one; the other passed an ISBN-only candidate check but failed the separate reference
identity comparison. The report's `falseIdentityMatch` flag means an **automated reference
discrepancy**, not a manually confirmed wrong-book finding. Only diagnostic scores were retained,
so the run cannot distinguish a wrong book from an unmodelled title/creator representation. The
source-policy guard held the observation and prevented any proposed fill. Do not claim that this
pilot proves zero false matches or certifies the ISBN-only path.

The report's overall positive denominator is ten probes: eight edition queries plus two repeated
ISBNs. It records 2/10 reference-agreeing Open Library candidates and 7/10 Hardcover candidates.
These are not ten distinct books. Failed normalization is not successful absence and is not counted
as a correctly rejected control.

## Acquisition and preservation

The run made 22 Open Library requests (eight edition redirects plus fourteen JSON responses) and
eight Hardcover requests. All transport requests completed without an HTTP failure; one Open
Library edition did not satisfy the adapter's identity shape and was withheld in its two probes.
There were no LLM or ISBNdb calls, and no production database access. Provider outputs remained
in memory. Private mode-0600 artifacts retain the reference frame, frozen lock, aggregate/per-case
scores and diagnostic codes; no raw provider payload or response-derived metadata was committed.

Both provider policies remain bibliographic/review-only with unknown upstream lineage. Agreement
between their APIs cannot promote a fact or establish independent support. The result is therefore
zero automatic fills by design; that is safe handling, not successful metadata completion.

Hardcover supplied more usable candidates on this small frame and is the more useful review input
here. This is not a general source ranking or evidence for changing the production source order.
Open Library remains a bounded corroboration/review input. Inspected exact-edition publisher sources
remain the reference for the unresolved disagreements.

## Next gates

1. Improve review diagnostics under the source-retention policy so an administrator can distinguish
   identity representation differences from wrong books without silently reacquiring a consumed run.
2. Investigate unknown format and contributor-role representations against provider contracts.
   Retain holds until a mapping is verified; do not expand initials or guess roles.
3. Add independently evaluated ISBN-less/work-search adapters and lossless credit persistence.
4. Evaluate any fixes on a new frozen holdout, then build a draft/revision-bound review handoff.
   This consumed pilot may become development evidence but cannot be relabelled as unseen.

The local regression/static/build gates and full browser outcome are recorded in the PR validation
receipt. Browser checks cover the unchanged app paths; they do not imply a live adapter integration.
