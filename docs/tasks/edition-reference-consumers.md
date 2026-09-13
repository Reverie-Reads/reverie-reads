# Keep reviewed edition details with their ISBN

## Why this follows the manual correction action

A correction's `referenceIsbn` is useful only if later consumers respect it. Previously, `workToHit`
copied the shared date to whichever ISBN a reader selected. The shared-adoption and delegated-add
RPCs likewise copied scalar values without checking reference provenance. No immediate personal
write during a correction did not establish safe future inheritance.

The correction also records `referenceValue`: the exact reviewed page payload or complete date
tuple. A later edit through another existing writer cannot reuse a retained citation to certify a
changed value. A scoped reference lacking this snapshot is withheld, never reclassified as unscoped.

This change protects that specific boundary. It adds no provider, table, graph/vector store, paid
feature or automatic historical repair.

## Behavior

- Add and corpus discovery request the existing metadata provenance with their bounded work reads.
  If any present date component is reference-bound, every present component must name the selected
  checksum-valid ISBN. ISBN-10/13 equivalents agree. A conflicting, missing or invalid reference
  blocks the whole date rather than mixing components. Other displayed metadata stays available.
  Every scoped component must also match the current whole date against its reviewed value.
- Guided discovery clears a multi-ISBN work's locator before mapping, so it cannot retain one
  edition's reviewed date after dropping that edition's ISBN.
- “Use shared details” keeps the reader's existing date when the shared reference does not match
  their ISBN. It does not change their ISBN or pages; the existing deliberate series/cover/genre
  behavior remains intact.
- A consented delegated household addition independently copies only compatible pages and dates.
  It retains the existing selected ISBN and neutral ownership/reading flags. Missing compatibility
  leaves a new field unknown, without extra lookups, inferred format or possession.
- Unscoped historical values retain their existing behavior. This guard does not retrospectively
  certify those observations or erase existing personal data.

## Implementation and checks

The client guard is in the existing `workToHit` mapper; all three work-read paths supply provenance.
Migration `20261014010000_edition_reference_consumers.sql` binds new correction provenance to the
reviewed value, adds one internal pure SQL helper and
patches only the current copy expressions in `adopt_corpus_work_metadata` and
`add_corpus_work_to_member_library`. Exact expression-count checks fail migration on definition
drift. Existing permission, household consent, row locks, series and cover behavior are retained.
The helper has no browser/service-role execution grant and performs no data write.

Unit tests cover different, unknown, equivalent, invalid and component-conflicting references, and
guided discovery without an edition. Browser tests exercise Add through saved-row read-back and
refresh for both matching and mismatched references. SQL tests cover both real RPCs, protected
personal dates/pages/ISBNs, independent page/date eligibility, unchanged shared evidence and existing
permission/consent boundaries. Run the full repository and fresh-database/no-retry browser gates
before reporting completion; retain any first failure and diagnose it rather than hiding retries.

## Release

This is stacked after the manual edition correction PR and closes its consumer release dependency.
Synchronize both through the private overlay; the owner applies the two migrations in order before
promoting the updated web app. Refresh the client before the first owner-run correction. No Edge
Function, secret, billing or provider change is needed. Keep the real Add/save smoke receipt and
the explicit historical reference-edition decisions separate; test fixtures approve neither.
