import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from './support/fixtures'
import AxeBuilder from '@axe-core/playwright'
import { SKIN_ORDER, type SkinId } from '@reverie/core'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
// A dedicated user, not the shared dev account. This spec is the ONLY one that mutates a profile's
// skin and mode — ten times per run — which is exactly what fonts and cover-sheet used to race.
const DEV_EMAIL = 'a11y-e2e@reverie.local'
const DEV_PASSWORD = 'a11y-e2e-password'
// The skin list is DERIVED from SKIN_ORDER (imported from @reverie/core) at the sweep plan below —
// deliberately no local skin array. The old `const SKINS = ['tryst','grimoire','aphelion','marrow']`
// was a fossil: written when those were all the skins there were, never revisited when the registry
// grew to nine, so five shipped skins were never once axe-scanned. A second copy of the list is
// exactly the drift mechanism that produced that gap.
const MODES = ['dark', 'light'] as const

/**
 * Give this spec's own user a full library, via the ONE seeding implementation the repo already
 * has. `scripts/seed-dev.mjs` honours DEV_EMAIL/DEV_PASSWORD and creates the account when absent,
 * so this needs no duplicated seed logic and no separate CI step — invoking it from the spec keeps
 * local and CI identical.
 *
 * The sweep genuinely needs the books: the seed is what populates the Library grid (all 290 land in
 * the default library — 213 owned and 77 borrowed since the seed started writing possession) and
 * Home's book-derived surfaces. Every other fixture below this spec creates itself. Measured cost of
 * a fresh user + 290 books: ~0.6s, against a ~15m job.
 *
 * Idempotent — re-running replaces this user's books, so repeat local runs are safe.
 */
function seedOwnLibrary(): void {
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  execFileSync('node', ['scripts/seed-dev.mjs'], {
    cwd: root,
    env: { ...process.env, DEV_EMAIL, DEV_PASSWORD },
    stdio: 'pipe',
  })
}

/**
 * A signed-in anon client, or a diagnosis. The three fixture helpers below used to call
 * `signInWithPassword` and discard the result, then dereference `.data.user!.id` — so a failed
 * sign-in surfaced as a bare `TypeError` on the `.id` access, pointing at the wrong thing entirely.
 * Route them through the same `authFailure()` reader every other spec uses.
 */
/**
 * TEXT OVER ARBITRARY COVER ART IS EXCLUDED — a validity fix, not a convenience one.
 *
 * `axe` cannot evaluate contrast for text composited over an `<img>`: it resolves the nearest
 * PAINTED background, and over artwork there is none. That class was therefore assigned to the
 * token tests BY DESIGN — `packages/core/src/statePill.contrast.test.ts`, whose header says it
 * outright ("axe does not measure text over an image, and the pill sits on arbitrary cover art"),
 * and which is keyed off the SKINS registry so a tenth skin fails there before it can ship.
 *
 * What changed, and why the exclusion is now REQUIRED rather than tidy: #262/#264 stubbed every
 * cover image suite-wide to a 1x1 PNG. axe can now resolve a background behind those elements — the
 * STUB's. Observed on run 32092051435, tryst/light: `fg=#f4eae0 bg=#f8eee4 ratio=1.03` on a
 * borrowed-state pill over a magnified cover. Near-white on near-white, a composite that exists in
 * no reader's browser. It fails in BOTH directions — a stub background can equally make a genuinely
 * unreadable pill measure fine.
 *
 * Scoped to a marker on the component rather than a selector list: `StatePill` carries
 * `data-over-art`, and all five of its call sites are `absolute` inside a cover box, so there is
 * nothing to keep in sync and no non-artwork usage being silenced. A future component that paints
 * text onto artwork adds the attribute and inherits both the exclusion and this reasoning.
 */
const OVER_ART = '[data-over-art]'

async function signedInClient(context: string): Promise<SupabaseClient> {
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
  })
  if (error || !data.session) throw new Error(authFailure(context, DEV_EMAIL, error))
  return sb
}

/** Establish a session directly: sign in with this spec's own password via the JS client, then hand
 *  the tokens to the app through the URL hash. The app's supabase client has detectSessionInUrl:true,
 *  so it adopts them on load and persists the session — the same landing the magic-link verify would
 *  produce, minus the email. This avoids Mailpit, the auth redirect allow-list, and the email rate
 *  limits, so it's immune to the dev server's port. TanStack Router is path-based, leaving the hash
 *  free for supabase-js to consume. */
async function signIn(page: Page) {
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
  })
  if (error || !data.session) throw new Error(authFailure('a11y', DEV_EMAIL, error))
  const { access_token, refresh_token } = data.session
  await keepOfflineCacheEmpty(page)
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  // An auth-callback arrival lands on /welcome ("You're in"); the button confirms the session is set.
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

async function setupFixtures(): Promise<{
  bookId: string
  clubId: string
  listCode: string
  shelfId: string
  tropeId: string
}> {
  const sb = await signedInClient('a11y setupFixtures')
  const uid = (await okUser(sb.auth.getUser(), 'a11y getUser')).id
  const bookId = (
    await okData(
      sb.from('books').select('id').order('added_at').limit(1).single(),
      'a11y books read',
    )
  ).id

  // Clear any fixtures a PREVIOUS run left behind, before creating this run's.
  //
  // Cleanup lives in the test's `finally`, but setup runs before that block exists — so an
  // interrupted or failed run (Ctrl-C, a CI timeout, a throw in here) leaks whatever it had already
  // created. `series` is UNIQUE (owner_id, name), which turned that leak into a ratchet: one
  // orphaned 'A11y Saga' row made the insert below return null, `.data!.id` threw, setup died
  // BEFORE the try block, and the club and shelf it had just made leaked too — wedging the suite
  // deterministically until someone deleted a row by hand. Clubs and lists have no unique
  // constraint, so they simply accumulated (4 of each, when this was found).
  await clearFixtures(sb)

  const club = await okData(
    sb
      .from('clubs')
      .insert({
        title: 'A11y Read-along',
        unit_type: 'chapter',
        unit_count: 10,
        unit_label: 'Chapter',
        created_by: uid,
      })
      .select()
      .single(),
    'a11y clubs insert',
  )
  await ok(
    sb
      .from('club_members')
      .insert({ club_id: club.id, user_id: uid, display_name: 'Dev', progress: 3 }),
    'a11y club_members insert',
  )

  // a shelf with one book, for the /shelf/$listId detail page
  const shelf = await okData(
    sb
      .from('lists')
      .insert({ owner_id: uid, name: 'A11y Shelf', kind: 'tbr', sort_order: 999999 })
      .select()
      .single(),
    'a11y lists insert',
  )
  await ok(
    sb
      .from('list_items')
      .insert({ list_id: shelf.id, book_id: bookId, owner_id: uid, position: 1000 }),
    'a11y list_items insert',
  )

  // a series with a linked entry + a ghost slot, for the /series/$seriesName page
  const series = await okData(
    sb
      .from('series')
      .insert({ owner_id: uid, name: 'A11y Saga', status: 'ongoing' })
      .select()
      .single(),
    'a11y series insert',
  )
  await ok(
    sb.from('series_entries').insert([
      {
        series_id: series.id,
        owner_id: uid,
        position: 1,
        title: 'Linked One',
        // Both rows carry every NOT NULL column explicitly, even where it's just the default.
        // PostgREST unions the two rows' keys for a bulk insert, so a column one row omits arrives
        // as NULL for it rather than falling back to the column default — and a NOT NULL column
        // then rejects the WHOLE batch. This bit twice (author, then user_edited) before both rows
        // carried the same key set. See AGENTS.md's testing discipline section.
        author: '',
        book_id: bookId,
        user_edited: true,
      },
      {
        series_id: series.id,
        owner_id: uid,
        position: 2.5,
        label: 'novella',
        title: 'A11y Ghost Novella',
        author: 'Ghost Writer',
        user_edited: true,
      },
    ]),
    'a11y series_entries insert',
  )

  // a trope assignment for the /tropes pages (canonical seed row + the fixture book)
  const trope = await okData(
    sb.from('tropes').select('id').is('owner_id', null).eq('name', 'Enemies to Lovers').single(),
    'a11y tropes lookup (the canonical seed row)',
  )
  await ok(
    sb
      .from('book_tropes')
      .upsert(
        { book_id: bookId, trope_id: trope.id, owner_id: uid, emphasis: 'pinned' },
        { onConflict: 'book_id,trope_id' },
      ),
    'a11y book_tropes upsert',
  )

  const listCode = 'A11YSMOKE'
  await ok(
    sb.from('shared_docs').upsert({
      key: listCode,
      value: { type: 'list', kind: 'list', name: 'A11y list', items: [], updatedAt: Date.now() },
    }),
    'a11y shared_docs upsert',
  )
  await ok(
    sb
      .from('shared_refs')
      .upsert(
        { owner_id: uid, code: listCode, kind: 'list', name: 'A11y list' },
        { onConflict: 'owner_id,code' },
      ),
    'a11y shared_refs upsert',
  )

  return { bookId, clubId: club.id, listCode, shelfId: shelf.id, tropeId: trope.id }
}

/** Remove every fixture row this spec creates, by its stable name — safe to run before or after. */
async function clearFixtures(sb: SupabaseClient) {
  await ok(sb.from('series').delete().eq('name', 'A11y Saga'), 'a11y series delete')
  await ok(sb.from('clubs').delete().eq('title', 'A11y Read-along'), 'a11y clubs delete')
  await ok(sb.from('lists').delete().eq('name', 'A11y Shelf'), 'a11y lists delete')
}

async function cleanup(clubId: string, listCode: string, shelfId: string, bookId?: string) {
  const sb = await signedInClient('a11y cleanup')
  await ok(sb.from('clubs').delete().eq('id', clubId), 'a11y clubs delete')
  await ok(sb.from('lists').delete().eq('id', shelfId), 'a11y lists delete')
  if (bookId) await sb.from('book_tropes').delete().eq('book_id', bookId)
  await ok(sb.from('series').delete().eq('name', 'A11y Saga'), 'a11y series delete')
  // shared_docs is NEVER deleted, on purpose: 20260624010400_grants.sql grants only
  // select/insert/update to authenticated (no delete), sharedLists.ts matches — the app itself
  // never deletes a shared_docs row — and ownedTables.ts documents that capability share docs
  // persist by design ("re-joining means entering the code again"). Attempting the delete here
  // always failed (permission denied), invisible until the bare await was routed through ok().
  // Nothing to clean up: setupFixtures upserts this row on the stable key 'A11YSMOKE', so each
  // run overwrites it rather than accumulating a new one.
  await ok(sb.from('shared_refs').delete().eq('code', listCode), 'a11y shared_refs delete')
  await setProfileSkinMode('tryst', 'system') // restore the dev profile
}

/** Set the dev profile's skin + mode so the app's skin-sync applies them on the next load
 * (avoids racing the client-side sync — this also exercises the real persistence path). */
async function setProfileSkinMode(skin: string, mode: string) {
  const sb = await signedInClient('a11y setProfileSkinMode')
  const uid = (await okUser(sb.auth.getUser(), 'a11y getUser')).id
  await ok(sb.from('profiles').update({ skin, mode }).eq('id', uid), 'a11y profiles update')
}

/**
 * Guard the rendered material itself, not merely `data-skin` / `data-mode`. Control colours now
 * switch atomically, specifically to prevent a low-contrast transition midpoint; this comparison
 * keeps that contract honest if a later component reintroduces an authored transition or a
 * skin-specific override drifts from the resolved token.
 *
 * The expected value is never hardcoded: a detached element stamped fresh with the target
 * `data-skin`/`data-mode` has no prior state to transition FROM, so its first computed `--ink` is
 * the token's cascade resolution, straight from tokens.css, with nothing here to go stale against
 * it. If a silently-broken pre-seed reintroduces the boot-light-then-flip sequence, this fails
 * loudly instead of the suite passing on a `data-mode` read that was never wrong to begin with.
 */
async function assertControlMaterialSettled(page: Page, skin: string, mode: string, where: string) {
  const result = await page.evaluate(
    ({ skin, mode }) => {
      // .skin-btn-primary is excluded on purpose—its color is --cta-ink, a different token, and
      // matching it here would compare a CTA state rather than persistent shell chrome. Clone the
      // actual secondary/icon class instead of hardcoding --ink so future intentional material
      // changes remain testable without creating a second token table here.
      const control = document.querySelector(
        '.skin-btn-secondary, .skin-btn-icon, .skin-control.text-ink',
      ) as HTMLElement | null
      const renderedColor = control ? getComputedStyle(control).color : null

      // Render that exact control contract in an isolated target-skin scope. A fresh element has no
      // in-flight transition, so this preserves the original race guard while respecting each
      // skin's intentional control ink instead of hardcoding one token for every material.
      const expectedScope = document.createElement('div')
      expectedScope.dataset.skin = skin
      expectedScope.dataset.mode = mode
      expectedScope.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
      const expectedControl = control?.cloneNode(false) as HTMLElement | undefined
      if (expectedControl) {
        expectedControl.style.transition = 'none'
        expectedScope.appendChild(expectedControl)
      }
      document.body.appendChild(expectedScope)
      const expectedColor = expectedControl ? getComputedStyle(expectedControl).color : null
      expectedScope.remove()

      return { controlFound: !!control, renderedColor, expectedColor }
    },
    { skin, mode },
  )
  expect(result.controlFound, `${where}: no .skin-control present to check`).toBe(true)
  expect(
    result.renderedColor,
    `${where}: a .skin-control's rendered color has not settled to its ${skin}/${mode} material`,
  ).toBe(result.expectedColor)
}

// Title states the real scope on purpose — and the scope is now ALL NINE skins. Until 2026-08-10
// this swept four (tryst/grimoire/aphelion/marrow), which was never a chosen sample: the constant
// predated the nine-skin expansion, so umbra, folio, hearth, almanac and bloom shipped with their
// own token sets and structural bones and were never once scanned here. Division of labour,
// unchanged: the registry-keyed contrast tests in packages/core remain the exhaustive TOKEN-PAIR
// layer across all nine; what this spec adds per skin is the RENDERED page — emergent pairings,
// text over per-skin surfaces — plus, in tryst alone, the skin-invariant structural/ARIA rules,
// which compute identically in every skin and so are checked once, on every route, in both modes,
// rather than re-checked per skin.
/**
 * ── ONE TEST PER SKIN PASS, NOT ONE TEST FOR THE WHOLE SWEEP ────────────────────────────────────
 * This used to be a single test looping all ten skin x mode passes, which meant ONE
 * `test.setTimeout` covering ~104 axe scans. That made the timeout a shared budget: a slow runner
 * spent all of it at once, and the failure said "the sweep timed out" rather than naming a skin.
 *
 * It stopped being hypothetical. The same unchanged spec ran 8m36s and green, then 12.9m, 15.1m and
 * 18.5m across one evening as the runner degraded — blowing a 720s cap, then an 1080s cap, then a
 * 20-minute JOB cap underneath it. Two raises bought nothing, and a third would have been an
 * admission that the number was the wrong lever.
 *
 * Split, each pass carries its own budget: tryst's full-route passes get 8m, the single-mode core
 * passes 4m. A runner slow enough to blow one now costs that pass, not the sweep, and the failing
 * test names the skin. Fixtures are created ONCE in beforeAll and cleaned once in afterAll, so the
 * split does not pay for setup ten times.
 *
 * The coverage guarantee moved rather than disappearing — see the plan-level test below.
 */
test.describe('axe sweep', () => {
  let fx: Awaited<ReturnType<typeof setupFixtures>>

  test.beforeAll(async () => {
    seedOwnLibrary() // creates this spec's user on first run, and gives it the books the sweep needs
    fx = await setupFixtures()
  })

  test.afterAll(async () => {
    await cleanup(fx.clubId, fx.listCode, fx.shelfId, fx.bookId)
  })

  /** Everything a pass needs on its page before it can scan: sign-in, then the network stubs. */
  async function preparePage(page: Page) {
    await signIn(page)

    // Third-party cover images are stubbed suite-wide by `support/fixtures.ts`'s `page` fixture —
    // this sweep's ~200 live cover requests per full-route pass are what proved the need, and the
    // stub lived here first (#262) before the CI cost/value audit found `rest` and `mobile` had
    // gone red from the identical class a week earlier. Do not re-add a local copy.

    // Discover browses an external catalog — stub it so the sweep is deterministic and offline-safe.
    // Covers point at the self-hosted landing thumbs, so the populated grid renders with zero
    // third-party requests; one hit matches the seeded library shape only by accident (never).
    const vol = (title: string, author: string, cover: string, isbn: string) => ({
      volumeInfo: {
        title,
        authors: [author],
        publishedDate: '2026-01-01',
        imageLinks: { thumbnail: cover },
        industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
      },
    })
    await page.route('**/books/v1/volumes**', (route) =>
      route.fulfill({
        json: {
          items: [
            vol('Fourth Wing', 'Rebecca Yarros', '/landing-covers/everflame.jpg', '9781649374042'),
            vol(
              'Iron Flame',
              'Rebecca Yarros',
              '/landing-covers/king-of-wrath.jpg',
              '9781649374172',
            ),
            vol(
              'The Serpent and the Wings of Night',
              'Carissa Broadbent',
              '/landing-covers/never-king.jpg',
              '9781250343178',
            ),
            vol('Divine Rivals', 'Rebecca Ross', '/landing-covers/mile-high.jpg', '9781250857439'),
          ],
        },
      }),
    )

    // The embed fn (Tier 2) is a background enhancement — stub it so the sweep can't stall
    // networkidle waits, and the run needs no local functions server.
    await page.route('**/functions/v1/embed**', (route) =>
      route.fulfill({ json: { embedded: 0, remaining: 0, hits: [] } }),
    )
    await page.route('**/functions/v1/releases**', (route) =>
      route.fulfill({ json: { authors: {}, pending: [], hits: [] } }),
    )
    // Cover system: detail views lazily backfill external covers via the covers fn — stub it so the
    // sweep never depends on a local functions server (and never mutates the seeded covers).
    await page.route('**/functions/v1/covers**', (route) =>
      route.fulfill({ status: 422, json: { error: 'fetch_failed' } }),
    )
  }

  // Tryst (the default skin) gets full route coverage; the alternate skins sweep a core set
  // that exercises the whole token surface (palette, cards, fills, links, muted text).
  const routesFor = (f: typeof fx): [string, string][] => [
    ['Home', '/'],
    ['Library', '/library'],
    ['Book detail', `/book/${f.bookId}`],
    ['Shelves', '/shelves'],
    ['Planner', '/planner'],
    ['Calendar', '/planner?tab=calendar'],
    ['Stats', '/stats'],
    ['Next read', '/match'],
    ['Discover', '/discover'],
    ['Add', '/add'],
    ['Settings', '/settings'],
    ['Clubs', '/clubs'],
    ['Club', `/club/${f.clubId}`],
    ['SharedList', `/list/${f.listCode}`],
    ['Shelf detail', `/shelf/${f.shelfId}`],
    ['Bookshops', '/indie'],
    ['Appearance', '/skins'],
    ['Series index', '/series'],
    ['Series detail', `/series/${encodeURIComponent('A11y Saga')}`],
    ['Tropes', '/tropes'],
    ['Trope detail', `/tropes/${f.tropeId}`],
  ]
  const CORE = [
    'Home',
    'Library',
    'Book detail',
    'Calendar',
    'Stats',
    'Settings',
    'Appearance',
    'Clubs',
    'Bookshops',
  ]

  // ── The sweep plan: every skin in the registry, derived from SKIN_ORDER so this spec can never
  // hold a second, driftable copy of the skin list. Tryst — the default skin, whose full-route
  // pass carries all of the skin-invariant structural/ARIA coverage — keeps both modes across
  // every route. Every OTHER skin gets the core set in exactly ONE mode, assigned by its FIXED
  // position in SKIN_ORDER: even index → dark, odd index → light. Position is the only input, so
  // the same commit scans the same combinations on every run, forever — a rotation keyed to date
  // or run count would let a contrast defect appear and disappear across re-runs of an identical
  // tree, which is precisely the non-reproducibility this convention exists to rule out. The
  // parity split lands 4 dark + 4 light across the eight, so both modes stay exercised beyond
  // tryst. (Literal indices into MODES, not MODES[i % 2]: noUncheckedIndexedAccess types a
  // computed index as possibly-undefined.)
  type SweepPass = { skin: SkinId; mode: (typeof MODES)[number]; full: boolean }
  const sweep: SweepPass[] = SKIN_ORDER.flatMap((skin, i): SweepPass[] =>
    skin === 'tryst'
      ? MODES.map((mode) => ({ skin, mode, full: true }))
      : [{ skin, mode: i % 2 === 0 ? MODES[0] : MODES[1], full: false }],
  )

  // One test per pass. The name carries the skin/mode, so a failure in CI reads as
  // "axe sweep > umbra/dark" rather than as a sweep-wide timeout with no attribution.
  for (const { skin, mode, full } of sweep) {
    test(`${skin}/${mode} — ${full ? 'every route' : 'core set'}`, async ({ page }) => {
      // Per-pass budgets, sized to the work AND calibrated against CI rather than against a laptop.
      // tryst walks 20 routes in each of two modes; the other eight walk 8 apiece.
      //
      // The first draft used 8m/4m, from a local run where tryst measured 4.7m. CI ran the same pass
      // at 8.2m — the runner is ~1.75x slower — and both tryst passes timed out while all ten other
      // tests passed. That failure is worth keeping in view, because it is what the split was FOR:
      // the sweep no longer dies as one anonymous timeout, it names tryst/dark and tryst/light and
      // leaves the other eight passes reporting normally.
      //
      // RETIGHTENED after #262 removed the dead-host stall. 12m/4m were sized against an 8.2m tryst
      // pass that was 8.2m only because ~200 live cover requests were being waited out, 55 of them
      // to hosts that had stopped answering. With those stubbed the same pass does the same 104
      // scans in a fraction of the time, and the old ceilings stopped being tripwires: 12m against
      // 1.3m is 9x, which absorbs almost anything rather than catching it.
      //
      // MEASURED, not derived — read off THREE independent CI runs, because a budget taken from a
      // single observation is the guess-wearing-a-ratchet's-clothes this repo has been bitten by
      // before. The third run is why there are three: it came in slower than the first two and blew
      // past the "worst observed" the first draft of this comment had written down.
      //   run 31994806370 (#262)   tryst 1.3m / 1.3m · core 28.0-28.6s · job 8.4m
      //   run 32000050725 (#263)   tryst 1.2m / 1.2m · core 25.5-26.2s · job 8.4m
      //   run 32001881355 (#263)   tryst 1.4m / 1.4m · core 29.6-30.6s · job 8.9m
      //   run 32002947099 (#263)   tryst 1.3m / 1.3m · core 27.7-28.8s · job 8.3m
      // Local on the same tree: tryst 47.7s/46.2s, core 16.7-17.3s — the ~1.7x CI:local ratio this
      // file already documents, unchanged.
      //
      // 240s and 90s are ~2.9x the WORST value across all three runs (84s and 30.6s), not the
      // median, and one ratio for both so they cannot drift apart the way 12m-vs-4m did.
      // Why ~2.9x and not tighter: between-run spread is 17% for tryst (72-84s) and 20% for the
      // core set (25.5-30.6s). Within a run they are far tighter — the eight core passes land
      // inside 1s of each other every time — but it is the BETWEEN-run number a ceiling has to
      // tolerate, and two runs badly understated it. 2.9x clears 20% with room, while the
      // saturation events this ceiling exists to catch are far larger (workers=2 costs ~1.5x;
      // workers=4 blew a 600s cap on a sweep whose normal was ~390s). Why not looser: 2.9x still
      // fails a pass that has started waiting on the network again, which is the specific
      // regression that produced this week's five red runs.
      //
      // A climb was suspected and is RULED OUT, recorded so nobody re-opens it: the first three
      // runs read 25.5 -> 28.0 -> 29.6s on the core set, monotonically, which looked like drift.
      // The fourth came back at 27.7s. It is variance around ~28s, not a trend — and three
      // consecutive points in one direction is exactly what variance looks like often enough that
      // it is not evidence on its own.
      test.setTimeout(full ? 240_000 : 90_000)
      await preparePage(page)
      const all = routesFor(fx)
      const routes = full ? all : all.filter(([name]) => CORE.includes(name))

      const failures: string[] = []
      await setProfileSkinMode(skin, mode) // skin-sync picks this up on each fresh load
      // Pre-seed the target BEFORE the next navigation reloads index.html's boot script, so it
      // stamps data-skin/data-mode correctly on FIRST PAINT instead of booting 'system' — which
      // resolves to Playwright's default light colorScheme — and letting useSkinSync flip it only
      // after the profile query lands. That flip left .skin-control's transition (all
      // var(--motion-duration), ~0.18s) still interpolating a control's rendered color when axe
      // scanned, which is what actually produced the CI-only violation this guards against — a
      // WCAG-real read of an unsettled paint, not a real defect (instrumented and confirmed via a
      // throwaway diagnosis spec on fix/a11y-contrast-diagnosis, reported and closed unmerged).
      // page.goto() below is a full browser navigation (confirmed by the boot
      // script re-running), and localStorage is origin-scoped, so this write — made on the page
      // this function is ALREADY on, from signIn()'s own navigation — survives it. This removes
      // the race; it does not wait it out.
      await page.evaluate(
        ({ skin, mode }) => {
          localStorage.setItem('reverie.skin', skin)
          localStorage.setItem('reverie.mode', mode)
        },
        { skin, mode },
      )
      // Each goto below is a full navigation, so keepOfflineCacheEmpty's init script re-runs and
      // this skin/mode is read fresh rather than restored from the previous pass's snapshot.
      for (const [name, path] of routes) {
        // Explicit per-action budgets. Without them both calls inherit the whole-test timeout
        // (Playwright sends `timeout: 0`), which is why one stalled cover request could consume an
        // entire pass and report as an anonymous "test timeout" naming neither the route nor the
        // reason. 45s is ~45x the ~1s a healthy navigation takes here, so it cannot fire on a slow
        // runner — it fires only on a genuine stall, and names the route it fired on.
        await page.goto(path, { timeout: 45_000 })
        await page.waitForLoadState('networkidle', { timeout: 45_000 })
        await page.locator('main').waitFor({ state: 'visible' })
        await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
        await assertControlMaterialSettled(page, skin, mode, `${skin}/${mode} ${name}`)

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa'])
          .exclude(OVER_ART)
          .analyze()
        const serious = results.violations.filter(
          (v) => v.impact === 'serious' || v.impact === 'critical',
        )
        for (const v of serious) {
          const detail = v.nodes
            .slice(0, 2)
            .map((n) => {
              const d = n.any?.[0]?.data as
                | { fgColor?: string; bgColor?: string; contrastRatio?: number }
                | undefined
              return d?.contrastRatio != null
                ? `${String(n.target)} fg=${d.fgColor} bg=${d.bgColor} ratio=${d.contrastRatio}`
                : String(n.target)
            })
            .join(' || ')
          failures.push(
            `[${skin}/${mode}] ${name} (${path}): ${v.id} (${v.nodes.length}) — ${detail}`,
          )
        }
      }
      if (failures.length) console.log('axe serious/critical violations:\n' + failures.join('\n'))
      expect(failures, failures.join('\n')).toHaveLength(0)
    })
  }

  /**
   * The coverage claim, ASSERTED rather than trusted — and it survived the split by moving from a
   * runtime `visited` set to the PLAN itself.
   *
   * With one test per pass there is no shared state to accumulate into, and a `visited` set built
   * across independent tests would be a lie the moment one of them is skipped or filtered. Asserting
   * on the plan is stronger anyway: it holds even on a `--grep`'d run, and it fails at collection
   * time rather than after ten minutes of scanning.
   *
   * Registry-keyed exactly as before: a tenth skin added to SKIN_ORDER fails HERE until the sweep
   * covers it, instead of silently joining the five skins the four-skin era never scanned.
   */
  test('the sweep plan covers every skin in the registry', () => {
    console.log('a11y sweep plan: ' + sweep.map((s) => `${s.skin}/${s.mode}`).join(', '))
    expect(
      [...new Set(sweep.map((p) => p.skin))].sort(),
      'every skin in SKIN_ORDER must be swept',
    ).toEqual([...SKIN_ORDER].sort())
  })
})

// The unauthenticated front door (gold master brand) — no sign-in seed needed. Keep one test per
// route so each page owns Playwright's timeout budget. The former six-route loop exhausted its one
// 30s budget on different later routes across consecutive CI attempts even though every completed
// axe scan passed. The gold CTA's dark text and the brand's muted/faint copy must clear AA here too.
test.describe('unauthenticated front door axe', () => {
  const routes: [string, string][] = [
    ['Landing', '/'],
    ['Skin character · all 18 states', '/lab/skins'],
    ['Auth · sign in', '/auth?mode=signin'],
    ['Auth · sign up', '/auth?mode=signup'],
    // The email-link landing (/welcome): the expired-link view and the set-new-password form
    // both render without a session, driven purely by the callback hash.
    [
      'Welcome · expired link',
      '/welcome#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired',
    ],
    ['Welcome · set new password', '/welcome#type=recovery'],
  ]

  for (const [name, path] of routes) {
    test(name, async ({ page }) => {
      const failures: string[] = []
      await page.goto(path)
      await page.locator('main').first().waitFor({ state: 'visible' })
      await page.waitForLoadState('networkidle') // let the landing's lazy below-fold chunk render before scanning
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .exclude(OVER_ART)
        .analyze()
      for (const v of results.violations.filter(
        (x) => x.impact === 'serious' || x.impact === 'critical',
      )) {
        const detail = v.nodes
          .slice(0, 2)
          .map((n) => {
            const d = n.any?.[0]?.data as
              | { fgColor?: string; bgColor?: string; contrastRatio?: number }
              | undefined
            return d?.contrastRatio != null
              ? `${String(n.target)} fg=${d.fgColor} bg=${d.bgColor} ratio=${d.contrastRatio}`
              : String(n.target)
          })
          .join(' || ')
        failures.push(`[${name}] (${path}): ${v.id} (${v.nodes.length}) — ${detail}`)
      }
      if (failures.length) console.log('axe (unauth) violations:\n' + failures.join('\n'))
      expect(failures, failures.join('\n')).toHaveLength(0)
    })
  }
})
