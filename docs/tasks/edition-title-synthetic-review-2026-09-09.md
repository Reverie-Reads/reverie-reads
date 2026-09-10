# Synthetic edition-title review

## Outcome

The next step after merged #514 was exercised against unchanged runtime
`c1310274e7e5b9266cd9519cc6a44e1f1a12e9c1`: **27 synthetic scenarios passed their expected assertions**.
Seven yielded review-only candidates, nineteen were blocked for identity review, and one was
withheld for conflicting page counts. These are constructed behavior checks, not accuracy estimates.

One reproducible representation limitation deserves a narrow diagnostic: if a provider puts a
complete title in `title` and repeats its subtitle in `subtitle`, the current assembly duplicates
that subtitle and returns `title_mismatch`. Both Google and Open Library exhibit this behavior with
constructed input. This does **not** establish that any #514 rejection had that cause. No live
responses were retained or replayed, and no new provider requests were made.

Do not strip subtitles, shorten contributor lists, infer binding, or enable automatic filling.
The existing matcher already handles case, punctuation, whitespace, accent differences, and
provider `Family, Given` author order. An LLM is unnecessary for those representation rules and
must not be used to explain away missing identity evidence.

## Exercise method

Imported the existing `createEditionPageClient` and `buildEditionPagePacket` directly in a Node
stdin exercise. Each scenario creates a fresh client and uses an injected in-memory fetcher,
fixed clock and no-op sleeper. The global fetch function throws if called. No environment files,
credentials, publisher references, historical identities, qualification truth or live results
were read by the exercise. External HTTP requests and model calls were zero.

The toy identity is `The Lantern Archive: A Novel`, author `Ada Example`, language `en`, with the
same checksum-valid ISBN fixture `9780316565202` used by the existing tests. This is a synthetic
association, not a claim about the real publication assigned that ISBN. Mock Google search/detail
and Open Library edition/author responses each supply 300 pages and no binding. A second existing
ISBN fixture supplies the mixed-identifier negative control. Every mock URL is intercepted; no
request reaches either provider.

Each scenario asserts expected provider status/reason and whether a candidate exists. Detail-change
cases assert the terminal detail stage and that otherwise matching Open Library cannot override the
Google conflict. Every packet asserts `automatic === false`. Aggregate diagnostics are collected
through the existing counter function. The adjacent [results](edition-title-synthetic-results-2026-09-09.json)
retain only constructed scenario names, statuses and toy values—not real provider output.
`mockedRequests` counts calls to the injected fetcher, not external requests or cost.

## Matrix and observed behavior

Unless noted, title variants are supplied to both provider fixtures; Google search and detail agree.
The baseline title is the full toy title above; the split variant uses `The Lantern Archive` plus
`A Novel`. All unrelated fixture fields stay unchanged.

| Input variation                                                                                      | Observed result                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Full title; split subtitle; uppercase/em dash; repeated whitespace; accented letters; blank subtitle | Both providers matched: six review-only candidate scenarios                                       |
| Complete title plus repeated `A Novel` subtitle                                                      | Both return `title_mismatch`                                                                      |
| Missing subtitle; changed `A Memoir`; plural `Archives` in base title                                | Both return `title_mismatch`                                                                      |
| Added `Abridged`, `Graphic Adaptation`, or `Volume Two`                                              | Both return `title_mismatch`                                                                      |
| Complete title plus `A Novel: Abridged`                                                              | Both return `title_mismatch`; do not mistake partial repetition for exact duplication             |
| Numeric subtitle `42` or object subtitle with a text property                                        | Both return `malformed_subtitle`                                                                  |
| Author `Example, Ada`                                                                                | Both matched: one review-only candidate                                                           |
| Author `A. Example`, `Eve Other`, or an extra `Tess Translator`                                      | Both return `contributors_mismatch`                                                               |
| Empty author lists                                                                                   | Google returns `malformed_record`; Open Library returns `missing_contributors`                    |
| Google detail alone loses or duplicates subtitle                                                     | Google returns `title_mismatch` at detail; joint candidate withheld despite matching Open Library |
| Google detail alone changes language to French or author to `Eve Other`                              | Corresponding language/contributor review at detail; joint candidate withheld                     |
| Exact requested ISBN plus another valid, different ISBN                                              | Both return `isbn_mismatch`                                                                       |
| Google 300 pages versus Open Library 301 pages                                                       | Both identities matched, packet `conflict`, no candidate                                          |

All seven emitted candidates had unknown format. Constructed page agreement does not create format
evidence. Missing authors still cannot be filled from the query, an unrelated work record, or a model
guess. A provider's flattened contributor list cannot safely identify which extra person is a
translator without explicit role evidence; the toy label is known only to the exercise author.

## Implementation recommendation

Add a **diagnostic-only**, fixed-vocabulary subtype for the exact repeated-subtitle shape in a
separate runtime change, starting with Google, without changing eligibility. Require a nonempty valid string subtitle,
raw title equal to the complete expected title after the existing normalization, and that exact
subtitle at a token boundary at the end of the raw title. A different qualifier, partial match,
missing subtitle, malformed value or mixed ISBN must not use the repetition subtype as acceptance.

Keep provider raw title/subtitle transient and persist only bounded aggregate categories. Attribute
the subtype to the same search/detail branch that rejected the record; it is a representation
observation, not a resolved identity. Keep the original first-failure reason for compatibility.
This would separate a plausible packaging problem from other title mismatches without retaining
provider text or loosening the gate. Any later normalization change needs its own reviewed tests
and a fresh preregistered sample; #514 cannot be rerun or used as a held-out confirmation.

Preserve the frozen baseline/study modules. The Google diagnostic can live in the separate edition-page
path; defer Open Library instrumentation rather than editing its frozen baseline client. Leave all
old locks, guards and study behavior unchanged. No runtime modification is part
of this assessment. There is no measured live coverage gain, no new gold annotation and no claim
that a diagnostic alone makes the system more accurate.

## Implementation evidence

- [Identity normalization and first-failure order](https://github.com/Reverie-Reads/reverie-reads/blob/c1310274e7e5b9266cd9519cc6a44e1f1a12e9c1/packages/series-source-trial/src/metadata/supplement.mjs): `fold`, `sameAuthors`, `identityReviewReason`.
- [Google full-title assembly and joint-packet gates](https://github.com/Reverie-Reads/reverie-reads/blob/c1310274e7e5b9266cd9519cc6a44e1f1a12e9c1/packages/series-source-trial/src/metadata/edition-pages.mjs): `admitGoogleVolume`, `buildEditionPagePacket`.
- [Detail revalidation](https://github.com/Reverie-Reads/reverie-reads/blob/c1310274e7e5b9266cd9519cc6a44e1f1a12e9c1/packages/series-source-trial/src/metadata/edition-page-client.mjs): Google search/detail orchestration.
- [Open Library title assembly and complete author lookup](https://github.com/Reverie-Reads/reverie-reads/blob/c1310274e7e5b9266cd9519cc6a44e1f1a12e9c1/packages/series-source-trial/src/metadata/baseline-client.mjs): `fullTitle`, `admit`, `openlibrary`.

## Verification and boundaries

The one-shot synthetic matrix passed all explicit assertions, and saved-result counts reconcile.
All 397 trial tests, 2,706 core tests, 909 web tests and the compiler-backed Workflow integration
test passed. Typecheck, lint, build, formatting and diff checks passed. The local build retained
its expected local-URL and bundle-size warnings; this is not production deployment verification.
Committed changes are documentation only; fresh browser E2E is explicitly
exempt under AGENTS.md. No production, billing, provider acquisition, local database, app/core,
Supabase, frozen inputs, attempt markers or runtime files changed. The other active chat confirmed
no overlap with its cover-efficiency PR #513.
