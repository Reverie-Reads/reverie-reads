import { defineConfig, devices } from '@playwright/test'

// ── Stack-lock enforcement: refuse to run outside the lock ─────────────────────────────────────
// scripts/stack-lock.sh's own header names this as a documented, deliberately-scoped-out gap:
// `npx playwright test` invoked directly bypasses the lock entirely, because the lock wraps
// `playwright test` as a whole (`pnpm e2e` → `bash scripts/stack-lock.sh playwright test`) and
// nothing stops a caller from reaching past the wrapper to the binary underneath. Two sessions
// did exactly that and collided on the fixed port 4317 below (webServer's `--strictPort` means
// the loser gets ERR_CONNECTION_REFUSED on every test, not a clean failure) — CI passthrough only
// ever needed to ANNOUNCE "not locking," never PROVE it didn't need to.
//
// This config file is loaded on every invocation of `playwright test` — `npx`, bare, `pnpm exec`,
// or the wrapped `pnpm e2e` — so the check belongs here, not only in the wrapper: the wrapper is
// bypassable by reaching past it, config-loading is not. `scripts/stack-lock.sh` sets
// RV_STACK_LOCK_HELD=1 for the whole process tree it wraps (its own re-entrancy guard, documented
// in its header) — that is also exactly the signal this needs. CI is exempt for the same reason
// stack-lock.sh exempts it: a dedicated runner has nothing to serialise against.
//
// Defense in depth, not redundant with `.agent-tooling/hooks/pretooluse-guard.sh`: that hook only fires
// for coding agent sessions issuing a Bash tool call. This fires for anything that loads this
// file — a human's own terminal included.
if (!process.env.CI && process.env.RV_STACK_LOCK_HELD !== '1') {
  console.error(
    [
      '',
      'playwright.config.ts: refusing to run — not under scripts/stack-lock.sh.',
      '',
      '  This suite always binds the fixed port 4317 (strictPort, reuseExistingServer: false — see',
      '  the PORT comment below), so a second unguarded run collides with whatever already holds',
      '  it instead of failing cleanly. Run it through the lock instead:',
      '',
      '      pnpm e2e                          (from the repo root)',
      '      pnpm --filter @reverie/web e2e     (from anywhere, e.g. CI)',
      '',
      '  Both forward flags, e.g. `pnpm e2e --project=rest`.',
      '',
      '  Deliberate raw run, typed not defaulted: RV_STACK_LOCK_HELD=1 npx playwright test ...',
      '',
    ].join('\n'),
  )
  process.exit(1)
}

// A dedicated, unusual port so the suite can never adopt a stray dev server (e.g. another local
// project squatting Vite's default 5173) and silently test the wrong app. Three guards:
//  - the pinned port below is shared by baseURL and webServer.url;
//  - `--strictPort` makes Vite abort loudly if 4317 is taken instead of drifting to the next free
//    port (which is how a foreign server slips in);
//  - `reuseExistingServer: false` means Playwright always boots its own Reverie server, never an
//    existing one — even in local runs.
const PORT = 4317
const BASE_URL = `http://localhost:${PORT}`

// Worker count is a CAPACITY setting, not a correctness one — hence an env var rather than a new
// hardcoded number, because a CI runner's capacity is not this machine's.
//
// It used to default to Playwright's own choice, which is half the cores: 4 on the 8-core box this
// suite is developed on. That saturated it. Four Chromiums plus axe plus the Vite dev server plus
// the Docker Supabase stack do not fit in 8 cores, and the suite failed nondeterministically for
// the whole of one development arc — measured at 8 failures per run across two runs, six of them
// overlapping, none of them attributable to one worker changing another's rows. The symptoms were
// saturation throughout: PostgREST answering `PGRST002 Could not query the database for the schema
// cache`, GoTrue returning empty sign-in failures, and ordinary round-trips missing 15–20s budgets.
//
// Measured on this box, fresh DB before every run, retries 0:
//
//   workers=1   3 runs, 3 green            mean 6.3m   ← default
//   workers=2   5 runs, 4 green            mean 5.7m
//   workers=3   1 run,  1 green                 5.2m
//   workers=4   3 runs, 0 green            (8, 8 and 3 failures)
//
// One is the default because parallelism buys almost nothing here and costs reliability. The a11y
// sweep alone is ~4.4m and is the wall-clock floor regardless of worker count, so serializing the
// entire rest of the suite costs only ~36s (~10%: 6.3m vs 5.7m) — and at workers=2 that ~10% bought
// a run that still failed one time in five. Going past 2 buys no speed at all while going red.
//
// The failure that survived workers=2 was NOT contention between arbitrary specs — it was a11y and
// cover-sheet, specifically, racing each other for the one seeded dev account they both sign in as:
// a11y holds one worker for the whole sweep while cover-sheet runs concurrently against the same
// rows. workers=1 dissolved that by serializing everything; it didn't fix the underlying sharing.
//
// The real fix — migrating a11y/fonts/cover-sheet to per-file users (test/trio-migration) — has
// landed. chore/ci-throughput then did the dedicated post-trio measurement, ON THE RUNNER
// (ubuntu-latest, full suite = all three projects sharing one worker pool, fresh DB per run,
// retries 0, three runs per worker count):
//
//   workers=2   3 runs, 0 green   ~19m/run   1 failure per run, every one a timing-sensitive
//                                            spine-shelf guard (2× the tracking guard's sample
//                                            floor — 15 of the required >50 mid-motion frames
//                                            survived the stall filter under load — 1× the
//                                            cover-aspect pointer-pick). ZERO database or
//                                            app-functional failures.
//   workers=4   3 runs, 0 green   ~16m/run   genuine saturation: the a11y sweep exceeded its
//                                            600s test timeout in all three runs, plus
//                                            page.goto ERR_ABORTED — the pre-trio symptom class.
//
// So the trio migration DID clear the database-sharing blocker (no 25P02, no PGRST002, no
// cross-spec row contention anywhere in six runs — the laptop's seed-saturation and
// cover-sheet-race modes did not reproduce on the runner), but what it exposed underneath is a
// different ceiling: the spine-shelf feel guards measure per-frame timing, and a loaded worker
// pool starves their samplers before it breaks the app. workers=4 additionally saturates the
// runner outright. The default therefore STAYS 1 — not because parallel workers corrupt shared
// state any more, but because the suite's own instruments stop being able to measure under load,
// and a guard that can't reach its sample floor is a guard that can't certify anything.
// Raising this again means first making those samplers load-tolerant (or per-project measurement
// on dedicated runners, the untested lighter shape) — its own stage, measured on its own.
const WORKERS = Number(process.env.E2E_WORKERS ?? 1)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  workers: WORKERS,
  reporter: 'list',
  // ── RETRIES: 1 ON CI, 0 LOCALLY — overturning "retries STAY 0", deliberately ──────────────────
  // The rule this replaces read: "Retries STAY 0 — this suite exists to measure flake, not to
  // absorb it." The intent was right and the mechanism was wrong: it CONFLATES DETECTING flake
  // WITH GATING ON IT. Playwright reports a test that fails then passes on retry as `flaky`, not
  // `passed`, so detection survives a retry completely. `retries: 0` was never what measured flake;
  // it was what BLOCKED on it — a much weaker claim, and the one that stopped being worth its cost.
  //
  // What it was costing, measured rather than asserted: `spine-shelf-reachability.spec.ts:477`
  // ("cover aspect") failed run 32104816007 on PR #271 — a branch touching ZERO app source (docs,
  // AGENTS.md, and a `.audit.ts` the main config cannot even match), whose app code was
  // byte-identical to a `main` that had passed twice in the preceding hour. The same spec and the
  // same test had gone once before, run 31053864700. It passes locally 12/12. A hover lands, the
  // wave settles on a neighbouring book, and a 5s poll never converges.
  //
  // WHAT KEEPS THIS FROM BECOMING A WAY TO STOP LOOKING, which is the real risk: every occurrence
  // goes in `docs/backlog/BACKLOG.md`'s "Known-flaky, with a prior" ledger, whose own standing rule
  // is that A SECOND FAILURE IS A DEFECT, NOT A FLAKE. This test is recorded there with both of its
  // occurrences, so the next one is a defect by that ledger's standard and is not something to
  // re-run past. Retries end the gating; the ledger keeps the counting.
  //
  // Local stays 0: locally a red run is read immediately by the person who caused it, and there is
  // no merge to block. The cost only exists on CI.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: BASE_URL,
    // `retain-on-failure` is KEPT, and it is now the better choice rather than merely the only one.
    // The original note said `on-first-retry` "was inert here: retries are 0, so there is never a
    // first retry" — true then, false now. Re-checked against the new config rather than left to
    // describe a config that no longer exists: with retries at 1, `on-first-retry` would capture
    // only the SECOND attempt, and a flake's first attempt — the one that actually failed and the
    // only one carrying the evidence — would have no trace. `retain-on-failure` keeps the trace of
    // any attempt that failed, including the failed first attempt of a test that then passes.
    trace: 'retain-on-failure',
  },
  // Three projects. `pnpm e2e` with no --project flag runs ALL THREE, in this same process, so
  // local behavior needs no flag; CI passes --project explicitly per job. `testIgnore` on `rest`
  // rather than an enumerated file list, so a new spec added later lands in `rest` automatically
  // instead of silently running nowhere.
  //
  // `mobile` re-runs a CURATED SUBSET of `rest` at a touch viewport — not everything, and not a
  // blanket duplicate. Criterion: run a spec on mobile unless its assertions are themselves ABOUT
  // a desktop-only pointer mechanic — mouse-drag reorder (series-builder.spec.ts uses raw
  // page.mouse.move/down/up, which is a real desktop gesture, not dnd-kit's touch-capable
  // PointerSensor exercised through touch input) or native HTML5 <img draggable> drag-hijack
  // prevention (shelf-regressions.spec.ts). Both land on SpineShelf, but that exclusion is about
  // those SPECS' own desktop-only gesture, not an open defect — SpineShelf's mobile touch-scroll
  // reachability bug (docs/audits/mobile-shelf-interaction.md Defect A) shipped (#142, #148, #149)
  // and is guarded by spine-shelf-reachability.spec.ts's per-frame invariance test, which DOES run
  // on `mobile`. Everything else — forms, CRUD, imports, routing, offline cache, cover
  // sourcing — exercises the same click/fill/navigate primitives on both viewport sizes and is a
  // real mobile regression surface, so it runs on both. `a11y` stays desktop-only: it already
  // sweeps all nine skins × modes and adding a viewport axis belongs to a decision about a11y's
  // own scope, not this one.
  //
  // Descriptor: iPhone-class touch (isMobile, hasTouch, iPhone 13's UA/DPR), but with the VIEWPORT
  // pinned to 390×844 (not iPhone 13's stock 390×664, which subtracts Safari's own chrome) so it
  // matches the exact size the mobile-shelf-interaction audit measured against — and with
  // `defaultBrowserType` forced back to 'chromium'. `devices['iPhone 13']` sets it to 'webkit',
  // and Playwright's browserName fixture reads that field directly — spreading the device as-is
  // would silently add WebKit as a second browser engine, which CI does not install
  // (`playwright install --with-deps chromium` only, ci.yml:149/224) and which this branch is not
  // the place to decide to add.
  projects: [
    { name: 'a11y', testMatch: /a11y\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    { name: 'rest', testIgnore: /a11y\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      // ── An ALLOWLIST, not a blocklist — and that inversion is a decision, recorded ─────────────
      // This was `testIgnore: /a11y|series-builder|shelf-regressions/`, i.e. "run everything at
      // 390×844 unless it is a desktop-only pointer mechanic", per docs/audits/e2e-mobile-viewport.md
      // §2. That criterion made this project 32 of `rest`'s 34 spec files — 121 of 130 tests, 94% —
      // and the second-longest job in the suite at 10.7m median.
      //
      // The CI cost/value audit (docs/audits/ci-suite-cost-value-audit.md §7.2) measured what that
      // bought over 17 days: `e2e-mobile`'s ONLY unique catches were route-viewport (#140) and
      // spine-shelf-reachability (#148, #149). Its other three reds duplicated failures `rest`
      // caught in the SAME run. And e2e-mobile-viewport.md's own §4 found zero mobile-only failures
      // at introduction, concluding the CRUD/import/routing/offline-cache surface is "provably
      // viewport-agnostic today" — re-running a provably viewport-agnostic surface is redundant by
      // that document's own finding.
      //
      // So the list below is every spec whose assertions actually depend on the viewport, checked
      // against what each one asserts rather than what its name suggests. Two corrections came out
      // of that check and are worth keeping visible: `tab-routing.spec.ts` was proposed and DROPPED
      // (it is about route state vs useState across back-navigation — zero viewport dependence),
      // and `shelf-header-links.spec.ts` was NOT proposed and is INCLUDED (it clicks real
      // coordinates via boundingBox + page.mouse.click and explicitly handles a header below the
      // viewport bottom).
      //
      // What this gives up, stated so it is not discovered later: a regression that manifests ONLY
      // at 390px in a spec outside this list no longer fails the PR. There is no instance of one in
      // 17 days of history, nor at introduction. e2e-mobile-viewport.md §3's own preferred fallback
      // — run the full mobile matrix nightly rather than at PR time — remains the cheapest way to
      // buy that back, and is left as the owner's call rather than taken here.
      //
      // `series-builder` and `shelf-regressions` stay out for the unchanged reason: their drags are
      // literal desktop mouse gestures, so passing here would prove the mouse path works, which is
      // already proven, and say nothing about touch.
      name: 'mobile',
      testMatch:
        /(spine-shelf-reachability|route-viewport|no-horizontal-overflow|placeholder-title-clip|cover-card-touch-affordance|star-touch-targets|scroll-restoration|shelf-header-links|household-library)\.spec\.ts$/,
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
        defaultBrowserType: 'chromium',
      },
    },
    // ── layout-390: the on-demand 390px LAYOUT sweep — absent unless asked for ──────────────────
    //
    // The old blocklist project (everything except a11y and the two mouse-gesture specs), kept as
    // a dispatch-time sweep after the allowlist above shrank the PR-time project to seven specs.
    // What the allowlist gave up — "a regression that manifests ONLY at 390px in a spec outside
    // this list no longer fails the PR" — this buys back on demand, via the layout-sweep-390
    // workflow (which owns the full reasoning for why it is dispatch-only, never a cron).
    //
    // ENV-GATED, and that is load-bearing: `pnpm e2e` with no --project flag runs ALL projects in
    // one process (see the note at the top of `projects`), so an unconditional fourth project
    // would silently add ~10.7m to every local full-suite run and to CI's `e2e` job — a cost paid
    // by everyone forever for a job that runs occasionally. With the var unset this project does
    // not exist: 3 projects without, 4 with, verified via `playwright test --list`.
    //
    // testIgnore (a blocklist), not testMatch: a NEW spec is swept by default, which is the point
    // of a sweep. `series-builder` and `shelf-regressions` stay out for the unchanged reason:
    // their drags are literal desktop mouse gestures, so passing at 390px would prove the mouse
    // path works, which is already proven, and say nothing about touch. Same viewport contract as
    // `mobile` above, including the forced 'chromium' (spreading iPhone 13 unmodified would switch
    // the engine to WebKit — probed and closed 2026-08-19).
    ...(process.env.LAYOUT_SWEEP_390 === '1'
      ? [
          {
            name: 'layout-390',
            testIgnore: /(a11y|series-builder|shelf-regressions)\.spec\.ts$/,
            use: {
              ...devices['iPhone 13'],
              viewport: { width: 390, height: 844 },
              defaultBrowserType: 'chromium' as const,
            },
          },
        ]
      : []),
  ],
  webServer: {
    // Local .env.local may enable live error reporting. Automated guest-library checks must
    // exercise the no-write path and never publish their deliberate failure fixtures to Sentry.
    // The monitoring unit tests still verify capture/scrubbing behavior independently.
    env: { VITE_SENTRY_DSN: '' },
    // Runs from this config's dir (apps/web), so `pnpm dev` boots @reverie/web with its own env
    // files (the committed .env; .env.local overrides if present). The port/strictPort flags override vite.config's default 5173 for e2e only —
    // the normal `pnpm dev` workflow keeps 5173.
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
