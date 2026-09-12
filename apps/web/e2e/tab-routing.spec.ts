import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

// Tab state belongs in the route, not in component state (fix/tab-routing).
//
// The reported defect: /shelves → Collections tab → open a shelf → browser back → /shelves comes
// back with the DEFAULT tab selected. The route tree is flat (every screen is a sibling under
// rootRoute), so navigating away fully unmounts the screen and `useState` re-initializes on the way
// back. Three surfaces had it — /shelves, /planner, /shelf/$listId — and the fix is the pattern
// AuthRoute already uses: a validated search param, `undefined` for the default so the canonical
// URL stays clean, written with `replace: true` so back means "leave the page", not "undo a tab".
//
// Every test here drives the real controls and asserts on `aria-pressed`, which is the same thing
// a screen reader reads — a tab that LOOKS selected but reports otherwise is still broken.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'tab-routing-e2e@reverie.local'
const PASSWORD = 'tab-routing-e2e-password'

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
        admin.auth.admin.createUser({
          email: EMAIL,
          password: PASSWORD,
          email_confirm: true,
        }),
        'tab-routing createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Tab Routing E2E', skin: 'tryst', mode: 'system' }),
    'tab-routing profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('tab-routing', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

/** One book + one TBR list + one collection, so both /shelves tabs have something to show and
 *  /shelf/$listId has a real shelf to open. Idempotent: clears this user's rows first. */
async function seedFixtures(c: Client): Promise<{ bookId: string; collectionId: string }> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'tab-routing list_items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'tab-routing books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'tab-routing lists delete')

  const book = (await okData(
    c.sb
      .from('books')
      .insert({
        owner_id: c.uid,
        title: 'Tab Routing Probe',
        author_first: 'Nell',
        author_last: 'Marrow',
        genre: 'fantasy',
        ownership: 'owned',
        status: 'standalone',
      })
      .select('id')
      .single(),
    'tab-routing books insert',
  )) as { id: string }

  // A collection (the NON-default tab on /shelves) with the book in it, so opening it from the
  // Collections tab lands on a shelf that renders both the spines and grid views.
  const collection = (await okData(
    c.sb
      .from('lists')
      .insert({
        owner_id: c.uid,
        name: 'Tab Routing Collection',
        kind: 'collection',
        sort_order: 1,
      })
      .select('id')
      .single(),
    'tab-routing lists insert',
  )) as { id: string }
  await ok(
    c.sb.from('lists').insert({
      owner_id: c.uid,
      name: 'Tab Routing TBR',
      kind: 'tbr',
      sort_order: 2,
    }),
    'tab-routing lists insert',
  )
  await ok(
    c.sb
      .from('list_items')
      .insert({ list_id: collection.id, book_id: book.id, owner_id: c.uid, position: 1 }),
    'tab-routing list_items insert',
  )

  return { bookId: book.id, collectionId: collection.id }
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

const tab = (page: Page, name: string | RegExp) => page.getByRole('button', { name })

// ── the reported defect, once per surface ────────────────────────────────────────────────────
// Select the non-default tab, navigate away to a DETAIL route (a full unmount — the flat route
// tree has no shared parent to preserve state), come back, and require the tab to have survived.

test('/shelves keeps the Collections tab across back-navigation', async ({ page }) => {
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)

  await page.goto('/shelves')
  await tab(page, 'Collections').click()
  await expect(tab(page, 'Collections')).toHaveAttribute('aria-pressed', 'true')

  // Open the shelf from the Collections tab — the exact path in the defect report.
  await page
    .getByRole('button', { name: /Tab Routing Collection/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/shelf\//)

  await page.goBack()
  await expect(page).toHaveURL(/\/shelves/)
  await expect(tab(page, 'Collections')).toHaveAttribute('aria-pressed', 'true')
  await expect(tab(page, 'TBRs')).toHaveAttribute('aria-pressed', 'false')
})

test('/planner keeps the Releases tab across back-navigation', async ({ page }) => {
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)

  await page.goto('/planner')
  await tab(page, 'releases').click()
  await expect(tab(page, 'releases')).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/library') // navigate away; any route unmounts the screen
  await expect(page).toHaveURL(/\/library/)

  await page.goBack()
  await expect(page).toHaveURL(/\/planner/)
  await expect(tab(page, 'releases')).toHaveAttribute('aria-pressed', 'true')
  await expect(tab(page, 'calendar')).toHaveAttribute('aria-pressed', 'false')
})

test('/shelf/$listId keeps the Grid view across back-navigation', async ({ page }) => {
  const c = await client()
  const { collectionId } = await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)

  await page.goto(`/shelf/${collectionId}`)
  await tab(page, 'Grid').click()
  await expect(tab(page, 'Grid')).toHaveAttribute('aria-pressed', 'true')

  await page
    .getByRole('button', { name: /Tab Routing Probe/ })
    .first()
    .click()
  await expect(page).toHaveURL(/\/book\//)

  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/shelf/${collectionId}`))
  await expect(tab(page, 'Grid')).toHaveAttribute('aria-pressed', 'true')
  await expect(tab(page, 'Shelf')).toHaveAttribute('aria-pressed', 'false')
})

// ── the two properties that make the URL the source of truth, not just a cache ────────────────

test('a deep link selects the tab it names', async ({ page }) => {
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)

  await page.goto('/shelves?tab=collection')
  await expect(tab(page, 'Collections')).toHaveAttribute('aria-pressed', 'true')
  await expect(tab(page, 'TBRs')).toHaveAttribute('aria-pressed', 'false')
})

test('an unknown tab value falls back to the default instead of throwing', async ({ page }) => {
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await signIn(page, c.session)

  // Fails CLOSED, the same discipline as storedUserId(): garbage resolves to the default rather
  // than throwing or rendering an empty screen. A router that throws here takes the app down.
  await page.goto('/shelves?tab=nonsense')
  await expect(tab(page, 'TBRs')).toHaveAttribute('aria-pressed', 'true')
  await expect(tab(page, 'Collections')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toHaveLength(0)
})
