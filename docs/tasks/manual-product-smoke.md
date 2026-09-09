# Reverie manual product smoke register

Status: **running owner checklist**. Automated tests protect data and interaction contracts; this
register covers comprehension, visual quality, real-provider behavior, and production-only paths
that still need a human judgment. Record the build, device, and date beside each completed group.

Never use a personal production library for destructive checks. Production account creation,
writes, migrations, function deployment, and deletion remain owner-run operations.

## Run record

| Field                      | Value                               |
| -------------------------- | ----------------------------------- |
| Date                       |                                     |
| Build / version            |                                     |
| Environment                | local / preview / production        |
| Desktop browser + viewport |                                     |
| Phone browser + viewport   |                                     |
| Tester                     |                                     |
| Result                     | pass / pass with findings / blocked |
| Issue or PR links          |                                     |

## P0 — trust and release blockers

- [ ] **Account boundary:** create or use a disposable account; sign in, sign out, sign back in,
      and confirm another account's books, notes, plans, household data, and arrangements never
      appear.
- [ ] **Import review:** import a small Goodreads or StoryGraph file containing a duplicate, a read
      book, an unread book, and a partial date; confirm the preview explains additions and merges
      before writing.
- [ ] **Restore preflight:** select a backup and confirm the app shows real counts and warnings
      before any restore; cancel once, then complete only in a disposable account.
- [ ] **Data persistence:** add or edit a book, reload, sign out/in, and confirm title, contributors,
      possession flags, formats, reading state, notes, rating, shelves, series, and plan remain.
- [ ] **Export:** download a complete backup and confirm it contains books, reads, shelves, series
      choices, moods, tropes, follows, plans, and arrangements without exposing another reader.
- [ ] **Failed-write honesty:** interrupt one safe local write path and confirm Reverie reports the
      failure instead of showing success or discarding the draft.
- [ ] **Accessibility blocker sweep:** keyboard-only sign-in and core navigation, visible focus,
      labels announced once, dialogs trap/restore focus, and no unreadable control in the selected
      room and mode.

## P1 — core promise and activation

- [ ] **Landing guest library:** add/select a sample book, open its details, rate it, save a note,
      change the room, and arrange the dock without the demo jumping down the page or losing state.
- [ ] **Guest handoff:** choose books, note, room, and arrangement; begin signup; verify explicit
      consent, duplicate handling, retry/cancel behavior, and the first useful post-auth action.
- [ ] **Add and find:** add by title/author, ISBN, scan where supported, and manual entry; return to
      the added book through search and Back without losing filter or scroll context.
- [ ] **Possession:** set owned formats, borrowed, and wishlist in overlapping combinations; confirm
      Library and derived shelves show each relationship without converting one into another.
- [ ] **Next read:** compare Available, Wishlist, whole-library, reread, and stopped-book scopes;
      save one choice, start it, and confirm possession and completed history remain intact.
- [ ] **Reading loop:** start, update progress, save a private note, finish, and start a reread;
      confirm each completed read keeps its own date, format, rating, and note.
- [ ] **Series:** open series details, inspect gaps/order, remove an incorrect category permanently,
      and confirm the books remain in the library with unrelated memberships unchanged.
- [ ] **Discover:** use book, mood, and genre paths; open addressable details; return without losing
      shortlist order; dismiss/undo; add a book; confirm owned/borrowed/wishlist state is visible.
- [ ] **Coverless books:** inspect long one-word and multi-word placeholder titles in Discover and
      Library; no title should split mid-word, collide, clip silently, or make a card change height.
- [ ] **Cover quality:** open a weak or missing cover, inspect alternatives, choose one explicitly,
      reload, and confirm the working linked fallback remains available.

## P1 — return experience

- [ ] **Plan queue:** add Soon and dated items, write a future-self intention, reorder, edit date
      precision, remove/undo, and confirm reload preserves order and meaning.
- [ ] **Release horizon:** inspect followed-author and manual releases; confirm source labels and
      year/month/day precision are honest and no release becomes a plan automatically.
- [ ] **Reflect:** change period, open counts and book records, inspect a saved note, open the private
      retrospective, and confirm its facts match the same visible reading history.
- [ ] **Home:** verify Reading now, Next read, priority shelves, releases, and reading-year modules
      reflect current data and the saved arrangement after a reload.
- [ ] **Return after inactivity:** after at least seven days, sign in without coaching and find the
      saved choice, current read, plan, and latest history action.

## P2 — atmosphere, layout, and personal configuration

- [ ] **Nine rooms:** review Tryst, Grimoire, Aphelion, Marrow, Umbra, Folio, Hearth, Almanac, and
      Bloom in day and night; each should feel distinct while every label and control remains clear.
- [ ] **Scene consistency:** compare Landing examples, signed-in Home, Library, Discover, Plan, and
      Reflect in one room; background, typography, materials, and controls should feel related.
- [ ] **Responsive layouts:** run 320px, 390px, tablet, and 1440px; no sideways page scroll,
      obstructed final card/add control, clipped book spine, or covered primary action.
- [ ] **Phone navigation:** Next read text centers under its icon; Add and More remain fixed and all
      hidden destinations remain reachable with 44px minimum targets.
- [ ] **Arrange Reverie:** choose each preset, reorder and hide destinations/Home modules, preview,
      cancel, save, restore a hidden destination, reset defaults, reload, and switch account.
- [ ] **Motion:** verify lamplight/room movement feels quiet at normal settings and stops under
      reduced motion without losing essential state or focus cues.
- [ ] **Typography:** inspect large landing headings, dialog copy, form fields, book cards, and long
      translated titles for collisions, tight line height, or text smaller than the surrounding UI.

## P2 — collection and shared-library depth

- [ ] **Shelves:** create, rename, prioritize, reorder, add/remove books, switch grid/spine view, and
      reach the first and last book with mouse, touch, and keyboard fallback.
- [ ] **Household:** add an existing and provisional work, compare member views, remove access, and
      confirm personal possession, notes, ratings, and history remain private.
- [ ] **Clubs and lists:** join through the supported path, add/remove a book, update progress, and
      confirm spoiler-gated comments stay hidden until the reader reaches them.
- [ ] **Catalog administration:** review cover and metadata queues, defer once, reject a stale save,
      and confirm shared edits never overwrite a personal reader choice.
- [ ] **Indie links:** choose a local shop and test Bookshop, Libro, and direct-store destinations;
      copy must accurately describe which purchase supports which shop and that Reverie takes no cut.

## P3 — recovery and install checks

- [ ] **Offline read:** load the library, go offline, reopen cached books and notes, return online,
      and confirm the visible state refreshes without cross-account cache leakage.
- [ ] **Install:** install the web app on one supported phone and desktop; launch from the icon and
      verify safe-area spacing, navigation, mode, room, and sign-in persistence.
- [ ] **Account deletion:** in a disposable account, export first, type the required confirmation,
      delete, and verify sign-in, cached personal content, and shared membership behavior match the
      documented contract.

## Finding rule

Record the first failing step, expected outcome, actual outcome, environment/build, viewport,
room/mode, and whether the issue reproduces after one fresh navigation. Do not erase a red result
with a green rerun. Link the repair and record the first verified build that closes it.
