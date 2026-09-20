import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'discover-releases-e2e@reverie.local'
const PASSWORD = 'discover-releases-e2e-password'

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
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'discover-releases createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Discover Releases E2E', skin: 'tryst', mode: 'dark' }),
    'discover-releases profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('discover-releases', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
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

function sampleRelease(title: string, days: number, kind?: 'new_work' | 'new_edition') {
  const now = new Date()
  now.setUTCDate(now.getUTCDate() + days)
  return {
    title,
    authors: ['Release Author'],
    isbn: '',
    cover: '',
    pub: now.toISOString().slice(0, 10),
    description: 'An edition-specific release for browser verification.',
    release: {
      source: 'hardcover',
      precision: 'day',
      sourceUrl: 'https://hardcover.app/books/example',
      checkedAt: new Date().toISOString(),
      kind,
      territory: 'US',
      formats: ['Hardcover'],
    },
  }
}
for (const width of [390, 1280]) {
  test(`release views separate current books, editions and catalog at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const c = await client()
    await page.route('**/functions/v1/releases', (route) =>
      route.fulfill({
        json: {
          hits: [
            sampleRelease('Fresh publication', -2, 'new_work'),
            sampleRelease('Future publication', 20, 'new_work'),
            sampleRelease('Old backlist', -400, 'new_work'),
            sampleRelease('Reprinted edition', -3, 'new_edition'),
            sampleRelease('Unconfirmed first publication', -1),
          ],
          providers: { hardcover: 'ready', prh: 'not_configured' },
          checkedAt: new Date().toISOString(),
        },
      }),
    )
    await page.route('**/functions/v1/enrich', (route) => route.fulfill({ json: {} }))
    await page.route('**/functions/v1/embed', (route) =>
      route.fulfill({ json: { hasTaste: false, scores: [] } }),
    )
    await signIn(page, c.session)
    await page.goto('/discover?view=releases')
    const nav = page.getByRole('navigation', { name: 'Discover sections' })
    await expect(nav.getByRole('link', { name: 'New & upcoming' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      page.getByRole('button', { name: 'View details for Fresh publication', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Shared catalog', exact: true })).toHaveCount(0)
    await expect(page.getByText('Old backlist', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Reprinted edition', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'New books only', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'View details for Reprinted edition', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('New edition', { exact: true })).toBeVisible()
    await expect(page.getByText('Edition release', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next six months', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'View details for Future publication', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'View details for Fresh publication', exact: true }),
    ).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`releases-${width}.png`), fullPage: true })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const before = await c.sb.from('books').select('id').eq('owner_id', c.uid)
    if (before.error) throw before.error
    await page
      .getByRole('button', { name: 'View details for Future publication', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Future publication', exact: true })
    await expect(dialog.getByText('Release date', { exact: true })).toBeVisible()
    const after = await c.sb.from('books').select('id').eq('owner_id', c.uid)
    if (after.error) throw after.error
    expect(after.data).toEqual(before.data)
    await dialog.getByRole('link', { name: 'Add to wishlist', exact: true }).click()
    await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue('Future publication')
    await expect(page).toHaveURL(/want=true/)
    await page.goBack()
    await expect(nav.getByRole('link', { name: 'New & upcoming' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await nav.getByRole('link', { name: 'Curated picks', exact: true }).click()
    await page.getByRole('button', { name: 'Romance', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Curated picks', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New & upcoming', exact: true })).toHaveCount(0)
    await nav.getByRole('link', { name: 'Shared catalog', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Shared catalog', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Curated picks', exact: true })).toHaveCount(0)
  })
}

test('release failure offers recovery instead of claiming an empty shelf', async ({ page }) => {
  const c = await client()
  let fail = true
  await page.route('**/functions/v1/releases', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.fulfill({
          json: {
            hits: [],
            providers: { hardcover: 'ready', prh: 'unavailable' },
            checkedAt: new Date().toISOString(),
          },
        }),
  )
  await signIn(page, c.session)
  await page.goto('/discover?view=releases')
  await expect(page.getByRole('alert')).toContainText('couldn’t be refreshed')
  await expect(page.getByText(/No releases match/)).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText(/One release source is unavailable/)).toBeVisible()
  await expect(page.getByText(/No releases match/)).toBeVisible()
})
