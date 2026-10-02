import { defineConfig, devices } from '@playwright/test'

// A SEPARATE runner for discovery audits, deliberately not part of `pnpm e2e`.
//
// ── WHY ITS OWN CONFIG ──────────────────────────────────────────────────────────────────────────
// An audit REPORTS; a spec ASSERTS. Mixing them breaks both. The main config's `rest` project
// selects by `testIgnore` — "a new spec added later lands in `rest` automatically instead of
// silently running nowhere" — so any file placed under e2e/ joins the gate by default. That default
// is right for guards and wrong for a sweep whose job is to print findings and exit 0: a green gate
// would then mean "the audit ran", not "the app is clean".
//
// The separation is by FILE SUFFIX, not directory, and that is what makes it hold. The main config
// sets no `testMatch`, so it inherits Playwright's default (`*.spec.ts` / `*.test.ts`), and
// `testDir: './e2e'` is recursive — a file at e2e/audits/foo.spec.ts WOULD be swept into `rest` and
// `mobile`. `.audit.ts` cannot match that default, so audits are excluded by construction rather
// than by an ignore list someone has to remember to extend.
//
// ── VIEWPORT ────────────────────────────────────────────────────────────────────────────────────
// No viewport in `use`: the sweep sets its own per-measurement via `page.setViewportSize`, since
// width is the axis under test. `isMobile`/`hasTouch` are off — Chromium's mobile emulation zooms
// OUT when a page overflows (honoring the meta viewport as a phone does), which moves `innerWidth`
// to match `scrollWidth` and would mask the exact symptom being measured. The sweep detects that
// zoom-out explicitly anyway (see the probe's `zoomed` finding), so both states are visible.
//
// Run it:  pnpm --filter @reverie/web exec playwright test -c playwright.audit.config.ts
const PORT = 4318 // NOT 4317 — so an audit can run beside the main suite without either adopting
// the other's dev server. Same --strictPort reasoning as the main config.
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  testMatch: /\.audit\.ts$/,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Long by design: the sweep is hundreds of navigations in ONE test, and a timeout mid-sweep
  // would truncate the findings list into something that looks complete and isn't.
  timeout: 45 * 60_000,
  // The discovery sweep saves incremental measurements and screenshots itself. A single trace
  // across hundreds of full reloads retains tens of thousands of development-module requests.
  // The ordinary regression suite keeps its per-test traces; this sweep uses the built client.
  use: { baseURL: BASE_URL, trace: 'off' },
  projects: [{ name: 'audit', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
