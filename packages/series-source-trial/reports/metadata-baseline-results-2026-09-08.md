# Verified-baseline metadata benchmark: results

## Decision

Keep the acquired-baseline harness trial-only. Do not integrate this metadata into the LLM or
user matching yet. This run identifies baseline disagreements and conservative coverage limits;
it does **not** establish a new ISBNdb accuracy result because no case qualified for a paid lookup.
The next useful work is field-level confidence and better aggregate review reasons, not a broader
provider rollout or looser identity gates.

## Frozen run

- [Preregistration and independent publisher references](metadata-baseline-plan-2026-09-08.md).
- [Machine-readable aggregate result](metadata-baseline-results-2026-09-08.json).
- Runtime commit: `9d7f286bb32d53e190d8a0342e339c88270734cb`.
- Frame SHA-256: `68f1ed4c3ac7ce5f826d406a72f45728913b3d8aca168754043aeec02b595be8`.
- One completed run: 2026-09-08 23:48:31–23:49:49 UTC, 78.435 seconds wall time.
- 20 editions; no earlier-comparison ISBN or private qualification work/author overlap.
- No frame/runtime edits after acquisition began. An exclusive local start marker prevents the
  run wrapper from repeating this completed experiment. The generic development CLI is reusable;
  it does not itself enforce a global one-run registry.

The independently selected frame has 17 scored page references and 19 scored format references.
Returned provider values remain memory-only; the published artifact contains only aggregates.

## Observations, not population accuracy

| Provider/field | Available after strict identity checks | Agrees with reference | Differs | Unscored |
| --- | ---: | ---: | ---: | ---: |
| Google pages | 9 | 1 | 8 | 0 |
| Google edition format | 0 | 0 | 0 | 0 |
| Open Library pages | 6 | 5 | 1 | 0 |
| Open Library edition format | 5 | 5 | 0 | 0 |

Google had 10 matched observations, 7 identity reviews, 2 not-found responses, and 1 server error.
Open Library had 6 matched observations, 12 identity reviews, and 2 not-found responses.
These provider counts overlap by case; do not add them to claim unique work coverage. A strict
identity match means the returned identifiers/title/contributors passed the guard, not that every
field on that record is correct. Google digital availability was deliberately not used as binding.

Baseline/reference page disagreements are not silently corrected, and this small, nonrandom
sample cannot establish catalog-wide accuracy. Some differences may involve page-count conventions,
edition leakage, or source errors; this aggregate-only run cannot determine the causes. Its separate
unscored Born a Crime reference was excluded before the run because the publisher's own sources
disagreed, rather than choosing whichever number later favored a provider.

## Routing and ISBNdb

| Decision | Cases |
| --- | ---: |
| Baseline identity/edition review | 12 |
| No admitted baseline identity | 2 |
| Baseline unavailable | 1 |
| Skip paid lookup: no eligible missing field | 5 |
| Eligible ISBNdb lookup | 0 |

Nineteen cases had completed baseline attempts, including completed reviews. This is **not** 19
accepted identities. Four of the five skip cases retained page-count conflicts; skip means no
eligible gap, not that all metadata is approved. No ISBNdb page/format candidates were produced.

The result validates the intended no-paid-call behavior on these live conflicts and failures.
It does not show ISBNdb to be ineffective or accurate: the selective policy never queried it on
this frame. The earlier 12-edition comparison remains separate evidence and is not pooled with
this experiment. Existing baseline/current values still win in the gap-only planner, which is
exactly why the baseline disagreement findings must be addressed before product integration.

## Cost and access

| Provider | Actual requests | Ceiling | Other observations |
| --- | ---: | ---: | --- |
| Google Books | 20 | 20 | 19 HTTP successes, 1 server error; 16.533 seconds HTTP elapsed |
| Open Library | 49 | 80 | 18 approved edition redirects, 29 HTTP successes, 2 not-found; 32.758 seconds HTTP elapsed |
| ISBNdb | 0 | 20 | No qualified lookup |
| LLM / Exa / PRH API | 0 | 0 | Not called |

Provider HTTP elapsed time excludes deliberate pacing and is not end-to-end user latency. The
78.435-second sequential batch is a developer benchmark, not a proposed interactive request.
No subscription purchase, upgrade, or extra LLM/Exa credit use occurred. Request counts are the
cost proxy; this run does not read account billing or prove a particular remaining balance.

## Implications for the evidence tool

1. Keep identity confidence separate from field confidence. An exact returned ISBN/title/author
   does not certify page count. Preserve the source and conflict for each proposed field.
2. Before another paid run, add aggregate reason codes for baseline reviews: conflicting ISBN
   lists, full-title/subtitle disagreement, contributor disagreement, and language/format issues.
   The current aggregate statuses do not reveal which mechanism dominated, so do not assume one.
3. Design a separate, bounded review experiment for disputed baseline fields. The current planner
   is gap-only; correction must not be smuggled in as a missing value or overwrite. Independent
   publisher facts can anchor a review, but publisher conflicts also need abstention.
4. If an LLM is later used, let it explain evidence and propose review/abstention. It must not
   invent pages, treat a digital preview as an edition, strip adaptation qualifiers, or equate an
   undifferentiated contributor list with authorship. Deterministic field eligibility remains in
   charge; no automatic repair is justified by this run.

Do not rerun these inspected cases to claim improvement. A follow-up requires a fresh preregistered
frame, including independently verified missing-field opportunities and identity-conflict controls.
Rights, storage/redistribution, latency, broader precision, and the user-review interface remain
separate gates. There is no Supabase migration, deployment, persistent provider cache, public gold
update, model training, or change to the legacy production ISBNdb adapter.

## Implementation verification

All 19 added offline tests passed, as did the complete 298-test trial suite, 2,687 core tests,
865 web tests, and the compiler-backed Workflow integration test. Lint, typecheck, and production
build passed. The synthetic CLI example was exercised without credentials or network access.
Full fresh-database browser verification is recorded separately in the pull request; it does not
alter this frozen API result.
