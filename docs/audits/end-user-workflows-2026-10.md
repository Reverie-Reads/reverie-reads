# End-user workflow and visual audit — October 2026

Audit date: October 2, 2026. Public baseline: `9e37809` (#615). Working branch:
`codex/end-user-workflow-audit`. **Validation is in progress; this is not release approval.**

This audit combines workflow/source review, disposable local accounts, browser interaction,
failure injection, layout measurements, and the existing browser/database/unit suites. It does not
certify every possible interaction, production data, external provider availability, actual phone
hardware, or real assistive-technology use. Private product evidence is maintained separately.

## Findings and decisions

| ID  | Priority            | Finding                                                                                                                                                                                        | Disposition                                                                                                                                                                                  |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W01 | P1, release blocker | Shared-list access contract requires a coordinated repair.                                                                                                                                     | Restricted evidence and the repair packet are retained in the private maintainer audit. This UI patch does not close the finding or approve the sharing release.                             |
| W02 | P2                  | An unbroken title in a household/personal detail nameplate loses both ends. At 390 px, the 1,548 px heading began at −563 px inside a clipped panel.                                           | Heading and contributor text now wrap within their panel; retain the full text. Regression checks added.                                                                                     |
| W03 | P2                  | A long shelf name pushes the modal Close button off-screen. At 390 px, Close started at 1,191 px.                                                                                              | Modal headings now shrink/wrap; shelf headings also stay inside their row. Real close action is covered.                                                                                     |
| W04 | P2                  | The full book page overflows at 320 px with an ordinary long multiword title, and can lose its favorite control.                                                                               | Constrain the title's flex minimum, wrap long words/contributors, and keep the favorite control from shrinking.                                                                              |
| W05 | P2                  | Household read failure offers no retry and exposes a raw technical error.                                                                                                                      | Provide an explicit Try again action that revalidates membership before loading household books. Personal-scope escape remains available.                                                    |
| W06 | P2                  | An account transition can deliver a room-canvas resize after its preview leaves the document, causing an empty-color gradient exception.                                                       | Ignore detached/disposed canvas work. A regression test exercises delivery before cleanup and after cleanup.                                                                                 |
| W07 | P2                  | A gateway timeout during sign-in appeared as the unhelpful error `{}`.                                                                                                                         | Explain account-service unavailability while preserving useful credential-validation messages. Credential retention and deliberate retry are covered by a browser flow.                      |
| W08 | P2                  | Shared-list and club detail reads conflate a failed lookup with an unavailable/missing record; secondary club failures can look like empty comments or zero progress.                          | Source-confirmed follow-up: explicit loading/error/empty states and separate retry for the failed data. Do not infer absence from a failed request.                                          |
| W09 | P2                  | Shared-list writes replace a whole document without a revision precondition. Concurrent changes can overwrite one another. Joining also ignores the saved-reference write result.              | Source-confirmed follow-up: combine access repair with atomic/revision-checked operations and truthful join/save recovery.                                                                   |
| W10 | P2                  | Personal-library defaults omit neutral and wishlist-only records; household additions can therefore be saved successfully but absent from the default personal view.                           | The current Filters → Show wishlist control also reveals neutral records. Improve its label and the post-add destination/explanation; never silently assign ownership to make a book appear. |
| W11 | P2                  | Personal tag/trope edits on eligible household copies can update shared enrichment. The corresponding ownership/borrowed-copy explanations do not fully explain that later annotation sharing. | The tag picker now explains household propagation at the edit control. Private reading notes, ratings, moods, plans, and history must remain outside that path.                              |
| W12 | P3                  | The unsplit shelf called “Read” intentionally includes DNF, while completed-reading statistics do not. The same fixture shows “Read · 2” with only one completed book.                         | Product-copy follow-up: use a reading-history label or make the stopped-book split more discoverable. Do not change the completed-read predicate.                                            |
| W13 | P2                  | The sharing reference described prototype storage, obsolete setup steps, and client-only spoilers.                                                                                             | Refresh the reference from shipped source and migrations; remove inaccurate security promises.                                                                                               |
| W14 | Coverage            | The visual harness had no shared-series fixture and resolved two routes from one file as the same path.                                                                                        | Add the missing fixture, resolve paths by their route declaration, retain interrupted measurements, and record redirects explicitly.                                                         |

| W15 | P2 | Add usually returns to a generic library instead of its launch context, and its saved state implies more work is required. | Account-bound observed entry/return, primary named completion and optional finishing details implemented; browser verification pending. |
| W16 | P2 | Edit replaces its form when opening the cover picker, losing unsaved details; Escape can close stacked dialogs together. | Keep Edit mounted under Cover, limit Escape to the active dialog, and protect changed/pending forms. Browser verification pending. |
| W17 | P2 | A title correction to a genre-less book is blocked until the reader assigns an unrelated genre, although Add allows genre-less records. | Remove the unrelated genre prerequisite; retain identity, numeric/date and series validation. Browser verification pending. |
| W18 | P2 | In-app return can restore a URL without restoring route-local selected-book or planner draft state; remounting a shelf-linked Library can reapply its original shelf. | Source-confirmed follow-up: account-bound view/draft restoration packet. Do not claim that remembering an origin already restores every local control. |

P1 means resolve before relying on the affected product promise. P2 means a material usability,
recovery, or data-consistency issue. P3 is a lower-risk clarity improvement. A source-confirmed
follow-up is not represented as an executed end-to-end test.

## Household and personal-library contract

Keep three independent concepts visible:

1. **My library:** a reader's books, editions/copies, possession, reading history, ratings, plans,
   notes, moods, and personal arrangements.
2. **Household library:** one shared work entry with attributable eligible personal copies.
   Membership can survive removing the last personal library entry. A household-only work does
   not create a personal book or assert possession.
3. **Shared catalog:** bibliographic identity and reviewed shared metadata. A household role or
   paid account does not automatically grant catalog authority.

Owned copies enter the household automatically. A borrowed copy needs explicit sharing. A wishlist
flag, rating, or reading state does not admit a work. Only consenting members can receive neutral
personal additions. “Use shared details” adopts the allowed metadata for the selected personal
record; it must preserve reading information and edition compatibility. Trusted automatic series
defaults have their own narrower reconciliation rule; a reader/imported series choice stays protected.

Recommended presentation: every affected screen should say what is being viewed or changed, who can
see it, and whether the action changes a shared work or a personal copy. Avoid describing household
membership itself as “a copy.” Do not merge the household and personal-library filters into one
ambiguous inventory. This patch labels a work without an attributed copy as a household entry and
corrects the personal-details explanation to distinguish automatic series defaults from deliberate
genre, cover and publication adoption.

## Streamlining decisions to validate with readers

| Moment                | Current tension                                                                                    | Recommended outcome                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Choose a library      | A household work can exist without an attributed personal copy.                                    | Keep the two named scopes; label an unattributed record a household entry, never a copy.                               |
| Add from household    | A neutral personal record is saved but falls outside the default grid.                             | Confirm the destination and provide an Open book action; make the filter for all saved records understandable.         |
| Edit a shared book    | Personal, household and catalog effects are different.                                             | State the affected audience beside the action; keep personal notes and reading history visibly separate.               |
| Adopt catalog details | Automatic series defaults coexist with deliberate cover/genre/publication adoption.                | Explain both rules accurately and preview which fields differ before an explicit adoption.                             |
| Remove a book         | Personal removal can leave the household work intact; an owned copy can prevent household removal. | Name the object being removed and show the resulting destinations before confirming.                                   |
| Read versus stopped   | The Read shelf includes DNF; completion statistics do not.                                         | Test a clearer reading-history label or make the stopped-book split obvious; retain the underlying history rules.      |
| Share or join         | Native prompts, minimal acknowledgement and secondary failures can obscure success.                | Use one recoverable form, retain the entered code/draft, and confirm a persisted join or a specific retryable failure. |
| Copy a code           | Clipboard writing has no visible success/failure acknowledgement.                                  | Show Copied only after success and retain a selectable fallback code on failure. Source-reviewed follow-up.            |

The owner's subsequent direction makes streamlining a shared requirement for both Bearded Mode and
the full interface. [Workflow implementation plan](../tasks/workflow-streamlining.md) defines the
common interaction contract, the initial Add/Edit changes, and the remaining packets. Unimplemented
recommendations here are not descriptions of shipped behavior.

## Workflow coverage ledger

The browser-suite references below identify executable coverage to run and inspect; their presence
in source is not a pass. Final run counts and exceptions are recorded in the validation section.

| Area                          | Workflows and states inspected                                                                                                                              | Principal executable coverage                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Landing and guest library     | Guest books, notes/rating, reading tabs, room changes, dock, handoff consent, no account writes                                                             | `landing`, `guest-library`                                                                               |
| Accounts and entry            | Sign-in failure/retry, welcome, independent guidance, existing Reader choice, unavailable product, stale preference/retry                                   | `appearance-first-paint`, `product-entry`, `reader-guidance`, new account recovery flow                  |
| Navigation                    | Direct links, Back/forward, scroll restoration, preserved searches, mobile More, arrangements, guide entry                                                  | `shell`, `tab-routing`, `scroll-restoration`, `search-param-persistence`, `arrangements`, `public-guide` |
| Personal library              | Search/filter/sort, five possession flags, wishlist/unset exclusion, cover/grid/spine states, long titles, detail drawer                                    | `shelf-views`, `state-pills`, `no-horizontal-overflow`, `route-viewport`, new long-title flows           |
| Household                     | Two readers, independent records, owned/borrowed inclusion, household-only Add, adoption, consent, missing/revoked access, deletion preservation            | `household-library`, household unit tests, database household tests                                      |
| Book intake                   | Title/author/ISBN/manual, source failure versus absence, ambiguous/duplicate matches, editions, partial save, lost acknowledgement, read failure after save | `add-*`, `discover-release*`, `write-integrity`                                                          |
| Copy inventory                | Several copies/formats under one reading history, reviewed setup, revision conflicts, failed save, import/export                                            | `copy-inventory`, core inventory/backup tests, database inventory tests                                  |
| Import and restore            | Goodreads/StoryGraph, preview, duplicates, race, field quality, backup preflight/cancel/version compatibility                                               | `import-*`, `restore-preflight`, data-layer unit and database tests                                      |
| Reading                       | Start/progress/100%/finish, DNF/resume/reread, date/format/rating/note, partial retry, unchanged possession                                                 | `reader-flow`, `reading-tour`, `book-tour`, `format-ratings`, `edit-superset`                            |
| Next read                     | Available/wishlist/all/reread scopes, mood, shortlist, selection, TBR membership, gentle/full coaching                                                      | `reader-flow`, `next-read-tour`, matching/core tests                                                     |
| Discover                      | For you, release windows, curated picks, catalog, filters, uncertainty, preview, explicit Add, saved state, return                                          | `discover-*`, `discovery-guided`, `search-withheld-matches`                                              |
| Shelves                       | Derived views, TBR/collections, create/rename/delete, priority, adding/removing, reordering, stale response, final spine/Add reachability                   | `shelf-*`, `spine-shelf-reachability`, `merge-book-picker`, new long-title flows                         |
| Planner                       | Soon/year/month/day, future-self note, queue/order/remove, calendar, release horizon, guide and failed reads                                                | `plan-precision`, `planner-tour`, planner/core tests                                                     |
| Reflect                       | Period/count/drilldown, dated/undated history, rereads, notes, chronology, private retrospective                                                            | `reflect-*`, reading-history summary tests                                                               |
| Series                        | Personal/shared graphs, gaps, explicit order/count, fractional positions, rename/build/merge/remove, preserved personal choices                             | `series-*`, `sync-book-series`, `shared-series-navigation`                                               |
| Tropes and moods              | Add/remove/rename, canonical versus personal labels, links, recommendation use, privacy                                                                     | `trope-rename-delete`, data/core/database tests                                                          |
| Covers                        | Missing/failed/intentional placeholder, source selection, quality, alternate edition, upload/photo boundary                                                 | `cover-*`, `placeholder-title-clip`, `discover-cover-quality`, cover unit tests                          |
| Shared lists                  | Create/join/leave, code copying, manual/personal additions, two-reader updates, failure and simultaneous-write limits                                       | Sharing source/database review; W01/W08/W09 remain open                                                  |
| Clubs                         | Create/join, units/progress, comments, spoiler lock, hide/report, leave, live update                                                                        | Club source, unit and database spoiler tests; W08 remains open                                           |
| Bookshops                     | Location permission, map/list, place data provenance, attribution, outbound search links                                                                    | `indie-bookstores`; real geolocation/provider inventory requires a separate live check                   |
| Settings                      | Profile, room/mode, reading goal/tips, guide replay, arrangement, export/restore, sign-out, deletion                                                        | Settings/data tests, `reading-tips`, `arrangements`, `offline-cache-idiom`                               |
| Offline and multiple sessions | Owner-only cached personal data, reconnect, sign-out isolation, revision conflicts, stale callbacks                                                         | `offline-cache-idiom`, `personal-library-sync`, `copy-inventory`, `product-entry`, household revocation  |
| Administration                | Unauthorized entry, bounded catalog review, cover/edition evidence, explicit acceptance/dismissal, failed writes                                            | `catalog-cover-review`, `catalog-metadata-review`, catalog/database tests; no real catalog writes        |
| Appearance/accessibility      | Nine rooms × two modes, real fonts, reduced motion, keyboard/dialog focus, title lengths/scripts, phone/tablet/desktop                                      | Registry-keyed contrast tests, `a11y`, `fonts`, `reader-flow`, visual audit and focused geometry         |

All 35 registered public routes are inventoried, including `/start`, `/settings/guidance`, shared
series and the three design labs. Parameterized routes use actual fixture records. An authenticated
visit to `/auth` is a redirect, not sign-in-screen coverage. Public account screens and guest states
are exercised separately. A route visit does not stand in for its dialogs or save workflow.

## Validation record

- Local audit accounts: new reader, returning owner, and household member. Synthetic books include
  short, long multiword, very long unbroken, CJK, Arabic, and diacritic-bearing titles; long authors
  and shelf/household names; owned, borrowed, wishlist, neutral, Reading, Read, and DNF states.
- Manual browser checks found W02/W03/W04 through screenshots and bounding-box measurements,
  rather than accepting `toBeVisible` as proof a control was reachable.
- Access-boundary findings and bounded local validation are recorded in the restricted maintainer
  audit. No production data was probed.
- Focused unit checks after the first fixes: **17 passed** (canvas observer lifetime and household
  behavior). Full source checks also pass: lint, typecheck, 3,028 core tests, 1,210 web tests, two tooling tests, formatting and build. The build used local development API configuration; it is not a deployment artifact.
- The first broad visual attempt stopped on an unfixtured shared-series route. The next discovery
  attempt was interrupted by a development navigation while edits were in progress. Neither is a
  completed sweep. Subsequent measurements must use a stable build and retain a coverage record.
- An initial focused browser run hit the old 30-second failure-path budget and rejected a one-member
  fixture household. The fixture now has two real test accounts, and the error/recovery flow has an
  explicit budget for two exhausted request-retry cycles. These were not successful app tests.
- A fast unchanged-membership unit case exposed a retry gap after the first pass. Recovery now
  explicitly invalidates only the freshly authorized household books. All 18 household unit cases
  pass; a real-browser unchanged-membership recovery scenario was added to the full run.
- Corrected focused browser run: **13 passed**, including all nine household workflows, the sign-in
  service failure/retry, and short/multiword/unbroken/CJK titles at 320, 390 and 1,440 px. Earlier
  failed attempts remain in the evidence record.
- Fresh-database full browser suite at the default worker count with retries zero, final visual
  sweep, private browser validation, and post-test database restoration: **pending**.

## Human testing that remains necessary

Use the actual release build on a physical iPhone and Android phone: camera/barcodes, photo upload,
keyboard/scroll behavior, safe areas, installed PWA/back navigation, interrupted network/backgrounding,
and a second device. Use a screen reader with the selected room/mode, not only automated axe checks.
Validate real authentication email/OAuth, provider data, permission prompts, and deployment behavior
separately. Browser emulation and provider fixtures do not establish those outcomes.

## Recommended implementation order

1. Repair shared-list access and concurrent-write/retry semantics before expanding sharing.
2. Review the title, recovery, canvas and Add/Edit return fixes after the full gates pass.
3. Build on the corrected household sharing explanations with clearer neutral-record destinations and the reading-history label.
4. Add recovery to club/shared-list secondary reads and test failed joins and lost acknowledgements.
5. Complete the account-entry/Collector journey against its existing implementation blueprint;
   keep Reader preferences, free-beta arrangements, role boundaries, and deferred bookstore entry intact.
6. Run the focused physical-device and human comprehension sessions above on the release candidate.
