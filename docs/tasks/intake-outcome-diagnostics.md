# Intake outcomes before corpus expansion

Owner direction, October 22: finish essential safeguards, measure actual misses, then select a
bounded completion pilot using the existing evidence pipeline. A global database, MCP service,
new providers and bulk acquisition remain deferred.

## Implemented slice

The production search client now requires a valid result array and renderable, attributed rows.
Missing bodies, malformed rows and degraded empty responses reach Add's existing unavailable/retry
path. Only a valid successful empty response produces an empty search. Useful partial results keep
their section order. This changes no admission, duplicate, copy or save rule.

`pnpm intake:replay` now includes fixed outcome counts, derived from the existing resolver rather
than another identity matcher. Each case may optionally add this context beside `request` and
`expected`:

```json
"diagnostics": {
  "requiredFields": ["pages"],
  "reviewDecision": "unobserved"
}
```

Requirements describe this particular review task; they never become mandatory Add fields.
The only other review decision is `declined`, recorded after an explicit human refusal. Closing a
screen, holding a candidate or leaving it unselected supplies no such decision. Context never
enters the resolver or changes proposals, permissions or the expected-answer score.

To export counts without case records, use a new private output path:

```sh
pnpm intake:replay --aggregate-only scripts/fixtures/intake-evidence.json /absolute/private/intake-outcome-counts.json
```

This invocation is exercised by the CLI test with a temporary private output path. The output is
create-only, mode 0600, and contains only the closed basis label, fixed counters and unobserved
metrics. It has no case IDs, fingerprints, book or edition identities, ISBNs, queries, contributor
names/roles, source names, URLs, account IDs, private values or raw provider messages. The original
full private report remains available without the flag. The command does no network or database
I/O, registers no background collection and does not send diagnostics to the existing error reporter.
Inputs still require deliberate bibliography-only preparation; this export is not a sanitizer for
arbitrary library data.

## What a count means

Counts are overlapping case indicators, not provider-attempt counts or a mutually exclusive funnel.
The denominator is every manifest case, including failed expected outcomes and unobserved evidence.
A case can retain usable peer evidence and still count a provider failure.

| Signal                                            | Meaning and limit                                                                                                                                                                                   |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workLookupEmpty`                                 | Every current requested observation successfully returned empty for a work request. Not proof the book is absent from the shared catalog or does not exist.                                         |
| `editionLookupEmpty`                              | The same, for an explicitly selected ISBN/edition locator. Not proof that the work is absent or the edition does not exist. Invalid ISBN requests cannot enter this count.                          |
| `providerFailure`, `responseCapped`               | A current source acquisition failed or reached its response cap. Failure includes malformed adapter observations; it is not necessarily a transport outage. Neither counts as successful emptiness. |
| `identityOrRoleHold`                              | Current identity, responsibility or contributor-role comparison is held, or the target/existing identity conflicts. No missing-book inference.                                                      |
| `selectedEditionUnresolved`                       | Work identity resolved but the explicitly selected edition did not. Work-only facts cannot supply selected-edition fields.                                                                          |
| `requiredFieldMissing`                            | At least one explicitly required field is missing from the admitted, resolved scope. Not a claim that no provider can supply it.                                                                    |
| `requiredFieldHeld`, `requiredFieldUnobserved`    | Requirements remain blocked by scope/conflict or were not observed. Held values are not missing values.                                                                                             |
| `reviewDeclined`                                  | A reviewer explicitly declined. It neither diagnoses source failure nor proves a save.                                                                                                              |
| `acquisitionUnobserved`, `staleOrChangedEvidence` | No observations, or observations outside the current fingerprint/freshness window. Stale empty evidence cannot establish a current empty lookup.                                                    |

Field availability means only a preserved/proposed field at the appropriate scope; it does not
certify complete contributor rosters, source truth, reuse rights or catalog authority. Source-use
holds remain `evidenceReviewHold` even when title and role comparisons agree. No provider is promoted.

Confirmed book/edition absence, real reader failure rate, deliberate Add success, correction effort,
latency and acquisition/review cost stay JSON `null` (unobserved), never fabricated zeroes.
Synthetic regressions and reviewed reconstructions retain their separate basis labels; neither
establishes a real reader miss rate. This PR contains no real intake outcome sample.

## Available evidence and release boundary

The supplied October 22 inventory (1,425 works, 454 reader-linked, 31,270 edition rows) is a catalog
projection, not an intake denominator or correctness assessment. Missing descriptions, empty edition
details, missing editions and deferred reviews identify review queues, not demand or save failures.
Existing synthetic/reconstruction fixtures verify the classifier's behavior; they are development
material, not a new unseen evaluation. Consumed provider comparisons, permanent attempt markers,
ISBN exclusions and unresolved reviews remain untouched.

Read-only checks in this task on October 22 confirmed public PR #653 merged at `5bd1c9c` and no open
public PRs before this change. The homepage response still had JavaScript content type and served
build `3e842497deea`; migration history still ended at `20261108010000`, omitting the three new
credit/source-use/evidence migrations. The function listing reported `enrich` version 22; its source
was not downloaded again, so the earlier source-difference audit remains dated evidence. No release
repair, production mutation, deployment or authenticated production save was attempted. This
client/offline slice does not depend on deploying those new writer migrations.

## Next bounded demand-led pilot (proposed acceptance, not measured)

1. Obtain up to 20 deliberately reported intake failures with explicit consent to inspect the
   bibliography. Preserve the original failure and correction effort separately; include successful
   attempts from the same explicitly bounded observation window if estimating a failure rate.
   Reports selected because they failed cannot supply that denominator. No default reader tracking.
2. Reconstruct only necessary bibliography into private replay cases; export counts with this
   command. Distinguish lookup emptiness, identity/role holds, source failure, edition scope, missing
   required facts and explicit refusal. Choose one demonstrated gap; do not enlarge the corpus to
   raise record counts.
3. Before changing acquisition or matching, freeze a **new disjoint 30-case evaluation** with
   independently reviewed work/edition references. Record the selection population, inclusion and
   exclusion counts, work-group split, input/code hashes and expected decisions privately. Exclude
   consumed comparisons, development cases, prior qualification and their edition/work siblings.
   Do not invent a holdout from already inspected failures. Keep unresolved and negative controls.
4. Use already qualified non-LLM sources first. Reuse per-claim evidence, source-use qualification,
   existing-value preservation and fingerprint-bound human review. No new provider or infrastructure
   is required. No new production-write exception is granted; the three earlier exceptions are used.

| Acceptance measure       | Proposed threshold and denominator                                                                                                                                                                                                                                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Correct work retrieval   | Correct target in the first five candidates for at least 95% of evaluated queries whose target is independently known present; report absent/unobserved cases separately and give numerator/denominator.                                                                                                       |
| Correct selected edition | Every proposed edition-dependent fact belongs to the explicitly selected edition; zero observed wrong-edition or wrong-work accepted facts. An unresolved edition is not a retrieval success.                                                                                                                  |
| Safe abstention          | All known identity, role, source-use and edition conflicts remain held; report each control, not only a pooled score.                                                                                                                                                                                          |
| Deliberate Add           | At least 95% of eligible, explicitly confirmed local test additions produce the reviewed personal record; preserve failed and partial saves, duplicates and copy details. Separate local/CI evidence from later owner-approved real use. Diagnostics cannot authorize writer cutover.                          |
| Correction effort        | Report edits and reviewer minutes per accepted case; target median at most two field corrections and p95 at most five. Keep refusals and unresolved cases visible.                                                                                                                                             |
| Latency                  | Record end-to-end lookup and review handoff separately; target p95 lookup at most five seconds on the frozen frame. Do not substitute resolver CPU time for provider latency.                                                                                                                                  |
| Acquisition/review cost  | First pass uses no paid acquisition/model requests. Report requests and reviewer minutes per usable accepted fact. Any residual Luna research first reconciles the live ledger and verified pricing, stays within the existing $5 pilot sublimit and cumulative $50 ceiling, and still requires source review. |

These are pilot targets, not evidence of global completeness, production readiness or a model's
factual accuracy. With no real observation window yet, selecting the actual completion population
and freezing the new evaluation remain future evidence steps, not completed outcomes of this PR.
