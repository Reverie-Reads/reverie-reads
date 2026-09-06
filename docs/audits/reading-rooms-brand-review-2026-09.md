# Reverie: brand and reading-room review

Review candidate on `codex/reading-rooms-cohesion`. This pass is not a production release.

## The direction

Reverie should feel like opening the door to your own library. The brand makes that promise;
the nine rooms let a reader decide how it feels to spend time there.

The selected brand is **Midnight & Lamplight**: blue-black ink, parchment, and aged brass.
Newsreader at 500 is the display face, with genuine italic emphasis, paired with Hanken Grotesk
for everyday reading and controls. The earlier green proposal moved too far from the atmosphere
the owner liked; three rendered concepts led back to a darker, luminous library. An open-book mark
replaces the crescent. These choices give the landing and account screens an identity distinct
from Tryst's plum, gilt, and romance associations.

| Role        | Color     | Use                                         |
| ----------- | --------- | ------------------------------------------- |
| Library ink | `#10121c` | The front door and dark editorial sections  |
| Aged brass  | `#d7bc88` | Primary actions and restrained emphasis     |
| Parchment   | `#f1eadc` | Long explanations and quiet section changes |
| Reading ink | `#302c37` | Text on paper                               |

The brand remains steady as someone browses. Selecting a room changes the working guest library,
its book record, and the larger library workspace. The controls say what changes, show the
selected room beside each example, and give a direct route back to the selector. Choosing a
room does not reset the sample reading actions or change a stored appearance preference.

The front door now includes a restrained pool of animated lamplight. Its 24-second outward
movement and 24-second return change only a decorative layer's opacity and transform. Text,
controls and room examples remain steady. Hidden tabs pause it; reduced motion cancels the
animation and leaves the authored still. It uses the browser's JavaScript
[Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate) and
[pause control](https://developer.mozilla.org/en-US/docs/Web/API/Animation/pause), without a frame
loop or animation dependency. Three lifecycle tests and 12 focused browser journeys passed,
including real movement, stable text, live reduced-motion changes, and the actual italic font.

## Aesthetic findings and changes

Large headings needed room for the real fonts to breathe. The landing now uses a 1.14 display
line height and a smaller, more manageable hero measure. The working library adapts to the
width of its own panel. On phones, dock icons sit above their labels. Books paginate so a CSV
upload cannot turn the hero into an unbroken wall of covers.

The old room gallery asked visitors to pass nine large previews before discovering the active
test. Nine compact, keyboard-operable choices now lead directly into the selected room. Day and
Night are visible on that preview. The sample shelf includes science fiction, literary fiction,
horror, nonfiction, and fantasy alongside romance; the appearance is independent of its books.

The first rendering of the new daylight art produced a metallic shading band. The redundant
center gradient caused it and was removed. The daylight scenes now retain their paper and
linen character without that sheen.

## A library visitors can actually use

The static desktop/phone composition and fictional shortlist have been replaced with one shared,
temporary guest library. It begins with Jane Eyre underway and a borrowed audiobook of The Left
Hand of Darkness. The visitor can:

- Select several titles from a curated six-book catalog sample, or enter a title, author, and ISBN.
- Choose owned, borrowed, wishlist, or decide later, then record independent copy and format flags.
- Upload a Goodreads, StoryGraph, or Reverie CSV: at most 50 rows and 1 MB, with a 60-book guest cap.
  Strong identities merge through the app's existing importer; fuzzy matches remain separate.
- Open a book, start reading, save progress, leave a note, and set their own half-star rating.
- Finish a read and see its date, format, rating, and note in the journal. Rereading preserves
  completed history and possession; retrying a completed finish does not append another read.
- Use Next read with available, wishlist, or whole-library scope, save a pick for later, and
  deliberately include rereads. These are honest eligibility examples, not a simulated personalized
  taste or mood score.
- Try three dock arrangements, reorder destinations with accessible buttons, or hide/restore them.
  The chosen guest dock now carries into the signed-in account during onboarding.
- Write a note in the lower landing example and open the same saved note in either library view.

The two library workspaces and the note example use the same state. Room selection changes their
appearance without changing books. Small pages keep larger imports browsable. Reset clears the
session after a local confirmation; refreshing or leaving the landing discards it. Signing up does
not claim to transfer these books. No dummy account, production corpus mutation, localStorage,
sessionStorage, or IndexedDB book persistence is involved.

The catalog is a bundled sample of public bibliographic facts, not an anonymous query against the
entire live corpus. It contains no private reader seed or real person's notes or history. Shared
CoverCard, CoverImage, Nameplate, Stars, navigation glyphs, NextReadCardView, CSV mapping, identity
matching, merge logic, and reading transitions keep the demonstration close to the product. Guest
cover failures do not send visitor-entered titles to cover telemetry. Cover URLs in uploaded CSVs
are omitted so private exports do not initiate those requests.

The next step after this review is deciding whether a visitor should be able to deliberately carry
this session into account creation. That requires an explicit, tested import handoff; it should not
be implied by a signup button before it exists.

## Each room's atmosphere

| Room       | Intended feeling                  | Authored scene                                              |
| ---------- | --------------------------------- | ----------------------------------------------------------- |
| Tryst      | Private, rich, close              | Velvet folds, a tall salon window, a pool of lamplight      |
| Grimoire   | A place to become absorbed        | A pointed tower window, shelves, vellum light               |
| Aphelion   | Quiet distance and possibility    | An observation alcove, orbital horizon, a few distant stars |
| Marrow     | Suspense from somewhere sheltered | Mineral seams and a protected light within a dark archive   |
| Gaslight   | A mystery on a rainy evening      | Rain along a tall window, a brass-toned lamp, a desk edge   |
| Marginalia | Time alone with words             | Paper edges, a pencil margin, a pale writing desk           |
| Hearth     | Familiar and unhurried            | Window light across linen, a sill, soft wood grain          |
| Almanac    | Curiosity and discovery           | A field notebook's indexed edge and map contours            |
| Firstlight | A fresh page and room to grow     | A rounded window, a low dawn horizon, light in the margins  |

These scenes accompany the existing room typography, controls, navigation, book spines, and
cover structures. They are decorative; they do not carry instructions or replace readable
surfaces. The app, skin gallery, and landing use the same renderer.

Canvas 2D was selected after comparing its static caching approach with the render loops of
Three.js and PixiJS. The art needs authored lines, texture, and local light rather than 3D
models. It adds no animation library, caches each still, caps pixel density and total pixels,
and avoids React updates for frames. Day views are still. Night light changes slowly and stops
when hidden, offscreen, or reduced motion is requested. Adaptive palettes repaint when changed.

Sources: [MDN canvas optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas),
[Three.js rendering on demand](https://threejs.org/manual/en/rendering-on-demand.html),
[PixiJS render loop](https://pixijs.com/8.x/guides/concepts/render-loop),
[Newsreader](https://fonts.google.com/specimen/Newsreader).
New fonts are self-hosted with their OFL license. Selected sample covers use the
[Open Library Covers API](https://openlibrary.org/dev/docs/api/covers) with attribution.

## Voice in use

Lead with the reader's books and time. Prefer “your library,” “keep browsing,” “save for later,”
and “pick up where you left off.” Avoid streak pressure, discovery rankings presented as
authority, and romance vocabulary in shared surfaces.

Hero: **Find your next read in your own library.**

Supporting copy: “A quiet place for your books, your notes, and the way a story stays with you.
Settle in, then find the next book for how you feel today.”

Account creation: “Make a little room for your books. Your library starts here.”

Discover: “Find a book you want to spend time with.”

## Discover and series usability

Discover covers and titles now open a book preview. Readers can inspect the catalog description,
author, publication information, and ISBN, then continue browsing, add to a wishlist, or open
the copy already in their library. A preview adds no book. Closing it restores the triggering
control's focus and retains the current browse. Description failures offer a retry; missing
descriptions say so. External search details need matching identity before their synopsis is
shown. Source HTML is rendered as plain text.

The immediate next Discover opportunity is a small set of editorial shelves that answer a
reader's question: a short read, a change of pace, or another book by an author they enjoyed.
That should follow catalog quality work: cover completeness, useful descriptions, edition
clarity, and credible explanations. Appearance must never become an implicit genre filter.
This pass does not claim those proposed shelves are implemented.

### A focused next version of Discover

The reader's question is usually more specific than “show me a genre.” Organize the next version
around three starting points: **An author I want more of**, **A feeling I'm looking for**, and
**Something different**. Keep ordinary title/author/ISBN search plainly available above them.
Retain the selected path, filters, and scroll position when a reader returns from a book.

Each shelf should contain a small, credible set of books with one honest reason for its inclusion.
Use catalog facts or the reader's explicit choices for that reason. A missing description should
reduce a book's prominence in an editorial shelf; it should not produce an invented synopsis.
Show the reader's own library relationship before suggesting an addition. Continue to separate
owned, borrowed, and wanted copies.

| Priority | Proposal                                                                    | Reader benefit                                         | Evidence before expanding                                  |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| First    | Complete the descriptions and covers of a bounded set of browseable works   | A detail view worth opening                            | Description coverage and the rate of unsuccessful previews |
| Next     | Remember browse context in the URL and open details as an addressable route | Back, reload, and opening another tab behave naturally | Completed browse → details → return journeys on a phone    |
| Then     | A few transparent editorial shelves using known catalog fields              | Less aimless scrolling                                 | Detail opens followed by deliberate wishlist saves         |
| Later    | Optional suggestions informed by stated reading preferences                 | Discovery feels personal                               | Reader feedback and cost per useful saved suggestion       |

Do not launch a large personalized feed before the catalog supports a useful small one. For a
profitable side business, a reliable, bounded browse costs less to maintain and explains its
value more clearly. Cache shared descriptions, fetch external details only when requested, and
avoid one provider request per visible card. This implementation already follows that last rule.

Example shelf voice: **A different kind of evening** — “A few books outside your usual shelves.
Open one and see where it takes you.” The shelf must actually use an explicit contrast with the
reader's chosen genres before this claim ships. Example empty state: “Nothing here yet. Try
another genre, or look for a book by name.”

Series detail has a visible **Not a series? Remove this category** action. The dialog distinguishes
permanent removal from keeping a category for later in Deleted series. Permanent removal deletes
the personal category and its entries, including missing-book slots. It retains books, private
notes, reading history, possession, and other series memberships. It records deliberate reader
intent when clearing a primary label and does not classify the work as standalone or edit the
shared corpus. A connected-universe refusal remains enforced by the existing archive operation.

The database change must be installed before permanent removal is available on a hosted app.
Older deployments show an explicit unavailable message instead of pretending to succeed.

## Review and release boundary

Review the brand beside Tryst, then switch rooms and Day/Night in the landing. Inspect the phone
layout as well as desktop. The important subjective decision is whether the rooms feel inviting
enough to return to while leaving the books at the center of attention.

This work is held for visual review. The new database function changes a personal-data write
path. After review and merge, its production deployment belongs to the owner using the guarded
private-repository process; a web preview does not install that function.

Automated verification results and rendered review images are recorded with the review delivery.

After the visual direction is approved, carry it into the app icon, share images, and onboarding
materials together. Those assets should follow the accepted brand rather than become competing
experiments during this review.

## Verification of the guest-library candidate

The complete candidate at `58c3058` passed the full local and hosted checks:

- Lint, type checking, repository formatting, and the production build passed. All **3,405**
  unit/integration tests passed, including the compiled Workflow integration.
- A fresh local database passed **43 SQL files and 1,323 assertions**, including all 22 assertions
  for permanent personal-series removal.
- The complete local browser run used **one worker and zero retries** after that fresh database
  reset: **236 passed, 10 skipped, no failures** in 31.6 minutes. Desktop Back restoration and
  permanent-series removal both passed. The existing mobile Back test remains skipped; the earlier
  intermittent scroll issue is retained below, and its cause is not claimed fixed.
- [Hosted CI run 33953238014](https://github.com/Reverie-Reads/reverie-reads/actions/runs/33953238014)
  also passed on that exact commit: 189 ordinary browser journeys, 35 mobile journeys, and 12 route
  accessibility journeys, with the same 10 skips and no reported flaky tests.
- The room audit rendered **36 captures**: nine skins, Day/Night, desktop/phone. Its 18 complete
  landing scans and the guest audit's 72 book, catalog, manual-entry, and dock scans reported
  **zero Axe violations across 90 scans**. All three examples followed room selection. The landing
  had no horizontal overflow at 320, 390, 768, or 1,440 pixels.
- Real touch measurements at 320 and 390 pixels confirmed each half-star target remained at least
  24 pixels wide. The guest walkthrough also passed against the compiled production preview:
  add a book, start, note, finish, journal, then switch all three examples into Aphelion.

A final phone probe after the full run found a separate guest-navigation defect: opening a book
from the last row of a larger import left its details above the viewport. The focused heading now
scrolls into view in the workspace the visitor used; paging does the same. The second workspace
does not take focus. The new touch regression asserts the heading and book title are actually
inside the viewport, without a test-side scroll. This final navigation adjustment is verified
separately from the full `58c3058` run; it does not claim to fix signed-in Back restoration.
All **seven guest browser journeys passed** after the adjustment, with one worker and zero retries,
including the new touch navigation regression, desktop/phone reading, CSV intake, and note focus.

The guest audit is reproducible with `node scripts/audit-guest-library.mjs` against a local preview.
Its screenshots and machine-readable results are under `output/playwright/guest-experience/`.
Full local logs and the preserved browser evidence are under `output/playwright/`, excluded from
source control. No production database writes, private synchronization, merge, or deployment were
performed for this review.

## Verification of the initial review candidate

- Lint, type checking, formatting, and the production build passed.
- The unit run passed 3,393 tests across core, web, the compiled Workflow integration, and the
  series-source trial package.
- A fresh local database passed all 43 SQL test files and 1,323 assertions. The permanent-series
  removal file contains 22 assertions covering authorization, retries, primary and secondary
  membership, legacy labels, empty/archived categories, and preservation of books and history.
- The rendered landing audit captured all nine rooms in Day and Night at desktop and phone widths
  (36 room captures). All three examples followed the selected room, with no horizontal overflow
  or browser errors. All 18 room/mode accessibility scans reported zero Axe violations. The hero's
  real Newsreader face rendered at the intended 1.14 line height. Brand widths of 320, 390, 768,
  and 1,440 pixels were inspected separately.
- The full browser run used one worker, no retries, and a fresh database: **224 passed, 10 skipped,
  5 failed**. Four failures were stale test contracts for the changed brand font, semantic
  Discover cards, and “more books” label. Those contracts were corrected; a focused run covering
  all five failures plus nearby reader journeys passed **13 of 13**.
- A final shared-search adjustment keeps results noninteractive on surfaces without a detail
  preview. The resulting Discover and Add journeys passed **14 of 14**, including opening details
  without adding a book, returning focus, wishlist/shelf additions, and an accessibility check.
- The fifth failure was Back navigation restoring the library to the top. It passed unchanged in
  the focused run. Its cause remains unresolved; a later pass does not establish that it is fixed.
  Keep it visible as a release concern. No scroll-restoration implementation or assertion was
  weakened in this pass.

The initial SQL rerun after browser fixtures reported failures in pre-existing global-count and
unique-work assumptions. Resetting the local database restored the suite's documented baseline;
all 1,323 assertions then passed. These dirty-fixture failures are not hidden by the clean result.

The visual audit is reproducible with `node scripts/audit-reading-rooms.mjs` against a local
preview (pass its URL as the first argument; the default is `http://127.0.0.1:4334`). Its images and machine-readable results are
local review evidence under `output/playwright/reading-rooms/`, excluded from source control.
The gallery includes desktop/phone and Day/Night comparisons plus the new Discover and series
dialogs. Private connected-universe compatibility was checked against the existing archive guard
in source; that private integration was not exercised in the public local database.
