# Series review preserves trust

## Defect

The discovery RPC correctly queues a conflicting proposal and sets the work's check state to
`review`. The shared-catalog trigger previously interpreted every `review` row as an already-trusted
tuple. For an unresolved legacy candidate, this created a high-confidence shared membership for
the old unverified label. The first evidence item could also supply a candidate **book** reference
as the shared **series** reference. For previously confirmed works, a new review could overwrite
the accepted graph's evidence with the conflicting proposal. Dismissal then marked any nonblank
label `found`, repeating the same promotion path for an unverified work.

## Narrow closure

`20261008010000_series_review_preserves_trust.sql` replaces the existing graph synchronizer and
suggestion-review RPC; it adds no schema or new public API.

- `review` returns the existing primary graph identity, or null, without changing entries, aliases,
  provider references, evidence, order, revisions or graph audit rows. It cannot revive a tombstone
  or promote a secondary slot. Proposals remain in the administrator suggestion queue.
- Dismissal retains `found` only when an active primary graph anchor already exists; otherwise it
  leaves the unchanged old label `unresolved`. The reviewer scopes a transaction-local
  `reverie.series_review_preserve_catalog` flag around this one update and restores its prior value,
  preventing rejected evidence from refreshing even an existing trusted graph. This flag grants no
  caller authorization; the existing administrator check, lock order and helper ACLs remain.
- Explicit acceptance still writes `found` through the existing RPC, publishes the accepted graph,
  and reconciles eligible personal defaults. Reader/import choices remain protected.
- When accepted provenance lacks a series reference, only one distinct reference from matching
  relational evidence may supply it. Candidate-label references and explicitly typed Hardcover book
  locators cannot become provider series identities. Ambiguous references remain unset.

The existing unavailable/no-label behavior, ordinary confirmed synchronization, catalog lifecycle,
and same-value personal-default repair paths remain intact. Dismissal is not a source-validation
action and does not certify the old label merely because it is nonblank.

## Verification

`supabase/tests/series_review_trust_test.sql` exercises the actual discovery/review RPCs and triggers
with synthetic fixtures. Whole-graph snapshots include entries, aliases, sources, claims, revisions
and audit rows. Personal snapshots include actual copies and structured memberships; the fixture
asserts those rows exist before comparison. Positive controls confirm that accepted changes really
publish and eligible defaults really follow them.

The complete 51-assertion regression file produced 14 failures on the old functions. With the fix,
it and the discovery/catalog/order suites passed all 270 assertions. The old discovery test's
“curated” fixture now obtains an actual confirmed relationship before exercising dismissal instead
of relying on its name as proof of trust. Full gate and fresh-database browser results are recorded
in the PR before readiness is claimed.

## Release boundaries

This is an owner-run migration because it changes write behavior. Merge publicly, sync through the
private overlay, and apply from clean, synchronized private main through the existing deploy guard.
Do not apply from the public checkout, whose migration history omits private migrations. No Edge
Function change or new credential is required for this fix.

The migration contains no historical-row rewrite, cleanup, backfill, or canary replay. Existing
possibly polluted graph data is not certified or silently deleted by this guard; any repair needs
a separate read-only inventory and owner-reviewed scope. After deployment verification, prepare a
fresh one-work save canary expecting review with no graph publication, not an automatic rename.
