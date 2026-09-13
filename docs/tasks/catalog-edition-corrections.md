# Manual catalog edition corrections

## Purpose

Correct a known shared page-count or publication-date error without invoking broad metadata
enrichment or replacing a reader's edition. Use the existing `/catalog/metadata` administrator
workspace. This adds no provider, vector store, autonomous model writer or paid entitlement.

Historical review found multi-ISBN records and conflicting edition observations. A work-level value
cannot certify all editions. Each correction therefore names one already-associated reference ISBN;
pages and dates have independent reference provenance. Selecting the reference remains a human
decision, not a highest-page-count or newest-date heuristic.

## Decision flow

1. Open the shared record and independently check its reference edition. Select its existing ISBN;
   enter the source's exact title and full recorded contributor names, HTTPS evidence link and a
   short explanation. Inconsistent author/contributor records, omitted coauthors and competing ISBN
   assignments require separate identity review. This action cannot resolve them.
2. Choose **pages only** or **publication date only**. Preview the before/after values. Whole-number
   pages must be 1–20,000. Dates accept year, year-month or an actual calendar day. Reduced precision
   deliberately replaces the complete date; it never retains an old day under a new month/year.
   Blank values do not clear a page count or the entire date.
3. Explicitly approve that preview and save once. Changing any input clears the preview and approval.
   Description edits and edition drafts cannot be submitted over one another.
4. Reload and inspect the persisted value, reference ISBN and private decision history. A failed,
   stale or uncertain response locks the attempted draft until explicit reload; neither the browser
   nor the mutation hook retries automatically. Inspect history before making another decision.

The server rechecks administrator authority, snapshot fingerprint, review revision, exact normalized
identity and canonical ISBN inside the write transaction. It shares the existing ISBN assignment
lock and locks the target work/review. It changes only the selected field and that field's provenance.
No provider request, personal-copy propagation, identity merge, series assertion or catalog sweep
runs. Confirming one field leaves the overall metadata assessment open.

## Data boundary

Migration `20261013010000_catalog_edition_corrections.sql` adds
`admin_correct_corpus_edition_details` and the private `edition_details` history action. Source URL,
canonical reference ISBN and observation time are retained in manual field provenance. Private
explanations are not copied into the general metadata edit audit. Review notes/history remain
administrator-only. Readers, anonymous clients and service-role RPC callers cannot use the action.

The snapshot's `editionCorrectionVersion: 1` makes a new client fail closed against an older server.
Pages, full date precision and provenance enter a separate `editionFingerprint`. The original
assessment fingerprint is unchanged: adding the capability does not reopen completed assessments
or erase history. An actual correction leaves that work's assessment open. There is no backfill or
approved historical repair in this migration.

An existing trigger listens to all metadata provenance updates, which could refresh the shared
series graph during an unrelated correction. The action reuses the existing transaction-local graph
preservation guard around its page/date update and restores the prior setting afterward. The
trigger subscriptions and ordinary series reconciliation remain unchanged; the correction cannot
refresh shared series entries or their audit. A failed update rolls back its transaction-local state.

## Verification and release

SQL tests cover permission boundaries/revocation, exact identity and coauthor omission, ISBN-10/13
equivalence and collisions, invalid values/URLs, stale versions, whole-date precision, private notes,
and full before/after personal rows. A populated shared graph is compared byte-for-byte, and a
same-state series confirmation must still repair a deliberately missing fixture entry.

Browser tests cover preview/explicit approval, refresh persistence, independent page/date actions,
double-click suppression, stale draft recovery, uncertain transport results and all nine skins in
both modes on a phone. Unit tests check the narrow payload, old-server refusal and no automatic retry.
Record the actual full repository, SQL and fresh-database/no-retry browser results in the PR; a
written checklist is not evidence that the hosted save path passed.

Land the public PR, synchronize through the private repository and rerun its release checks. The
owner applies the migration through the existing deployment guard before web promotion. No Edge
Function deployment or secret change is needed. The owner then confirms one proposed reference
edition and performs one correction/reload with protected personal copies verified separately.
Do not apply the historical shortlist as a batch, bypass unresolved contributor/edition conflicts,
or treat local fixture tests as authorization to write production.

Before the first live correction, reader prefill/copy/adoption paths must honor the new reference
ISBN: a corrected edition date/page count must not silently become another edition's default.
The editor/RPC tests establish no immediate personal writes, not that downstream inheritance is
edition-safe. That consuming-path guard is a separate release dependency; keep live repairs off
until it is verified and synchronized as well.
