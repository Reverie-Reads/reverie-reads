# Personal editions and copies

A personal book keeps one reading history, progress, rating and planning entry. Its optional
`copy_inventory` version-1 document records reader-owned edition and copy IDs. An edition stores
format/binding, a reader label, optional ISBN, publisher, publication precision, pages and cover.
Each individual copy refers to one edition and records its own owned/borrowed/wishlist/unset state,
label and private location. Two identical hardbacks are two copy IDs, not two books or two reads.

## First release

- Book details offers **Set up editions & copies**; detailed inventories replace the broad format
  control in both details and Edit. **Manage copies**, **Add another edition**, and **Add another
  copy** edit one explicit save draft. Closing a changed draft asks before discarding it.
- Null means legacy/not set up; an empty document means deliberately no recorded copies. Migration
  creates no inventory and changes no existing quantities or edition metadata. Setup drafts one
  entry per currently recorded format for the reader to review. Co-occurring borrowed/wanted flags
  get unidentified draft entries. An ISBN is carried into a draft only for a single recorded format.
- Private metadata is kept on the personal book, not promoted to shared catalog evidence. Existing
  household rules see only the aggregate possession projection; copy labels/locations are private.
- The inventory is an atomic bounded document (100 editions, 500 copies), alongside the book so its
  existing owner RLS, offline mirror, Realtime signal and account-deletion cascade apply. This is a
  personal inventory, not a second shared edition catalog. A later normalized catalog may reference
  these stable personal edition IDs without changing which copies the reader recorded.
- `save_copy_inventory` row-locks the active owner book and compares the inventory revision. Failed
  saves keep the draft. Identical retries are read-only; a stale different draft cannot overwrite
  a newer collection. Legacy possession/edition changes also invalidate an open setup draft.
- A trigger validates every inventory write and projects possession/format aggregates before the
  existing household triggers run. Legacy possession writes are refused for configured books;
  Add/import metadata folds preserve their existing inventory-derived flags. Reading edits work
  independently. Ordinary book metadata and its selected cover remain separate from edition cards.
- Backup v10 carries inventories in book rows and validates them before any restore writes. Restore
  attaches inventories after historical annotations, preserving the existing household-consent
  boundary. Source revisions are not replayed. Older backups remain supported.
- Duplicate merging refuses either book with a configured inventory before any destructive merge
  effects. It does not guess whether two imported copy IDs describe one object. Existing intentional
  duplicate book entries are not automatically combined. Readers can keep both.

## Rollout

Migration `20261026010000_library_copy_inventory.sql` was reserved against combined public/private
history after `20261025010000`. Apply through the owner migration workflow before deploying web.
No new provider, Edge Function, subscription or Pro entitlement is needed. Private integration must
retain its existing edition comparison and book-detail insertions; comparison is not inventory setup.

## Verification / owner smoke

1. Start with one owned paperback and existing progress, notes and reads. Set up copies, add two
   owned hardbacks of one special edition, a borrowed audio edition and a wanted edition. Save,
   reload and verify every copy and the unchanged reading record.
2. Confirm Available to read and derived format shelves use possession correctly; wanted-only
   copies must not imply possession. Record zero copies without removing the book/history.
3. Open two editors: save one, then try the older draft. Confirm conflict and draft retention.
4. Export and restore into a test account; verify editions, IDs, labels, locations and history.
   Older backups still restore. Household readers must not see private copy locations.
5. Check desktop/phone, keyboard focus and all rooms/modes. Remove-copy changes take effect only
   on Save; Cancel protects a changed draft.

## Later extensions

Provider edition lookup and cover upload per edition; deliberate reconciliation of existing
separate book records; optional linking of a reading session to an edition; household opt-in copy
sharing. These are not implied by this release, and none may fabricate copies or rewrite history.
