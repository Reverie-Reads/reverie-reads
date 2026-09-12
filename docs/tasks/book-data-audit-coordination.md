# Coordinated book-data audit and remediation

September 12, 2026. Owner requested consolidation of the two active tasks.
This records ownership and findings, not a claim that all fixes are implemented or deployed.

## Shared boundary

Improve the reader app using existing providers and review controls. No new provider,
graph/vector store, automatic catalog writer, paid acquisition, source requalification,
production migration or billing change is implied. Preserve reader/CSV choices, exact
identity admission, field-specific provenance and explicit unknowns. A plausible model
answer is not a verified source observation; a source disagreement is not a correction.

## Ownership

| Task                                   | Owned scope                                                                                                                         | Avoid                                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Book-data authority task               | `packages/series-source-trial/src/authority`, its offline policy regressions, consumed trial receipts and private evidence handoffs | Production adapter/normalizer, app and private comparison edits; shared database/stack operations |
| Develop Reverie strategy and brand (2) | Production acquisition/normalization, persistence/display, private edition comparison, integrated ingestion audit                   | Trial authority source/runtime and its tests                                                      |

Coordinate before opening overlapping PRs. Public and private runtime changes remain
separate reviewed releases. No public merge while the other task is running shared-stack
browser regression; do not reset its stack. Keep provider-comparison #521 draft. A docs-only
receipt neither deploys functionality nor needs a private runtime sync or migration.

## Findings to reconcile

The [fresh 25-work trial](authority-fresh25-v12-trial.md) is complete and consumed.
Its independently inspected authority findings are:

- A supplied author typo can become a high-confidence identity without an explicit repair
  decision. Require observed identity and conservative comparison; do not relax title/author
  gates to recover more results.
- An author-named domain is not proof of author/estate control. Require independently reviewed
  source control, and retain an unverified state when it cannot be established.
- A later search pass can omit earlier source claims and appear policy-safe. Preserve the
  cross-pass evidence and conflicts rather than replacing the packet with the cleaner answer.
- An omnibus can have a correct series association but is not an ordinary individual-work
  slot. Keep the container distinction and unknown ordinal.
- Standalone assertions are sometimes incorrectly encoded as unknown named relationships;
  generic descriptions sometimes become competing series names. Clarify encoding without
  suppressing actual disagreements or treating absent evidence as standalone.

The production task independently reported these implementation findings; it owns their
local reproductions, fixes and verification receipts:

- Explicit Open Library subtitles are stored separately from the main title. Compare approved
  structured title variants, not prefixes/fuzzy identity matches.
- Anthology MODS contributors can lack author-role labels. Missing author-role evidence is
  uncertainty, not necessarily malformed data; do not silently relabel editors as authors.
- Library physical pagination and publisher page totals can genuinely disagree. Preserve
  source semantics and existing values instead of treating either as an automatic winner.
- Production enrichment uses work-search page medians and first/list-selected edition
  values. A supplied ISBN must not confer high confidence on an unvalidated adapter result.
- First title-only Hardcover hits require identity validation. Date parts from different
  providers must not form a synthetic complete date; year-only evidence must not become
  January 1. Missing Discover page-count plumbing is separate from whether those pages
  were safely acquired.

These production items are reported findings, not additional observations from the frozen
authority trial. This task has not independently certified their fixes or deployment.

The production task subsequently supplied an executed synthetic reproduction receipt:
same-title Jane Smith versus John Smith is scored high confidence; a year-only 2031 date
becomes January 1; merging a 1990 year with another source's 2031-06-15 becomes 1990-06-15;
and CSV `Number of Pages` is dropped. These strengthen the correction order: identity and
work/edition admission first, coherent date precision next, then additional metadata plumbing.
Its source-to-screen audit also covers invalid calendar dates, outage/negative-cache semantics,
coverless search and incomplete contributor handoffs. That task owns the detailed audit,
reproduction artifacts and code verification; this receipt does not duplicate them or claim
that the defects have already been fixed in production.

The authoritative production audit and reproduction receipts are in
[PR #545](https://github.com/Reverie-Reads/reverie-reads/pull/545). An additional offline
actual-Edge-handler probe, with all HTTP intercepted, confirmed that an unrelated
title/author/ISBN from a first provider hit can survive as high-confidence enrichment.
It also reproduced HTTP-200 GraphQL errors returning an empty provider result without a
failed-source indication. These are production-path admission and outage findings, not
live provider acquisitions or measurements from the authority trial.

## Delivery order

1. Preserve and publish the aggregate trial receipt; keep case identities/evidence private.
2. Production task fixes admission, field semantics and display plumbing with focused
   regressions; authority task owns a separate bounded offline policy patch. Avoid broad
   source rewrites and do not use the consumed frame for another live evaluation.
3. Exchange exact patch scopes and verification evidence before private sync or merge.
4. After the relevant releases, perform one coordinated bounded reader-flow verification.
   Automatic correction remains behind the existing qualification and source-use gates.

The trial's API estimate was approximately $0.89 for 25 cases. The expensive remaining
problem is trustworthy interpretation and review, not evidence-search token cost. No live
rerun or additional model/provider is authorized by this coordination record.
