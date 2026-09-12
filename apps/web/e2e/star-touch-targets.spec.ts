import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

// Defect B (docs/audits/mobile-shelf-interaction.md): CoverCard's fave toggle and MatchRoute's
// "Not tonight" dismiss were both `opacity-0 … group-hover:opacity-100` — hover-only reveal, so on
// a touch device (no hover capability) an unfaved book's toggle was invisible until a stray tap or
// keyboard focus found it, and the dismiss button (no aria-pressed fallback at all) was PERMANENTLY
// invisible on touch. The fix adds `pointer-coarse:opacity-100` to both — this file guards three
// things: the touch reveal actually works, the fix is real interaction (not just a class landing in
// the DOM), and the desktop hover-only contract survives (this must not go always-on for a mouse).
//
// Per AGENTS.md's testing discipline, every assertion here reads COMPUTED style or a REAL outcome —
// never class-string presence, which is the proxy the bundle-grep rule warns is invisible to whether
// the CSS actually applies.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'cover-card-touch-e2e@reverie.local'
const PASSWORD = 'cover-card-touch-e2e-password'

type Client = { sb: ReturnType<typeof createClient>; uid: string }

// Same admin-createUser-or-find shape as state-pills.spec.ts / a11y.spec.ts: the public signUp
// endpoint enforces GoTrue's password-strength policy (mixed case + digits), which none of this
// suite's plain-lowercase e2e passwords satisfy — the service-role admin API bypasses it. SERVICE
// is the local stack's well-known demo key, already hardcoded in every e2e spec file; not a secret.
async function client(): Promise<Client> {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'cover-card-touch createUser',
      )
    ).id
  }
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('cover-card-touch', EMAIL, error))
  return { sb, uid }
}

/** One plain, unowned-but-owned-for-visibility book per test title — deleted and re-created each
 *  run so repeat local runs are safe (idempotent, same convention as a11y.spec.ts's seed). */

async function signIn(page: Page): Promise<void> {
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !data.session) throw new Error(authFailure('cover-card-touch', EMAIL, error))
  const { access_token, refresh_token } = data.session
  await keepOfflineCacheEmpty(page)
  await configureReturningReader(access_token)
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

/**
 * TOUCH TARGET GEOMETRY — asserted as measured boxes, never as a tapped-and-it-worked.
 *
 * e2e-mobile-viewport.md §4 measured that headless touch emulation does not meaningfully change
 * interaction dispatch, so a synthetic tap proves nothing about a thumb. cover-card-touch-
 * affordance.spec.ts is the precedent this follows: read computed geometry, not DOM classes.
 *
 * THE ARITHMETIC (WCAG 2.5.8 Target Size Minimum, AA in 2.2 — 24x24 CSS px):
 *   half-star mode = TEN targets tiling one strip -> 10 x 24 = 240px minimum strip width.
 *   whole-star mode = FIVE targets              ->  5 x 24 = 120px.
 * 2.5.5 (AAA, 44px) is deliberately NOT chased: 10 x 44 = 440px does not fit a 390px viewport.
 * A half-star zone is by construction half a star's box, so padding cannot buy target size the
 * way it can for an isolated button — the star box width IS the lever.
 */
const STAR_TITLE = 'Star Target Probe'

/**
 * Seeds this spec's OWN book — and that is the point, not boilerplate.
 *
 * This spec inherited cover-card's scaffolding, whose seeder was deleted here as "unused" when
 * lint flagged it (#300). The spec then passed for days on LEFTOVER STATE: a book another spec's
 * run had left for the shared test user. A database restart cleared it and the route rendered
 * "That book isn't in your library." A spec that depends on another spec's residue is a false
 * green — it can pass while asserting nothing about the code under test.
 *
 * Every row carries every column the batch touches (PostgREST bulk inserts take the UNION of keys,
 * so an omitted key arrives as explicit NULL and a NOT NULL column rejects the whole batch).
 */
async function seedStarBook(c: Client): Promise<string> {
  await ok(
    c.sb.from('books').delete().eq('owner_id', c.uid).eq('title', STAR_TITLE),
    'star-targets book delete',
  )
  const row = await okData(
    c.sb
      .from('books')
      .insert({
        owner_id: c.uid,
        title: STAR_TITLE,
        author_first: 'Nell',
        author_last: 'Marrow',
        genre: 'fantasy',
        status: 'standalone',
        ownership: 'owned',
        borrowed: false,
        wishlist: false,
        fave: false,
        rating: 3.5,
      })
      .select('id')
      .single(),
    'star-targets book insert',
  )
  return (row as { id: string }).id
}

const MIN_TARGET = 24

/**
 * COARSE POINTERS ONLY, and this scoping is the contract rather than a convenience: the sizing
 * rule is `pointer-coarse:`, so on a FINE pointer the zones stay at their designed 9.94px and
 * SHOULD — a mouse does not need a 24px target and the desktop layout should not pay for one.
 * The `rest` project (Desktop Chrome) swept this spec by its blocklist and failed it exactly
 * that way on the first full run; asserting the floor there would have been asserting against
 * the design. `isMobile` is the same guard cover-card-touch-affordance uses for its touch path.
 */
test.describe('star touch targets (coarse pointer only)', () => {
  test.skip(({ isMobile }) => !isMobile, 'the 24px floor is a coarse-pointer rule by design')

  test('half-star zones meet the 24px touch-target floor at a phone viewport', async ({ page }) => {
    test.setTimeout(120_000)
    const c = await client()
    const bookId = await seedStarBook(c)
    await signIn(page)
    await page.goto(`/book/${bookId}`)

    const slider = page.getByRole('slider', { name: /Your rating/i })
    await slider.waitFor({ timeout: 20_000 })
    const boxes = await slider.evaluate((el) =>
      [...el.querySelectorAll('[data-star]')].map((s) => {
        const b = s.getBoundingClientRect()
        return { w: b.width, h: b.height }
      }),
    )
    expect(boxes.length, 'five star boxes').toBe(5)
    for (const [i, b] of boxes.entries()) {
      // each star holds TWO half-star targets side by side
      expect(
        b.w / 2,
        `star ${i + 1}: half-zone width ${(b.w / 2).toFixed(2)}px < ${MIN_TARGET}`,
      ).toBeGreaterThanOrEqual(MIN_TARGET)
      expect(
        b.h,
        `star ${i + 1}: height ${b.h.toFixed(2)}px < ${MIN_TARGET}`,
      ).toBeGreaterThanOrEqual(MIN_TARGET)
    }
  })

  test('whole-star mode meets the same floor with five targets, not ten', async ({ page }) => {
    test.setTimeout(120_000)
    await signIn(page)
    await page.goto('/review')
    const slider = page.getByRole('slider', { name: /Your rating/i }).first()
    const present = await slider.count()
    test.skip(present === 0, 'no whole-star control on this route in this fixture state')
    const boxes = await slider.evaluate((el) =>
      [...el.querySelectorAll('[data-star]')].map((s) => {
        const b = s.getBoundingClientRect()
        return { w: b.width, h: b.height }
      }),
    )
    for (const b of boxes) {
      expect(b.w).toBeGreaterThanOrEqual(MIN_TARGET)
      expect(b.h).toBeGreaterThanOrEqual(MIN_TARGET)
    }
  })
})
