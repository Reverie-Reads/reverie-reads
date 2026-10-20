# Luna evidence methodology

The first refinement makes residual description research traceable and testable. The paid executor
still accepts only planner-approved description gaps after completed non-LLM research and permitted
source excerpts. It does not yet reproduce a general web investigation of held identities or edition
conflicts. This distinction is intentional: a research explanation must not silently release an
identity hold, select an edition or expand provider permissions.

## Implemented sequence

1. Refresh the private inventory and inspect reusable non-LLM evidence. Existing identity/review
   holds stay in their current queue. Only a current, fingerprint-bound description disposition may
   reach the existing paid boundary.
2. Inspect at most four source excerpts and their permission for model input. A provider's public
   lookup access, matching ISBN or model-generated citation is insufficient. No original provider
   payload from consumed transient comparisons is reused or submitted to Luna.
3. Use `intake:budget prepare` to inspect a private request before spending. The request assigns
   source IDs and separates its code-owned instructions from untrusted excerpt data. The fixed
   model remains `gpt-6-luna`; the durable $50 total ceiling and permanent attempt identities apply.
4. Request strict structured research: a cited identity assessment, separate work-description
   claims, categorized findings and explicit abstentions. Each claim has literal quoted support and
   a candidate/withheld disposition. Pages, formats, dates, contributor patches and other edition
   fields are not valid description claims. Title formatting is a finding, not permission to relax
   matching. Findings cover contributor roles, identity/edition conflicts and unsupported facts.
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

The frame contains exactly `version: 1`, `basis` and up to 20 `cases`. A case contains `id`
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
never replay consumed studies to obtain a better result. General identity/edition investigation
needs a separate bounded research packet and scheduling design before broadening paid task scope.
Bounded discovery/fetching and independent semantic review remain future work; this change adds
neither automatic web search nor autonomous adjudication. Production Add/scanning/imports remain
unchanged and the existing staged cutover is still required.
