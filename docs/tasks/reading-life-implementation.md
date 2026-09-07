# Reading life implementation

September 7, 2026. The approved study is being implemented in slices. The first slice replaces
Stats with Reflect and connects Planner's completion counts/calendar entries to the same model.
The route remains `/stats`; saved navigation arrangements retain their existing identifiers.

## Record contract

`packages/core/src/readingHistory.ts` receives personal books and persisted read logs separately.
It never writes or reconciles data on page load. Duplicate transport rows and rows whose books
are outside the supplied personal library are excluded. Base `Book.reads` is intentionally not
used: the normal books query does not hydrate it.

- Logged reads are the existing finish/past-read records. Current Reading, wishlist, possession,
  and plans cannot create a completion.
- Books marked Read without logs remain visible as a separate list. Planner's all-time book count
  includes these and books with actual logs, with each book counted once.
- DNF is the book's current state. Earlier finished reads remain in history. There is no dated
  stopped-attempt field; Reflect does not manufacture an annual DNF count.
- Current persistence supports an exact finish date or null. The pure model can represent year
  and month precision for a future adapter, but this release adds no partial-finish-date storage
  or input control. Invalid dates are treated as unknown, not rolled into another month.
- Dates are parsed as calendar components, never UTC instants. Undated completions count in
  all-time summaries and remain accessible separately from a selected year.
- Return counts are repetitions in the recorded history. A dated earlier year establishes that
  every later log is a return; otherwise the first recorded session is not counted as a return.
  Unknown dates can make a selected year's count a lower bound, labeled “at least.” The return
  drilldown shows the full history of repeated books, explicitly including other periods.
- One selected period governs finishes, distinct books, months, genres, formats, and the record.
  Genre counts use current book metadata, once per genre per read, and may overlap. Formats use
  read-log values; missing values stay “Not recorded.” No rating averages are calculated.
- The query boundary waits for both sources. Initial errors have a retry; failed refreshes retain
  last-loaded data with a visible notice. Long record lists disclose additional rows in batches.

## Reflect

A saved reading note and the complete book jacket lead the page. Without a note, the opening
uses the book's title and recorded finish. With no history, it explains how to log a first or
past read. Metric, month, genre, format, undated, legacy, and current DNF controls reveal their
underlying records. Book controls navigate to the existing book detail and reading log.

The page uses existing room materials, fonts, tokens, cover sourcing, native dialogs, and focus
return behavior. No new cover provider, atmosphere engine, analytics export, or public sharing
surface is added. Notes in the review harness are explicitly fictional; the app uses real notes.

## Next slices

1. **Plan queue and direct editing.** Preserve PartialDate and existing calendar entries. Design
   storage for an undated “Soon” entry, ordering, and optional intention; null date currently means
   no plan and must not silently become queue membership. Include backup/restore and offline rules.
2. **Private retrospective.** Compose the same summary into a private period story. No derived
   analytics export or share card.
3. **Release horizon.** Integrate followed-author sources and honest publication precision into
   Plan; do not convert unknown months/days into January 1 or create plans automatically.

No migration or Edge Function deployment is needed for this first slice. Public review/merge
comes before private synchronization and a separate web release.
