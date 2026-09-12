import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// Search text belongs in the route, not in component state — the same defect class as the tab bug
// and the same fix shape (fix/tab-routing, #97, 937f2e4).
//
// The route tree is flat: every screen is a sibling under rootRoute, so navigating away fully
// unmounts the screen and `useState` re-initialises on the way back. Three search fields get the
// fix here — /tropes `q`, /discover `query`, /match `vibeQ` — each a validated search param,
// `undefined` for the default so the canonical URL stays bare, written with `replace: true` so back
// means "leave the page" rather than "undo a keystroke".
//
// /shelves' `openListId` was a fourth and is NOT one: see the note where its block used to be.
//
// ── WHEN each one syncs, which is NOT uniform and is the whole judgement in this file ───────────
//   /tropes    filters instantly client-side, so the URL sync is DEBOUNCED — otherwise every
//              keystroke pushes a history entry through `replace`.
//   /discover  already debounces 400ms into `debounced` for its own search; the URL reuses THAT
//              value rather than starting a second timer that could disagree with it.
//   /match     is submit-triggered, not live-filtered. The field means "the search you ran", so it
//              syncs when the reader presses the button, never on a debounce.
//
// ── WHY THE ASSERTIONS LOOK LIKE THIS ──────────────────────────────────────────────────────────
// Each param gets three: the URL gains it (the write), a fresh load of that URL repopulates the
// field (the read), and a real `goBack()` restores it (the reported defect). The read test is not
// redundant with the back test — a param can be written and still be ignored on mount, which is
// exactly half the bug.
//
// Assertions are on the input's VALUE and the URL, never on filtered results, so these do not
// depend on catalogue data that could drift.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// Per-project users: `rest` and `mobile` run in parallel and each execute beforeAll, so a shared
// fixture account means two seeds interleave and a test reads a list the other one deleted.
const PROJECT = (): string => test.info().project.name
const EMAIL = () => `search-params-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'search-params-e2e-password'

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
        'search-params createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Search Params E2E', skin: 'tryst', mode: 'dark' }),
    'search-params profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('search-params', EMAIL(), error))
  const c = { sb, session: s.session, uid: s.session.user.id }
  shared.set(PROJECT(), c)
  return c
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

async function stub(page: Page) {
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

// ── /tropes · q ────────────────────────────────────────────────────────────────────────────────
test.describe('/tropes keeps its search text', () => {
  const FIELD = /^Search /

  test('typing writes q to the URL, debounced', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/tropes')
    await page.getByLabel(FIELD).fill('enemies')
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('q=enemies')
  })

  test('a fresh load of ?q= repopulates the field', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/tropes?q=enemies')
    await expect(page.getByLabel(FIELD)).toHaveValue('enemies')
  })

  test('back-navigation restores the text', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/tropes')
    await page.getByLabel(FIELD).fill('enemies')
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('q=enemies')

    await page.goto('/library')
    await page.locator('main').waitFor({ state: 'visible' })
    await page.goBack()

    await expect(page.getByLabel(FIELD)).toHaveValue('enemies')
  })

  test('a garbage q fails CLOSED — empty field, no crash', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    // An array-valued param is the shape a hand-edited or doubled query string produces, and the
    // one a `typeof === 'string'` guard has to survive rather than throw on.
    await page.goto('/tropes?q[]=a&q[]=b')
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByLabel(FIELD)).toHaveValue('')
  })
})

// ── /discover · query ──────────────────────────────────────────────────────────────────────────
test.describe('/discover keeps its search text', () => {
  const FIELD = 'Search the wider catalog'

  test('typing writes query to the URL, reusing the existing 400ms debounce', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/discover?browse=true')
    await page.getByLabel(FIELD).fill('dragons')
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('query=dragons')
  })

  test('a fresh load of ?query= repopulates the field', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/discover?query=dragons')
    await expect(page.getByLabel(FIELD)).toHaveValue('dragons')
  })

  test('back-navigation restores the text, and does not disturb genre', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/discover?genre=fantasy')
    await page.getByLabel(FIELD).fill('dragons')
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('query=dragons')
    // The pre-existing param must survive the new one being written.
    expect(page.url()).toContain('genre=fantasy')

    await page.goto('/library')
    await page.locator('main').waitFor({ state: 'visible' })
    await page.goBack()

    await expect(page.getByLabel(FIELD)).toHaveValue('dragons')
    expect(page.url()).toContain('genre=fantasy')
  })

  test('a garbage query fails CLOSED', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/discover?browse=true&query[]=a&query[]=b')
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByLabel(FIELD)).toHaveValue('')
  })
})

test('guided Discover restores its search after a library visit and refresh, and rejects malformed input', async ({
  page,
}) => {
  const c = await client()
  await signIn(page, c.session)
  await stub(page)
  const field = page.getByRole('textbox', { name: 'Search by title, author, or ISBN' })
  await page.goto('/discover')
  await field.fill('dragons')
  await expect.poll(() => new URL(page.url()).searchParams.get('find')).toBe('dragons')
  await page.goto('/library')
  await expect(page.locator('main')).toBeVisible()
  await page.goBack()
  await expect(field).toHaveValue('dragons')
  await page.reload()
  await expect(field).toHaveValue('dragons')
  await page.goto('/discover?find[]=a&find[]=b')
  await expect(field).toHaveValue('')
})

// ── /match · vibeQ ─────────────────────────────────────────────────────────────────────────────
test.describe('/match keeps the vibe it ran', () => {
  const FIELD = 'Describe tonight’s vibe'

  test('typing alone does NOT write to the URL — only submitting does', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/match')
    await page.getByText('Refine choices', { exact: true }).click()
    await page.getByLabel(FIELD).fill('cozy rivals')
    // Long enough that a debounce, if one existed, would have fired. The field means "the search
    // you ran"; a half-typed phrase is not that.
    await page.waitForTimeout(1200)
    expect(page.url()).not.toContain('vibeQ')
  })

  test('submitting writes vibeQ, and it survives back-navigation', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/match')
    await page.getByText('Refine choices', { exact: true }).click()
    await page.getByLabel(FIELD).fill('cozy rivals')
    await page.getByRole('button', { name: 'Find this mood' }).click()
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain('vibeQ=cozy')

    await page.goto('/library')
    await page.locator('main').waitFor({ state: 'visible' })
    await page.goBack()
    await page.getByText('Refine choices', { exact: true }).click()

    await expect(page.getByLabel(FIELD)).toHaveValue('cozy rivals')
  })

  test('a garbage vibeQ fails CLOSED', async ({ page }) => {
    const c = await client()
    await signIn(page, c.session)
    await stub(page)

    await page.goto('/match?vibeQ[]=a&vibeQ[]=b')
    await page.getByText('Refine choices', { exact: true }).click()
    await expect(page.locator('main')).toBeVisible()
    await expect(page.getByLabel(FIELD)).toHaveValue('')
  })
})

// NO /shelves BLOCK, deliberately. `openListId` was persisted here and the param was dropped before
// merge: it drives the shelf's edit SHEET (a ListModal), not an accordion as the BACKLOG entry had
// it, so persisting it made back-navigation re-open a modal nobody clicked. The tab half of
// /shelves is already covered by tab-routing.spec.ts and is untouched by this file.
