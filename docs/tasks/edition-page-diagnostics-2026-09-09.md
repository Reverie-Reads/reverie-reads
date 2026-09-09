# Edition-page diagnostics without broader acceptance

Follow-up to the [completed comparison](edition-page-comparison-report-2026-09-09.md), merged
in #510. This change instruments future runs; it does not replay that sample, assign retrospective
failure reasons, or qualify automatic filling.

## What the report adds

Report schema version 2 contains a version-1 diagnostics object with fixed-vocabulary marginal
histograms. No case identifier, provider text, title, author, ISBN, URL, page value or raw binding
is added to the persisted output.

| Counter               | Meaning                                                                | Important limit                                                                          |
| --------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Provider reasons      | First rejection reason, separately for Google and Open Library         | `none` means no reason was emitted, not a successful match; unknown codes become `other` |
| Google terminal stage | Preflight, search or detail branch that returned                       | A stopped branch may make no HTTP request; use transport counters for actual requests    |
| Packet format         | Validated provider/current format, unknown, conflicting or unavailable | Blocked packets are unavailable; the publisher reference never supplies this field       |
| Candidate source      | Google, Open Library or both                                           | Counts emitted review candidates only; does not establish independent lineage            |
| Candidate format      | Format evidence for emitted candidates                                 | Not edition certification; no current-value replacements are counted                     |

Provider-reason, terminal-stage and packet-format totals each reconcile to processed editions.
Candidate-source and candidate-format totals reconcile to emitted candidates. These are separate
marginal counts, not case-level traces or cross-tabulations. They cannot identify which particular
book failed or establish a causal link between a reason and an incorrect candidate.

Google now reports the existing deterministic identity predicate's specific ISBN, title or
contributor mismatch. The predicate is the same one previously wrapped by `exactIdentity`;
subtitle stripping, fuzzy matching and contributor relaxation are not introduced. Open Library's
existing reason codes are counted without changing its acquisition or admission runtime.

## Safety and frozen history

All diagnostic keys are selected from local finite sets. Unknown provider strings, URLs and
prototype-property names cannot become output keys. The accumulator receives neither publisher
reference truth nor an API client; it cannot acquire data, modify candidate eligibility or choose
a replacement. Packet serialization remains refused. Existing page values, conflicts, unavailable
sources, audio and ambiguous identity still withhold candidates under the previous rules.

The consumed subscription-study runtime and the completed 16-edition comparison artifacts remain
unchanged. No live provider calls or production/billing changes are part of this implementation.
The next live evaluation must use a fresh reviewed and registered sample; do not retrofit these
counters onto the completed run.

## Verification

- 397 trial tests passed, including six new diagnostic tests and the existing request/retention guards.
- Synthetic parity against merged base `5942e4d`: 2,116 packet combinations and 60 Google admission cases; no decision differences. Only diagnostic reason labels/format annotations differ.
- Workspace unit tests passed: 2,704 core, 905 web and one compiler-backed Workflow integration test.
- Full browser verification and remaining gate results will be recorded before handoff.

The other active chat confirmed non-overlapping app/core work and released the shared local
database before this branch's required fresh-database browser run. The test span uses the existing
machine-wide stack lock, default workers and zero retries; production is not a test target.
