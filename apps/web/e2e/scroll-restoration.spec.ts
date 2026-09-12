import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// Scroll position across navigation (`scrollRestoration` on createRouter).
//
// TanStack ships the behaviour and it was simply unconfigured, which is wrong in BOTH directions —
// so both are asserted here, and they are genuinely different failures:
//
//   FORWARD  navigating to a new route kept the PREVIOUS page's scroll offset, so a book page could
//            open halfway down its own content.
//   BACK     returning to a list did not restore where you were, dumping the reader at the top of a
//            library they had scrolled a long way into.
//
// One option fixes both, which is exactly why it is on its own branch: a red run here has to mean
// one thing.
//
// The assertions read `window.scrollY` after the navigation has settled rather than immediately —
// restoration happens after the route renders, and asserting on the first frame would measure the
// scheduling, not the behaviour.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
// PER-PROJECT ISOLATION: `rest` and `mobile` run in parallel and each execute beforeAll, so a
// single shared fixture user means two seeds interleave — delete, delete, insert, insert — and the
// grid a test scrolls is not the one it seeded. Scoping the user and the titles by project name
// removes the shared state rather than timing around it.
const PROJECT = (): string => test.info().project.name
const EMAIL = () => `scroll-restoration-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'scroll-restoration-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  session: { access_token: string; refresh_token: string }
  uid: string
}
const shared = new Map<string, Client>()

async function client(): Promise<Client> {
  const cached = shared.get(PROJECT())
  if (cached) return cached
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL())?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL(), password: PASSWORD, email_confirm: true }),
        'scroll-restoration createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Scroll E2E', skin: 'tryst', mode: 'dark' }),
    'scroll-restoration profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('scroll-restoration', EMAIL(), error))
  const c = { sb, session: s.session, uid: s.session.user.id }
  shared.set(PROJECT(), c)
  return c
}

/** Enough books that /library scrolls well past a viewport. */
async function seed(c: Client): Promise<void> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await ok(c.sb.from('books').delete().in('id', ids), 'scroll books delete')

  // Every row carries every column the batch uses — PostgREST takes the UNION of all rows' keys, so
  // a key omitted from one row is sent as an explicit NULL rather than the column default.
  const rows = Array.from({ length: 40 }, (_, i) => ({
    owner_id: c.uid,
    title: `Scroll Probe ${String(i + 1).padStart(2, '0')}`,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }))
  const { error } = await c.sb.from('books').insert(rows)
  if (error) throw new Error(`scroll-restoration seed failed: ${JSON.stringify(error)}`)
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

const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY))

test.beforeAll(async () => {
  const c = await client()
  await seed(c)
})

// CHARACTERISATION, NOT A GUARD FOR THIS FIX — and the distinction is load-bearing.
// Mutation-checked: this test passes with `scrollRestoration` REMOVED, so forward-nav-starts-at-top
// was already true and the option is not what delivers it. The BACKLOG entry claimed the behaviour
// was "wrong in both directions"; only the back half reproduced. Kept because a future regression
// that starts carrying scroll forward would be a real defect and nothing else watches for it — but
// it must not be read as evidence that this PR's one-line change works. The back test below is that
// evidence.
test('forward navigation starts at the top, not at the previous page’s offset', async ({
  page,
}) => {
  const c = await client()
  await signIn(page, c.session)

  await page.goto('/library')
  await page.locator('main').waitFor({ state: 'visible' })
  await expect(page.getByText('Scroll Probe 01').first()).toBeVisible({ timeout: 20_000 })

  await page.evaluate(() => window.scrollTo(0, 1200))
  await expect.poll(() => scrollY(page), { timeout: 15_000 }).toBeGreaterThan(400)

  // Navigate to a DIFFERENT route while scrolled down.
  await page.getByRole('button', { name: new RegExp('^Open Scroll Probe 01') }).click()
  await page.locator('main').waitFor({ state: 'visible' })

  // Without scrollRestoration the offset carried over and the book page opened mid-content.
  await expect
    .poll(() => scrollY(page), {
      message: 'the new route kept the previous page’s scroll offset',
      // Generous because restoration lands after the route renders, and the two projects share one
      // dev server — the default 5s was tight enough to fail under parallel load while passing
      // alone, which reads exactly like a real defect and is not one.
      timeout: 15_000,
    })
    .toBeLessThan(100)
})

// Desktop only, deliberately. The mobile leave-gesture has to go through a book route (its Shelves
// link is behind the bottom nav's "more" sheet), and restoration after that round trip lands
// unpredictably — measured flaky across repeated runs: two clean passes, then a failure that used
// the full 15s poll, with no code change between them. A test that fails one run in three teaches
// people to re-run rather than to look, so it runs where it is deterministic and says why here. The
// property under test is viewport-independent; the desktop assertion is what proves the option.
test('back navigation restores where the reader was', async ({ page, isMobile }) => {
  // Keyed to `isMobile` — the thing the note above is actually about (the touch viewport's only
  // leave-gesture routes through /book) — not to the project NAME, which was a proxy: the
  // layout-390 sweep project re-ran this at 390px under a different name and flaked exactly as
  // documented on its first dispatch-shaped run. Any touch-viewport project, present or future,
  // skips here for the same reason.
  test.skip(
    isMobile,
    'a touch viewport’s only leave-gesture routes through /book, where restoration timing is flaky — see the note above',
  )
  const c = await client()
  await signIn(page, c.session)

  await page.goto('/library')
  await page.locator('main').waitFor({ state: 'visible' })
  await expect(page.getByText('Scroll Probe 01').first()).toBeVisible({ timeout: 20_000 })

  await page.evaluate(() => window.scrollTo(0, 1200))
  await expect.poll(() => scrollY(page), { timeout: 15_000 }).toBeGreaterThan(400)
  const before = await scrollY(page)

  // Leaving /library, via the app's OWN nav — never page.goto, which is a full document load the
  // client-side router never sees, so its scroll restoration never engages. That distinction IS the
  // mechanism under test; using goto made this fail on both viewports for an unrelated reason.
  //
  // The gesture differs by viewport because neither is a real navigation on both: on DESKTOP a cover
  // click keeps a selected-book rail and never leaves /library, and on MOBILE the Shelves link sits
  // behind the bottom nav's "more" sheet, so that locator just times out.
  //
  // `isMobile`, not the project NAME — same class as the skip above: the name was a proxy that
  // broke twice in one week when new 390px projects appeared under other names (mobile-webkit,
  // layout-390). Under the isMobile skip this branch is currently unreachable; it keys to the
  // property anyway so lifting that skip can never resurrect the proxy.
  if (isMobile) {
    await page.getByRole('button', { name: new RegExp('^Open Scroll Probe 01') }).click()
    await page.waitForURL(/\/book\//)
  } else {
    const shelves = page
      .getByRole('navigation', { name: 'Primary', exact: true })
      .getByRole('link', { name: 'Shelves', exact: true })
    // A reader clicks the persistent sidebar where they are. Playwright must not scroll the
    // entire library back to a vanished sidebar before clicking and change the position to save.
    await expect(shelves).toBeInViewport({ ratio: 1 })
    await shelves.click()
    await page.waitForURL(/\/shelves/)
  }
  await page.locator('main').waitFor({ state: 'visible' })
  await page.goBack()
  await page.locator('main').waitFor({ state: 'visible' })
  // Deliberately NOT waiting on a specific title: restoring to ~1200px scrolls the first rows out of
  // the rendered window, so waiting for "Scroll Probe 01" fails for the very reason the test asserts.
  // The poll below is the wait.

  await expect
    .poll(() => scrollY(page), {
      message: 'back navigation did not restore the scroll position',
      timeout: 15_000,
    })
    .toBeGreaterThan(before - 200)
})
