# Keep both save-recovery verification

## Cause

The full browser run on the editor-credit branch ended with 435 passed, 11 skipped and one
failed test: `Keep both cannot insert a third copy after the duplicate preference fails`.
Its five-second alert assertion started immediately after choosing Keep both. The retained
trace shows a 4,712 ms library read and a subsequent 1,462 ms authentication check, followed
by a successful book insertion. The contributor request was still unfinished when the test
ended. The injected duplicate-preference failure had not been reached.

This failure did not demonstrate a third insertion or broken recovery: neither the retry nor
its row-count assertion ran. Inspection confirms the existing flow inserts the new book and
contributors before saving the duplicate preference. `useAddSave` retains one insertion UUID
and, on retry, reads that exact reader-owned UUID before authorizing any further write. A found
row leads to review without replaying contributors or the duplicate preference.

## Repair

The browser regression now observes the duplicate-preference POST, holds its response while
checking the saving state, then returns the intended 503. Only after that response does it
assert the error message. Recovery also waits for the exact reader-owned lookup response
before asserting the link to that saved book. Assertion and suite timeouts are unchanged.
The fixture no longer reloads the entire app after seeding the existing book: Add confirmation
already refreshes the library and `useIntake` reads that refreshed query cache.

The first focused attempt after synchronization changed still failed (nine passed, one timeout).
Its trace shows a real local authentication 504 before the verdict request; the browser never
received the intended injected failure. That attempt is retained separately. Moving fixture setup
before entry was then tested, but correctly skipped new-reader welcome because a book already
existed (nine passed, one setup failure). The final fixture keeps the original onboarding order
and removes only the redundant reload. Both development failures remain recorded.

The test checks the full personal book rows, contributor joins and reading-history rows,
using a synthetic reader with an existing owned/read book and a dated, rated reading entry
with private notes. It verifies:

- Both duplicate choices stay disabled while the response is pending.
- The new book retains its contributor and wishlist state without starting a read.
- The original book and reading history remain identical after insertion and recovery.
- Exactly one book insert, one contributor request and one failed preference write occur.
- Retry links to the exact new book and changes no saved data or write counts.
- The failed preference remains absent; recovery does not silently complete it.

Only the test and this report change. Add, scanning, import, matching, source adapters and
storage behavior remain unchanged. No migrations, production writes or model calls are needed.

## Intake boundary

This repair does not qualify intake cutover. The [frozen creator-role comparison](intake-creator-role-comparison-2026-10-17.md)
retains its original code/frame lock and outcomes. Ambiguous contributor roles, edition/source
conflicts, unobserved controls and source-use qualifications still require review. The resolver
remains in shadow mode, and the existing writers remain in place.

## Validation

- Final focused browser run: **10 passed**, zero retries, one worker, fresh local database.
  Keep both completed in 3.5 seconds and reached every preservation and recovery assertion.
- Full unit suite: 3,376 core tests, 1,346 web tests, 498 source-trial tests, two Workflow tests,
  127 recovery checks and nine completion-plan tests passed.
- Type checking, lint, production build, changed-file formatting and whitespace checks passed.
- Full fresh-database browser run: in progress; this is not a green full-suite claim.

All database testing uses the shared stack lock and synthetic accounts. Private pre-run local
snapshots and failure traces are retained outside Git. Each run restores the standard local demo
library afterward. No production data is accessed or changed.
