import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// The corpus browse — Discover's new lead section (works-layer Phases 1+4).
//
// The external Google shelf is STUBBED EMPTY in every test here, deliberately: the corpus browse
// must not depend on the `releases` fn, and an empty external shelf alongside a full corpus grid
// is that independence, asserted. The browse ACCUMULATES ("show more" appends) where the external
// shelf cycles — the append tests pin that distinction from the reader's side.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'discover-corpus-e2e@reverie.local'
const PASSWORD = 'discover-corpus-e2e-password'

// 25 rows = one full page of 20 plus a 5-row tail, in a genre whose external shelf is stubbed.
const N = 25
const T = (i: number) => `Corpus Probe ${String(i).padStart(3, '0')}`

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  admin: ReturnType<typeof createClient>
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
        'discover-corpus createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Corpus E2E', skin: 'tryst', mode: 'dark' }),
    'discover-corpus profile',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('discover-corpus', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
  return shared
}

/** Seed the corpus via the service role — the same standing write path the import script uses.
 *  Rows are namespaced by title prefix and re-seeded per test file run. */
async function seedWorks(c: Client): Promise<void> {
  // Personal rows now hold a restrictive corpus FK. Clear the fixture copy before replacing its
  // corpus rows; production removal is soft, but deterministic fixture reseeding owns both sides.
  await ok(c.admin.from('books').delete().eq('owner_id', c.uid), 'discover-corpus books cleanup')
  await ok(
    c.admin.from('works').delete().like('title', 'Corpus Probe %'),
    'discover-corpus works cleanup',
  )
  const rows = Array.from({ length: N }, (_, idx) => {
    const i = idx + 1
    const author = i % 2 ? 'Nell Marrow' : 'Vera Stone'
    return {
      work_key: `corpusprobe${String(i).padStart(3, '0')}|${author.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
      title: T(i),
      contributors: [{ name: author, role: 'author', position: 0 }],
      author_text: author,
      genre: 'mystery',
      tags: i <= 5 ? ['locked room'] : ['seaside'],
      // deliberately COVERLESS: the placeholder is the designed common case at launch
      cover_url: null,
      pub_y: 2020 + (i % 5),
    }
  })
  const { error } = await c.admin.from('works').insert(rows)
  if (error) throw new Error(`discover-corpus works seed failed: ${JSON.stringify(error)}`)
  // the owner's own library holds probe 001, so hide-what-I-have has something real to hide
  await ok(
    c.admin.from('books').insert({
      owner_id: c.uid,
      title: T(1),
      author_first: 'Nell',
      author_last: 'Marrow',
      genre: 'mystery',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'unset',
    }),
    'discover-corpus own book seed',
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

const grid = (page: Page) => page.getByTestId('corpus-grid')
const cards = (page: Page) => grid(page).locator(':scope > article')

async function openMystery(page: Page) {
  const c = await client()
  await seedWorks(c)
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/discover?genre=mystery')
  await expect(grid(page)).toBeVisible({ timeout: 20_000 })
  // Scope exact-count assertions to this file's namespace. Other e2e files deliberately create
  // corpus-backed mystery books, and their shared work can outlive the personal fixture row. A
  // dirty local stack must not turn that legitimate catalog residue into a pagination failure.
  const scopedRead = page.waitForResponse((response) => {
    if (response.request().method() !== 'GET' || !response.url().includes('/rest/v1/works?')) {
      return false
    }
    return new URL(response.url()).searchParams.get('or')?.includes('Corpus Probe') ?? false
  })
  await page.getByTestId('corpus-filter').fill('Corpus Probe')
  await scopedRead
  await expect(grid(page).getByText(T(1)).first()).toBeVisible()
}

test('the corpus browse leads with exactly DISCOVER_BATCH rows, coverless included', async ({
  page,
}) => {
  await openMystery(page)
  // default 20 — the first page, not the whole table
  await expect(cards(page)).toHaveCount(20)
  // ordered by title, so 001 leads; its card renders despite having NO cover (placeholder path)
  await expect(grid(page).getByText(T(1)).first()).toBeVisible()
  await expect(grid(page).getByText(T(21))).toHaveCount(0)
})

test('"show more" APPENDS the next page — the accumulate-not-cycle contract', async ({ page }) => {
  await openMystery(page)
  await expect(cards(page)).toHaveCount(20)
  await page.getByTestId('corpus-show-more').click()
  await expect(cards(page)).toHaveCount(N)
  // appended: the FIRST page's rows are still on screen alongside the tail
  await expect(grid(page).getByText(T(1)).first()).toBeVisible()
  await expect(grid(page).getByText(T(N)).first()).toBeVisible()
  // the pool is exhausted, so the control retires rather than cycling back to page one
  await expect(page.getByTestId('corpus-show-more')).toHaveCount(0)
})

test('the text filter narrows in place; the tag filter narrows by membership', async ({ page }) => {
  await openMystery(page)
  await page.getByTestId('corpus-filter').fill(T(7))
  await expect(cards(page)).toHaveCount(1, { timeout: 10_000 })
  await expect(grid(page).getByText(T(7)).first()).toBeVisible()
  await page.getByTestId('corpus-filter').fill('')

  // author search rides author_text — half the seed is Vera Stone's
  await page.getByTestId('corpus-filter').fill('Vera Stone')
  await expect(cards(page)).toHaveCount(12, { timeout: 10_000 })
  await page.getByTestId('corpus-filter').fill('')

  await page.getByTestId('corpus-tag-filter').fill('locked room')
  await expect(cards(page)).toHaveCount(5, { timeout: 10_000 })
})

test('hide-what-I-have hides the owned probe from the corpus grid', async ({ page }) => {
  await openMystery(page)
  await expect(grid(page).getByText(T(1)).first()).toBeVisible()
  await page.getByRole('button', { name: 'Hide what I have' }).click()
  await expect(grid(page).getByText(T(1))).toHaveCount(0)
  // and the next unowned row is still there — the filter removed one book, not the shelf
  await expect(grid(page).getByText(T(2)).first()).toBeVisible()
})

test('a corpus pick IS an Add prefill — same contract as an external hit', async ({ page }) => {
  await openMystery(page)
  // probe 002 is unowned, so its card carries the Add action
  const card = cards(page).filter({ hasText: T(2) })
  await card.getByRole('button', { name: '＋ Add' }).click()
  await page.waitForURL(/\/add/)
  // the AddForm's title input has a placeholder, not a label — locate by it, assert the VALUE
  await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue(T(2), {
    timeout: 10_000,
  })
})

test('a catalog cover opens details without adding a book and restores focus on close', async ({
  page,
}, testInfo) => {
  const c = await client()
  await openMystery(page)
  await ok(
    c.admin
      .from('works')
      .update({
        description: 'A quiet journey through an unfamiliar city.',
        publisher: 'Example Press',
      })
      .eq('title', T(2)),
    'preview description fixture',
  )
  const before = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const opener = page.getByRole('button', { name: `View details for ${T(2)}`, exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: T(2), exact: true })
  await expect(dialog.getByText('A quiet journey through an unfamiliar city.')).toBeVisible()
  await expect(dialog.getByText('Example Press')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('discover-book-details.png') })
  await expect(dialog.getByRole('link', { name: 'Add to wishlist' })).toHaveAttribute(
    'href',
    /want=true/,
  )
  await dialog.getByRole('button', { name: 'Keep browsing' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  const after = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  expect(after.error).toBeNull()
  expect(after.data).toEqual(before.data)
  await page.getByRole('button', { name: `View details for ${T(1)}`, exact: true }).click()
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'Open your book' }),
  ).toHaveAttribute('href', /\/book\//)
})
