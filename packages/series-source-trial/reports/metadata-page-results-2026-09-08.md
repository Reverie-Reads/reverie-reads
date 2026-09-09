# Page-observation comparison: completed development result

ISBNdb agreed with the exact-edition publisher page reference in all three admitted comparisons:
two ties with Google and one case where ISBNdb agreed and Open Library differed. Seven of ten
editions did not reach the paid comparison because of identity safeguards. This is evidence for
a selective, review-only supplement, not a catalog-wide accuracy estimate or an automatic winner.

## Frozen run

- [Preregistration](metadata-page-plan-2026-09-08.md) was committed before tested-provider calls.
- Exact clean-tree run lock: `0b7bb1eadfa1ba53aa1a157bb547c6a42e089c90`.
- Runtime unchanged from merged #492: `568d62741e4e596d5118ae7cbc30ac48f63d9e0f`.
- Frame SHA-256: `eedbac4ec921e6a9cf3bbbfb51eeedcd43269f58a0faa78030abcaff7566c2af`.
- One run, 2026-09-09 03:50:10.336–03:50:37.399 UTC (September 8 locally), 27.057 seconds.
- Ten editions, five works, four authors, three publishing groups; eight page references and
  eight format references. Two known-audio controls; two format references deliberately unscored.
- [Machine-readable aggregate](metadata-page-results-2026-09-08.json). No provider response,
  case-level provider value, or in-memory review packet is retained.

The exclusive start marker remains in ignored private inputs. No rerun, replacement edition,
title adjustment, contributor removal, or post-result matching change was made.

## Admission and resource use

| Outcome                              | Editions |
| ------------------------------------ | -------: |
| Eligible page lookup; ISBNdb matched |        3 |
| Baseline requires identity review    |        6 |
| Identity unresolved                  |        1 |

Finite baseline review reasons were Google title mismatch (2), Open Library title mismatch (4),
and Open Library missing contributors (2). These are provider-level counts, not eight distinct
editions. The aggregate cannot identify which works or controls hit each reason. Strict matching
may reject legitimate subtitle/contributor variants; this run does not establish that any rejected
record was safe. Do not weaken those guards from aggregate counts.

Actual requests were Google 10/10 budget, Open Library 21/40, and ISBNdb 3/8. Google recorded ten
successful HTTP responses. Open Library recorded eleven successful responses, eight edition
redirects and two not-found responses across its request hops. All three ISBNdb lookups matched;
no provider stop condition was recorded. Transport success is not identity admission.

There were no LLM or Exa calls, purchases, upgrades, or production writes. Request counts are the
cost measure; billing and remaining credits were not queried, and no dollar cost is inferred from
an existing subscription.

## Page comparisons

| Same-edition pair     | Both agree with publisher | Only baseline agrees | Only ISBNdb agrees | Neither agrees |
| --------------------- | ------------------------: | -------------------: | -----------------: | -------------: |
| Google + ISBNdb       |                         2 |                    0 |                  0 |              0 |
| Open Library + ISBNdb |                         0 |                    0 |                  1 |              0 |

There were no unscored page pairs. Admitted page observations were Google 2 (2 agree), Open Library
1 (1 differs), and ISBNdb 3 (3 agree). These conditional denominators cover only admitted records;
they are not interchangeable provider coverage or accuracy rates over the ten-edition frame.

Final page states were source agreement (2), conflict (1), identity review (6), and identity
unresolved (1). No page-fill proposal was generated: this path measured existing competing page
observations, not missing-page repair. The conflict stayed a conflict even though offline reference
scoring favored ISBNdb. Reference truth never entered lookup routing or winner selection.

## Format and controls

Open Library supplied two admitted format observations: one agreed and one had no reference.
ISBNdb supplied three: two agreed and one had no reference. Google supplied none. One eligible
format-fill proposal agreed with its publisher reference; it remained review-only. The aggregates
do not establish whether that proposal occurred in the page-conflict case.

Final format states were single source (1), source agreement (2), identity review (6), and identity
unresolved (1). Both current audiobook format values remained protected. No case reached the
`audio_control` decision or `not_applicable` field state, so this live run does not independently
exercise the late audiobook page-suppression branch. Existing synthetic tests cover that branch.

## Decision and limits

Keep ISBNdb as a bounded comparison source after exact-edition identity checks. It provided one
useful independent-reference page disagreement and one eligible format fill at three paid-provider
requests. Do not prefer it unconditionally over Google or Open Library, correct pages automatically,
or generalize 3/3 to the entire catalog. Publisher agreement may reflect a shared upstream feed;
it does not prove provider independence or physical-book pagination.

This result answers the page-scoring gap left by the earlier gap-only trials, without changing or
pooling their completed results. Admission, not request budget, limited the comparison. The next
engineering work should preserve separate identity review, field conflicts, and explicit user/admin
decisions rather than spend more requests on this inspected frame. Any identity-rule improvement
needs separately reviewed development fixtures and a new prospective evaluation, not relaxed rules
and a rerun here.

Production source-use/retention permissions, LLM data-sharing permission, untouched series
qualification, production orchestration, review/matching integration, and owner-run deployment
remain separate gates. This metadata result clears none of them. PRH API remains out of scope.

## Verification and change boundary

Local lint, typecheck, unit tests, and build passed: 321 trial tests, 2,688 core tests, 881 web tests,
and one compiler-backed Workflow integration test. Build emitted the expected warning about the
committed local Supabase URL; this was a local build, not a deployment. Local full e2e is exempt
for this documentation/aggregate-only branch; no shared local stack was acquired or reset.

The branch adds only this report, its aggregate JSON, and the preregistration. No runtime,
migration, provider adapter, app, private repository, Supabase, corpus, personal row, public gold,
or qualification data was changed. Hosted PR checks and merge status are recorded on the PR,
separately from these local checks and the completed live experiment.
