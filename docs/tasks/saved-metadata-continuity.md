# Saved metadata continuity

Third in the owner-approved September 12 book-data correction sequence, following source admission.

## Reader behavior

- Discover saves exact selected-edition pages and publication dates, retaining the selected title,
  ISBN and every contributor. A provider cannot substitute its title or an unrelated edition.
- Hardcover work-search ISBN arrays no longer select a copy. Its search year and series label remain
  display observations, not selected-edition publication or series-membership facts.
- Add exposes an optional Pages field, fills supported pages/date through Fetch details, and keeps
  reader edits. Changing the identity during a lookup invalidates that response. The Discover
  details-to-Add handoff carries all contributors.
- Goodreads/StoryGraph and mapped imports carry positive whole page counts. Edition-year columns
  no longer fall back to the original work year. Invalid dates and page strings remain unknown.
- Fill-only personal merges preserve current pages and the whole publication tuple. A selected ISBN
  cannot borrow blank pages/dates from a different, invalid or absent ISBN; ISBN-10 equivalents work.
  The duplicate picker obeys the same gate. Shared future fills and explicit duplicate selections
  also carry a valid date tuple together, preserving source precision and applied provenance.
- Search membership is a compact checkmark and sentence-case **In your library** label. It links
  to the book without suggesting a particular shelf save succeeded. The original large outlined
  pill is removed, using each room's existing text and focus tokens.

## Rollout and limits

Requires the source-admission patch and owner deployment of `enrich` first. An old/unqualified
function response remains a visible failed lookup rather than silently supplying edition facts.
The `search` function changes its cache namespace to `search:v3:` and needs owner deployment.
Private upstream sync includes migration `20261012010000_publication_tuple_fills.sql`; it modifies
future operations only and preserves current function authorization and later series/cover guards.
No historical record is changed by migration, verification or a broad sweep. Publication records
without a selected edition are not certified by this patch. Publisher/language remain edition
observations on existing detail surfaces; this does not add unsupported personal schema fields.

The unused legacy `importCsv` core helper is not the app's intake path; the shipped importer uses
`parseCsvRows` or the selected column profile and the shared intake engine.

## Verification

Run core edition-gate/CSV/date and client response-boundary tests; verify actual Discover and Add
saves, reader edits, all contributors and reopening against local persistence. SQL tests exercise
whole-tuple completion and provenance. Verify the library-status presentation in the retry
screenshots and retain the full fresh-database, one-worker, zero-retry browser receipt. Check both
normal and reduced-motion appearances through the ordinary room accessibility coverage.
