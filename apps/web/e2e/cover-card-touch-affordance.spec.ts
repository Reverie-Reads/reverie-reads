import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

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

const FAVE_TITLE = 'Touch Toggle Probe'
const MATCH_TITLE = 'Dismiss Probe'

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
async function seedFixtures(c: Client): Promise<void> {
  await ok(
    c.sb.from('books').delete().eq('owner_id', c.uid).in('title', [FAVE_TITLE, MATCH_TITLE]),
    'cover-card-touch books delete',
  )
  // Every row carries EVERY column both rows touch, including defaults. PostgREST's bulk insert
  // takes the UNION of all rows' keys as the column set, so a key one row omits arrives as an
  // explicit NULL for it rather than the column default — which a NOT NULL column then rejects for
  // the WHOLE batch (AGENTS.md's testing discipline; bit this file on `fave` first).
  const base = {
    owner_id: c.uid,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    borrowed: false,
    wishlist: false,
    fave: false,
  }
  const { error } = await c.sb.from('books').insert([
    // inDefaultLibrary = isPossessed || hasReadingHistory — needs ownership: 'owned' to render on
    // /library without touching the wishlist filter.
    { ...base, title: FAVE_TITLE, ownership: 'owned' },
    // /match's score() reads the WHOLE library regardless of ownership; left unowned/unread on
    // purpose so novelty scores at its max (1) — a plain unread book with every other signal at
    // NEUTRAL (0.5) scores ~58 in taste-only mode, clearing the >=45 pick floor with margin.
    { ...base, title: MATCH_TITLE, ownership: 'unowned' },
  ])
  if (error) throw new Error(`cover-card-touch seed failed: ${JSON.stringify(error)}`)
}

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

async function stubBackgroundCalls(page: Page): Promise<void> {
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

const faveToggle = (page: Page) =>
  page.getByRole('button', { name: `Add ${FAVE_TITLE} to favorites` })

test.describe('CoverCard fave toggle — pointer-coarse reveal (mobile only)', () => {
  test.skip(({ isMobile }) => !isMobile, 'asserts the touch-only reveal path')

  test('the mobile project genuinely presents a coarse pointer — the premise this fix depends on', async ({
    page,
  }) => {
    // If Playwright's touch-viewport descriptor ever stops matching (pointer: coarse), the reveal
    // mechanism below has nothing to key off — this must fail LOUDLY on that, not pass vacuously
    // because the button happened to be visible for some other reason.
    await page.goto('about:blank')
    const isCoarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    expect(
      isCoarse,
      'the mobile project must present pointer: coarse for this test to mean anything',
    ).toBe(true)
  })

  test('an unfaved card wears the toggle at rest, with no hover or focus applied', async ({
    page,
  }) => {
    const c = await client()
    await seedFixtures(c)
    await stubBackgroundCalls(page)
    await signIn(page)
    await page.goto('/library')

    const toggle = faveToggle(page)
    await expect(toggle).toBeVisible({ timeout: 20_000 })
    // The computed style is what actually paints — a class-string check would pass even if the
    // pointer-coarse media query never matched in the shipped CSS.
    await expect(toggle).toHaveCSS('opacity', '1')
  })

  test('tapping the toggle flips aria-pressed and survives a reload', async ({ page }) => {
    const c = await client()
    await seedFixtures(c)
    await stubBackgroundCalls(page)
    await signIn(page)
    await page.goto('/library')

    const toggle = faveToggle(page)
    await expect(toggle).toBeVisible({ timeout: 20_000 })
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await toggle.tap()
    const faved = page.getByRole('button', { name: `Remove ${FAVE_TITLE} from favorites` })
    await expect(faved).toHaveAttribute('aria-pressed', 'true')

    await page.reload()
    await expect(
      page.getByRole('button', { name: `Remove ${FAVE_TITLE} from favorites` }),
    ).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
  })
})

test.describe('CoverCard fave toggle — quiet-until-hover contract (desktop only)', () => {
  test.skip(({ isMobile }) => !!isMobile, 'pins the mouse-only reveal this fix must not disturb')

  test('at rest the toggle is invisible; hovering the card reveals it', async ({ page }) => {
    const c = await client()
    await seedFixtures(c)
    await stubBackgroundCalls(page)
    await signIn(page)
    await page.goto('/library')

    // ESTABLISH "at rest" — the precondition this test asserts but never set up.
    //
    // Playwright's pointer persists across navigation. `signIn()` clicks "Enter your library", so
    // the mouse is left wherever that button was, and after `goto('/library')` a cover card can
    // land under it — firing `group-hover:opacity-100` and revealing the very control this
    // assertion says is hidden. It flaked three times that way (BACKLOG: "Known-flaky, with a
    // prior"), each time sampling the fade mid-flight — 0.695799, 0.837265 — and settling at 1,
    // an INCREASING sequence, which is the signature of a reveal rather than a wrong resting value.
    //
    // Moving the pointer to the origin is the fix rather than a wait: no duration makes a hovered
    // element un-hover, so a timeout or a retry here would only have changed how long the test took
    // to report the same wrong answer.
    await page.mouse.move(0, 0)

    const toggle = faveToggle(page)
    await expect(toggle).toBeVisible({ timeout: 20_000 }) // present in the DOM; opacity 0 hides it visually
    await expect(toggle).toHaveCSS('opacity', '0')

    await toggle.hover()
    await expect(toggle).toHaveCSS('opacity', '1')
  })
})

test('Next read "Show less often" — visible and functional under a touch tap (mobile only)', async ({
  page,
  isMobile,
}) => {
  test.skip(
    !isMobile,
    'this button had NO non-touch fallback at all — the mobile project is the only one that could ever have caught it being invisible',
  )
  const c = await client()
  await seedFixtures(c)
  await stubBackgroundCalls(page)
  await signIn(page)
  await page.goto('/match')
  await page.getByRole('combobox', { name: 'Choose from' }).selectOption('library')

  const card = page.getByRole('button', { name: `Open ${MATCH_TITLE}` })
  await expect(card).toBeVisible({ timeout: 20_000 })
  const dismiss = page.getByRole('button', { name: `Show ${MATCH_TITLE} less often` })
  await expect(dismiss).toHaveCSS('opacity', '1')

  await dismiss.tap()
  await expect(card).toHaveCount(0)
})
