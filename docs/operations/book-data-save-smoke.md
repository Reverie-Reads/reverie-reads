# Owner-run book save and reopen check

First in the September 12 repair sequence. This is a production **owner-run** checklist,
not an automated test or permission for a Code session to write production data.
Use one real book you intend to keep; do not create a throwaway account or test book.

## Before saving

1. Sign in to your own account on the deployed app. Record the build displayed by
   `/version.json` and the time privately. The September 12 release baseline is private
   merge `505ebcbfca7c6c680012cb7bef4969b4ef0869ff` (public source `3ba18a10ba3f06db968eec412051812096fc7ff0`).
2. Choose one exact edition through Add or Discover's details-to-Add path. Confirm the
   selected ISBN, full title and every contributor against the edition you intend to save.
   An unrelated edition, author-role disagreement or missing ISBN is not an edition test.
3. In Add, record the displayed Pages and publication date **before** saving. Keep missing
   values unknown; a year or year-month is not a full date. If Fetch details is unavailable,
   stop the provider check rather than inventing values or repeatedly fetching.
4. Record any deliberate reader edits and the selected destination. Prefer personal-only
   unless you actually intend to add the book to the household. Do not change possession,
   reading history, series or cover choices merely to satisfy this check.

## Save once, then read

1. Press the displayed Add action once and wait for the result. If a duplicate decision
   appears, stop this simple-insert check: record that it requires a separate merge review.
   Do not approve a merge just to complete the smoke test.
2. If saving errors, times out or has an uncertain result, do not press Add again. Inspect
   your library read-only for an existing saved copy and report the uncertainty.
3. After a successful save, open that exact personal book from your library. Record its
   personal book URL. Refresh the page and reopen its details. If a value is visible only
   in Edit details, inspect the form and cancel without saving.
4. Compare ISBN, full title, all contributors, Pages, and publication precision with the
   pre-save values. Reader-entered values must remain unchanged. A field that stayed blank
   passes unknown preservation, not successful provider acquisition for that field.
5. Confirm the chosen library destination and absence of an unintended second copy. Do not
   delete or repair anything as part of verification. Report a discrepancy for diagnosis.

## Private receipt

Keep the filled receipt under ignored private verification output, never in a public PR.
Do not include tokens, account credentials, private annotations or other readers' records.

| Observation                | Result to record                                              |
| -------------------------- | ------------------------------------------------------------- |
| Build and time             | Exact build; timestamp                                        |
| Entry path and destination | Add or Discover-to-Add; personal/household choice             |
| Selected edition           | ISBN; full title; contributor names and roles as displayed    |
| Before save                | Pages; whole publication date and precision; deliberate edits |
| Outcome                    | Saved / duplicate review / failed / uncertain                 |
| After refresh              | Same fields from the exact saved personal book; its URL       |
| Comparison                 | Each field unchanged / mismatch / unknown preserved           |
| Unexpected effects         | Any duplicate or unexpected destination                       |

Status at authoring: **owner execution pending**. The prior deployment/read-only navigation
check does not establish that a production save preserved these values. Local persistence
coverage exists in the saved-metadata-continuity release; it is not this live receipt.

## Next gates

Evidence gathering for the frozen historical shortlist may proceed read-only while this
receipt is pending. Historical writes wait for qualified before/after proposals, current
fingerprints and review revisions, the narrow reviewed correction action, and owner approval.
No completion sweep, broad shared editor, automatic standalone declaration, or personal-copy
rewrite is part of this sequence. See [the targeted review handoff](../tasks/targeted-catalog-data-review.md).
