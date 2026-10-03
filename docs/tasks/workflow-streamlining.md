# Simpler workflows in every Midniht interface

Owner direction, October 2, 2026: Bearded Mode can provide a simpler presentation, but the full
interface must also have shorter, clearer paths. Presentation density must not determine whether a
routine task is easy. This specification applies to Reader and the future registered Collector
journey, on Free and Pro. Paid capability does not include basic usability, recovery or data quality.

## Common interaction contract

1. **Enter in context.** An action launched from a book, shelf, household, release or sourcing trip
   remembers its account and originating view. An internal return target is observed or validated;
   arbitrary query strings cannot send readers elsewhere. Reload/deep-link fallback is explicit.
2. **Keep the task small.** Put the required identity and consequential choices first. Put optional
   detail behind a clearly named disclosure. Do not require a genre, rating, ownership claim, reading
   status, or an extra paid feature merely to correct a title.
3. **Separate destination from return.** “Save to my library” answers where the record belongs;
   “Return to Shelves” answers where the person goes next. Neither silently changes the other.
4. **Save once and state the result.** Keep the existing retry identity, partial-save explanation,
   duplicate review, revision conflict and authorization checks. A saved book followed by a failed
   reload is still saved. Open the exact saved book only when its record is available.
5. **Offer one main completion action.** Put the named return beside the save confirmation. Opening
   the new record or improving its cover/tags is optional. Do not put a completed Add form back in
   the reader's path when they leave the saved book.
6. **Protect unfinished work.** Cancel an unsaved draft deliberately; dismissing a secondary picker
   returns to the same draft. A pending save must not appear to cancel merely because a dialog
   closes. Explain fields that save immediately versus those saved by the form.
7. **Preserve the view.** Retain search/filter, selected book, tab/calendar month, scroll, and relevant
   planning draft. Memory belongs to the current account and must be reauthorized before displaying
   shared content. Revocation, household replacement and sign-out clear the relevant context.
8. **Make failure recoverable.** Name the failed action, keep the entered work, and offer its retry.
   Never use an empty-state message for a failed read or claim a join/copy/save succeeded early.
9. **Keep the phone path complete.** Required actions remain reachable with long labels and titles,
   keyboard open, short viewports, reduced motion and every room/mode. Desktop can show more context
   without introducing additional steps.

## This audit's first implementation slice

- An account-keyed, page-session Add origin remembers supported in-app entry routes. Named Back and
  post-save Return use that origin; normal browser history restores its entry scroll. Direct entry
  retains existing safe Library, release and shortlist fallbacks. Barcode review and an active
  first-book walkthrough retain their specialized continuation.
- The saved state says “Your book was saved.” Return is primary and precedes optional cover/tag
  work. Open your book replaces the completed Add history entry.
- In-app navigation out of an unfinished single-book form offers Keep editing or Leave draft. A
  pending save does not offer Leave. This does not make drafts durable through reload or tab close.
- Edit's cover picker leaves the original form mounted. Escape closes only the top dialog.
  Closing a changed detail form offers a deliberate choice; its pending save keeps the form open.
- A title/detail correction no longer requires first classifying an unclassified book's genre.
  Title and numeric/date validation, series-change confirmation and sequenced writes still apply.
  Unchanged series fields do not become a reader-authored membership claim merely because another
  detail was corrected.

These are branch changes awaiting the recorded browser gates and review. They do not establish that
all view-local drafts or selections survive every route. Existing filters stored outside a route
survive normal returns; route-local selection and planner/editor draft restoration need the next
slice below. No billing, product registration, catalog authority, or production change is included.

## Remaining workflow packets

| Workflow                           | Short intended path                                                                   | Required preservation and checks                                                                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search/manual Add                  | Find or enter → review identity and destination → save → return                       | Avoid another full search when correcting a hit; guard same-screen result/destination replacement; one retry identity and explicit duplicate decision.                                   |
| Edit details                       | Open the relevant section → change → save and close                                   | Keep draft across cover/tag pickers; clearly distinguish autosaved controls; retain draft and explain partial failures.                                                                  |
| Library to Add and back            | Launch from current scope → save → return to the same view                            | Account-bound filters, current shelf, selected personal record and scroll; a shelf deep link must not reapply an earlier filter on return.                                               |
| Household-only Add                 | Choose Household only → confirm shared identity → save shared entry → return          | Never fabricate a personal copy or possession; retain authorized household search/selection, clear on revocation.                                                                        |
| Add a personal copy from household | Explicit personal destination → confirm copy/edition → open personal record or return | Label neutral saved records so their absence from the default possessed/read grid is understandable.                                                                                     |
| Catalog adoption                   | See differing supported fields → apply chosen shared details → stay on book           | Protect reader/imported series and personal reading information; entitlement is never catalog-edit authority.                                                                            |
| Barcode batch                      | Capture → review each distinct copy → confirm → next capture                          | Camera lifecycle, account isolation, repeated-ISBN decision and the session-only export notice remain essential.                                                                         |
| Discover/releases                  | Preview → Add with exact edition → save → same results/window                         | Preserve shortlist session and filters; keep release provenance/uncertainty; never convert a release date into a reading plan.                                                           |
| Next read                          | Refine → choose a book → start or plan → return to the choice context                 | Preserve unsent mood, quiz, scope and shortlist; no guide/demo saves or automatic ownership changes.                                                                                     |
| Planner                            | Choose a book → choose timing → save → same tab/month                                 | A date picker or book detour cannot destroy notes; distinguish releases from personal plans; revision and error states stay visible.                                                     |
| Reading log                        | Start/update/finish → optional reflection → close to book                             | Preserve history on the parent book, partial-finish retry and independent possession; no mandatory rating/review.                                                                        |
| Shelves/series                     | Act directly on the selected list or slot → confirm → same collection                 | Undo where safely supported; destructive actions explain the retained personal book and affected membership.                                                                             |
| Import/restore                     | Select source → preview scope/conflicts → confirm → results with recovery             | Consent, version compatibility, identity/copy safeguards, and failed-row visibility remain required steps.                                                                               |
| Shared list/club                   | Create or enter code → confirm persisted membership → open                            | First repair the documented shared-list access/concurrency finding; separate failed reads from missing/empty data.                                                                       |
| Collector sourcing                 | Open active trip → capture/review a find → decide/acquire → resume trip               | Preserve private evidence and purchase state; exact-copy personal-library handoff is explicit. Detailed commercial/workspace design remains private.                                     |
| Account/product changes            | Choose a usable product → confirm preference → registered destination                 | Exactly Reader and Collector are the target initial products; Collector entry remains gated on its usable Free journey; Bookseller entry deferred. Preserve current Reader arrangements. |

## Delivery order and acceptance

1. The first Add/Edit slice passed the final public source and fresh-database browser gates at
   `fad4c4e`; see the audit receipt. Validate its private integration separately, retaining phone,
   desktop, household, direct-entry, duplicate/release and guided/scanned continuations.
2. Introduce one account-bound view/draft restoration contract, starting with Library and Planner.
   Keep draft values out of URLs, analytics and shared data. Test leaving and returning after edits,
   a changed account, household revocation, and records removed while away.
3. Make detail editing revision-aware: preserve unrelated concurrent changes, surface overlapping
   conflicts, and keep the older draft available for review. Then reduce Add/Edit density through
   optional sections and unify repeated pickers and direct actions.
   Determine visibility from task state, not account price or a promise to simplify Bearded Mode.
4. Repair shared-list access, simultaneous writes and join recovery before improving its invitation
   flow; add independent read recovery for clubs. Keep this security/data change separately reviewable.
5. Apply the same contract to the Collector's active-trip journey and exact-copy handoff before
   registering Collector entry. Coordinate through the public/private integration seam.
6. Run human task sessions on actual phones. Ask people to add a book, correct one field, change a
   cover without losing text, distinguish a household entry from a personal copy, and return to a
   filtered view. Record success, wrong turns, lost context, time and confidence without retaining
   private book/notes content. Establish a baseline before claiming measured speed improvements.

See [the audit](../audits/end-user-workflows-2026-10.md) for evidence, open defects, executed coverage
and current limits. A green source gate alone is not acceptance of these workflows.
