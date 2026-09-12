import { configureReturningReader } from '../support/readerGuidance'
import { expect, test, type Page } from '../support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from '../support/authError'
import { keepOfflineCacheEmpty } from '../support/offlineCache'
import { ok, okUser } from '../support/ok'
import { SKIN_ORDER, type SkinId } from '@reverie/core'
import { mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

/**
 * SURFACE MIGRATION — per-site visual baseline and diff.
 *
 * Batch 0's instrument. Run it on `main` to capture a baseline, run it again after each migration
 * batch, and it reports WHICH SITE changed rather than "N pixels differ".
 * Scope, batching and the reasoning: `docs/audits/surface-primitive-scope.md`.
 *
 * ── WHY THIS IS AN AUDIT AND NOT A SNAPSHOT GATE ────────────────────────────────────────────────
 * Deliberately NOT `toHaveScreenshot` in `pnpm e2e`. A snapshot suite that runs on every PR goes
 * stale, gets a blanket `--update-snapshots` the first time an unrelated change moves a pixel, and
 * from then on certifies nothing. `.audit.ts` cannot match the main config's default `testMatch`, so
 * this is opt-in per batch and a green `pnpm e2e` keeps meaning "the guards passed".
 *
 * ── WHY PER-SITE CROPS AND NOT FULL PAGES ───────────────────────────────────────────────────────
 * A full-page diff goes red the moment any unrelated content shifts — a different seeded book, a
 * changed count, a re-wrapped line — and then the signal has to be re-established by eye every time.
 * Cropping each surface's own bounding box keeps a difference attributable to one migrated site.
 *
 * ── THE LIMIT, STATED UP FRONT ──────────────────────────────────────────────────────────────────
 * A pixel diff answers "did this change", never "is the change correct". A genuinely improved radius
 * and a regression are the same red. This narrows where to look; a person still rules.
 *
 * ── THE BASELINE IS NOW TRUSTWORTHY — what the residual was, and how it was closed ─────────────
 * Two identical runs used to report a shifting set of crops as "changed", and four hypotheses had
 * already been eliminated with measurements (motion — ruled IN and fixed, 52/62 -> 3-6; the star
 * field — ruled OUT; per-render CONTENT — ruled OUT, outerHTML byte-identical on every changed crop;
 * SUB-PIXEL GEOMETRY — ruled OUT, getBoundingClientRect identical to 3dp). Same DOM, same geometry,
 * same fonts, different bytes. The answer was inside the pixels, and needed a decoder to see.
 *
 * With `pngjs` the residual resolved into two populations, neither of which any of those four
 * eliminations could have found:
 *
 *   1. THE AMBIENT MATERIAL — the dominant cause, and now fixed. Every skin sets --ambient-texture
 *      to an SVG feTurbulence fractalNoise filter, rasterised into .rv-skin-texture behind all
 *      content. Chrome re-rasterises that procedural noise per run and dithers it to 8-bit with an
 *      unstable phase. Measured over 570 crops: 41 changed, maxΔ of 1 on 40 of them; the worst case
 *      (/shelves' empty-state panel, in ALL 18 skin x mode combinations) had 23-36% of its pixels
 *      differing by exactly one level in an alternating even/odd column pattern — a dither matrix
 *      shifting phase, not content moving. `freezeMotion` now hides that layer, the same way and for
 *      the same reason it already hid the star field. 41 -> 9.
 *
 *   2. CORNER ANTI-ALIASING — irreducible, and handled by a floor rather than a fix. The remaining 9
 *      are the four rounded corners of /match's answer-button panel: <= 33 pixels each, maxΔ <= 2,
 *      mid-tones between border and fill. Skia rasterising a curve the surface genuinely has. See
 *      the note above `pixelDelta` for the floor and why both of its conditions are needed.
 *
 * Result: 41 of 570 -> 0 reported changed between two identical runs, with the 9 anti-aliasing crops
 * listed under their own heading rather than silently dropped.
 *
 * THE FONT GUARD IS LOAD-BEARING NOW: with the suite's font stub removed (fonts self-hosted),
 * `fontsSettled()` is what keeps a capture from racing a real face's load. Its old caveat — that
 * under the stub it was probably vacuous — resolved in the direction it predicted.
 *
 * ONE GAP LEFT OPEN DELIBERATELY: `stub()` does not stub cover images, so this harness still makes
 * live requests to the seeded covers' 13 third-party hosts. It was NOT the residual — 0 of the 41
 * changed crops contained an <img> at all — but it is the same exposure that took e2e-a11y red five
 * times, and `support/fixtures.ts` gaining a suite-wide image stub closes it here for free.
 *
 * ── RUN IT ──────────────────────────────────────────────────────────────────────────────────────
 *   # on main, before any migration:
 *   pnpm --filter @reverie/web exec playwright test -c playwright.audit.config.ts \
 *     --grep "surface visual" -- --baseline
 *   SURFACE_BASELINE=1 pnpm --filter @reverie/web exec playwright test \
 *     -c playwright.audit.config.ts --grep "surface visual"
 *
 *   # after a batch, on the batch branch (compares against the stored baseline):
 *   pnpm --filter @reverie/web exec playwright test -c playwright.audit.config.ts \
 *     --grep "surface visual"
 */

/**
 * reducedMotion is not a nicety here — it is what makes the baseline mean anything. The ambient
 * night sky (`rv-anim`: drift + twinkle) renders BEHIND every surface, and `--card` carries alpha in
 * most skins, so a translucent card shows a moving sky through itself. Measured: without this, a
 * re-capture with NO code change reported 52 of 62 crops as "changed" — the instrument reading its
 * own animation. The app already disables that drift under `prefers-reduced-motion` (a11y
 * requirement), so this rides an existing, tested path rather than a special capture mode.
 */
/**
 * FONTS ARE REAL HERE NOW — the self-hosting flipped the trade this block used to argue.
 *
 * The stub era's reasoning, kept for the record: this harness measures SURFACE CHROME, type was a
 * variable arriving over a third-party CDN, and with real CDN fonts 14 of 62 captures on a COLD
 * cache raced the download (instability converged 5 -> 4 -> 0 as the HTTP cache warmed). A baseline
 * whose stability depends on cache temperature is not a baseline — so the suite stubbed the CDN.
 *
 * Self-hosting (feat/selfhost-webfonts) removed both halves of that argument at once: the fonts are
 * first-party static files served by the same webServer as the app (no third-party availability,
 * no CDN cache temperature), and the suite-wide stub is gone (support/fixtures.ts). What makes the
 * baseline stable now is `fontsSettled()` below — the wait until the active skin's real faces are
 * genuinely loaded, which under the stub was vacuous and now earns its keep. The baseline captured
 * after this change renders the faces a reader actually sees, which also makes the sweep a true
 * nine-skin tofu check rather than a fallback-face proxy.
 */
test.use({ reducedMotion: 'reduce' })

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'surface-visual-e2e@reverie.local'
const PASSWORD = 'surface-visual-password'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(HERE, '..', '..')
const OUT = join(WEB_ROOT, 'audit-output', 'surface-visual')
const BASELINE = join(OUT, 'baseline')
const CURRENT = join(OUT, 'current')
const OBSERVATIONS = join(OUT, 'observations')

/** Writing a baseline is explicit. Without it, a run compares — it never silently re-baselines. */
const IS_BASELINE = process.env.SURFACE_BASELINE === '1'

/**
 * Routes chosen for surface DENSITY, not coverage of the app: these carry the bulk of the 72 and
 * every tone/radius combination the migration will touch. Adding routes is cheap; the constraint is
 * that a route must render its surfaces without interaction, since a crop of a closed dialog is a
 * crop of nothing.
 */
const ROUTES: readonly string[] = [
  '/',
  '/shelves',
  '/discover',
  '/add',
  '/settings',
  '/clubs',
  '/review',
  '/planner',
  '/stats',
  '/match',
]

/**
 * The 18 combos are the point — a skin-driven radius that regresses in ONE skin is exactly what a
 * single-skin check misses. `SURFACE_SKINS` trims it while iterating on the harness itself.
 */
const MODES = ['light', 'dark'] as const
const SKIN_FILTER = (process.env.SURFACE_SKINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const SKINS: SkinId[] = SKIN_FILTER.length
  ? SKIN_ORDER.filter((s) => SKIN_FILTER.includes(s))
  : [...SKIN_ORDER]

type Client = {
  sb: ReturnType<typeof createClient>
  admin: ReturnType<typeof createClient>
  session: { access_token: string; refresh_token: string }
  uid: string
}
let shared: Client | null = null

async function client(): Promise<Client> {
  if (shared) return shared
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'surface-visual createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Surface Visual', skin: 'tryst', mode: 'dark' }),
    'surface-visual profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('surface-visual', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
  return shared
}

/**
 * Fixed content. Every value is deterministic — no dates, no counts that drift, no randomness —
 * because the baseline is only worth anything if a re-run with no code change produces identical
 * crops. Non-determinism here would read as a migration regression.
 */
async function seed(c: Client): Promise<void> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'surface items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'surface books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'surface lists delete')

  const rows = Array.from({ length: 8 }, (_, i) => ({
    owner_id: c.uid,
    title: `Surface Probe ${String(i + 1).padStart(2, '0')}`,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    series: null,
    position: null,
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }))
  const { error } = await c.sb.from('books').insert(rows)
  if (error) throw new Error(`surface-visual seed failed: ${JSON.stringify(error)}`)
  await ok(
    c.sb
      .from('lists')
      .insert({ owner_id: c.uid, name: 'Surface Shelf', kind: 'collection', sort_order: 1 }),
    'surface list insert',
  )
}

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  await keepOfflineCacheEmpty(page)
  await configureReturningReader(session.access_token)
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

/**
 * Belt and braces on top of `reducedMotion`. Anything still animating — a CSS transition mid-flight,
 * a cover fading in — moves pixels between two captures that should be identical. Killing motion
 * outright is safe for a still capture and removes a whole class of false "changed".
 *
 * ── AND THE AMBIENT MATERIAL, WHICH WAS THE WHOLE RESIDUAL ──────────────────────────────────────
 * The star field below was only half the wallpaper. Every skin also sets `--ambient-texture` to an
 * SVG `feTurbulence` fractalNoise filter (tokens.css:146, 204, 240, 264, 294, 363, 392 …),
 * rasterised into `.rv-skin-texture` behind all content. Chrome re-rasterises that procedural noise
 * per run and quantises it to 8-bit with a dither phase that is NOT stable between runs.
 *
 * MEASURED, not guessed — this is what the residual actually was, and it is the reason two prior
 * eliminations both came back clean. Two identical runs over 570 crops reported 41 changed; decoding
 * both PNGs of each with `pngjs` put the maximum per-channel difference at **1** on 40 of them, and
 * 2 on the 41st. The dominant case — /shelves' "No TBRs yet" panel, changed in ALL 18 skin x mode
 * combinations — had 23-36% of its pixels differing by exactly one level, spread over every row and
 * every column of the crop, in an alternating even/odd column pattern. Sample from row 0: x=1,3,5
 * differ (13,7,21 -> 13,6,21) while x=0,2,4 are byte-identical. 164 distinct colour pairs among the
 * differing pixels, every one a single-level step. That is an ordered dither matrix shifting phase,
 * not content moving.
 *
 * Which is exactly why `outerHTML` was byte-identical and `getBoundingClientRect` matched to 3dp on
 * every "changed" crop: nothing about the content changed. It is what shows THROUGH the surface,
 * and this harness measures surface chrome.
 *
 * Deliberately not a tolerance threshold. A +/-1 tolerance would have hidden this rather than named
 * it, and would then quietly hide the next one-level defect too — an accent that lands a level off
 * in one skin is a real regression this sweep should catch.
 */
async function freezeMotion(page: Page) {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation: none !important;
      transition: none !important;
      caret-color: transparent !important;
    }
    /* Hide the ambient night sky. Freezing motion is not enough: the star field's POSITIONS are
       randomised per mount, so every translucent or bare surface showed a different sky through
       itself on each load. That was the last 3 of the 62 crops still flagging as changed with no
       code change. This measures surface chrome, not the wallpaper behind it. */
    .rv-sky-star, .rv-anim { display: none !important; }
    .pointer-events-none.fixed.inset-0.-z-10 { display: none !important; }
    /* The ambient MATERIAL — see the note above this function for what it was doing and how it
       was measured. Same reason as the star field: wallpaper, not surface chrome. */
    .rv-skin-texture { display: none !important; }
    /* And the app background's own GRADIENT — the third and last wallpaper layer. See the note
       above this function; body carries a radial-gradient, transparent surfaces show it through,
       and Chrome dithers it with an unstable phase. Flat --bg colour remains. */
    body { background-image: none !important; }`,
  })
}

/**
 * Wait for the page to STOP CHANGING, rather than for a fixed number of milliseconds.
 *
 * A `waitForTimeout(900)` is a guess about how long queries, images and re-renders take, and when
 * the guess is short the crop catches a half-rendered panel — which is why the diff's "changed" set
 * varied run to run (an empty-state panel in one capture, populated in the next). This waits for the
 * network to go idle and then for the DOM to stop mutating, so the capture happens at a settled
 * state instead of at a stopwatch reading.
 */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  // WAIT FOR THE FONTS, and this is the one that mattered. Diagnosed rather than guessed: every
  // unstable crop compared IDENTICAL in DOM (outerHTML byte-for-byte) and IDENTICAL in geometry
  // (getBoundingClientRect to 3dp, same scrollY, same DPR) while its PNG differed — e.g. /shelves'
  // `<p>No TBRs yet — hit ＋ New.</p>` at 9443 vs 9399 bytes. Same box, same markup, different
  // glyphs: the webfont had landed in one capture and not the other. A centred line inside a
  // fixed-width panel does not resize when the face swaps, so the box never moves and neither the
  // DOM-quiet nor the geometry check could see it. `document.fonts.ready` is the thing that can.
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => {})
  await page
    .evaluate(
      () =>
        new Promise<void>((resolve) => {
          let t = setTimeout(done, 400)
          const obs = new MutationObserver(() => {
            clearTimeout(t)
            t = setTimeout(done, 400)
          })
          obs.observe(document.body, { subtree: true, childList: true, attributes: true })
          function done() {
            obs.disconnect()
            resolve()
          }
          setTimeout(done, 6000) // hard cap: a page that never settles must not hang the sweep
        }),
    )
    .catch(() => {})
}

/**
 * Wait until the ACTIVE SKIN's own faces are really loaded — not merely until `document.fonts.ready`
 * resolves.
 *
 * `fonts.ready` settles the faces requested SO FAR. Skin fonts are requested lazily (`loadSkinFont`
 * on skin apply), so on the first visit to a skin the request can start *after* `ready` has already
 * resolved — the capture then races the download. That is why the residual instability shrank run
 * over run (5 -> 4 -> 0) as the HTTP cache warmed: a cold capture raced, a warm one did not. A
 * baseline whose stability depends on cache temperature is not a baseline.
 *
 * This reads the families out of the live tokens and settles each via `document.fonts.load` —
 * load, not merely check, and the difference became load-bearing the day the suite switched to
 * real self-hosted fonts: `check()` OBSERVES and never initiates, and the browser only fetches a
 * face some rendered text actually uses. A page whose visible text is all weight-600 never loads
 * the 400 face, so polling `check('16px …')` (400-normal) spun for the full deadline on every
 * capture and reported a font race that wasn't one — measured on this branch's first real-font
 * sweep: both observation runs failed the fontRaces guard and ran ~30m against the baseline's
 * ~13m, all of it deadline-spinning. `load()` fetches the matching face and resolves when it's
 * usable, which is the thing this wait exists to know.
 */
async function fontsSettled(page: Page): Promise<boolean> {
  return page
    .evaluate(async () => {
      const fam = (v: string) => (v.split(',')[0] ?? '').replace(/['"]/g, '').trim()
      const cs = getComputedStyle(document.documentElement)
      const wanted = [
        fam(cs.getPropertyValue('--font-display')),
        fam(cs.getPropertyValue('--font-sans')),
      ].filter(Boolean)
      const deadline = performance.now() + 8000
      const ok = () => wanted.every((f) => document.fonts.check(`16px "${f}"`))
      while (performance.now() < deadline) {
        await Promise.all(wanted.map((f) => document.fonts.load(`16px "${f}"`))).catch(() => {})
        if (ok()) return true
        await new Promise((r) => setTimeout(r, 100))
      }
      return ok()
    })
    .catch(() => false)
}

async function stub(page: Page) {
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers', 'taste', 'geo'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

/**
 * Find the surfaces on the current page and tag each with a STABLE identity.
 *
 * The identity cannot be a DOM index — migrating a site can change the tree — and it cannot be the
 * class list, because changing the class list is the entire point of the migration. It is instead
 * `route + ordinal among surfaces sorted by document position`, which survives a className rewrite
 * and is stable as long as the seeded content is. That stability is exactly what the seed above
 * exists to guarantee.
 */
function tagSurfaces() {
  const PAD = /\b(p|px|py|pt|pb|pl|pr)-/
  const INTERACTIVE = new Set(['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A', 'LABEL'])
  const found: { idx: number; tag: string; cls: string }[] = []
  let i = 0
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const cls = typeof el.className === 'string' ? el.className : ''
    // Match the audit's own population definition: bordered + padded, non-interactive, and not a
    // control/field kit carrier. Post-migration a Surface still emits `border border-line`, so the
    // same query keeps finding the same boxes on both sides of the diff.
    if (!/border\s+border-line/.test(cls) || !PAD.test(cls)) continue
    if (INTERACTIVE.has(el.tagName)) continue
    if (/\bskin-control\b|\bskin-field\b/.test(cls)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    el.setAttribute('data-surface-probe', String(i))
    found.push({ idx: i, tag: el.tagName.toLowerCase(), cls: cls.slice(0, 120) })
    i++
  }
  return found
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex').slice(0, 16)

/**
 * ── THE NOISE FLOOR, AND WHY IT IS A FLOOR AND NOT A TOLERANCE ──────────────────────────────────
 * Byte-equality of two PNGs is the wrong question, and chasing it to zero is chasing an asymptote.
 * After the ambient texture was frozen (see `freezeMotion`), two identical runs over 570 crops still
 * reported 9 changed. Decoding every one of them put the whole remainder in a single population:
 *
 *   · 7 of the 9 are the same surface, /match's answer-button panel, in different skins.
 *   · The differing pixels sit at x=25-27 and x=495-502, y=388-401 and y=423-436 — the FOUR ROUNDED
 *     CORNERS of one button, 25px inset on both sides, ~49px apart top to bottom.
 *   · Their values are mid-tones between the border colour and the panel fill: 203,112,139 ->
 *     202,112,139. Anti-aliased corner coverage, rounding a level differently.
 *   · Every crop: <= 33 differing pixels, <= 0.010% of the crop, maxΔ <= 2.
 *
 * That is Skia rasterising a curve, and unlike the noise texture there is nothing to freeze — the
 * corner is real geometry the surface actually has. So the instrument gets a floor instead.
 *
 * BOTH conditions must hold for a crop to be dismissed, and that is what makes this safe rather than
 * a blanket tolerance:
 *   · maxΔ <= 2  alone would hide a one-level accent shift across a whole fill — but that moves
 *     THOUSANDS of pixels, so the pixel arm catches it.
 *   · <= 64 px alone would hide a small but real change — but a radius, border or padding change
 *     paints border colour over panel fill, which is a large delta, so the delta arm catches it.
 * Only "a handful of pixels AND imperceptible" is dismissed, which is precisely anti-aliasing.
 *
 * 64 is ~2x the 33 actually observed, so the floor has room without swallowing a second population.
 * Dismissed crops are PRINTED, never silently dropped — a floor nobody can see is a floor nobody can
 * check, and if this list starts growing it is evidence, not housekeeping.
 */
const MAX_NOISE_DELTA = 2
const MAX_NOISE_PIXELS = 64

/**
 * ── ONE RUN IS NOT A MEASUREMENT, AND THIS FILE ENFORCES THAT RATHER THAN ASKING ────────────────
 * The failure this exists to stop has happened twice, in one week, by the same hand, and the second
 * time the rule was already written down:
 *
 *   · `c157c1b` set an a11y budget from the worst of TWO CI runs. A third run exceeded it.
 *   · #265 declared this harness "0 of 570 changed" from a SINGLE post-fix run and called the Batch 1
 *     precondition met. Re-running the identical tree gave 24. The texture fix in it was real; the
 *     verification was not. `b3350c5` found the third cause the single run had masked.
 *
 * Both are the same shape: a stochastic process sampled once, read as settled. And this one is worse
 * than a wrong number — a clean run is the outcome you were hoping for, so nothing prompts a second
 * look. The residual's original description, "~4-6 of 62, a different set each time", was describing
 * exactly a distribution that sometimes lands on zero.
 *
 * WHY TOOLING AND NOT A RULE. `scripts/safe-revert.sh`'s entry in AGENTS.md makes this argument
 * already, for the same reason: that rule "existed since 2026-07-28 (#93) and being written down did
 * not make it a reflex, because the failure happens inside a fast revert loop rather than at a moment
 * of deliberation". N=1 is identical — run, read the number, move on. There is no moment of
 * deliberation for a rule to catch, so the enforcement is here instead: a comparison run records its
 * observation and REFUSES TO REPORT until it has at least MIN_OBSERVATIONS of them. "0 changed" is
 * structurally unobtainable from one run.
 *
 * The report is the UNION of crops that differed in ANY observation, not the last one's — a crop that
 * flags in one run and not the next is exactly the instability this measures, and taking the last run
 * would discard it. Raise the bar with SURFACE_MIN_OBSERVATIONS for a tighter check.
 */
const MIN_OBSERVATIONS = Math.max(2, Number(process.env.SURFACE_MIN_OBSERVATIONS ?? 2))

function pixelDelta(
  aPath: string,
  bPath: string,
): { pixels: number; maxDelta: number; bbox: [number, number, number, number] } | null {
  if (!existsSync(aPath) || !existsSync(bPath)) return null
  const a = PNG.sync.read(readFileSync(aPath))
  const b = PNG.sync.read(readFileSync(bPath))
  if (a.width !== b.width || a.height !== b.height) return null // a size change is never noise
  let pixels = 0
  let maxDelta = 0
  let minX = Infinity
  let minY = Infinity
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (a.width * y + x) << 2
      const d = Math.max(
        Math.abs(a.data[i]! - b.data[i]!),
        Math.abs(a.data[i + 1]! - b.data[i + 1]!),
        Math.abs(a.data[i + 2]! - b.data[i + 2]!),
        Math.abs(a.data[i + 3]! - b.data[i + 3]!),
      )
      if (d === 0) continue
      pixels++
      if (d > maxDelta) maxDelta = d
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return { pixels, maxDelta, bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1] }
}

test('surface visual — per-site crops across skins x modes', async ({ page }) => {
  test.setTimeout(45 * 60_000)
  const c = await client()
  await seed(c)
  await stub(page)
  await signIn(page, c.session)

  const dir = IS_BASELINE ? BASELINE : CURRENT
  mkdirSync(dir, { recursive: true })
  const manifest: Record<string, { hash: string; tag: string; cls: string; dom: string }> = {}
  const unstable: string[] = []
  const fontRaces: string[] = []

  await page.setViewportSize({ width: 1280, height: 900 })

  for (const skin of SKINS) {
    for (const mode of MODES) {
      await ok(
        c.admin.from('profiles').update({ skin, mode }).eq('id', c.uid),
        'surface-visual skin update',
      )
      for (const route of ROUTES) {
        await page.goto(route)
        await settle(page)
        // A crop taken while the skin's face is still downloading differs from the same crop taken
        // after it lands — same DOM, same box, different glyphs. Record it rather than silently
        // capturing an unstable frame.
        if (!(await fontsSettled(page))) fontRaces.push(`${route} ${skin}/${mode}`)
        await freezeMotion(page)
        await page.waitForTimeout(150)

        // A crop taken under the wrong skin is filed against a combination that was never on
        // screen — the same trap the visual-overflow audit had to close. Refuse it loudly.
        const applied = await page.evaluate(() => ({
          skin: document.documentElement.dataset.skin,
          mode: document.documentElement.dataset.mode,
        }))
        if (applied.skin !== skin || applied.mode !== mode)
          throw new Error(
            `surface-visual: asked ${skin}/${mode}, page rendered ${applied.skin}/${applied.mode} at ${route}`,
          )

        const found = await page.evaluate(tagSurfaces)
        for (const f of found) {
          const key = `${route.replace(/[^\w]+/g, '_') || 'root'}--${skin}-${mode}--${f.idx}`
          const loc = page.locator(`[data-surface-probe="${f.idx}"]`)
          const shot = await loc.screenshot().catch(() => null)
          if (!shot) continue
          // SHOOT IT TWICE. Two captures milliseconds apart must be identical; if they are not,
          // this crop is unstable and any "changed" it reports later is noise, not a migration.
          // Measuring that per crop is what makes the instrument's own reliability visible instead
          // of assumed — the first version of this file asserted determinism by comparing a
          // manifest against its own PNGs, which is true by construction and proved nothing.
          const shot2 = await loc.screenshot().catch(() => null)
          if (!shot2 || sha(shot) !== sha(shot2)) unstable.push(key)
          writeFileSync(join(dir, `${key}.png`), shot)
          // The DOM alongside the pixels. A pixel diff says a crop changed; only the markup says
          // WHAT changed, which is the difference between "the harness is noisy" and a named cause.
          const html = await loc.evaluate((el) => el.outerHTML).catch(() => '')
          writeFileSync(join(dir, `${key}.html`), html)
          manifest[key] = { hash: sha(shot), tag: f.tag, cls: f.cls, dom: sha(Buffer.from(html)) }
        }
      }
    }
  }

  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  // A fresh baseline invalidates every observation taken against the old one.
  if (IS_BASELINE) rmSync(OBSERVATIONS, { recursive: true, force: true })
  const total = Object.keys(manifest).length
  console.log(
    `surface-visual: ${IS_BASELINE ? 'BASELINE' : 'CURRENT'} — ${total} crops across ` +
      `${SKINS.length} skins x ${MODES.length} modes x ${ROUTES.length} routes → ${dir}`,
  )
  expect(total, 'no surfaces were captured — the probe found nothing to crop').toBeGreaterThan(0)

  // The instrument's own honesty check, measured rather than asserted. A non-zero count here means
  // every diff this run produces is suspect.
  if (unstable.length) {
    console.log(
      `surface-visual: ${unstable.length}/${total} crops were UNSTABLE between two captures taken ` +
        `milliseconds apart. Any "changed" below is noise until this is zero. Sample: ` +
        unstable.slice(0, 8).join(', '),
    )
  }
  if (fontRaces.length)
    console.log(
      `surface-visual: ${fontRaces.length} captures ran with the skin's faces NOT fully loaded — ` +
        `those crops are unreliable. Sample: ${fontRaces.slice(0, 6).join(', ')}`,
    )
  expect(
    fontRaces.length,
    `${fontRaces.length} captures raced the webfont download. A crop taken mid-swap differs from ` +
      `the same crop after it lands, with identical DOM and identical geometry — which is exactly ` +
      `the residual this harness had. Do not baseline from this run.`,
  ).toBe(0)
  expect(
    unstable.length,
    `${unstable.length} crops differ between two back-to-back captures — the harness is measuring ` +
      `its own motion, not the migration. Do not trust a diff until this is 0.`,
  ).toBe(0)

  if (IS_BASELINE) return

  // ── compare ────────────────────────────────────────────────────────────────────────────────
  const basePath = join(BASELINE, 'manifest.json')
  if (!existsSync(basePath)) {
    console.log(
      'surface-visual: NO BASELINE FOUND — capture one on main first:\n' +
        '  SURFACE_BASELINE=1 pnpm --filter @reverie/web exec playwright test ' +
        '-c playwright.audit.config.ts --grep "surface visual"',
    )
    return
  }
  const base = JSON.parse(readFileSync(basePath, 'utf8')) as typeof manifest

  // Record THIS run's observation, then refuse to report on fewer than MIN_OBSERVATIONS of them.
  // See the note above MIN_OBSERVATIONS for why this is enforced here rather than asked for.
  mkdirSync(OBSERVATIONS, { recursive: true })
  const priorCount = readdirSync(OBSERVATIONS).filter((f) => f.endsWith('.json')).length
  writeFileSync(join(OBSERVATIONS, `run-${priorCount + 1}.json`), JSON.stringify(manifest, null, 2))
  const observations = readdirSync(OBSERVATIONS)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(OBSERVATIONS, f), 'utf8')) as typeof manifest)
  console.log(
    `surface-visual: observation ${observations.length} of ${MIN_OBSERVATIONS} required recorded.`,
  )
  expect(
    observations.length,
    `INSUFFICIENT OBSERVATIONS — ${observations.length} of ${MIN_OBSERVATIONS}. This harness measures ` +
      `a stochastic process and will not report a result from one run: a clean single run is the ` +
      `outcome you were hoping for, which is exactly why nothing prompts a second look. #265 reported ` +
      `"0 of 570" from one run and was wrong; re-running the identical tree gave 24. Run the same ` +
      `command again (the baseline is untouched) and the comparison will report the union across ` +
      `runs. A fresh SURFACE_BASELINE=1 capture resets the count.`,
  ).toBeGreaterThanOrEqual(MIN_OBSERVATIONS)

  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []
  const belowFloor: string[] = []
  // The UNION across observations: a crop that differs in ANY run is unstable, and reporting only
  // the latest run would discard precisely the flapping this exists to catch.
  const everChanged = new Map<string, string>()
  for (const obs of observations) {
    for (const k of Object.keys(obs)) {
      if (!(k in base) || base[k]!.hash === obs[k]!.hash) continue
      if (!everChanged.has(k)) everChanged.set(k, obs[k]!.dom)
    }
  }
  for (const k of Object.keys(manifest)) {
    if (!(k in base)) {
      added.push(k)
      continue
    }
    if (!everChanged.has(k)) continue
    // A hash mismatch is the QUESTION, not the answer. Decode both and ask how big the difference
    // actually is — see the noise-floor note above `pixelDelta` for why, and for the measurements
    // the two thresholds come from. The PNGs on disk are the latest run's; a crop that flapped in an
    // earlier observation still reports, with that run's delta unavailable — which is why the union
    // is taken on hashes and the localisation is best-effort.
    const d = pixelDelta(join(BASELINE, `${k}.png`), join(CURRENT, `${k}.png`))
    if (d && d.maxDelta <= MAX_NOISE_DELTA && d.pixels <= MAX_NOISE_PIXELS) {
      belowFloor.push(`${k}  (${d.pixels}px, maxΔ=${d.maxDelta}, bbox ${d.bbox.join(',')})`)
      continue
    }
    const where = d ? `  ${d.pixels}px maxΔ=${d.maxDelta} bbox ${d.bbox.join(',')}` : ''
    changed.push(
      `${k}${base[k]!.dom !== manifest[k]!.dom ? '  [DOM ALSO CHANGED]' : '  [PIXELS ONLY — same DOM]'}${where}`,
    )
  }
  for (const k of Object.keys(base)) if (!(k in manifest)) removed.push(k)

  const lines = [
    `# Surface visual diff`,
    ``,
    `- baseline crops: ${Object.keys(base).length}`,
    `- current crops:  ${Object.keys(manifest).length}`,
    `- **changed: ${changed.length}**  ·  added: ${added.length}  ·  removed: ${removed.length}`,
    `- below the noise floor (dismissed, not hidden — maxΔ<=${MAX_NOISE_DELTA} AND <=${MAX_NOISE_PIXELS}px): ${belowFloor.length}`,
    ``,
    `A pixel diff answers "did this change", never "is it correct" — every entry below needs a look.`,
    ``,
  ]
  for (const [label, list] of [
    ['changed', changed],
    [
      `below the noise floor — anti-aliasing, dismissed by the pixel floor (see pixelDelta's note)`,
      belowFloor,
    ],
    ['added (a surface exists now that did not before)', added],
    [
      'removed (a surface the baseline had is gone — check it was not dropped by accident)',
      removed,
    ],
  ] as const) {
    lines.push(`## ${label} — ${list.length}`, '')
    for (const k of list.slice(0, 200))
      lines.push(`- \`${k}\` ${manifest[k]?.cls ? `— \`${manifest[k]!.cls}\`` : ''}`)
    if (list.length > 200) lines.push(`- …and ${list.length - 200} more (truncated in this report)`)
    lines.push('')
  }
  writeFileSync(join(OUT, 'diff.md'), lines.join('\n'))
  console.log(lines.slice(0, 8).join('\n'))
  console.log(`surface-visual: wrote ${join(OUT, 'diff.md')}`)
})

/**
 * NOTE — there is deliberately no second "determinism" test here any more.
 *
 * The first version compared the manifest's hashes against the PNGs the SAME run had just written.
 * That is true by construction: it re-hashed the bytes it had already hashed. It passed while the
 * harness was in fact reporting 52 of 62 crops as changed between independent runs, which is
 * precisely the kind of green that stops anyone looking.
 *
 * Stability is now measured where it can actually fail — inside the capture, by shooting every crop
 * twice and asserting the pair is identical. See `unstable` above.
 */
