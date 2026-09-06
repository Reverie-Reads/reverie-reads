import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// Curated Discover injection (docs/tasks/task-discover-curated-candidates.md): the four starved
// categories carry curated candidates in the pool; the five left on live query must NOT. The live
// window is stubbed EMPTY and the releases fn stubbed DOWN, so what renders is exactly the curated
// injection through the client fallback path — the same core blend the fn mirrors. An in-scope
// genre shows curated titles; an out-of-scope genre falls through to the honest empty state, which
// is this branch's scope-creep guard rendered on a real screen.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'discover-curated-e2e@reverie.local'
const PASSWORD = 'discover-curated-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
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
        'discover-curated createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Discover Curated E2E', skin: 'tryst', mode: 'dark' }),
    'discover-curated profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('discover-curated', EMAIL, error))
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
  // The releases fn is DOWN and the live window is EMPTY: everything that renders on an in-scope
  // shelf arrived through curated injection; an out-of-scope shelf has nothing at all.
  await page.route('**/functions/v1/releases**', (r) =>
    r.fulfill({ status: 500, json: { error: 'stubbed down' } }),
  )
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
  await page.route('**/functions/v1/embed**', (r) =>
    r.fulfill({ json: { hasTaste: false, scores: [] } }),
  )
  await page.route('**/functions/v1/search**', (r) => r.fulfill({ json: { results: [] } }))
  await page.route('**/functions/v1/enrich**', (r) => r.fulfill({ json: {} }))
  // Cover CDNs stay out of the test: the placeholder renders, the card's text is the assertion.
  await page.route('**covers.openlibrary.org/**', (r) => r.fulfill({ status: 404, body: '' }))
  await page.route('**books.google.com/books/content**', (r) =>
    r.fulfill({ status: 404, body: '' }),
  )
}

test('an in-scope genre surfaces curated titles through the same shelf; out-of-scope stays empty', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await client()
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/discover?browse=true')

  const chips = page.getByRole('group', { name: 'Browse a genre' })
  await chips.waitFor({ timeout: 20_000 })

  // Romance (in scope): with live empty, the shelf IS the curated set — newest-first by the tier
  // logic, so 2025 titles lead. Assert two known curated titles render as cards. (.first(): the
  // title also appears inside the cover placeholder's aria-hidden art, so two nodes match.)
  await chips.getByText('Romance', { exact: true }).click()
  await expect(page.getByText('Onyx Storm').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Quicksilver').first()).toBeVisible()

  // Mystery (in scope) — a different curated set, no romance leakage.
  await chips.getByText('Mystery', { exact: true }).click()
  await expect(page.getByText('The Thursday Murder Club').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Onyx Storm')).toHaveCount(0)

  // Horror (left on live query): the pool is untouched, so an empty window is an empty shelf —
  // the scope-creep guard. The empty state must show and no curated title may leak in.
  await chips.getByText('Horror', { exact: true }).click()
  await expect(page.getByText(/the smaller shelves run thin/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('The Thursday Murder Club')).toHaveCount(0)
  await expect(page.getByText('The Only Good Indians')).toHaveCount(0)
})
