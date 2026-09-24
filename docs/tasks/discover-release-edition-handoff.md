# Discover release edition handoff

A selected release now enters Add as a bounded edition draft. The release snapshot keeps the title,
complete author list, checksum-valid ISBN when available, exact publication precision, one supported
format, publisher and an allowlisted release page. Ordinary Hardcover work search still clears its
cross-edition ISBN arrays and work publication date. A source link is a private reference, not
catalog verification or permission to publish provider claims.

Both release cards and detail previews use the same mapper. The snapshot must agree with the outer
Add title, authors, ISBN and date; invalid or mismatched snapshots cannot relax the work-search guard.
Unknown, unsupported or competing formats remain unknown. Changing the title, full contributors or
known format detaches the source/ISBN/publisher and untouched inherited date/pages; explicitly edited
values remain reader input. The Add screen explains this before save.

Opening Add, reloading, leaving, or opening a preview performs no save. The reader's explicit Add
creates one personal book and its one edition/copy document in the same insert. Wishlist remains
unowned and unread; edition format is retained in inventory without implying possession. Stable
edition/copy IDs and the existing single-Add insertion identity survive retries. A duplicate match
requires review rather than silently folding away the incoming inventory. The reader can review the
selected release alongside the existing book's editions and copies, save it there, open the existing
book without changing it, or explicitly keep a separate book entry. The existing-book path reuses
the revision-checked copy editor: configured inventories are cloned; legacy possession becomes the
same explicit setup draft; and an unidentified legacy wanted copy may be identified by the selected
release instead of fabricating a second copy. Nothing changes until the reader saves, and the path
never merges books or reading histories. A release preview keeps the ordinary “Open your book”
action and adds an explicit “Add this edition” handoff when that work is already in the library.

The bounded return link preserves the release window and edition filter. Ordinary shortlist and
reading-walkthrough return behavior stays intact.

## Deployment

Owner migration `20261027010000_release_copy_source.sql` before web. It adds optional release-link
validation to the existing inventory validator, with unchanged RLS, ACLs, mutation RPC, revision
semantics and projection. It changes no stored records. No Edge Function deployment is required.
The private app must keep its existing edition comparison alongside inventory controls.

Backup v11 retains optional edition source URLs. v10 and older inventories remain valid. Newer
backups are clearly versioned because previous strict validators reject the extra field. Copy
source links are included in export/restore and remain absent from shared household metadata.

## Verification

- Unit boundaries: release versus work search; complete identity and ISBN/date matching; unsupported
  formats; unsafe/lookalike/provider-mismatched links; impossible dates; malformed inventory rejection.
- Intake: new copy saved with the book in one insert; duplicate reviews never discard inventory.
- Existing-book handoff: review before save; preserve legacy possession and reading state; reuse an
  exact ISBN edition without overwriting reader-entered details; reject stale inventory revisions.
- Backup round-trip includes source URLs; database accepts legitimate links and refuses lookalikes.
- Browser: desktop and phone Discover → preview → Add → reload without save → explicit wishlist save
  → reopen inventory; exact ISBN/date/source/full authors retained, unknown format remains unknown,
  no ownership/reading fabricated, and return keeps the upcoming window/filter.
- Complete fresh-database, default-worker, zero-retry browser run, database suite and repository gate.
