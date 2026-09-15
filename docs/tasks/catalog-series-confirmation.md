# Manual shared-series confirmation

## Purpose

Close the narrow gap between an administrator's independently checked source and Reverie's existing
shared-series reconciliation. The `/catalog/metadata` workspace can record a source-backed
confirmation of the exact series name, position and count already on a work. It does not search a
provider, import an audit report, infer a series, or edit the tuple.

This action is useful when a trusted tuple is already present but older personal catalog defaults or
the structured shared graph did not receive the confirmation event. It is not a replacement for the
series suggestion workflow: a pending suggestion must be resolved first, and a missing or incorrect
tuple must use the existing review/correction path.

## Decision flow

1. Open the shared work in the administrator metadata workspace and verify its exact title, full
   author identity, named series, and displayed order on an independent first-party or otherwise
   acceptable source.
2. Enter the HTTPS source URL and explain what on that source establishes the relationship. Preview
   the unchanged tuple and explicitly approve it.
3. Save once. Changing evidence clears the preview and approval. A stale work, graph, review
   revision, pending suggestion, or uncertain result requires reload and inspection before another
   attempt.
4. Inspect the private review history and the shared relationship. Verify protected personal copies
   separately when using the action in production.

## Boundaries

The RPC accepts the current tuple from the frozen record and rejects any mismatch; it cannot change
name, position, or count. It records manual relational evidence, reviewer, observation time and
source URL on the work and in private metadata history. The normal graph-sync trigger refreshes the
shared primary membership. The existing classifier transaction flag deliberately replays the
default projection for personal rows whose claim origin remains unknown, enrichment, or corpus.
Reader-selected and CSV-imported series choices remain authoritative.

The action has no provider client, model call, source fetch, bulk mode, service-role grant, or direct
writer to personal books or series entries. It preserves the metadata assessment state and note,
increments only the shared review revision, and uses a separate series fingerprint so introducing
the capability does not reopen prior metadata assessments.

## Release

Migration `20261018010000_catalog_series_confirmation.sql` is owner-run after public and private
repository synchronization. No Edge Function or secret change is needed. After deployment, perform
one administrator confirmation, reload the record, inspect the event/source, and verify the shared
graph plus an eligible automatic personal default and a protected reader-selected personal choice.
Do not batch the audit handoff through this control.
