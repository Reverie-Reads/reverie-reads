# Design backlog — design tool deliverables

> **These statuses age. Verified 2026-08-18** (backlog verification pass), entry by entry, against
> `origin/main` — content read via `git show origin/main:<path>` and shipped-ness by ancestry
> (`git log origin/main -- <path>`), never by a PR badge or the working tree. Six entries had gone
> stale between passes; the landing-page entry alone sat as "blocks public launch" through five
> iterations of the shipped page. If you are planning against this file and the date above is old,
> re-verify the entry you're about to build before building it. This file is the canonical copy;
> `docs/backlog/DESIGN_BACKLOG.md` is a pointer here (it had drifted as a stale duplicate).

Outputs land in design/from-design-tool/<set>/ (code export + screenshots). coding agent implements
against them on the token system (no hardcoded colors from the mockup).

## Current design queue — 2026-09-06

The approved Midnight & Lamplight brand, authored reading rooms, working guest library, and
account arrangements are on public main. This queue was refreshed against public `dc24877`;
the historical sections below retain their own verification dates. Current execution order
lives in `ROADMAP.md`.

1. **MODULAR LIBRARY ARRANGEMENTS — IMPLEMENTED.** Public PR #441 (`ab732ee`) adds account
   persistence and **Settings → Arrange Reverie**, with accessible navigation/Home ordering,
   hide/restore, preview/reset and the deliberate guest handoff. See
   `MODULAR_LIBRARY_ARRANGEMENTS.md` and `docs/backlog/task-modular-library-arrangements.md`.
   Keep atmosphere and recommendation scope independent of arrangement preferences.
2. **DISCOVER AS A READING DECISION — APPROVED, IMPLEMENTED IN PR #444.** The authenticated
   page now follows the study's three guided paths, bounded catalog choices, book details,
   independent copy relationships, dismiss/undo, and private saved shortlists. The original
   [interaction specification](studies/discover/DISCOVER_READING_DECISION.md) remains the design
   reference. [Implementation notes](../docs/tasks/discover-implementation.md) record the source
   evidence, account/backup boundaries, and release checks. Future matching improvements should
   be measured against useful selections, not a larger feed or unverified explanations.
3. **ACCEPTED BRAND ASSETS — P2.** Carry the approved open-book mark and typography into app/share
   icons, onboarding material, and one accurate demonstration. Preserve each room's own interface
   language. Do not reopen the chosen palette as a new concept exercise.

## Reopened by owner — 2026-08-25

- **LANDING / MARKETING PAGE REDESIGN — P1 after the series overhaul.** The existing page shipped
  and remains the production baseline, but it is no longer the final product direction. Re-audit
  the app's complete current capability set before designing; derive the page's visual language
  from the authenticated product; use warm, personal Reverie voice; and show accurate glimpses made
  with curated fixture data rather than private production data. Do not invent features or preserve
  stale screenshots. The result must cover responsive layout, accessibility, performance, SEO,
  sign-in/get-started paths, and claims accuracy. Ordering and completion gates live in `ROADMAP.md`.

## Done — verified shipped on main, 2026-08-18

- ONBOARDING / FIRST-RUN — DONE, shipped (6578e51 `feat(onboarding): first-run flow`, iterated
  since). apps/web/src/routes/OnboardingRoute.tsx, registered in router.tsx: stepped stage with
  progress dots, genre→skin pick straight from the registry (live re-skin on pick), CSV/Excel
  import with duplicate review, import summary and enrichment. Design handoff was
  design/from-design-tool/onboarding/HANDOFF.md (gitignored working-tree export).
- AUTH SCREENS — DONE, shipped (895320d `feat(auth): landing + password/social auth front door`,
  same commit family as the landing; iterated since). apps/web/src/auth/AuthScreen.tsx: sign in /
  sign up / forgot with reset-sent and verify-email confirmation states, plus OAuth providers, on
  the gold brand. Design handoff was design/from-design-tool/auth/HANDOFF.md.
- ACCOUNT & DATA SCREENS — DONE, shipped. apps/web/src/routes/SettingsRoute.tsx carries the full
  set: JSON library export (buildBackup), CSV/Excel import, a "Your data & privacy" summary
  section, and delete-account with typed confirmation (`delete my account`) through
  data/account.ts.
- SKIN DIVIDER MOTIFS — DONE for all nine skins. components/SkinDivider.tsx holds a
  `Record<SkinId, ReactNode>` of motifs — the type does not compile with one missing. The five
  named here pre-build (Calliope / Mull / Compendium / Clew / Fledge) were working names for what
  shipped as umbra / folio / hearth / almanac / bloom.
- SKIN GALLERY — already BUILT in code (C3). Prompt exists (DESIGN_PROMPT_SKIN_GALLERY.md)
  if a visual polish pass is ever wanted; not required.
- DESKTOP — DONE -> design/from-design-tool/desktop/. Skin-agnostic shell on the token contract.

## Partial — some shipped, remainder named

- WRAPPED — the app ships a private stats dashboard titled "Your Reading, Wrapped"
  (routes/StatsRoute.tsx: year selector, stat tiles, month-by-month, genres, rereads), and the
  landing's privacy copy correctly describes it as private. What has NOT shipped is a dedicated
  "your reading year as art" experience distinct from the dashboard. Whether the design tool
  screens (prompt: DESIGN_PROMPT_WRAPPED.md) ever came back is unverifiable from the tree —
  design/from-design-tool/ is gitignored except its README. If the screens exist in Greg's
  working tree, this is implement-next; if not, still in flight on the design side.
- COVER STUDIO — per-book cover picking shipped (components/CoverPicker.tsx); the studio surface —
  batch triage of missing/low-confidence/broken covers, photograph-your-copy — has no route or
  component. PROMPT WRITTEN -> design/DESIGN_PROMPT_COVER_STUDIO.md. Scope in
  docs/reference/COVER_SOURCING_AND_STUDIO.md. Needs its own look before any build.

## Next

1. MOBILE PASS — confirm mobile-specific screens (scan flow, mobile nav) are covered by design;
   this build was desktop-first on the design side (the app itself is mobile-first per
   conventions, and the scan flow ships in AddRoute). A design-coverage check, not a code gap —
   unverifiable from the tree by nature.
