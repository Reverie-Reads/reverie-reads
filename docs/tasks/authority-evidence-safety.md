# Authority evidence safety follow-up

September 12, 2026. Trial-only implementation following the consumed
[25-work development audit](authority-fresh25-v12-trial.md). The production task owns
provider adapters, ingestion, persistence and reader-facing changes. This patch adds no provider,
database, graph/vector store, production writer or acquisition run.

## Sequential changes

1. **Keep earlier observations.** Focused search, Exa fallback, structural repair and optional
   retrieval check prior grounded claims, including rejected passes. Missing competing names,
   named-type uncertainty, incompatible explicit orders, affirmative standalone conflicts and
   reviewed publisher-collection conflicts prevent a later resolution from replacing them.
   Selection-frame and discovery-only claims cannot poison a result. Unknown order can still gain
   direct evidence; only the existing series/books suffix normalization is allowed.
2. **Encode relationships accurately.** Shared acquisition/repair/retrieval instructions put an
   affirmative standalone assertion in support/summary with no fabricated named relationship.
   Unnamed descriptive series phrases remain summary-only; they cannot supply a membership name
   or lend their number to another source. Named ambiguities and actual conflicts remain explicit.
3. **Expose identity, origin and container review needs.** Current sources carry observed title,
   full author list and work scope, plus a claimed-first-party/unverified origin assessment.
   Deterministic comparison preserves the target instead of fixing its spelling. Omnibus and
   unknown scope remain unresolved, even when a series association is plausible. Unverified
   origins and link hubs cannot establish classification; another independent eligible source can.
   Rejected identity/container observations and same-URL ownership uncertainty survive later passes.
   Retrieval requires all full author names before interpretation, not one matching surname.

Current prompt/cache versions are `authority-acquisition-v14-observed-identity`,
`authority-acquisition-repair-v3-observed-identity` and
`authority-retrieval-interpretation-v5-observed-identity`. Historical proposals without the new
fields remain inspectable in legacy offline tests, but cannot satisfy current acquisition policy.
Neither tests nor cleanup manufacture missing observed facts. Consumed study/qualification frames,
runtime locks, private source evidence and single-use markers are unchanged.

## What this does not prove

The scout still reports observations; a model can misread or omit page content. A consulted URL
does not prove its contents, source ownership, reuse rights or classification truth. The
`claimed_first_party` value is not a model-issued verification certificate. Human-reviewed origin
and production qualification gates remain in force. Optional retrieval provides stronger packet
grounding but stays within its existing profiled, hash-checked, bounded no-write path.

These changes add no automatic correction route and do not qualify the resolver for production.
Offline synthetic regressions establish guard behavior, not a new precision/recall estimate or
measured reduction in abstentions. Any subsequent live evaluation needs a new approved frame and
budget; do not rerun the consumed 25 or nine cases under a new name or checkout.

## Verification

Focused synthetic tests cover cross-pass selection (including the actual mocked Exa wrapper and
retrieval path), malformed and contradictory relationship claims, standalone/generic encoding,
author spelling/initial/surname/coauthor mismatches, Unicode identity, unverified origins,
independent-source survival, omnibus scope, legacy observations and packet-grounded identity.
The full repository gate and coordinated browser-run receipt belong in the PR; do not infer a
browser pass, live improvement or deployment from these offline tests.
