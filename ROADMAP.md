# Reverie Reads roadmap

Current product priorities updated 2026-09-08. This file is the ordered project status. Historical briefs remain in
`docs/archive/`; detailed proposals that are not yet active remain in `docs/backlog/`; only work
actually in flight belongs in `docs/tasks/`.

Priorities mean:

- **P0 — safety/blocker:** finish before the next product change or production-data write.
- **P1 — next:** the next product or engineering program after P0 is closed.
- **P2 — planned:** valuable work with no current blocking dependency.
- **P3 — deferred/monitor:** revisit on evidence, schedule, or an explicit owner decision.

## Active product program: Reflect and Plan

The owner approved the Reading Life study in public PR #471 and prioritized the Stats/Planner
fundamental overhaul. This sequence takes precedence over the September 5 product queue below:

1. **Shared history and Reflect — implemented and released.** Stats now uses a book-and-note
   opening, a single period for every summary, and drilldowns to real reading records. Planner
   shares the completion model. Undated reads, current DNF, and books marked read without logs
   remain distinct; there is no invented session or average rating.
2. **Plan — implemented for public review.** The flexible queue supports direct edit/remove/undo,
   saved ordering, optional intentions, and explicit undated “Soon” membership. It preserves
   year/month/day precision, existing calendar entries, backup/offline behavior, and atomic merges.
3. **Private retrospective and release horizon — implemented for public review.** Reflect now
   composes its selected-period summary into a private story with real covers and saved notes. The
   same record supplies every fact, uncertain return counts stay qualified, and the view has no
   derived analytics sharing/export. Public PR #482 added source-aware release discovery with
   honest date precision, provider provenance, manual entry, and no automatic reading plans.
4. **Reader validation and remaining arrangements work.** Return to the first-use/return-loop
   checks and modular arrangements after the paired reading experience is coherent.

[Implementation notes](docs/tasks/reading-life-implementation.md) record the data contract,
implemented persistence decisions, and release boundaries. Plan's migration changes stored
data/write behavior and therefore waits for the owner's human confirmation after public merge.

## Catalog quality follow-up

The cover review workspace merged in public PR #460/private PR #34. Catalog metadata review
merged in public PR #467/private PR #36; the owner reported its migration applied. The review
controls do not automatically curate the catalog. Remaining record assessments and identity
reconciliation are separate from the active reader-experience implementation.

The September 7 dropdown accessibility fix is merged publicly in #471. Its private synchronization
and web release are a separate release step from the new Reflect implementation.

## Production baseline recorded before this release

The original prototype-to-product roadmap is complete. Reverie Reads is a React/TypeScript,
Supabase-backed application at `reveriereads.app`, with authentication, personal libraries,
imports and exports, corpus-backed works and edition identity, enrichment and cover handling,
search and discovery, shelves, series tooling, planner/calendar, stats, Match, nine skins,
accessibility coverage, offline read caching, clubs/shared lists, and a read-only household view.

The 2026-09-04 structural audit recorded public `origin/main` at `333e3a8`. PRs #377–#397 established structured series
authority and source provenance, added safe corpus series classification and review, unified series
browsing with rename/merge/reversible removal, reconciled confirmed canonical defaults, and made
corpus cover recovery bounded and resumable, durable across navigation, and recoverable after a
workflow runtime failure. PRs #398–#401 then corrected landing assertions, surfaced production
search-provider failures, and completed the current nine-skin readability/control pass. The private
Pro overlay shipped connected-series universes with braided timelines and lifecycle editing, and
has continued to synchronize public releases. The owner deployed migrations through
`20260923010000`; Vercel Production points at private merge `edd1ccb`.

The structural report's runtime row initially observed one assigned corpus administrator. The
owner then ran the exact-roster operator for the two approved profiles: its dry run found one
existing grant, one addition, and no unexpected account; the owner executed that reviewed write,
and post-write verification confirmed both requested grants and the exact roster.

The household reconciliation is no longer an active release blocker. The owner accepted the
current production household outcome, while the evidence audit preserves the narrower truth: the
retained historical dry run was blocked with 10 unmatched identities, and no writable dry run,
transaction backup, or post-write verification artifact was found. See
`docs/audits/household-reconciliation-evidence-2026-09.md`.

The administrator corpus sweep is also operationally closed. Four works repeatedly returned as
eligible after deferred cover recovery; the owner directed that residue be parked rather than
rerun. They are not counted as filled or resolved and are not a release gate. Revisit them only
after their source/objective fingerprint changes, an administrator resolves them directly, or a
diagnosed pipeline defect makes another retry meaningful. The owner reports that the Hardcover
credential has been rotated; authenticated production search returned results without a surfaced
provider error, although that aggregate search check does not attribute the result to one provider.

## Ordered execution plan

### Current product queue after the app and landing redesign

Public PR #408 delivered the reading flow, navigation, and first-use improvements; PR #412 aligned
Home. Public PR #418 is merged and adds Midnight & Lamplight, a real temporary guest library,
the shared nine-room renderer, Discover details, and permanent personal-series removal. Its private
production release is in progress. Those implementations replace the earlier mockup-stage plans;
do not schedule them again because a historical brief still says proposed.

The September 5 order below superseded the older P2/P3 ordering; the active Reflect/Plan
program above now takes precedence. Discover’s guided experience subsequently merged in #444.
Safety regressions still take precedence. Keep one product implementation and one small reader experiment active at a time.

| Order | Priority  | Next outcome                                                            | Completion gate                                                                                                                                                                                                                                                                                                                               |
| ----: | :-------: | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 |    P1     | Finish the approved release and verify app/landing aesthetics           | Matching private production build; all nine rooms use the same scenes, typography, and shared book controls; phone/desktop signed-in views are checked. The series-removal migration follows its owner-operated production gate.                                                                                                              |
|     2 |    P1     | Keep a guest's chosen books, notes, and room through signup             | Explicit opt-in handoff, accurate preview/counts, duplicate and retry handling, cancellation and expiry, and a useful first reading action after authentication. Do not silently persist private guest notes or lose them behind a signup promise.                                                                                            |
|     3 | P1 design | Design modular library arrangements                                     | Reviewed mobile/desktop presets, dock/rail ordering, Home module choices, hide/restore/defaults, accessible controls, and account persistence rules. Account-level implementation stays a later reviewed change. See `docs/backlog/task-modular-library-arrangements.md`.                                                                     |
|     4 |    P1     | Make Discover worth spending time in                                    | First improve a bounded set of covers/descriptions and edition identity; preserve browse/filter/scroll context through addressable details; then add a few transparent author, feeling, or change-of-pace paths. Never infer genre from appearance or invent recommendation reasons.                                                          |
|     5 |    P1     | Validate the complete first-use and return loop with readers            | Begin with five observed usability sessions, then use the original small-cohort validation plan. Separate assisted actions from independent outcomes and return from prompted check-ins. Import/reimport, possession, retained history, and Back navigation issues outrank cosmetic expansion. No invitations are sent without authorization. |
|     6 |    P2     | Finish accepted brand assets and publish one accurate demonstration     | App/share icons and onboarding material follow Midnight & Lamplight; the clip uses the deployed guest experience and leads to a working destination. Publish only approved content, then judge useful outcomes rather than visits alone.                                                                                                      |
|     7 |    P2     | Implement the reviewed arrangements and only evidence-backed paid depth | Use the design and reader findings; retain Free's core library, nine rooms, accessibility, export, and correction. Verify paid purchase/entitlement/cancellation before selling a new promise. Expand only within the profitable-side-business operating envelope.                                                                            |

The separate series-source trial continues within its evidence and rights gates. Its results may
support catalog quality but are not automatic permission to write production classifications.
The four parked corpus works remain parked unless new evidence makes a retry meaningful.

### Completed foundation

The table below preserves the earlier dependency sequence. It is a completion record, not a second
active queue. Older production commit references above describe the September 4 baseline; current
release evidence will be recorded with the reading-room delivery.

| Order | Priority | Task                                                     | State                  | Dependency and completion gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----: | :------: | -------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|     1 |    P0    | Private recovery mirror and workspace audit              | Complete               | The private recovery mirror is verified and all local commits are archived. The first owner-approved safe pruning set removed 12 clean worktrees, three stale registrations, and one temporary audit directory without touching protected or review-required material.                                                                                                                                                                                                                                                                                   |
|     2 |    P0    | Retire vendor tooling and contributor metadata           | Complete               | Canonical refs, contributor surfaces, integrations, and repository metadata are clean. The owner deliberately preserved historical pull requests whose read-only refs cannot be rewritten; they are not active contributors or canonical refs. The obsolete local cleanup branch must not be merged. See `docs/backlog/task-contributor-history-cleanup.md`.                                                                                                                                                                                             |
|     3 |    P0    | Prune redundant worktrees and app-related `dev/` folders | Complete               | Both safe sets are complete. Distinct environment files were preserved outside Git with owner-only permissions, redundant worktrees and stale registrations were removed, and local `main` was realigned exactly to rewritten `origin/main` without merging unrelated history.                                                                                                                                                                                                                                                                           |
|     4 |    P0    | Build independent, corpus-preserving library membership  | Complete               | PRs #364–#366 integrated the reviewed bounded backfill, corpus-admin preservation, ACL repair, and operator boundaries. All three migrations are deployed; the production report returned 43/43 true, and the covers function passed the owner’s refresh-persistence smoke check. See `docs/queries/library-membership-rollout-verification.sql`, `docs/tasks/task-library-removal-and-reconciliation.md`, and `docs/tasks/task-corpus-admin-enrichment.md`.                                                                                             |
|     5 |    P0    | Owner-library backup and CSV reconciliation              | Owner-accepted closure | The current production household outcome is accepted and no longer blocks product work. The retained dry run still had 10 unmatched identities and `canWrite = false`; no writable dry run, transaction backup, or post-write verification artifact was found. The roadmap therefore records operational acceptance, not a verified checksum-bound reconciliation. See `docs/audits/household-reconciliation-evidence-2026-09.md`.                                                                                                                       |
|     6 |    P1    | CI/CD value and reliability review, then simplification  | Complete               | PR #374 reduced active pull-request checks from eight to six while preserving types, formatting, secrets, database/RLS, accessibility, and critical browser behavior. The corrected live run passed every retained boundary. See `docs/audits/ci-cd-simplification-2026-08-30.md`.                                                                                                                                                                                                                                                                       |
|     7 |    P1    | Series truth and library-experience overhaul             | Complete               | PRs #377–#386 shipped provenance, structured membership authority, source-backed corpus classification and review, a dedicated series experience, rename/merge/reversible removal, and confirmed-default reconciliation. The private Pro overlay adds connected-series universes without weakening public series truth.                                                                                                                                                                                                                                  |
|     8 |    P1    | Landing-page capability and brand redesign               | Complete               | PRs #388–#389 shipped the capability-led landing foundation and approved nine-reading-rooms direction. PRs #394 and #401 then unified landing/app skin behavior and completed the current readability/control polish. The page uses curated fixtures—never private production data—and demonstrates personal context, household identity, reviewed series truth, taste-led discovery, and the nine skins across responsive layouts. See `docs/audits/landing-capability-claims-2026-09.md` and `docs/backlog/task-landing-capability-brand-redesign.md`. |
|     9 |    P1    | Canonical shared-series catalog                          | Complete               | PR #390 shipped stable shared series identity, aliases, provider ids, ordered linked/unbound slots, revision-checked administrator lifecycle controls, a signed-in shared browser, and an audit trail. Migrations through `20260920020000` are live and private PR #9 synchronized the feature into the Pro repository. Later PRs #396–#397 added independent reading order and safer reviewable editing. See `docs/decisions/0008-canonical-shared-series-catalog.md`.                                                                                  |
|    10 |    P1    | Durable shared corpus and series completion              | Complete with residue  | PRs #392–#395 made runs durable, recoverable, and independent of deferred cover batches; PR #400 exposed provider failures instead of silently presenting an empty result. Four repeatedly deferred works are parked by owner decision and are neither counted as filled nor an active retry/release gate. Resume only on new evidence or a diagnosed defect.                                                                                                                                                                                            |

## P2 — planned product and reliability work

The signed-out and accessibility coverage item is complete. `a11y.spec.ts` scans the landing page,
the complete skin-character lab, sign-in, sign-up, expired-link, and password-recovery states with
axe; the registry-backed sweep covers every skin in both modes. `landing.spec.ts` separately proves
the desktop and mobile product stages, 390px viewport containment, touch-sized navigation, and
reduced motion. Placeholder contrast remains guarded across every skin/mode/accent combination in
core, while rendered no-cover imports retain browser-level axe coverage. Keep these tests; closing
the roadmap item does not remove or weaken the regression boundary.

The remaining items are ordered within P2, but they do not block the P0/P1 sequence above.

1. **Deploy/CI safety residue.** Address production RPC ACL verification, the deploy guard's
   duplicate confirmation, bounded Supabase-start recovery/cleanup, e2e TypeScript coverage,
   resilient fixture cleanup, Deno-function execution coverage, and useful/non-corrupt browser
   artifacts as narrow follow-ups. The check-topology simplification itself is complete; do not
   reopen it as a second redesign without new evidence. The deploy guard's downstream confirmation
   ambiguity is closed: after its human `y/N`, it explicitly acknowledges the CLI prompt instead of
   depending on EOF-as-consent.
2. **Spine reveal band.** Implement the already-decided shared, fixed-height reveal band only after
   revalidating `docs/tasks/task-spine-reveal-band.md` against the current UI.
3. **Calendar/Releases cluster.** The sparse calendar pass shipped. Revalidate the remaining
   Calendar/Releases route, density, mobile, and heatmap decisions in
   `docs/tasks/task-calendar-cluster-scope.md` before another implementation branch.
4. **Library state and synchronization.** Decide URL precedence for filters; fix realtime lifecycle
   across sign-out and assess personal-book/list subscriptions. Treat a true offline write queue as
   its own subsystem, not a quick caching patch.
5. **Reader safeguards and polish.** The restore preflight with real counts and the fresh-device
   appearance handoff are complete. Resolve dense-grid state indicators and convert the remaining
   risky literal glyphs to controlled SVGs. See `docs/tasks/restore-preflight.md` and
   `docs/tasks/fresh-device-appearance.md`.
6. **Reading progress.** Decide whether percent-only progress is sufficient; pages/chapters require
   schema, import/export, stats, and UI semantics together.
7. **Cover pipeline efficiency.** Remove repeated image decodes only after measuring CPU/memory and
   preserving current cover-quality guards.

## P3 — deferred, scheduled, or evidence-triggered

1. **Discover re-curation:** measure the four curated categories before the first six-month refresh;
   use `docs/tasks/task-discover-recuration.md`. Do not build a standing feed without a separate
   product/monetization decision.
2. **iOS barcode fallback:** revisit when tester/browser evidence justifies shipping a WASM decoder;
   the current unsupported-browser fallback is deliberate.
3. **Year heatmap, dedicated Wrapped experience, Cover Studio, author following, bulk trope tagging,
   unattended bidirectional whole-library household sync, app-store packaging, social discovery,
   and premium corpus freshness:** separate product decisions, not launch blockers. Explicit Add and
   import destinations plus opt-in neutral peer-library additions are implemented; the deferred item
   is automatic synchronization, not reader-chosen placement.
4. **Dead-code/tooling sweep:** consider a narrowly configured `knip` pass after CI simplification;
   do not add another permanent gate merely because a one-time audit is useful.
5. **Historical global-cover objects and licence review:** owner/data decisions; code sessions must
   not infer production counts or delete stored objects.
6. **Flake watch items:** investigate recurrence with the existing failure ledger; do not rerun a
   red job until green or raise timeouts without a diagnosed mechanism.
7. **Three-reader corpus-trope voting:** design proposal identity, unique-voter evidence, threshold
   semantics, abuse controls, correction/retraction, and privacy as one reviewed feature. An
   accepted vote should call the existing additive promotion boundary with `source_scope = 'vote'`;
   do not simulate voting by weakening the administrator check or counting household JSON values.

## Rules that apply to every item

- Corpus, household, and personal membership have independent lifecycles. Removing a personal book
  must preserve existing household membership and shared work, edition, contributor, and ISBN data;
  removing a household book must preserve every personal library and the corpus.
- Book edits are scoped: explicit household-owner/corpus-administrator edits update canonical
  series, genre, publication, and reviewed cover fields; household tags, tropes, and similar shared
  enrichment update the household overlay; possession, wishlist, reading, rating, notes, progress,
  favourites, and lists remain personal. A service-granted corpus
  administrator's newly added personal or household trope is also promoted additively to the
  canonical work. The deferred three-reader mechanism may authorize ordinary-reader promotion
  later, but does not weaken the current admin-only boundary.
- Production-data changes require a scoped backup, a deterministic dry-run, explicit owner review,
  and post-write verification. Code sessions do not write production data.
- Re-check task text against the current tree and `origin/main`; historical confidence is not
  current evidence.
- Use one focused branch per reviewable outcome. No merge, deployment, history rewrite, branch
  deletion, or directory pruning without its own verified gate and owner authorization.
