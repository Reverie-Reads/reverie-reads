# Luna evidence methodology

Residual description research and separate identity, edition and contributor investigations are
traceable research tasks. Both require completed non-LLM work and freshly reviewed, permitted
source excerpts. Investigations explain held questions; they do not change completion eligibility,
release holds, select editions or expand provider permissions. There is no automatic web investigation
or catalog writer. New requests share a durable $5 pilot sublimit within the existing $50 total.

## Implemented sequence

1. Refresh the private inventory and inspect reusable non-LLM evidence. Existing identity/review
   holds stay in their current queue. Description gaps require the existing fingerprint-bound
   `complete_no_supported_value` disposition. Separate investigations require a current,
   fingerprint-bound `complete_unresolved` non-LLM disposition, even for works held by the completion
   planner. Failed sources and incomplete research do not satisfy either gate.
2. Inspect at most four source excerpts and their permission for model input. A provider's public
   lookup access, matching ISBN or model-generated citation is insufficient. No original provider
   payload from consumed transient comparisons is reused or submitted to Luna.
3. Use `intake:budget prepare` to inspect a private request before spending. The request assigns
   source IDs and separates its code-owned instructions from untrusted excerpt data. The fixed
   model remains `gpt-6-luna`; the durable $50 total ceiling and permanent attempt identities apply.
4. Request strict structured research: a cited identity assessment, separate claims, categorized
   findings and explicit abstentions. Description requests retain the v2 work-description schema.
   Investigations use a separate v3 schema for the requested identity, edition or contributor question,
   including work/edition/part scope and a source locator for non-work claims. These are explanatory
   text, not typed bibliographic patches. Each claim has exact quoted anchors and a candidate/withheld
   disposition. Edition facts cannot enter description claims, and title formatting cannot relax
   matching. Target ISBNs in investigation input remain disputed observations. Every investigation
   finishes `held` with `investigation_requires_review`, including a model's consistent assessment.
5. Validate locally after recording and settling the original response. Unknown source IDs,
   fabricated/changed quotes, duplicate citations within an item, invalid shapes, refusals,
   incomplete output and reported conflicts have distinct held diagnostics. Silent empty output
   is not successful absence. Settlement proves only bounded usage, even for unusable research.
6. Independently inspect the original cited source and exact target before accepting any fact.
   `citation_checked` establishes literal anchors only. Every result has
   `requiresSourceReview: true` and `saveAllowed: false`. Existing values and personal data never
   enter a write path. A valid quotation can accompany a false paraphrase; a regression explicitly
   preserves that limit rather than claiming automatic semantic verification.

The request's `text.format` follows the current [official Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
Strict JSON shape does not certify factual correctness. `scripts/intake-research-contract.mjs`
owns the prompt, schema and citation assessment. The budget CLI invokes these functions on its
real prepare/run/review paths; this is not a test-only helper. No SDK dependency, new model,
tool-enabled request or alternate endpoint is introduced.

## Frozen evaluation

```sh
pnpm intake:research:eval freeze /private/frame.json /private/lock.json
# Collect responses using only each case's body, never its reference or expected outcome.
pnpm intake:research:eval score /private/frame.json /private/lock.json /private/responses.json /private/report.json
```

The frame contains exactly `version` (`1` or `2`), `basis` and up to 20 `cases`. A case contains `id`
(`case-01` etc.), the fixed-contract request `body`, and a separate `reference` with `expectedState`
(`held` or `citation_checked`) and a written `basis`. Freeze the frame and current contract,
executor and scoring code before collecting replies. A changed request, reference or code hash
refuses scoring against the old lock. Do not turn a development case into unseen evaluation data.

The response file maps every case ID to either `{ "status": "observed", "response": ... }` or
`{ "status": "unobserved", "reason": "not_run" | "request_failed" | "response_missing" }`.
Unknown, duplicate-in-frame and omitted case IDs are refused. Outputs and reports are private and
create-only. The report retains counts, case IDs and fixed diagnostic codes, not source text,
claims, quotations or target identities. It records observed/unobserved denominators, agreement
with the expected contract disposition, overly permissive citation-check results and unnecessary
holds separately. The evaluator has no acquisition, model executor, budget override or writer.

Version 1 preserves contract-only evaluation. Version 2 also accepts an optional `humanReview`
on each observed response. Without it the case remains `not_reviewed`; failed and unobserved cases
remain in both the overall and not-reviewed denominators. The review contains exactly:

- `version: 1`, `requestHash`, `responseHash` and `referenceHash` (SHA-256 of `JSON.stringify` of
  the exact request body, response and frozen reference).
- Private `reviewer`, `reviewedAt` (non-future timestamp), written `basis`,
  `originalSourcesInspected: true` and `referenceIndependent: true`.
- `dimensions` with `identity`, `edition` and `contributorRoles`, each marked `supported`,
  `unsupported`, `uncertain` or `not_applicable` after independent inspection.
- `claims`, covering every zero-based proposed-claim `index` exactly once, with `verdict`
  (`supported`, `unsupported` or `uncertain`) and a written `basis` per claim. An unfavorable claim
  cannot be omitted or marked not applicable.

Reports separate these human verdict counts from citation/contract agreement. A real quotation with
a false paraphrase can pass the literal citation check and simultaneously receive an unsupported
semantic verdict. Reviewer names, explanations, source passages and bibliography are absent from
reports. Human review is an attestation, not machine verification of the source, reviewer's
independence or population accuracy. Model graders cannot supply this human-review receipt.

Use `basis: "synthetic_contract"` for invented bibliography and injected responses, and
`"reviewed_model_responses"` only for actual model replies with separately inspected references.
The former tests the contract, not Luna's ability to recognize wrong books. Even a real small frame
does not establish population accuracy. Reports always retain `accuracyEstablished: false` and
`semanticSupportCertified: false`. Model labels, quote matches and API agreement are not gold truth.

## Current evidence and remaining qualification

The October 20 development source probe predates this refinement and remains consumed. Its four
positive comparisons across two editions yielded two identity matches; all four negative controls
were held. First-acquisition transient inspection found one leading-article omission and one
page-count disagreement with the selected publisher edition. Those are distinct failure patterns,
not an explanation for earlier consumed frames whose raw titles were never retained. Nothing in
this refinement reclassifies or rescores those records, changes title rules or certifies API facts.

Synthetic tests cover reported article-formatting, role/identity/edition conflicts, wrong-scope
claims, unsupported citations, refusals, truncation, explicit abstention, preservation of review
requirements and incorrect interpretations of genuine quotes. These are injected replies; they are
not a live Luna comparison, a paid source study or proof of prompt-injection resistance.

Before a paid methodology trial, qualify model-input permission for a genuinely new, reviewed
sample, verify current exact-model pricing/context bounds and freeze the sample and references.
Use the existing reservation before each request. Keep acquisition failures and all costs visible;
never replay consumed studies to obtain a better result. The separate bounded investigation packet and
scheduler now support identity/edition/contributor explanations while preserving their holds. The
human-review receipt measures independently reviewed claim support separately from contract shape;
it does not automate semantic verification. Bounded discovery/fetching remains future work; this
change adds neither automatic web search nor autonomous adjudication. Production Add/scanning/imports remain
unchanged and the existing staged cutover is still required.
