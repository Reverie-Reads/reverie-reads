# Catalog quality inventory and invalid-date detection

The owner requested a full read-only shared-data audit, followed by invalid-publication detection.
`docs/queries/catalog-quality-audit.sql` inspects every shared work and active canonical series/slot
in one repeatable-read, read-only transaction, with a 30-second statement timeout. It returns a
reconciled work count, snapshot digest, per-concern counts and case-level work/slot inventories.
It reads Storage object metadata for cover durability, but no image bytes or external providers.
No personal rows or administrator notes enter the result. Save output under ignored private
verification storage, never in this public repository. The documented CLI invocation was executed
against the linked owner project; a fresh worktree may not have a project link.

The inventory separates deterministic invalid values, potential identity/graph inconsistencies,
missing fields, and insufficient edition evidence. A checksum-valid ISBN, populated field, matching
display author, or `curated` marker is not factual certification. No finding authorizes a merge,
identity reassignment, broad enrichment, provider acquisition or historical repair. External
confirmation, artwork/rights verification and protected personal-copy checks remain separate.
Unknown series length and date precision must stay unknown rather than being fabricated.

## Invalid-publication concern

Migration `20261015010000_catalog_invalid_publication.sql` extends the existing metadata record
builder and bounded queue. It reuses `publication_tuple_is_valid`, admits the `invalid_publication`
filter, and prioritizes it after identity/ISBN concerns and before missing descriptions. The UI
uses the existing concern registry, so the filter, list and opened record agree.

All-null publication is unknown, not invalid; a valid year or year/month remains valid. Leap years,
centuries, range errors and disconnected components are checked. The read model returns the stored
tuple unchanged, never a normalized replacement. A date error extends the existing assessment
fingerprint with its exact tuple, reopening only affected legacy assessments and rejecting stale
decisions after a bad tuple changes. Valid/unknown dates retain the old assessment fingerprint.
The separate edition fingerprint continues to guard **all** date changes for actual corrections;
a general assessment is not edition certification.

The migration uses checked exact-definition patches and fails on source drift. It changes no table
rows, grants, write RPCs, personal defaults or provider/cache logic. The owner deploys it before
the web build; an older server cannot accept the new concern filter. Correct dates only through
the existing explicit reference-edition preview/approval workflow after source confirmation.

Coverage includes actual record-builder invalid/valid/unknown cases, old assessment compatibility,
stale invalid-date decisions, bounded filtering, read-only behavior and administrator authorization.
The browser journey finds the invalid-only concern, opens it, refuses an impossible proposed date,
corrects with an explicit fixture reference, reloads, clears the concern and verifies personal
copies are unchanged. Production remains read-only.
