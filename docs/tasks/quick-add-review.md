# Quick Add and import review

Owner direction, October 8: entering a book needs a clear review and confirmation. Start with
core information, open the saved book to complete it, and keep large imports manageable.

## Reader journey

1. Search, scan or enter a title. Quick Add shows identity, optional ISBN/format and possession.
   It does not assume a paperback, a genre from the room, or reading history. Extra metadata and
   reading fields remain available behind disclosures, using the shared editor controls.
2. Review the exact submission and destination. Missing information is named, not guessed.
   Back to information preserves the draft. Confirm and add is the first write action.
3. A duplicate is a separate deliberate decision, including exact matches when import auto-merge
   is enabled. Existing copy-inventory and release handoff protections still apply.
4. A confirmed save shows the loaded record and Open your book as the primary action. Notes,
   copies, cover choices and further editing live on that book. Contextual and scanned/list
   continuation remain available. Read failures never become another insert.

## Many books

- **Barcode capture:** retains the existing account-separated page-session queue. A selected
  candidate now goes through Quick Add and confirmation before scan continuation consumes it.
- **Pasted titles/ISBNs:** up to 200 entries per list, paged ten at a time. Lookup writes nothing
  and never chooses the first result. Every entry retains its candidate choices, failure or
  successful empty state. Review uses the same Add flow; confirmed results link to their real
  books. This is deliberate per-book review, not one-click bulk acceptance. Repeated input lines
  do not imply physical copies. The lifetime notice remains explicit.
- **CSV/XLSX:** select the file, inspect counts and possible duplicates, filter missing/duplicate
  entries, expand any mapped book, then explicitly confirm the complete file. The preview uses
  the existing profile-specific parsers and freezes destination/merge policy. Unknown fields
  are not invented. Cancel permits corrections in the spreadsheet. Existing duplicate review
  and per-book import results follow. Import is still multi-step: an interrupted write can be
  partial and is not advertised as atomic or safely repeatable without review.

No schema, billing, entitlement or production data changes are required.

## Validation

The full fresh-database browser run on October 8 used the default single worker and zero retries:
380 passed, 10 skipped, 2 failed. The complete room accessibility sweep and Add/recovery, release,
household, import and phone layout checks passed. The failures were:

- The new pasted-list test expected an empty-string database format. The existing mapper stores
  an unknown format as null; the saved data and list continuation were correct. The assertion was
  corrected to the database contract and is included in the final focused follow-up.
- The desktop reading walkthrough did not advance after demonstrating Done on the finishing
  sheet. Its trace shows the sheet expanding as coaching and mood choices appear; Done changes
  position, so the existing moved-target safeguard cancels the automatic click. The phone
  counterpart passed. This remains a separate layout-stability finding, not a proven baseline
  flake; no safety guard was removed, sleep added, or unchanged test rerun to obtain a pass.

The full-run source stayed unchanged during execution. The final follow-up changes only the
import's busy/error wording and assertions for explicit duplicate review, unknown format, a
phone bulk queue, and blocked controls during an in-flight import. Those focused checks passed
8/8 on a fresh database. Afterward, the duplicate test's database reads were moved to the standard
checked-result helper for lint; assertions and application code were unchanged. Final typecheck,
lint, all unit suites (127 recovery checks, 498 source-trial tests, 3,064 core tests, 1,251 web tests
and 2 workflow tests), and build passed. The PR remains draft while the full-suite finding is open.

Review screenshots were inspected at 320, 390 and 1440 px, including a long unbroken title. Physical
iPhone acceptance remains separate from simulated viewport checks. The next bulk improvement
would be editable, selectable spreadsheet rows and durable cross-device drafts; neither is
claimed here. No production data was changed; the shared local stack is restored to its standard
private schema and 290-book seed after each browser run.

## Information visibility refinement

The October 11 refinement restores the cover-led section layout and Book / Genres / Edition /
Series / Reading / Copies navigation from the shared editor before Quick Add (`16bffc9^`,
public merge `5cd63b7`). Quick entry remains the default. An always-visible overview names genre,
pages/publication and series information, displaying the current draft or an explicit missing
value. “Show all book information” opens the optional metadata and reading controls. Section
navigation also opens the relevant fields before focusing the heading.

Folding the controls away keeps them mounted and preserves their values, including after a
Bearded Mode change. Validation reopens an invalid field before focusing it. Review still freezes
the same payload and destination; confirmation, duplicates, retry identity and saved-book handoff
are unchanged. No data-layer or schema changes are involved.

Initial refinement validation: the 29-test focused browser run passed 28 checks, including desktop
and touch walkthroughs, save recovery, duplicates and release-edition handoffs. The new Bearded
Mode test exposed a real focus race: the focus call ran before the expanded field was visible.
Returning to the Add tab did not fix it, and CI reproduced the failure. Validation now waits for
the expanded fields' DOM commit before focusing the error; the original failure traces are retained
locally. The follow-up also caught delayed section focus intercepting the rating's first keyboard
input at 320 px. Section navigation now focuses in the same committed render, before subsequent
input. Screenshot review corrected the overview to use the room's card-radius token instead of
the pill-shaped control token. Full final validation is recorded in
the feature PR.

## Immediate entry and reviewed destination

Add begins with a stable compact destination control and an immediately usable search/scanner.
The signed-in, account-keyed provider starts membership/delegation lookup before Add opens; it
fetches no household books. Its separate query key does not weaken full-library authorization.
Offline transitions hide protected destination data immediately; focus/reconnect and household
mutations revalidate. Leaving Add no longer discards the startup check.

The default remains My library unless an explicit household entry supplies the destination.
No arriving response changes a selection. Review presents the full destination picker. A single
mounted book draft survives switches between personal, household and delegated destinations.
Shared review shows only the bibliographic fields its existing writers receive, and explains
that personal reading details are excluded. Every shared confirmation rechecks membership and
delegation; the server writers retain their authority checks. Failed attempts lock the reviewed
destination until the reader returns to information. There is no persistent permission cache,
new migration, or promise of zero network latency on first load.
