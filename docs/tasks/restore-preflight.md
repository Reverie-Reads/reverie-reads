# Restore preflight

September 8, 2026. The JSON backup restore now stops after file selection and asks the reader to
review the operation before any account request or write.

## Reader contract

- A restore is additive. Every book in the backup becomes a new personal book. Existing books stay
  in place, and matching books are not merged during restore.
- The preview waits until the current library has loaded, then shows the current number of books,
  the number of active books in the backup, and the projected visible total. Removed records carried
  for backup continuity are disclosed separately and stay outside the visible library. This makes
  the duplicate risk concrete for a non-empty library.
- The detail grid is computed from the payload itself: books, reading records, saved notes, shelves,
  placements, saved Discover shortlists, structured series memberships, tags and moods, reviews,
  author choices, plans, and favorites.
- A current backup must match its completeness record before the preview opens. A damaged file is
  refused locally. A backup from before completeness records remains restorable with a plain warning
  that its original download cannot be verified.
- A backup with a newer format version or a declared section this build does not understand is held.
  Restoring only the familiar sections would make a newer backup appear successful while silently
  dropping data.
- If the file carries profile data, the preview states that its reader name, room, appearance,
  reading goal, bookstore, and arrangement will replace the account's corresponding preferences.
- Cancel closes the preview without changing the account. The retained file text is validated again
  when the reader confirms, before authentication lookup and before the first write.

## Verification boundary

`inspectBackup` is synchronous and local: it performs no authentication lookup, Supabase query,
mutation, or cache write. The component test proves selection is preview-only and that a newer
unknown section blocks confirmation. The browser flow exports a current backup, previews it against
a non-empty library, checks the database after Cancel, then confirms and observes the projected
additive book count.

This change adds no table, migration, function, provider, or production deployment step.
