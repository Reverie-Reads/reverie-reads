# Reading life study

A standalone interactive proposal for Reverie's Stats and Planner overhaul. The reviewable
contract and implementation order are in [READING_LIFE.md](READING_LIFE.md). The Stats/Planner
redesign remains a study; no application route, database, account, network API client, or service
worker is initialized. The accompanying shared CSS fix makes native select menus readable in
the application and every study importing its styles.

## Open the preview

From the repository root, with dependencies installed:

```sh
pnpm --filter @reverie/web exec vite --config ../../design/studies/reading-life/vite.config.mjs
```

Open `http://127.0.0.1:4351/?skin=folio&mode=light`. The room and Day/Night selectors update both
views and the URL. Switch the sample reader to reset to an empty history or a settled library.
All edits are in memory and reset on refresh. The calendar is bounded to the sample year, 2026.

Try Reflect's period selection and book drilldowns, the private retrospective, and Plan's
queue/calendar, date precision, book picker, intention, ordering, removal, and undo. Same-day
plans open a complete list. Choosing an empty calendar day carries that date into the editor.
The two views share fictional history, not personal production data.

## Verification commands

```sh
pnpm exec tsc -p design/studies/reading-life/tsconfig.json
pnpm exec eslint --no-ignore design/studies/reading-life/main.tsx design/studies/reading-life/model.ts design/studies/reading-life/ReadingLifeStudy.tsx design/studies/reading-life/vite.config.mjs
pnpm exec prettier --check design/studies/reading-life design/DESIGN_BACKLOG.md
pnpm --filter @reverie/web exec vite build --config ../../design/studies/reading-life/vite.config.mjs
```

Build output goes to ignored `output/reading-life-study`. Local browser evidence goes to
`output/playwright/reading-life-*`. The initial study was design-only. The follow-up native-select
fix touches app CSS, so its validation also includes the full app gate and a fresh-database e2e run.
Before a full repository lint, move generated standalone build/verification JavaScript outside
the checkout; ESLint does not inherit the output directory exclusions from `.gitignore`.

## Assets and boundary

- Real token styles, skin fonts, room renderer, open-book mark, and accessible native-dialog shell
  come from the application. There is no new background framework.
- Public book facts and hotlinked covers come from the previous reviewed Discover study. Reading
  histories, progress, notes, and plans are explicitly authored fiction. No image bytes are copied.
- The layout is a proposed reading-journal composition. Production must use actual reading-log and
  plan persistence, existing completion flows, backup/offline boundaries, and account isolation.
- Private statistics stay private. No derived analytics sharing or download is introduced.

## Verified in this study — September 7, 2026

- Dedicated TypeScript, ESLint, Prettier, and standalone production build.
- Chromium interaction checks: period/drilldown agreement, undated all-time inclusion, unknown
  read format, DNF exclusion, retrospective scope, focus return after Escape, reordering,
  exact-day/month/year/Soon plans, intentions, remove/undo, date carry-through from the calendar,
  multiple books on one day, cancel, sparse scenarios, and refresh reset. Planning actions left
  the completed-reading totals unchanged.
- 48 axe WCAG A/AA and horizontal-layout checks: Reflect and Plan at 320/390/720/1440 pixels;
  both views in all nine rooms and both modes at 390 pixels; mobile editor, calendar, and two
  sparse states. No violations, overflow, or JavaScript page errors in the final sweep.
- The mobile editor uses 16px text and a 6px textarea radius. Reduced motion was enabled for the
  surface sweep, using the existing renderer's motion handling.
- Desktop and mobile screenshots were inspected. This is Chromium verification, not a claim of
  completed native Safari/Android or production persistence testing. Those are implementation gates.

## Native dropdown follow-up

The review exposed light room text inherited into a white operating-system option menu. The
shared app stylesheet now sets a select-only color scheme from the nearest resolved mode and
pairs `CanvasText` with `Canvas` for options and groups. Disabled options retain `GrayText` and
forced-color handling stays with the browser. Closed selects keep their room treatment.

Browser checks cover all nine rooms in both modes, a Day subtree inside a Night page, forced
colors, and native listbox keyboard selection. Native popup overlays are outside page captures;
listbox rendering provides a visual check of the same option colors, not a claim that an automated
axe scan inspected an operating-system popup. The CSS follows the browser's
[color-scheme contract](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/color-scheme).
