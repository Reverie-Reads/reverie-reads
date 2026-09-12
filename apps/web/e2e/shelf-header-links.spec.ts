import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// The /shelves derived-shelf headers (Owned, Borrowed, Read, Wishlist) navigate to /library scoped
// to that shelf, using the same button-wraps-the-heading affordance the "Your lists" headers already
// use. Real coordinate clicks (boundingBox + page.mouse.click), not locator.click(), because the
// point of this test is that the header ITSELF is the hit target — a `.click()` finds the element by
// role/name and would pass even if only some inner span were interactive.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'shelf-header-links-e2e@reverie.local'
const PASSWORD = 'shelf-header-links-e2e-password'

const OWNED_FIXTURE = 'Header Link Owned Fixture'
const BORROWED_FIXTURE = 'Header Link Borrowed Fixture'
const READ_FIXTURE = 'Header Link Read Fixture'
const WISHLIST_FIXTURE = 'Header Link Wishlist Fixture'

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
        'shelf-header-links createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Shelf Header Links E2E', skin: 'tryst', mode: 'dark' }),
    'shelf-header-links profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('shelf-header-links', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

/** One book per derived shelf, and nothing else — a small, exact fixture set beats the seeded
 *  290-book library for this: each header link must show exactly its own book and exclude the
 *  others, and that is fast to prove by name against four rows instead of hundreds. */
async function seedFixtures(c: Client): Promise<void> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('reads').delete().in('book_id', ids), 'shelf-header-links reads delete')
    await ok(
      c.sb.from('list_items').delete().in('book_id', ids),
      'shelf-header-links list_items delete',
    )
    await ok(c.sb.from('books').delete().in('id', ids), 'shelf-header-links books delete')
  }

  const base = {
    owner_id: c.uid,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'unowned',
    borrowed: false,
    wishlist: false,
    read_status: 'unset',
    owned_physical: null as string | null,
    owned_ebook: false,
    owned_audiobook: false,
  }

  await ok(
    c.sb.from('books').insert([
      { ...base, title: OWNED_FIXTURE, ownership: 'owned' },
      { ...base, title: BORROWED_FIXTURE, borrowed: true },
      { ...base, title: READ_FIXTURE, read_status: 'Read' },
      { ...base, title: WISHLIST_FIXTURE, wishlist: true },
    ]),
    'shelf-header-links books insert',
  )
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

/** Click a shelf header at its own on-screen coordinates — not `.click()`, which resolves by
 *  role/name and would pass even if only a chevron glyph inside the heading were the real target. */
async function clickHeaderAt(page: Page, name: RegExp): Promise<void> {
  const header = page.getByRole('button', { name }).first()
  await header.waitFor({ timeout: 20_000 })
  // page.mouse, unlike locator.click(), never scrolls the target into view on its own — a header
  // below the fold (Wishlist, on a page with several sections above it) would get a coordinate past
  // the bottom of the viewport and the click would land on nothing.
  await header.scrollIntoViewIfNeeded()
  const box = await header.boundingBox()
  if (!box) throw new Error(`shelf header "${name}" has no box — not on screen`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

const bookButton = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^Open ${title}\\b`) })

test('every derived shelf header navigates to Library, scoped to that shelf, and only that shelf', async ({
  page,
}) => {
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)

  const cases: [RegExp, string, string[]][] = [
    [/^Owned/, OWNED_FIXTURE, [BORROWED_FIXTURE, READ_FIXTURE, WISHLIST_FIXTURE]],
    [/⇄ Borrowed/, BORROWED_FIXTURE, [OWNED_FIXTURE, READ_FIXTURE, WISHLIST_FIXTURE]],
    [/^Read/, READ_FIXTURE, [OWNED_FIXTURE, BORROWED_FIXTURE, WISHLIST_FIXTURE]],
    [/⊹ Wishlist/, WISHLIST_FIXTURE, [OWNED_FIXTURE, BORROWED_FIXTURE, READ_FIXTURE]],
  ]

  for (const [headerName, want, excluded] of cases) {
    await page.goto('/shelves')
    await clickHeaderAt(page, headerName)

    // Navigated to a route that renders — Library's own chrome is up, not a blank/error page.
    await expect(page).toHaveURL(/\/library\?shelf=/, { timeout: 20_000 })
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 })

    await expect(bookButton(page, want), `${want} on its own shelf link`).toBeVisible({
      timeout: 20_000,
    })
    for (const other of excluded) {
      await expect(
        bookButton(page, other),
        `${other} must not appear on the ${headerName} link`,
      ).toHaveCount(0)
    }
  }
})
