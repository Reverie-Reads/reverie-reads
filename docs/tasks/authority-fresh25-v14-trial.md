# Fresh 25-work observed-identity development trial

September 12, 2026. Completed single-use development evaluation; review-only, not production qualification.
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

Freshness means exclusion from the inventoried authority/provider development artifacts, not
that every title is unknown to the application or this task's history. Some titles have appeared
in earlier production relationship smoke tests. This is not a blinded holdout.

## Execution

Use unchanged Luna-low v14 acquisition, medium hosted-search context, requested `max_tool_calls: 3`
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

## Completed receipt

The lock was committed as `e657a08ec7e0d88c6945392d587327dc02b8de2a` before acquisition.
One run completed all 25 cases from `2026-09-12T20:18:00.164Z` through
`2026-09-12T20:25:52.225Z`: 472.061 seconds, about 7 minutes 52 seconds. No failed cases,
automatic retries, structural-repair calls or production writes occurred. All proposals remain
review-only. The private runtime summary deliberately retains `truthAdjudicated: false`; the
separate assistant-led source audit is not a human gold-standard adjudication.

| Outcome                                                                 | First pass | Selected after optional fallback |
| ----------------------------------------------------------------------- | ---------: | -------------------------------: |
| Valid, policy-safe, resolved proposals                                  |      11/25 |                            12/25 |
| Directly supported ordinary series and numeric order after source audit |      10/25 |                            10/25 |
| Software-accepted proposals still needing evidence/scope review         |       1/25 |                             2/25 |
| Withheld or unresolved by software                                      |      14/25 |                            13/25 |
| Accepted affirmative standalone proposals                               |          0 |                                0 |

The ten supported answers are review candidates, not permission to write the catalog. Two of
the twelve software-accepted answers cannot be counted as fully supported ordinary membership:
one relies on an indirect author-biography series mention rather than an exact-work relationship;
the other mixes a core series with a broader publisher grouping and leaves alternate scope in
unstructured uncertainty. Neither is demonstrated to be a false association, but both need review.
This is an evidence-admissibility limitation, not a claim of measured 83% factual accuracy.

The 13 withheld cases reconcile as follows:

- Six identity-review cases: author alias, author typo, combined author/pseudonym, joined title
  words, marketing-subtitle expansion, and a truncated collection title.
- One omnibus, one supported publisher relation held by the conservative self-titled rule, and
  one standalone proposal lacking eligible affirmative evidence.
- Four cases without sufficient direct named-series or affirmative standalone evidence. Absence
  of a label remains unknown; none is counted as a correct standalone answer.

Three selected packets are structurally invalid and are included in the withheld counts, not
successful classifications. The estate-hosted standalone essay is attributed to a third-party
scholar; first-party hosting cannot change the speaker. One supported source was verified using
indexed same-URL publisher attributes after partial/timeout origin reads. These access and
attribution limitations remain in the private audit.

### Cost and locator value

Reported usage: 39 Luna search requests, 96 hosted-search calls, 42 Exa searches, 620,006 input
tokens including 163,944 cached and 104,074 cache-write tokens, and 25,738 output tokens. No request
crossed the long-context pricing threshold. Estimated model tokens cost $0.13058058, hosted
search $0.96, and Exa $0.294: **$1.38458058 total**, approximately 5.54 cents per tested work.
The conservative application ledger settled $1.43988710 against its $5 ceiling. Neither number
is a provider invoice, and neither includes this Codex task or the separate evidence audit.

Although requests specified three maximum tool calls, four responses reported four hosted calls;
reported usage, not the requested limit, drives these totals. The overall 150-call ceiling was
not reached. Do not describe the requested per-pass setting as an observed hard bound.

Exa was attempted for 14 cases and its separate Luna pass was selected once. That selected answer
still needs direct-relationship review, so **incremental fully supported yield was zero** in this
sample. Exa latency totaled 70.315 seconds; all 14 additional Luna passes also consumed tokens and
hosted search. There is no extra-Luna-only control, so this does not isolate Exa's causal value or
prove it can never help. Do not expand its use from this result. Keep it opt-in and bounded while
prioritizing the existing matching/review path.

### Verification and next decision

All 451 trial tests and nine private offline runner checks passed before acquisition. A post-run
read-only check verified the frozen runtime, Node version, target dataset, population and all 982
historical exclusion artifacts unchanged. Exclusive experiment and dataset attempt markers remain
consumed. Do not rerun these cases, including from another worktree or clone, or use them as a
future qualification holdout. No runtime repair was made in response to this run.

Private receipt hashes (SHA-256):

- Runtime `summary.json`: `38136e65952ac1fbcbc835287df53f045ff703d0bed792516604114a67bb3690`.
- Separate `review.json`: `702df3b651f988c694774fabeca184952a4364f1f0ca2ad25696eb90f78127c7`.

Keep Luna low and automatic catalog corrections disabled. The smallest useful next work is an
explicit identity-review handoff that shows stored versus observed title/contributors separately
from series claims. Coordinate it with the existing source-identity intake task; do not silently
fix names or broaden matching globally. Separately preserve indirect-biography, quoted-speaker
and broad-grouping context as structured review reasons. No additional provider, shared vector
store, model upgrade or large paid run is justified by this sample.

The preceding v12 trial used a different fresh frame. Its higher raw yield cannot establish a
v14 regression or improvement. This result identifies concrete development cases, not readiness
for autonomous correction, production source rights, or locked qualification.
