# Reader guidance and gradual introductions

Owner-directed addition before the first beta cohort, September 11, 2026. This improves first use
of the existing product. It does not add another Pro candidate family.

## Reader experience

### Animated guided walkthrough

Owner requested September 12, 2026, after the approved book-data correction sequence.
The written guide remains a reference. The animated walkthrough should highlight the relevant
control in the real app, show the
action and its result, then guide the reader to the next step in adding a book, opening it,
recording a read and choosing or planning what comes next. Offer the gentle and full flows at
welcome; keep independent exploration, pause, skip, resume and replay available.

This supersedes the earlier design preference below against a spotlight. A focused visual tour
may use anchored callouts and transitions while preserving keyboard access, readable contrast,
mobile layout and a reduced-motion equivalent. Keep the written Library guide as a reference.
Demonstrations must use clearly labelled temporary examples or wait for deliberate reader actions;
never fabricate or save reading progress, books, plans or Pro access. Tour movement must not lose
an unfinished form or create a confusing page jump. Verify actual first-use flows, including empty
libraries, saved arrangements and interruptions, before shipping.

The first implementation covers **Add → search/choose → deliberate save → Library → open the
saved book**. The Books chapter and its in-app trail offer **Guide me in the app**. Each **Show me
this step** moves a desktop cursor or a touch dot to a real control. The guide can open Add,
return through Done and open the saved book; it points to search/results/save without choosing
book data or saving for the reader. Validation failures remain on the details step. A successful
personal save identifies the book for this session only. If current Library filters exclude it,
a temporary “Your added book” section exposes that real record without changing the filters or
possession. The normal cover card still opens the native drawer on compact desktop layouts.

The controller is account-keyed and memory-only: no migration, new milestone, content telemetry,
provider request or tour-owned book writer. Navigation away, Escape, window blur and a different
modal pause it; pointer/key input cancels pending demonstrations. Resume follows the current
screen, and End removes the guide without changing the form. Refresh ends the live session; the
existing saved chapter guide remains available for restarting. Reduced motion points directly
without cursor travel or a ripple. Floating UI positions the token-styled callout; the guide joins
an open book drawer's native dialog layer rather than opening another focus trap.

Next, in order:

1. A clearly labelled practice library with automatic playback through the same application
   screens. Isolate all read/write adapters before demonstrating saves; do not fake this with
   query-cache seeding over live Supabase hooks.
2. Actual-screen reading, Next read and Planner chapters using their confirmed success events.
3. Full-flow/replay selection at welcome, then evaluate the shortest useful beta introduction.

The earlier separate illustrated demo is a design study, not this implementation or a practice
data boundary. Practice playback and the later animated chapters are not part of the first slice.

The first welcome offers three explicit choices:

- **Start gently:** four practical stops through adding books, reading, choosing a next read and
  planning. The main navigation begins with Home, Library and Add; More keeps Settings and Appearance reachable.
- **Show me around:** every destination is visible, with a walkthrough through the full reading
  flow, organization, reflection, discovery, sharing, appearance and account/privacy controls.
- **Explore on my own:** the full interface, with no active walkthrough.

Every choice is reversible from **Settings → Walkthroughs and guidance** (`/settings/guidance`).
The written reference lives on the public website at `/guide`, linked from the landing footer
and Settings. It loads without a session or profile and is never a persistent app navigation item.
A gentle dock omits unintroduced destinations without substituting help links or leaving empty slots.
Custom arrangements retain their selected destinations. The saved chapter guide uses a small note in the
page flow; the optional live walkthrough uses a nonmodal anchored callout. Readers can
pause, resume after refresh, replay a stop, open a destination directly, or reveal everything.

The guide's **Show full navigation** action is offered only in gentle mode. It reveals every
section in the sidebar or More menu while preserving the saved dock and current walkthrough
stop. A pending label prevents repeated saves; a successful save replaces the action with
**Full navigation is on**, announces the status and moves keyboard focus to it. Readers already
using full navigation see that status instead of a redundant button. Pausing the walkthrough
remains a separate action. This UI refinement needs no additional migration.

Gentle introductions follow existing personal-library facts:

| Existing evidence                                             | Tools introduced                                  |
| ------------------------------------------------------------- | ------------------------------------------------- |
| First personal book, including an import                      | Next read and Planner                             |
| Started, stopped or recorded read, including imported history | Shelves, Series, Tropes and Cover Studio guidance |
| Completed reading history                                     | Stats and reflection                              |
| Saved reading plan, including undated Soon                    | Discover and Bookshops                            |
| Reader explicitly chooses sharing                             | Clubs and shared-space guidance                   |

These are introductions, not permissions. All direct routes and book controls work at every stage.
Add, Library, Home, Appearance, Settings, privacy, import/export and account exit are always
reachable. A custom saved dock or Home arrangement takes precedence over gradual presentation.
No plan, finish, personal book or shared membership is created by a walkthrough. Pro authorization
continues to be enforced by the existing server boundary.

## Implementation

The existing import/guest handoff remains the onboarding engine. New readers choose a pace before
ordinary import; a deliberately saved guest library keeps its explicit review first. Existing
profiles are migrated to the complete interface without forcing a new tour or changing appearance
or arrangements. The old device-wide completion marker is no longer authoritative for a new
account, so one account cannot suppress another's welcome.

`profiles.guidance` stores a versioned mode, setup completion, current/resumable stop, explicit
introductions and a bounded set of coarse milestones. No book identifiers, contents, event stream
or usage timestamps are retained. Observations run only for gentle readers, through the existing
personal-book/history cache. They are monotonic: deleting a book or changing status never takes
away a tool already introduced. Failed background saves do not block reading or repeatedly retry.

`update_reader_guidance` uses the existing owner-only profile RLS and a row lock. Each patch merges
only the explicit fields plus milestone/reveal unions, preserving another device's observations
and preventing a background observation from replacing the reader's mode. Profile backup includes
the document; existing profile restore and account cascade preserve its lifecycle.

Unknown/future documents are read without mutation. An automatic update cannot replace a newer
version. Shared navigation derives its visible items without rewriting the reader's saved
arrangement. Guide entry points are present on both desktop and phone.

## Release boundary

Public feature PR, then private synchronization. Migration `20261010010000_reader_guidance.sql`
must be applied from the private production checkout before publishing the updated web app. No
Edge Function deployment, provider acquisition, billing change or beta grant is needed.

The unreleased guidance migration was renumbered before production integration to avoid an
existing deployment migration identifier. Its SQL is unchanged. Local databases that already
applied the earlier filename must use the normal fresh test database workflow before verification;
production migration history is not repaired or rewritten.

The optional chapter-details registration gives an extension the current chapter and whether the
reader chose the full walkthrough. Without a registration, the core guide renders unchanged. The
extension checks its own availability; it cannot add stored milestones or change core tour order.

During private synchronization, extend the relevant guide chapters with the entitled beta tools:
Edition Lens and Connected Universes, Reading Table, Room Workshop and Reading Keepsake. Keep
those explanations alongside their existing reading, organization, appearance and reflection flows;
the public build introduces the complete Free app. Preserve the private entitlement checks.

## Live reading chapter

Settings → Walkthroughs and guidance → Settle into a book offers **Guide my reading**.
The first-book walkthrough also offers that continuation. This reuses the account-keyed,
session-only tour provider and cursor/touch dot; it adds no navigation item or stored milestone.
Readers choose their own personal book from Library, with their filters preserved. An empty library
can enter the existing Add walkthrough instead. Shared catalog records never imply a personal copy.

The chapter points at the existing Start reading / Resume reading / Read again control. Its
transition waits for that mutation's success callback, not the optimistic Reading flag. Update
progress may be demonstrated by opening its existing dialog; the reader enters their own whole
percentage and explicitly saves. The success callback offers **Continue reading** as a natural
stopping point. **When I finish** is optional: opening or cancelling the existing finish dialog
never creates a read. Only the successful log and status update together advance to saved history.
The existing retry-after-partial-finish behavior keeps the already-saved log and retries status.
The real Just finished sheet remains available for optional moods and the next book; the pointer
can demonstrate Done to return to history without selecting any mood or next read.

Confirmed callbacks carry the selected book and walkthrough run number, so a late result from a
previous run cannot complete a replay. Paused guides observe successful reader actions without
restarting animation. Ending or changing accounts removes the session state. Other routes pause the
chapter; returning opens the chosen personal book. No provider acquisition, schema change, Pro
entitlement, reader-data entry, fabricated finish, or automatic saving is part of the tour.

In native dialogs the coaching card occupies a normal layout slot above the form. It does not cover
fields or Save, including short phone viewports. The pointer remains inside the native focus boundary
and respects reduced motion. Physical phone keyboard verification remains an owner smoke check.

## Verification

- Core guidance/navigation tests: real-history milestones, DNF, undated plans, early exploration,
  custom arrangements, direct routes, unconfigured/future documents.
- Existing onboarding/import and Home tests continue to exercise their actual reading outcomes.
- SQL tests invoke the owner RPC, union independent observations, preserve mode/tour, reject
  unknown identifiers, isolate accounts and verify deletion. No private reading content is saved.
- Browser scenarios start with real new local accounts despite a previous browser completion flag,
  import a real CSV, inspect the resulting navigation, resume after refresh, explore early and
  exercise failed-save recovery. Desktop and phone layout and axe are checked.
- Registry-derived contrast checks cover the guide's small instructions and primary actions in all
  nine rooms, in both modes.
- Full format/lint/typecheck/unit/build/database and default-worker, zero-retry e2e gates are
  required before handoff. Production behavior remains in the owner smoke register until observed.

Existing-reader browser fixtures explicitly save the full-interface preference through the reader's
RPC. The previous local-storage flag is retained only by the first-use regression proving it cannot
suppress another account's welcome. The e2e server disables live Sentry reporting, matching CI and
keeping intentional test failures out of production monitoring; monitoring behavior has its own unit
coverage.

## Contextual live entry and same-session continuation

Library and personal book pages offer **Guide my reading**; Add offers **Guide me through adding**.
Starting on a loaded personal book selects that book and observes its real reading state, without
routing through Library. Starting in Library preserves the current view and filters. Starting or
restarting on Add observes the existing search, chosen result or form without clearing its draft.

A running task offers **Continue walkthrough** and a separate **Start over here**. On another
screen, returning is labelled explicitly; the paused coach reminds the reader to finish unsaved
changes before leaving. Resume is offered only where the target is usable. If a selected book is
no longer available, **Choose another book** returns to Library and begins a new selection.

Both initial screen observations and successful reading callbacks carry the run number. Restarting
on an unchanged loaded screen re-observes its data; delayed observations from earlier runs cannot
select a book or complete the new task. The last usable URL is kept only in the account-keyed
provider's memory. No guide data is written to browser storage, analytics or the profile. This
continuation does not restore form drafts after navigation or reload. No migration is needed.
