# Bearded mode and layout audit

Owner request: October 2, 2026. Elegance and intuitive layouts take priority. Review the live
walkthrough and the whole app using Apple and Google guidance as inspiration. Offer an optional,
vastly simpler interface identified by a large beard. Collector copy retention continues separately.

## Findings and recommendation

The app has useful individual tools but exposes too many simultaneous decisions. Simplify the
hierarchy before changing the accepted reading-room artwork or inventing another navigation system.
This is a source/component audit; signed-in device acceptance remains a separate gate.

| Priority | Area                         | Observed problem                                                                                                                    | Direction                                                                                                                                                                                                                                                |
| -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Navigation                   | Eleven destinations, utility buttons and guidance compete with the book journey on desktop. Mobile already has a better separation. | In Bearded mode, show Home, My books, Next read and one labelled Add action. Put other tools in an accessible menu on both sizes. Keep Settings and sign-out reachable.                                                                                  |
| 1        | Home                         | Module order is customizable, but several panels and inline reorder/remove controls turn the landing into a workspace.              | A distinct simple landing: current books, My books, choose a next read. Open the existing personal record for reading changes. Restore the saved full arrangement unchanged.                                                                             |
| 1        | Walkthrough                  | Step-specific jumps, replay, alternate chapters and pause can appear together. Instructional text competes with actions.            | Keep the current instruction, pointer/dot demonstration, Pause and End. Put optional chapter navigation under More steps. Continue observing actual saves; do not automate reader choices.                                                               |
| 1        | Book record                  | Copies, reading history, series/plans, taxonomy and maintenance are all expanded.                                                   | Keep title, actual reading actions and history in view. Disclose editions/copies, series/plans and more details. Preserve mounted editors when changing modes.                                                                                           |
| 2        | First entry                  | Room, pace and arrangement are independent choices, but can be perceived as one setup requirement.                                  | Offer interface density separately from guidance pace. No mandatory walkthrough, fabricated progress or automatic product registration. Place the dedicated interface choice first, before pace, guest handoff review and room setup.                    |
| 2        | Library                      | Header, scope, view tabs, search, filters and sorting create several competing rows.                                                | In Bearded mode disclose secondary library views. Keep search, active filters/counts, scope and error explanations. Follow-up: a single refinement sheet with a clear Apply/Reset model after testing current filter behavior.                           |
| 2        | Settings                     | Long expanded sections include routine preferences, bulk maintenance and account operations.                                        | Keep interface choice and walkthrough access visible; label other sections with native disclosures. Preserve drafts across interface changes. Privacy, backup and account exit remain available, with their explanations.                                |
| 2        | Add                          | Search, scanning, bulk capture, manual entry and import all serve real needs, but share one initial surface.                        | Next pass: search or scan first; manual entry and import under labelled alternatives. Preserve failed-search versus empty distinctions, duplicate review and partial-save recovery. Collector capture remains a separate queue, not an automatic writer. |
| 2        | Next read                    | Scope, mood, refinement and private comparison serve different stages of a choice.                                                  | Keep simple selection followed by picks; refinement stays optional. Do not conceal reasons, source uncertainty, saved state or comparison draft. Design private comparison with its owner in a later paired pass.                                        |
| 3        | Planner / Stats              | Expanded workspaces are appropriate once a task is chosen but should not dominate simple Home.                                      | Keep them deliberate destinations. Preserve month/tab/editor state and private yearly data. Inspect device usage before introducing another compact version of each editor.                                                                              |
| 3        | Discover / clubs / bookshops | Separate discovery and social tasks are not the first-book journey.                                                                 | Keep them in More tools for Bearded mode; never change source attribution, release separation, privacy or consequential choices to reduce text.                                                                                                          |

## First implementation

- Account-separated, versioned **browser-local** preference; no Supabase migration, billing,
  product enrollment or backup claim. The choice says where it is stored and reports storage failure.
- Full interface is the default. Bearded mode is explicit and available at initial welcome and
  Settings. The first welcome screen names the Bearded Bookseller, the admins’ local bookstore owner,
  as its inspiration and explains that the simpler layout puts the reader’s priorities first. It is for anyone who prefers fewer choices, with no assumptions about age or ability.
- The original beard SVG is the default. Hover/focus reveals Choose your beard; tapping opens a
  native dialog with six styles (Original, Rounded, Full, Trimmed, Goatee, Braided) and nine colors
  (Room ink, Espresso, Chestnut, Copper, Golden, Silver, Snow, Plum, Rainbow). The rainbow uses a
  shared six-color palette for its swatch and SVG; its stops and intermediate blends retain contrast.
  Preview first; Use this beard
  explicitly saves a separate account-bound browser document. Cancel discards the portrait draft.
  Storage failure keeps the dialog and retry available. Existing rooms and interface mode remain
  independent. All portraits keep at least 3:1 contrast on their backing across all nine rooms;
  the registry-keyed guard reads the actual portrait palette tokens and selectable colors.
- Larger labelled controls, quiet type, three destinations and a native More tools dialog. Saved
  priority destinations and Home module order take precedence over the simple defaults.
- Read-only simple Home uses the actual library; it does not invent reading state or perform writes.
- Secondary book/Settings information uses native disclosures. The form tree stays mounted across
  mode changes, including another tab's change. Main route children keep the same shell position.
  Active maintenance, import results, duplicate review and an account-deletion draft keep their
  Settings section open; switching interface never conceals their progress or pending decision.
- Walkthrough state machine, pointer/dot, cancellation, run identity and save observers are unchanged.
  Secondary chapter actions are disclosed; the main instruction and stop controls remain visible.
- `/lab/reading-mode` is an explicitly synthetic layout study using the same chrome/Home components,
  public example covers, no profile/book hooks, and no cover-error telemetry. Its welcome preview
  renders the actual first-welcome component. Links open real app routes.

The next iteration should be driven by phone observation: can a new reader add one book, open it,
start reading, update progress and find their way back without a narrated explanation? Repeat with
keyboard, zoom and reduced motion. Do not turn Bearded mode into an access restriction.

## Design evidence

[Apple HIG: Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)
recommends fast, optional introduction and instruction near the relevant interface.

[Google Android: Layouts and navigation patterns](https://developer.android.com/design/ui/mobile/guides/layout-and-content/layout-and-nav-patterns)
recommends familiar navigation, three to five primary destinations, adaptive rails and menus for
infrequent actions. The proposal applies those principles to the existing web shell rather than
imitating either platform's visual styling.

[Google Android: Accessibility](https://developer.android.com/design/ui/mobile/guides/foundations/accessibility)
supports generous touch targets, clear labels, contrast and alternatives to gesture-only interaction.
Web controls here use a minimum 48 CSS-pixel target; CSS pixels and native dp are different units.

## Validation and rollout

The portrait candidate passed lint, typechecking, formatting, production build and the full source
suites: **3,046 core, 1,211 web, 2 workflow, 498 source-trial and 127 recovery checks**.
An earlier full run recorded one 5-second timeout in a test that combined portrait preview, cancel
and save; those behaviors are now separate tests with native label queries. No deadline was raised.
The replacement full run passed. The final Settings safeguard adds an active-task visibility test;
the final full suites passed with **1,212 web tests**, with the other suite counts unchanged.
Final lint, typechecking, formatting and production build passed.

Hosted validation of `87f6870` exposed two ineffective storage-failure mocks on Node 22: jsdom keeps
Storage methods on its prototype, while the Node 26 test fallback owns them directly. The revised
helper targets the actual method owner and proves that a write throws before exercising the UI.
All 11 focused mode tests pass on Node 26; full gates for Rainbow and the mock correction are being
run with CI's Node 22.23.3. No deadline or assertion was relaxed.

The synthetic study was checked at 390px and 320px: no horizontal overflow; Save and Cancel remain
visible; a narrow phone can scroll the dialog to the remaining colors and save Braided / Copper.
The original glyph is restored as the default. The all-room contrast checks cover every portrait
palette choice against its actual backing. These are local study and source checks. Full browser
validation and signed-in device acceptance must still be recorded for the final candidate.
The revised nine-color chooser fits at 390px without device insets; shorter safe rectangles scroll
its choices independently of the action row. Rainbow was selected and saved as Braided, updating
both shared chrome portraits with no overflow.
Do not report this as deployed from a study or unit result.

Public draft #616 is open. Its initial full local browser run was deliberately interrupted after the
owner requested Rainbow: **6 passed, 1 interrupted, 368 unrun**; this is not a full-suite pass.
That candidate's fresh reset and SQL suite passed (1,973 assertions, 65 files). Restoration then
timed out waiting for local Storage startup; all three services subsequently became healthy.
The exact private migration history was verified before restoring the 290-book development seed
and confirming local Auth health. Preserve that interrupted run and restoration record.
The revised candidate needs its recorded full browser result under the shared database lock.

The first Node 22 Rainbow run passed core checks but was interrupted after two existing
ReflectScreen cases exceeded their five-second limits under measured host memory pressure. A
replacement capped unit workers at two, without changing deadlines; it passed core/source-trial/
recovery before being stopped to address review findings and the owner's added iOS scope. Neither
interrupted run is a full-source pass. Home now retains its actual Progress/Finish and other open
forms through a cross-tab mode change; focused regressions verify unsaved values and no writes.
Modal cleanup returns focus to the stable app main when changing interfaces removes the opener.

## iOS and other devices

The owner requested iOS installation clarity and protection from the front camera/status bar.
The existing viewport uses `viewport-fit=cover` and a translucent iOS status bar, but the shell
previously protected mostly its bottom edge. Shared safe-area values now protect initial content,
sticky desktop rails, both phone docks, the full-interface More tray, native modal sheets and
side drawers. Planner’s right-aligned Undo message also clears landscape side insets. The room still fills the screen. The beard picker scrolls its choices independently
of its action row, so a short screen cannot place colors under Save/Cancel.

Installation help is a closed, optional disclosure after the first welcome choice, in Settings >
Interface, and at the landing page's closing invitation. It suggests the current device but lets
the reader choose another. iPhone/iPad instructions explain Safari's Share/Page Menu, scrolling
for Add to Home Screen, Edit Actions, and Open as Web App when offered. Existing installed-app
views hide the welcome/landing invitation and retain Settings help. Nothing prompts installation
or changes account data automatically.

Sources: [Apple's Home Screen instructions](https://support.apple.com/guide/iphone/iphea86e5236/ios),
[WebKit's safe-area guidance](https://webkit.org/blog/7929/designing-websites-for-iphone-x/), and
[Chrome installation help](https://support.google.com/chrome/answer/9658361).

The existing mobile CI project uses Chromium with an iPhone descriptor. A separate, explicit
WebKit project now runs the real welcome/Bearded/Add journey, live reading coach, and shared-component layout
matrix: 320px small phone, 390px notch, 393px island, 844px landscape, and 820px iPad. Its layout
cases inject named safe-area values to model the occluded edges; those are **simulated constraints,
not evidence that a physical iPhone reported those insets**. It is opt-in because the existing
apt-free CI runners install Chromium only; no browser/dependency fallback is introduced.

Run with WebKit installed using `IOS_SIMULATIONS=1 pnpm e2e --project=ios --retries=0` under the
usual database lock. A full local gate can include it with `IOS_SIMULATIONS=1`; default worker
count and fresh-database requirements remain unchanged. Record actual results below.

An isolated WebKit preview on the existing study server passed all five device rectangles, including
selecting/saving Braided + Rainbow, dialog control bounds, and no horizontal overflow. Its request
allowlist admitted only the study server; it made no shared-database requests. Screenshots were
visually reviewed for small phone, notch phone and landscape. This is shared-component preview
proof, not the pending signed-in WebKit/full regression gate.

The checked-in WebKit focus run passed **7/7**: the five device layouts, optional installation help
(including the simulated standalone signal), and a real personal book’s landscape walkthrough.
The walkthrough stays inside the safe rectangle and leaves the stored book unchanged. The first
attempt stopped at test collection because a per-device descriptor included a worker-scoped browser
option; the project now owns the WebKit worker and cases vary only context options. No test deadline
or assertion was relaxed.

Final Node 22 source gates passed: lint, typechecking, formatting, production build, **3,046 core,
1,226 web, 2 workflow, 498 source-trial and 127 recovery checks**. The earlier in-progress iOS
source/typecheck runs were interrupted for the walkthrough fix; these replacement results supersede
them. A final CSS-only review adjustment protects Planner’s Undo action in landscape, with bounds
assertions added to its existing persistence test; static/build checks are repeated for that delta.
The full fresh-database browser gate is still pending for the final committed candidate.

Physical acceptance remains: install from Safari on a notch/island iPhone, cold-launch from Home
Screen, rotate, use the actual keyboard in Add/notes, check VoiceOver and larger text, then confirm
Save/Cancel/navigation clear the status bar and home indicator. Repeat on an iPad. Xcode's iOS
Simulator is not installed on this host; Playwright WebKit cannot operate Safari's native Share
sheet or certify installed-iOS viewport/keyboard behavior.

After review and full gates, advance public draft #616 for review. The private app needs its normal reviewed sync
before production gets this UI. Browser-local persistence is deliberately limited; a later account-
portable preference requires a separately reviewed compatibility/restore contract.
