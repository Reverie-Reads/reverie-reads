# Cited shared-series order corrections

Follow-up to the [book-data walkthrough](book-data-review-walkthrough-2026-09-09.md).
Base: public main `0db010d` (PR #523). Branch: `codex/series-order-citation`.

## Delivered scope

The existing administrator shared-series slot editor records an HTTPS source page and a short
explanation for an existing slot's changed or cleared position. The reviewer explicitly confirms
checking the exact work and order. Editing the unbound title/author, proposed position or citation
resets that confirmation.
Label-only changes need no new citation; an unchanged position can also receive a fresh cited review.

The new `review_corpus_series_entry_order` RPC checks administrator authority and current series
revision, locks the selected work/entry, and commits the correction and audit together. It preserves
membership provenance separately from the manual position claim. Primary linked slots update the
work projection through existing default-only propagation; a cited same-value confirmation also
repairs missing eligible defaults and structured membership. Secondary and unbound slots do not
rewrite it. Reader/import choices remain protected. Unbound title/author editing and new-slot
creation remain available; a linked work's identity cannot be changed through this order writer.

The explanation lives in the existing administrator-only `corpus_series_edits` audit. It is not
placed in shared claims or persisted to the offline library cache. The editor shows the last cited
review's position beside the current position, since a later catalog operation is not retroactively
verified by an earlier citation. Saved text is rendered as text, not HTML. URLs must be HTTPS and
exclude credentials, query parameters and fragments; saving never fetches or qualifies the source.

This is not model training or additional automated classification. It closes the human correction
provenance gap found in the walkthrough. Existing source-selection and evidence policies are unchanged.

## Verification

- Final typecheck, lint, production build and all 3,639 unit/workflow tests passed.
- Focused UI/data tests cover correction confirmation, source validation, null position, label-only
  saves, safe historical review rendering, existing/new RPC routing, failed-save refusal, and offline
  exclusion.
- Real local browser: synthetic work changed from position 1 to 5; source and explanation survived
  a page reload and reopening the editor. No external source was fetched.
- At 390 x 844, the populated order form passed axe WCAG A/AA checks with no horizontal overflow
  in all nine skins, both modes, with the historical review both collapsed and expanded.
- The initial 1,554 database assertions across 50 pgTAP files passed, including 29 new order-review
  assertions. The first database run identified the conflict-code inventory's
  old exact counts; updated from 23 functions/29 paths to 24/31 for the new RPC's two explicit
  stale-state refusals, then verified the full database suite.
- Self-review then identified the unchanged-value reconciliation boundary. Added five assertions;
  the two repair assertions failed against the old local RPC, proving the regression guard detects
  a tuple-equality no-op. Extended the new RPC to run existing default propagation on cited
  re-confirmation, not on label-only edits. Preliminary browser runs were interrupted for this
  correction and the unbound-identity confirmation reset; neither is counted as a completed run.
- Final fresh-database pgTAP: all 1,559 assertions passed, including 34 order-review assertions.
- Complete default-worker E2E with retries 0: **272 passed, 10 expected skips, no failures** in
  26.3 minutes against the final frozen implementation and another fresh database. The shared
  stack lock was released after completion. An interrupted preliminary run left its
  own Vite process on port 4317; the next launch refused before executing any tests. Verified and
  stopped only that orphaned process, then launched against the same unused fresh database.

## Release boundary

Migration: `supabase/migrations/20261001010000_series_order_review.sql`.
It adds an RPC and changes the app's explicit administrator write path; no backfill or new table.
Production migration execution remains owner-run through the repository deploy guard. The frontend
requires this RPC for existing-slot saves; if it is absent, the save fails visibly and does not fall
back to the old uncited writer. Coordinate the migration and app rollout.

No production read/write, deployment, paid provider/model call, qualification run or billing change
was performed. The Pro edition-comparison implementation remains with the other thread.
