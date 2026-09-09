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
  last-loaded data with a visible notice. Planner keeps cached plans available when logs are
  missing/offline and displays unknown reading totals until the history arrives. Long record lists
  disclose additional rows in batches.

## Reflect

A saved reading note and the complete book jacket lead the page. Without a note, the opening
uses the book's title and recorded finish. With no history, it explains how to log a first or
past read. Metric, month, genre, format, undated, legacy, and current DNF controls reveal their
underlying records. Book controls navigate to the existing book detail and reading log.

The fuller yearbook also keeps an optional reader-set goal in context without treating it as a
score, renders each month's finished books as a readable rhythm, and adds evidence-bound author,
trope, and reader-assigned mood drilldowns. Taxonomy labels are deduplicated case-insensitively
within each read so aliases cannot inflate a count.

The page uses existing room materials, fonts, tokens, cover sourcing, native dialogs, and focus
return behavior. No new cover provider, atmosphere engine, analytics export, or public sharing
surface is added. Notes in the review harness are explicitly fictional; the app uses real notes.

## Plan

The second slice turns Planner into a flexible reading queue. `books.plan_position` is both
deliberate membership and preference order: a non-null position with an empty PartialDate means
“Soon,” while an empty date and null position remains unplanned. Existing dated plans receive
stable positions in their existing partial-date order. `books.plan_intention` is an optional
300-character private note to the reader's future self; it is never a review or reading-log note.

Queue reorder changes one spaced numeric key. Remove has a local Undo and clears only the five plan
fields. The full editor supports Soon, year, month, and exact day; the book screen can create Soon
or retain the existing three-field precision editor. Calendar dates and publication dates preserve
their real precision. Merge keeps a stored primary plan whole or adopts the loser's complete plan,
including Soon and intention. Raw book-row backup/restore and the existing IndexedDB book mirror
carry both new fields without a second store or reconciliation path.

This slice adds `20260929010000_reading_plan_queue.sql`. Its existing-plan backfill and merge RPC
replacement change stored data/write behavior, so production deployment remains an owner-operated
human confirmation after merge.

## Private retrospective

Reflect now offers a private story for the selected period. It is composed directly from the same
`summarizeReadingHistory` result that supplies the metrics and drilldowns: logged completions,
distinct books, qualified return counts, recorded months, current genre, author, trope, and
reader-assigned mood labels, and read-log formats. It shows a bounded set of complete, addressable
book jackets and, when one exists, an actual saved reading note. Empty periods do not offer a
retrospective, and an unknown earlier date keeps the return language explicitly uncertain.

The story uses the existing native modal and room tokens, returns focus when closed, lets a reader
open one of the shown books, and provides a direct turn into Plan. It creates no persisted document,
model output, public score, share card, image download, or derived analytics export.

## Release horizon

Public PR #482 implements source-aware release discovery in Plan. It preserves year/month/day
precision, records provider provenance, supports explicit manual release entry, and never turns a
release into a reading plan automatically. Hardcover supplies the primary followed-author horizon;
an optional Penguin Random House confirmation path and Google Books fallback remain isolated and
honestly labeled.

Public review/merge comes before private synchronization. The retrospective and release horizon
need only a web release; Plan's earlier queue work also needs the owner-operated migration before
its web artifact is promoted.
