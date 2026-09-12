# Fresh 25-work authority development trial

Status: frozen for one owner-authorized no-write run, September 12, 2026.

This tests the merged source-claims safeguards at public commit
`d139d9a5cd8a6608103ec83fb1c8af2a98c2e136`, without changing prompts, production code,
the catalog, billing settings, or qualification. The public non-secret lock is
[`authority-fresh25-v12-lock.json`](authority-fresh25-v12-lock.json). The private
identity frame, operational runner, exclusion manifest, proposals and review handoff
stay outside the repository in the owner's local trial directory.

## Selection before acquisition

- Reuse the complete 847-row September 10 recovery identity inventory. Its work
  fingerprints and historical classification state are not model inputs.
- Scan trial data and private JSON artifacts across every currently registered public
  worktree, the canonical private checkout's trial directory, and the consumed nine-work
  pilot. The 901-file content-hashed exclusion manifest includes 347 normalized titles.
  It includes the public qualification plan; no private qualification pool was found in
  these locations. This is an inventory-scoped claim, not proof about other storage.
- Exclude historical title matches, missing identities and duplicate titles. Counts
  reconcile: 847 population = 87 excluded + 760 eligible.
- Rank eligible title/full stored-author pairs by SHA-256 with the fixed seed
  `authority-fresh25-v12-2026-09-12`; select the first 25 with at most one work per stored
  author. Do not replace inconvenient cases after seeing predictions.
- Preserve input spelling, titles, and contributor strings. Withhold existing series,
  positions, truth, known URLs, publication year, identifiers and reader information.
  Model output cannot silently repair an identity. This app-derived sample is not
  population-representative, a balanced standalone benchmark, or a human-reviewed gold set.

## Execution boundary

Use the unchanged Luna-low acquisition helper, medium hosted-search context, at most
three hosted tool calls per search pass, strict current relationship-claims policy, and
one permitted no-tools structural repair. Exa is a fallback only after unresolved or
quarantined Luna output. It remains an in-memory locator, never evidence. Retain only
aggregate Exa operations; persist neither Exa results nor case-level Exa diagnostics.
The second Luna pass may retain only its own proposals and consulted manifest. Preserve
both Luna passes for review so selecting the fallback cannot hide an earlier conflict.

Run sequentially, once, with no automatic retry, no navigation retrieval and no Supabase
connection. Exact fixed provider endpoints, unchanged runtime hashes, Node version,
target hash and a committed public lock are checked before acquisition. Exclusive
Git-common-directory experiment and dataset markers prevent replay across worktrees;
never clear them or rename/reclone to repeat the frame. A provider authentication,
quota, network, usage-accounting, model-drift or budget failure stops the run. A malformed
structured proposal remains an error, not a standalone conclusion or a successful save.

The runner uses a $5 application-side acquisition budget, reserving $0.60 before each
model request and $0.007 before each Exa request, then conservatively accounting for
reported usage. Unknown charges retain their reservation and stop. This is not a
provider-account billing limit. Hard request bounds are 100 model calls (at most 50 search
passes and 50 repairs), 150 hosted searches and 75 Exa requests. At the checked rate,
Exa cannot exceed $0.525 for this run. No model/provider upgrades or automatic retries.

Pricing checked September 12 against official [Luna model pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[hosted-search pricing](https://developers.openai.com/api/docs/pricing), and
[Exa Search pricing](https://exa.ai/pricing): standard Luna $0.20/$1.20 per million
input/output tokens, cached input $0.02, hosted search $0.01/call, Exa auto search with
ten results $0.007/call. Long-context/cache-write premiums are accounted for conservatively
in the guard. Final costs are estimates from reported usage, not an invoice, and exclude
this Codex task's preparation/review effort.

## Review and decision

After the one run, independently inspect first-party evidence for every emitted answer
and abstention. This is an assistant-led cited development audit, not a blind human
qualification attestation. Record exact identity, membership type/name, order, conflicting
claims, unsafe publisher groupings, evidence availability and unresolved reasons.
Report first-pass versus selected-result resolution, supported/incorrect/unverified
answers, Exa's incremental supported resolutions, tokens, costs and latency. Keep
unverified answers separate from correct ones; do not turn missing evidence into standalone.

No production correction is authorized by a good result. The narrow fill-only lane still
requires the separate qualification and source-use gates in
[`authority-automatic-correction-gates.md`](authority-automatic-correction-gates.md).
The prior nine cases and consumed qualification/study state remain untouched.

## Preflight evidence

- Provider DNS resolved and both required local keys were present; no values printed.
- Five offline runner guard checks passed, including request/cost refusal before a call.
- All 18 source-claims regressions passed, including missing claims, non-book groupings,
  competing relationships and conflicting order.
- This branch changes only documentation and the non-secret lock. It does not change app,
  package source, database or test infrastructure; a full application e2e run is not required
  for this documentation-only trial receipt.
