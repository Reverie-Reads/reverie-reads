# Series editing and household search

Owner request: make series edits available directly from Library, retain fetched series entries,
suggest existing series names in Add/Edit, and give Household Library comparable search controls.

## Implemented contract

- Library details opens a compact series section in the existing book editor. Full book details
  expands the same mounted draft. An unrelated legacy publication value cannot block a series edit.
- Add and Edit suggest the reader's existing series. A unique case-insensitive name resolves to
  that series; ambiguous case variants require review rather than creating another duplicate.
- A deliberate personal membership edit may attach the exact title/full-author book to its existing,
  unlinked numbered placeholder. It never takes a different title, author, or removed slot.
- Changing the main series retains the former membership as secondary. Clearing the series removes
  the current primary membership. The confirmation describes this distinction.
- Provider refreshes reread stored entries before applying changes. Failed inserts and refresh
  timestamps surface as failures. Retrying uses persisted state, and an unavailable source does not
  mark the series refreshed. Provider relationship/evidence and tombstone guards remain in place.
- Household search covers shared title, author, series, genres, tags/tropes and ISBN. Filters cover
  member, confirmed copy format, possession, genre/subgenre and series status/length. Copy filters
  must describe the same member. Sorting covers title, author, series and recently added.
- Personal notes, moods, ratings and reading progress never enter household search. Household-only
  works do not acquire an implied personal copy. Hidden-match recovery preserves the search query.

## Rollout

Migration: `20261104010000_personal_series_edit_reliability.sql`. This changes a personal-write
function and requires the existing human-confirmed guarded migration deployment. No production
migration is performed by this change. Deploy the public feature through the private overlay before
production. Local validation is recorded in the PR; local browser checks do not prove physical iOS
or deployed account behavior.
