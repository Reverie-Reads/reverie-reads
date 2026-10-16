# Importer accuracy: shared catalog, then personal intake

Owner direction: improve both shared-catalog ingestion and personal CSV/barcode intake, with the
shared catalog first. Use non-LLM methods before `gpt-6-luna` evidence research. Existing source
policies, review controls, reader protections and budget limits remain in force.

## Acceptance contract

Every proposed fact needs an identified work, the correct scope, an inspected supporting source,
and a reviewable reason. Work identity, edition identity, field support and permission to retain
source material are separate checks. A provider match or a model's citation does not satisfy all
four. Normalize presentation differences through the existing admission matcher; retain exact
canonical ISBN checks, full-contributor checks and ambiguous-name review.

Keep work descriptions separate from edition pages, language, format, publisher and publication
dates. Do not populate blank work scalars from an arbitrary edition. Preserve date precision as
one tuple. Series requires the exact work in a relationship, never a search label or an inference
from absence. A manually reviewed edition is an administrator decision, not necessarily independent
source verification. Direct administrator correction remains available under its existing contract.

Existing values are protected. A conflicting candidate produces a review, not a precedence winner.
An accepted correction must bind the source, field, exact value and edition to the current target
fingerprint/revision and retain before/after history. Research output cannot call personal library,
reading-history, possession or copy-inventory writers.

## First implemented slice: reproducible completion planning

`scripts/corpus-completion-inventory.sql` is a read-only owner/admin projection. It contains shared
identity, work scalar gaps, review state and a reader-link priority boolean; it does not export
reader identities, annotations, ratings or reading history. Save it outside the repository.

The planner consumes that JSON array and writes a private, create-only plan:

```sh
pnpm corpus:completion:plan /absolute/private/inventory.json /absolute/private/plan.json
pnpm test:corpus-completion
```

These interfaces were exercised with the full private inventory and synthetic regression fixtures.
The planner prints aggregate counts only. It performs no acquisition, model calls, Supabase writes
or evidence promotion. It rejects unsupported input fields and duplicate identities by ID.

The queue prioritizes identity problems, existing review holds, reader-linked descriptions, then
edition selection and relationship review. Work scalar gaps are expressly edition-selection tasks;
their count is not an edition-gap count. Reviewed edition page coverage is informational and cannot
authorize copying a value. Stale deferred reviews remain held. `no_series` is retained as an existing
state, not newly certified; unknown/review/unresolved states need relationship evidence.

An optional third argument is a private array of research dispositions, each containing exactly:

```json
{
  "taskId": "<work UUID>:description",
  "fingerprint": "<current 32-character inventory fingerprint>",
  "nonLlmStatus": "complete_no_supported_value"
}
```

Only use that disposition after checking reusable eligible evidence and completing the applicable
non-LLM research. `not_attempted` stays in source research; `failed` requires retry review;
`candidate` requires source review. Only `complete_no_supported_value` schedules Luna research.
Stale, duplicate and wrong-scope dispositions fail closed. This is an operator research ledger,
not an automated verifier or spending authorization. It does not certify that sources were checked.
Reconcile prior attempts before scheduling; never replay consumed studies or uncertain writes.

## Next shared-catalog slices

1. Reconcile existing cached evidence and exact-edition registry entries before new acquisition.
   Prioritize reader-linked works, identity holds and missing descriptions. Establish edition targets
   separately, including ISBN-less editions; never select the first ISBN from a work list.
2. Reuse deterministic author/publisher extraction and existing admitted provider adapters. Retain
   exact source location, observation time, field/value, scope, target fingerprint, retrieval outcome
   and applicable retention permission. A failure stays distinct from successful emptiness.
3. Present field-specific evidence in the existing review controls. Distinguish a direct manual
   correction from independently supported source evidence. Keep contradictory observations visible
   even when one source is preferred. A citation URL alone is insufficient.
4. Use Luna only for remaining research: locate evidence and propose explanations. Independently
   inspect the cited original source and apply the same deterministic identity/scope guards. Model
   confidence, repeated claims and mirrored provider records are not independent corroboration.
5. Apply only reviewed deltas through current authority and concurrency controls. Verify private
   data preservation and report accepted fills, corrections, abstentions, failures and cost separately.

These runtime connections are still pending; the planner is not an automatic importer or a new
review system. No new provider, shared vector store or general autonomous catalog writer is added.

## Personal intake follows the shared boundary

Reuse source admission and selected-edition continuity in CSV, pasted lists, barcode search, Add,
duplicate review and reopen. Imported reader values remain personal assertions, not shared evidence.
CSV mappings and duplicate choices remain explicit; repeated barcodes require a separate-copy
decision. Preserve per-format inventory, reading history, notes and manual series choices. Failure
retries must not duplicate records or discard drafts. Never automatically choose the top search hit.

Acceptance fixtures must cover harmless title/author formatting, same-title different-author books,
ambiguous initials, conflicting ISBNs, hardcover/paperback date and page differences, audiobook pages,
translation/omnibus conflicts, stale evidence, source failures, protected reader values and lost
save responses. Use sanitized synthetic cases in the public repository and keep real case evidence
private. Measure wrong-book acceptance and wrong-edition acceptance separately from useful-match
recovery; coverage alone cannot establish accuracy. There is no claim of perfect accuracy until a
representative independently verified evaluation supports it.
