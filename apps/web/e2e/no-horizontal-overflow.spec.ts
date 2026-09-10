import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'
import { expectNoHorizontalScroll } from './support/layout'

// ADR 0003's open question, closed. Add's cover preview was the ONE surface where the latent genre
// gradient reached the screen: it drew its cover conditionally — `{cover && <CoverImage …/>}` — so a
// book with no cover left the gradient box bare. Every other surface renders CoverImage
// unconditionally, and CoverImage always paints something opaque (an <img>, or the placeholder when
// the candidate chain is exhausted).
//
// The guard measures the same way the four-surface audit did: ask the browser what is actually
// painted at the gradient box's centre. If the placeholder is on top, the gradient is occluded and
// Add matches everywhere else.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'no-h-overflow-e2e@reverie.local'
const PASSWORD = 'no-h-overflow-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
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
        'add-preview-plate auth createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Add Preview Plate', skin: 'tryst', mode: 'system' }),
    'add-preview-plate profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('add-preview-plate', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
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

// Horizontal-overflow guard. The page must never pan sideways on a phone.
//
// The confirmed regression this exists for: AddRoute's column around ContributorEditor was a
// `flex-1` child without `min-w-0`, so it could not shrink below its children's intrinsic minimum
// and pushed the document wider than the viewport — measured scrollWidth 532 vs clientWidth 390.
// An EMPTY form does not reproduce it; the contributor row is what sets the floor, so these tests
// populate one before asserting. Assertions live in support/layout.ts (shared, opt-in — SpineShelf
// scrolls horizontally by design, so this must never be applied blindly to every page).
const MOBILE = { width: 390, height: 844 }

test('the Add screen does not scroll sideways with contributors populated', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await client()
  await stub(page)
  await page.setViewportSize(MOBILE)
  await signIn(page, c.session)

  await page.goto('/add')
  await page.getByRole('button', { name: /add manually/i }).click()
  const title = page.getByPlaceholder('Title', { exact: true })
  await expect(title).toBeVisible({ timeout: 10_000 })
  await title.fill('The Overflow Probe')

  // Two contributors, with names long enough to be realistic. Two also enables the up/down
  // buttons, so the row carries its full five-control width rather than a reduced one.
  const addC = page.getByRole('button', { name: /Add contributor/i })
  await addC.click()
  await page.getByLabel('Contributor 1 name').fill('Alexandra Wollstonecraft-Bennett')
  await addC.click()
  await page.getByLabel('Contributor 2 name').fill('Jonathan Featherstonehaugh')
  await page.waitForTimeout(300)

  await expectNoHorizontalScroll(page, '/add with two contributors')
})

test('the book edit dialog does not scroll sideways with contributors populated', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await client()
  await stub(page)
  await page.setViewportSize(MOBILE)

  const { data } = await c.sb
    .from('books')
    .insert({
      owner_id: c.uid,
      title: 'Dialog Overflow Probe',
      author_first: 'Alexandra',
      author_last: 'Wollstonecraft-Bennett',
      genre: 'fantasy',
      ownership: 'owned',
      status: 'standalone',
    })
    .select('id')
    .single()
  const id = (data as { id: string }).id

  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Dialog Overflow Probe' })).toBeVisible({
      timeout: 20_000,
    })
    await page.getByRole('button', { name: /edit details/i }).click()
    const addC = page.getByRole('button', { name: /Add contributor/i })
    await expect(addC).toBeVisible({ timeout: 10_000 })
    await addC.click()
    await page.getByLabel('Contributor 1 name').fill('Alexandra Wollstonecraft-Bennett')
    await addC.click()
    await page.getByLabel('Contributor 2 name').fill('Jonathan Featherstonehaugh')
    await page.waitForTimeout(300)

    // Shares ContributorEditor with /add but sits in a plain block rather than a flex row — a
    // different container, so it needs its own measurement rather than an assumption.
    await expectNoHorizontalScroll(page, 'book edit dialog with two contributors')
  } finally {
    await c.sb.from('books').delete().eq('id', id)
  }
})

// The rest of the app, in its default state. Cheap (one navigation each) and it means a future
// layout change anywhere is caught by SOME test rather than none.
//
// /clubs was ABSENT from this list until the visual-overflow audit found it overflowing every phone
// width (scrollWidth 450 at a 375 viewport, constant across widths — a layout floor, not a
// text-length edge case). It is added here, and unlike the other routes it needs a fixture: an empty
// /clubs is two empty-state paragraphs and cannot overflow whatever the layout does, so listing the
// route without seeding a club would add a name to this array and no coverage at all.
const ROUTES = [
  '/library',
  '/covers',
  '/add',
  '/shelves',
  '/discover',
  '/stats',
  '/settings',
  '/planner',
  '/planner?tab=calendar',
  '/clubs',
]
test('no route scrolls sideways at a phone viewport', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await stub(page)
  await page.setViewportSize(MOBILE)

  // A club with a name a person would plausibly choose. The card is the widest thing on /clubs, and
  // a short title hides the defect entirely — see route-viewport.spec.ts's fixture, which did.
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await ok(admin.from('clubs').delete().eq('created_by', c.uid), 'no-h-overflow clubs delete')
  const { data: club, error: clubErr } = await admin
    .from('clubs')
    .insert({
      title: 'The Thursday Evening Romantasy Read-Along Society',
      unit_type: 'chapter',
      unit_count: 30,
      created_by: c.uid,
    })
    .select('id')
    .single()
  if (clubErr || !club) throw new Error(`no-h-overflow club failed: ${JSON.stringify(clubErr)}`)
  await ok(
    admin.from('club_members').insert({
      club_id: (club as { id: string }).id,
      user_id: c.uid,
      display_name: 'Overflow Probe',
      progress: 3,
    }),
    'no-h-overflow club_members insert',
  )

  await signIn(page, c.session)

  for (const r of ROUTES) {
    await page.goto(r)
    await page.waitForTimeout(700)
    await expectNoHorizontalScroll(page, r)
  }
})
