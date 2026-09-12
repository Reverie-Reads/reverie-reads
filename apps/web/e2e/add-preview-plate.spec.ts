import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

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
// PER-PROJECT ISOLATION. `rest` and `mobile` run this file concurrently, and both raced one shared
// account: each calls listUsers(), each sees no such user, each calls createUser(), and the loser
// gets `422 email_exists` before a single assertion runs. It only fires when the account does not
// already exist, which is why it looked intermittent — a warm database hides it. Same fix as
// scroll-restoration and the search-param specs.
const PROJECT = (): string => test.info().project.name
const EMAIL = () => `add-preview-plate-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'add-preview-plate-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
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
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL(), password: PASSWORD, email_confirm: true }),
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
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('add-preview-plate', EMAIL(), error))
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

test('a coverless book in the Add form gets the designed plate, not a bare gradient', async ({
  page,
}) => {
  const c = await client()
  await stub(page)
  await signIn(page, c.session)

  await page.goto('/add')
  await page.getByRole('button', { name: /add manually/i }).click()

  // `exact` matters: the search box's placeholder is "Title, author, or ISBN", so a substring
  // match resolves to two elements and trips strict mode.
  const title = page.getByPlaceholder('Title', { exact: true })
  await expect(title).toBeVisible({ timeout: 10_000 })
  await title.fill('A Book With No Cover At All')

  // The placeholder is a role=img with an accessible label — proof CoverImage rendered its
  // fallback rather than nothing. Before the fix this box was empty for a coverless book.
  const plate = page.getByRole('img', { name: /A Book With No Cover At All.*placeholder cover/i })
  await expect(plate).toBeVisible()

  // And it OCCLUDES the gradient: whatever is painted at the gradient box's centre must be the
  // plate (or inside it), never the gradient div itself. Same measurement as the ADR's audit.
  const occluded = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>('[style*="linear-gradient(150deg"]')
    if (!box) return { found: false, occluded: false }
    const r = box.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { found: true, occluded: !!top && top !== box && box.contains(top) }
  })
  expect(occluded.found, 'the gradient box should exist in the Add form').toBe(true)
  expect(occluded.occluded, 'the gradient must be covered by the placeholder plate').toBe(true)
})
