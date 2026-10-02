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
  native dialog with six styles (Original, Rounded, Full, Trimmed, Goatee, Braided) and eight colors
  (Room ink, Espresso, Chestnut, Copper, Golden, Silver, Snow, Plum). Preview first; Use this beard
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

The synthetic study was checked at 390px and 320px: no horizontal overflow; Save and Cancel remain
visible; a narrow phone can scroll the dialog to the remaining colors and save Braided / Copper.
The original glyph is restored as the default. The all-room contrast checks cover every portrait
palette choice against its actual backing. These are local study and source checks. Full browser
validation and signed-in device acceptance must still be recorded for the final candidate.
Do not report this as deployed from a study or unit result.

Hold public publication while the separate private backup sync is validating: its marker requires
the exact public main. Its unrelated local authentication/navigation timeouts remain a real failed
gate, not a contrast defect and not permission to bypass checks. Coordinate the shared local DB lock.

After review and full gates, publish a public PR. The private app needs its normal reviewed sync
before production gets this UI. Browser-local persistence is deliberately limited; a later account-
portable preference requires a separately reviewed compatibility/restore contract.
