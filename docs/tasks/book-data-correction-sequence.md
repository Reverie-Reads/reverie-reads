# Book-data correction sequence

Owner approved September 12, 2026. Builds on the source-to-screen audit in `docs/audits/book-data-ingestion-2026-09-12.md`.

## 1. Reliable shelf additions

Implemented in the preceding shelf patch; full release verification is recorded in its PR. A failed shelf write after successful book intake must remain visible. Retry only the membership, preserving the book and any later edits. A successful write whose response was lost must not duplicate or reorder the membership. Cover both Discover and the shelf picker with real local persistence and injected failure responses.

## 2. Source identity and edition scope

Implemented in this source-admission patch; release verification remains required. Admit every fetched source independently against the requested identity. Exact selected editions own page counts, language, binding and publication dates; work search medians and arbitrary ISBN-array entries do not. Preserve full contributor checks, source-declared subtitles and competing-match uncertainty. Update the cache namespace and every promotion reader together. Keep weak personal duplicate matches in review without changing persisted verdict keys. No broad completion sweep before these safeguards pass.

## 3. Saved metadata continuity

Implemented in the metadata-continuity patch; release verification remains required. Carry valid supported values through search, Add, CSV, fill-only merges, saving and reopening. Preserve existing reader values and prevent one edition from donating pages/dates to another ISBN. Publication dates retain their original precision and never combine incompatible source tuples.

## 4. Targeted existing-data review

Read-only review completed; see `targeted-catalog-data-review.md` and the private handoff. Prepare a bounded review of records supported by existing provenance and the existing administrator review controls. Missing or mixed provenance is uncertainty, not permission for a blanket correction. Identify concrete records and suggested changes for owner review; historical repair is separate from migration. No production write is part of the automatic verification flow.

## Delivery

Separate reviewable patches in this order, preserving public/private upstream sync. Each runtime patch gets the required code gates, fresh local database and full one-worker, zero-retry browser run. Keep failed results visible. Function deployment, migrations and any historical production repair remain explicit owner handoffs; do not infer deployment from merge.
