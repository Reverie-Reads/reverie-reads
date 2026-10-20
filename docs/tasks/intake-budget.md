# Durable Luna research budget

The intake budget CLI is a private spending boundary for residual description research. It does
not write catalog facts or personal data. Its fixed **$50 total ceiling** includes prior expenditure
and retained uncertainty; it is not a new $50 allowance. The reviewed October 16 completion receipt
records **$20.73931475**, including the earlier $2.30 uncertain/comparison reserves, leaving
**$29.26068525** before any new reservation. Historical continuation totals are cumulative, not
additional amounts. This local receipt is not an account-wide invoice audit: initialization requires
explicit reconciliation of any later activity.

## Executable boundary

Run `node scripts/intake-budget.mjs` from a checkout of this repository. The CLI finds the real Git
common directory and uses its fixed `intake-luna-budget-v1` child. Worktrees share that directory;
there is no CLI path, ceiling, model or endpoint override. Do not create another clone or remove
receipts to reset the budget. This gate cannot account for unrelated clients that bypass it.

```sh
node scripts/intake-budget.mjs init /private/budget.json /private/reconciliation.json
node scripts/intake-budget.mjs status
node scripts/intake-budget.mjs configure /private/verified-pricing.json
node scripts/intake-budget.mjs prepare /private/current-inventory.json /private/dispositions.json WORK_UUID:description /private/evidence.json 2000 /private/prepared.json
node scripts/intake-budget.mjs run /private/current-inventory.json /private/dispositions.json WORK_UUID:description /private/evidence.json 2000
node scripts/intake-budget.mjs settle REQUEST_HASH
node scripts/intake-budget.mjs review /private/prepared.json
```

`init` and `status` work without pricing or credentials. `init` verifies the supplied receipt's
`model` and `conservativeSpentTotalUsd`, requires at least the known opening burden, and binds its
exact bytes by SHA-256. The reconciliation document must contain exactly:

```json
{
  "version": 1,
  "receiptSha256": "<SHA-256 of the exact private budget.json bytes>",
  "openingBurdenUsd": "20.73931475",
  "checkedAt": "<current UTC timestamp>",
  "laterActivityReconciled": true
}
```

The attestation must be no more than one day old. Set it only after reconciling later local activity;
the program cannot establish that an operator supplied every expenditure. Opening initialization is
permanent. A later higher opening receipt may be used for initial reconciliation, but the ceiling
cannot exceed $50. Monetary arithmetic uses integer nanodollars, preserving all eight supplied
decimal places without floating-point rounding.

## Verified pricing, not an assumed request allowance

No production price is bundled. `configure` requires a manually verified manifest with exactly
these fields:

| Field                                         | Required value                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| `version`, `model`, `serviceTier`, `currency` | `1`, `gpt-6-luna`, `default`, `USD`                                                  |
| `pricingVersion`                              | Explicit reviewed pricing revision, at most 100 characters                           |
| `pricingSource`, `contextLimitSource`         | Official HTTPS OpenAI documentation URLs                                             |
| `checkedAt`, `verified`                       | Current UTC timestamp, `true` after inspecting both sources                          |
| `inputUsdPerMillion`, `outputUsdPerMillion`   | Positive verified uncached USD rates as decimal strings, at most nine decimal places |
| `maxInputTokens`, `maxOutputTokens`           | Verified model token ceilings as positive integers                                   |

The full verified input-token ceiling, rather than an unverified tokenizer estimate, is reserved
for every request. The requested `max_output_tokens` must be within the verified output ceiling.
The reserved cost is the sum of both token bounds at their respective rates, each rounded upward
to a nanodollar. If the conservative bound exceeds remaining funds, the request does not run.
There is no assumed $0.50 allowance, cached-input discount, unbounded search charge or automatic
tool budget. Official URLs and an attestation are a review gate, not automatic verification of the
page's contents; absent verified Luna pricing or token bounds, paid execution stays blocked.

Pricing expires for new requests after seven days. Renew by running `configure` with a newly
reviewed, later `checkedAt` timestamp. Each manifest is an immutable hash-named receipt; renewal
does not reset spending or rewrite prior requests. Existing reservations and settlements remain
bound to the original pricing version. An identical configuration retry is read-only. Changed
configuration with the same or an older review timestamp is refused.

## Current task and source restrictions

`run` rebuilds the completion plan from the supplied current inventory and dispositions. It accepts
only a description task actually scheduled as `llm_evidence_research`, with model `gpt-6-luna`, after
a fingerprint-matched `complete_no_supported_value` non-LLM disposition. Identity/review holds,
stale dispositions, unknown input fields and incomplete deterministic research remain blocked.
The caller must refresh the read-only inventory before execution; this local tool does not connect
to the database or certify that a file still matches live catalog state.

The evidence document contains exactly `version: 1`, the current work `fingerprint`, `snippets`,
`checkedAt`, `inventoryHash`, `dispositionHash`, and `currentInventoryConfirmed: true`.
Compute each hash as SHA-256 of `JSON.stringify` of the parsed inventory/dispositions, retaining
their order. The explicit review timestamp must be no more than 24 hours old and not future-dated.
The exact evidence document, including snippets and review attestations, is also hash-bound into
the permanent reservation. Freshness is checked again immediately before reservation. Matching
old files alone therefore cannot schedule a request. This is a bounded operator attestation of
current inventory and completed non-LLM research, not independent proof of live database freshness.

Supply one to four independently inspected snippets, each containing exactly `url`, `locator`,
`text`, `sourceChecked: true`, and `modelInputAllowed: true`. Text is capped at 6,000 characters per
snippet; locators at 500 and HTTPS URLs at 2,000. Permission to access, display or store a source is
not automatically permission to send its text to a model. Do not submit source text unless its
applicable source-use policy permits model input. No personal notes, owner IDs, reading history or
copy inventory are accepted by the planner/evidence allowlists. The reviewer remains responsible
for excluding personal information from free text.

This first paid boundary **interprets supplied evidence**. It has no browsing/search tools and does
not discover or fetch new sources. Its fixed prompt treats snippets as untrusted data and requests
supported description research, supplied citations and explicit uncertainty. Output is always an
unverified proposal for independent original-source inspection, never a metadata patch or approval.
The fixed request uses the Responses endpoint, `gpt-6-luna`, `service_tier: default`, `store: false`,
disabled truncation and a bounded output limit. Redirects, retries, arbitrary commands, tools,
alternate endpoints and caller-provided model configuration are unavailable. `OPENAI_API_KEY` is
required before reservation and is never written to the ledger.

The v2 methodology replaces free-form text with a strict, code-owned claim/citation schema. Every
claim has work/description scope, a candidate/withheld disposition and exact quoted support linked
to a code-assigned source ID. Identity explanations, categorized findings and abstentions remain
separate. Local checks verify the shape, supplied source IDs and literal substring anchors. They
cannot establish that the source is correct or that a quote supports the model's interpretation.
`citation_checked` always retains `requiresSourceReview: true` and `saveAllowed: false`; conflicts,
unknown citations, abstentions, refusals and incomplete/malformed output remain `held`. A withheld
research result still incurs usage; valid accounting is never presented as valid bibliography.

`prepare` is a no-network dry run. It performs the same planner, source-use and freshness checks,
then writes a private create-only request packet without pricing, credentials or a reservation.
Keep this packet outside Git: it contains permitted excerpts, not merely aggregate diagnostics.
Run with the identical inventory/disposition/evidence/token inputs to retain its request hash.
Changed inputs require new review; changing the prompt or schema cannot replay a consumed task.

`review` reads the original settled response and compares the packet's configuration hash to the
reservation. It prints fixed diagnostic codes/counts only, without another model call, settlement
or reservation. It may be repeated read-only, including after the original evidence freshness
window; this is inspection of a historical attempt, never current evidence requalification.
Unsettled responses must first use the existing `settle` recovery. Older free-form attempts remain
accountable and consumed; they do not gain the new research contract or become replayable.
See [Luna methodology](intake-luna-methodology.md) for evaluation and remaining boundaries.

## Durable accounting and recovery

One exclusive directory lock serializes writes across processes and worktrees. Reservation JSON is
written to a create-only pending file, fsynced, renamed atomically and followed by directory fsync
**before network activity**. The lock is released before the bounded network call. The request ID
is a hash of planner task ID and target fingerprint; changing prompt text, pricing or output filename
cannot replay the same task revision. Reservations permanently bind model, request configuration,
pricing, inventory and dispositions. Aggregate journals contain hashes and costs rather than book
identity, source snippets or credentials.

A private response artifact is saved separately from the reservation. It may contain bibliographic
source text and model proposals; it is not a provider-qualified evidence store. Settlement is a
separate durable receipt bound to both reservation and response hashes. Settlement requires the
expected model and default service tier, a completed/incomplete response, no tool output, consistent
input/output/total usage, bounded cached and reasoning counters, and token usage within the original
reservation. Reasoning tokens are included in output usage; they are not billed twice. Cached inputs
are conservatively charged at the verified uncached rate. A repeated identical settlement is read-only.

Missing usage, unexpected tier/model/tools, failed requests, lost responses, interrupted calls and
out-of-bound usage retain the complete reservation. The CLI never releases or replays them. If a
response is durable but settlement was not attempted, `settle REQUEST_HASH` can record its validated
usage without another network call. No caller-supplied cost or replacement usage file can settle it.

A process killed while holding the writer lock, an unfinished pending file, corrupt ledger data or
an orphan receipt stops further operations. There is deliberately no automatic stale-lock removal,
pending-file deletion, receipt repair or reservation release. An operator must inspect durable
receipts and uncertain provider activity before any separately reviewed recovery. Retain the original
artifacts; do not reset the ledger to resume. An uncertain response cannot be made safe merely by
changing its task ID or running from a different checkout.

## Verification

`node --test scripts/intake-budget.test.mjs` exercises exact opening arithmetic, no-pricing status,
pricing validation/renewal, planner and source restrictions, fixed request configuration, durable
pre-network reservation, conservative settlement, uncertain usage and failures, duplicate requests,
budget exhaustion, concurrent processes, shared worktree location, a process killed after send,
and a process killed between settlement fsync and rename. All provider calls in tests are synthetic.
No real model calls or credentials are needed. Test pricing is explicitly synthetic and must never
be configured for paid execution.
