# ISBNdb subscription value: implementation and prospective protocol

## Decision to support

Retain ISBNdb only if it produces enough correctly improved books or measured saved work to justify
the recurring subscription and integration burden. Request utilization alone is not success, and
three correct page observations are not a subscription business case. The owner approved evaluating
broader utility and independent source matching on September 8, 2026.

This document defines the next experiment, not a registered live dataset or a keep/cancel verdict.
No paid requests, completed-frame reruns, credential changes, upgrades, production writes, or series
qualification runs are part of this implementation. PR #493's completed results remain untouched.

**September 9 update:** the owner authorized one bounded evaluation before further ISBNdb contact.
The scoped public `metadata:study --run` path admits only that committed 100-ISBN/100-work set.
The [source-use review](isbndb-source-use-review-2026-09-08.md) still applies to production and
retention. Older commands are not an alternative path around study safeguards.

## Owner-reported trial window and cost

On September 8, the owner confirmed the lowest paid account tier, **$14.99/month**, and **five
days remaining** in the original seven-day trial. Use `monthlySubscriptionUsd: 14.99` in the
prospective study, not a guessed public list price. This is owner-reported account information;
the exact billing timestamp, taxes, included quota and account-specific rights remain unverified.
Five days remaining is a planning window, not an exact cancellation deadline or permission to renew.

Target a decision with at least one day of margin before the reported expiry. The immediate order is:

1. Verify the implemented `metadata:study` lock-bound combiner and single-use run guard in the
   approved runtime. Verify account limits and the rights needed for the bounded factual trial.
2. Review the fresh 100-work minimum frame, audit exclusions/overlap, and freeze the complete
   dataset, runtime and request budget before acquisition. Do not trade away source review to fit
   the deadline or append replacement cases after seeing results.
3. Acquire the frozen cohorts once, reconcile their totals, and compare free-only, selective ISBNdb
   and ISBNdb-first. Report unavailable sources, unknown references and regressions beside gains.
4. Deliver the keep/cancel recommendation or an explicit inconclusive result before the final-day
   margin. If the study or rights review cannot finish in time, report what is missing; a looming
   renewal is not evidence for retaining the subscription. Billing action remains with the owner.

This sequence is a plan, not a scheduled job or a claim that the dataset has been frozen. No live
subscription-value requests have been made as part of this account-information update. Monthly
distinct-work volume and the owner's acceptable cost threshold remain unknown; keep those inputs
null until supplied. Show sensitivity scenarios rather than inventing adoption or repeat-use value.

For orientation, the subscription alone requires the following incremental benefit. These are
arithmetic scenarios, not selected acceptance thresholds or observed improvements:

| Illustrative maximum subscription cost per additional correct work | Minimum additional correct works per month |
| ------------------------------------------------------------------ | ------------------------------------------ |
| $0.25                                                              | 60                                         |
| $0.10                                                              | 150                                        |
| $0.05                                                              | 300                                        |

The count is `ceil(14.99 / threshold)`, after work-level deduplication and the existing no-regression
rules. It is not total lookups, returned fields, cached repeat requests, or all books processed.
Integration, maintenance, taxes and any usage charges are excluded from this illustrative floor.
The trial being temporarily free does not make the recurring cost zero.

## Implemented instrument

The new `metadata:value` command independently admits each provider against one reviewed exact
edition. It reuses the existing provider transports and strict ISBN/full-title/full-author rules.
The acquired-baseline client has an opt-in factual projection; default output and old commands are
unchanged. ISBNdb is requested once even when a free provider is unavailable or rejects identity.
This is an ISBN-based edition trial, not title-search recall, missing-ISBN discovery, or general
user matching. It cannot measure ASIN-only catalog coverage.

The same in-memory observations support three policies. Free-only joins admitted free facts.
Selective adds ISBNdb if free identity or a requested field remains incomplete/conflicted.
ISBNdb-first stops when paid data supplies all requested fields, otherwise joins free evidence.
Disagreement in a joined packet remains review-only. Reference truth scores after these decisions.
The policies are counterfactual lookup/field policies, not three separately timed live workflows.

Each policy reports field-level agreement, disagreement, missing values, conflicts and unscored
values. An additional correctly improved work must gain a reference-agreeing field over free-only,
lose no previously correct field, and emit no wrong/unscored value across its sampled editions.
One work cannot count five times for five fields or twice for two editions. This intentionally
conservative metric can undercount useful partial results; the individual counters explain why.
It is not the count of accepted corrections, resolved identities or error-free complete records.

Known-answer tests exercise both beneficial and harmful ISBNdb-first answers, exact-identity
refusals, free outages, independent free admission, audiobook controls, work-group deduplication,
cross-edition harm, unknown references, numeric date precision, and output redaction. A synthetic
CLI fixture supplies executable help/dry-run paths without credentials. No production writer exists.

## Field scope and rights

Pages, binding, publisher, numeric-precision publication date and language are compared as ephemeral
facts. No fuzzy publisher aliases or natural-language date inference. Existing identity guards still
reject incomplete contributors, qualified-title mismatches, contradictory ISBNs, unknown binding,
and observed language contradictions. A language supplied as identity context makes matching
language output a consistency check, not new identity information.

Covers, descriptions and related editions are **availability only**, outside economic benefit.
No provider text/artwork/link is retained or sent to an LLM. Their quality, display/storage rights,
and alternate-edition relationship correctness require a separate reviewed capability before they
can improve the keep/cancel score. No description-based embedding or graph ingestion is authorized.

The [official API specification](https://api2.isbndb.com/doc.json), inspected September 8, documents
these fields and bulk ISBN lookup. Bulk requests reduce transport overhead but each requested ISBN
consumes quota; the current implementation uses single ISBN lookups for auditable bounded requests.
Public pricing/terms initially failed in the web reader, but the browser review linked above now
establishes the published plan and a material source-use question. Do not infer this account's
remaining quota, renewal timestamp, retention entitlement or model-sharing permission from a key.

## Next live study: freeze before acquisition

1. Use the owner-reported $14.99 monthly fee above and confirm included quota before live acquisition.
   The exact expiry remains an account check for the owner's billing decision, not a reason to delay
   safe study preparation. No automatic purchase, upgrade or cancellation. Record storage, display,
   caching, derived-data, third-party model sharing and termination/deletion conditions separately;
   API availability is not a license.
2. Build one prospective frame of at least 100 distinct works, with their exact edition references,
   before querying tested providers. Include at least five publishing groups and broad fiction,
   nonfiction, indie/small press, backlist, recent releases, translated editions, formats and known
   audiobook controls. Record selection counts and exclusions; do not manufacture a representative
   claim from a convenience sample. Missing-reference facts stay unscored.
3. Audit overlap with every located completed metadata frame and the private qualification identity
   partition. Disclose missing historical frames. Never expose or repurpose qualification truth.
4. Freeze the full identities, work grouping, required fields, references, policy version, cost
   assumptions and spend ceiling. Select deterministic cohorts of at most 20 editions using the
   current transport caps; keep every edition of one work in the same cohort. Commit the non-secret
   plan/hash/runtime lock before the first call. Use an exclusive marker for each cohort; failures
   are results, not permission to retry, add cases or refresh an inspected sample.
5. Use `metadata:study` to report cohort metrics and reconcile complete frame totals without treating
   editions as independent works. Its deterministic work-preserving partition, committed runtime/lock
   checks, permanent shared-worktree attempt state and strict aggregate validation are now implemented
   with offline known-answer tests. The original `metadata:value` remains the single-cohort primitive;
   do not invoke it directly to bypass the study wrapper. Incomplete or failed study cohorts prevent
   a combined cost projection, and an already-attempted ISBN set cannot be repriced into a new run.
   See the package README for the remaining manual rights/overlap gates and state-recovery limits.
6. Add a blinded review-time exercise only after permitted ephemeral display is established.
   Compare time and error rate on baseline-only versus supplemented packets. Until then, report
   review time as unmeasured and do not price assumed human time as observed savings.

The study should not grow indefinitely until ISBNdb looks good. A preregistered study can end in
keep, cancel recommendation, or inconclusive. A failed rights gate is a deployment blocker regardless
of quality. Another round requires a new stated question and owner-visible budget, not a silent rerun.

## Proposed keep/cancel scorecard

The owner must select a maximum acceptable cost per additional correctly improved work and expected
monthly distinct-work volume before results. The instrument accepts these and the actual monthly fee
as nullable inputs; it never invents a price or credits balance. Proposed quality gates are no
observed wrong-identity admissions, no increase in incorrect selected metadata versus free-only,
and a material positive benefit after accounting for regressions. These are decision criteria, not
claims that zero observed errors proves zero true error.

For each policy, project monthly additional works as monthly distinct-work volume multiplied by the
observed work-level benefit rate. Divide the subscription fee by that projection for cost per extra
work. Label the projection explicitly; publish observed counts, sample limitations, missing-reference
coverage, outages and uncertainty beside it. Zero gain gives no finite cost estimate, not free value.
Do not amortize the fee over all requests or all returned fields. Include integration/maintenance
burden and measured review-time savings separately in the final decision.

Prefer the least costly policy that meets the chosen quality and utility gates. ISBNdb-first must
earn its ranking through the comparison; selective use is not assumed optimal. If the completed
study shows only marginal benefits below the chosen threshold, recommend cancellation instead of
retaining the subscription for hypothetical future value. No automated renewal/cancellation action
or production promotion follows from this trial report.
