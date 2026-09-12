# Fresh 25-work observed-identity development trial

September 12, 2026. Pre-acquisition freeze; review-only, not production qualification.
The owner authorized proceeding after PR #546 merged. This tests public runtime
`109d133b6ee6507e4fb957898e006608bde4e07f` without changing it. The non-secret
[system/dataset lock](authority-fresh25-v14-lock.json) is committed before any API call.
Private inputs, operational runner and source-review artifacts stay outside the repository.

## Selection

Reuse the complete 847-row September 10 recovery identity inventory, preserving stored title
and full author spelling. Across all currently registered public worktrees' trial data/private
results, the canonical private trial results and the consumed nine- and 25-work trial directories,
982 JSON artifacts contribute 372 normalized historical titles. Exclude historical title matches,
incomplete identities and duplicate titles. Counts reconcile: 847 = 112 excluded + 735 eligible.
SHA-256 ranking with seed `authority-fresh25-v14-2026-09-12` selects 25, capped at one work per
stored author. The model receives title/authors only, with a null year and opaque case label;
no catalog series, position, truth, known URLs, identifiers or reader data.

All selection inputs and exclusion artifacts are hash-checked. The exclusion inventory includes
public qualification plans; no private qualification-named pool was found in the scanned roots.
This is an inventory-scoped freshness check, not proof about unregistered storage. The app-derived
sample is neither balanced nor representative, and is not human-reviewed gold. Do not replace
inconvenient cases after seeing predictions. Prior consumed runs remain unchanged and ineligible.

## Execution

Use unchanged Luna-low v14 acquisition, medium hosted-search context, up to three hosted calls
per search pass, and at most one existing no-tools structural repair per pass. Current identity
policy is bound to each target. Repair retains and revalidates earlier observations; Exa fallback
uses the merged cross-pass policy with that same target. Record both Luna passes and their
history, but no Exa response, result URL/domain/title/snippet/query/request ID or case-level
locator diagnostics. Exa remains an in-memory locator, never evidence. No navigation retrieval.

One sequential run, no retries, no Supabase connection, production writes, migrations, deployments
or billing-setting changes. Exclusive experiment and dataset attempt markers live in the shared
Git common directory and must never be reset. Freeze the source/runtime/Node/input hashes before
acquisition; require the committed lock and clean tracked tree. Fixed provider endpoints only.
Authentication, quota, network, model drift, missing usage or budget failure stops the run.

Keep the previous $5 application-side acquisition ceiling, reserving $0.60 per model request
and $0.007 per Exa request before sending. Unknown charges retain reservations and stop.
Hard bounds: 100 model requests, 50 search passes, 50 repairs, 150 hosted searches and 75 Exa
requests (at most $0.525 Exa). This is not a provider-account billing limit. No new model or provider.

Pricing rechecked September 12: [Luna token pricing](https://developers.openai.com/api/docs/models/gpt-5.6-luna),
[hosted search](https://developers.openai.com/api/docs/pricing), and [Exa search](https://exa.ai/pricing).
Use $0.20/$1.20 per million input/output tokens, $0.02 cached input, applicable cache-write/long-context
premiums, $0.01 per hosted search, and $0.007 per Exa auto search with ten results. Record reported
usage and a conservative budget ledger; estimates exclude this Codex task and human review.

## Review and decision

Independently audit every answer and abstention against source pages after the frozen run.
Separate ordinary-work supported answers, incorrect answers, unverified claims and withheld cases.
Check full identity, source control, relationship type/name and explicit position. Do not treat
reading independence as bibliographic standalone or an omnibus as one numbered work.
Report first-pass/selected useful yield, Exa's incremental supported yield, usage, cost and latency.
Different fresh samples cannot establish a causal before/after improvement; no extra-Luna-only
control is included. This assistant-led development review is not blind human qualification.

Keep automatic corrections disabled. Existing [qualification and correction gates](authority-automatic-correction-gates.md)
remain unchanged. Any inspected cases become development material, not a future holdout.

## Preflight

Both provider hostnames resolve and both required local keys are present; values were not printed.
Nine offline runner checks cover request/cost refusal and current target-bound identity policy.
The merged trial regression suite is checked separately. This branch contains documentation and
the non-secret lock only, so it is exempt from the full application browser suite; no app, package
runtime, database or test infrastructure is changed.
