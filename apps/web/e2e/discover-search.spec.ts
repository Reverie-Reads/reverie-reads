import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import AxeBuilder from '@axe-core/playwright'
import { expectResolvedMode } from './support/mode'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

// Discover search e2e (docs/archive/task-discover-search.md): search field → results (deduped against the
// library, "On your shelf" for owned) → add owned / add-to-shelf unowned, and the shelf picker's
// "search everywhere" seam adding the same way. The `search` + `enrich` edge functions are STUBBED
// so the run is deterministic and offline; the real Hardcover+Google backend is exercised in the
// eyeball. A dedicated throwaway user keeps the seed + a11y sweep untouched.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const TEST_EMAIL = 'discover-e2e@reverie.local'
const TEST_PASSWORD = 'discover-e2e-password'

test.describe.configure({ mode: 'serial' })

// Stub results: one book NOT in the library, one that IS (seeded below) so de-dupe shows "On shelf".
const STUB_RESULTS = [
  {
    source: 'hardcover',
    title: 'Wildfire Vow',
    authors: ['Imogen Vale'],
    cover: '/landing-covers/everflame.jpg',
    isbn: '9780316580792',
    isbn13: '9780316580792',
    year: '2023',
    series: 'Emberwild',
    seriesPosition: 1,
  },
  {
    source: 'google',
    title: 'Seeded Owned Book',
    authors: ['Ada Known'],
    cover: '/landing-covers/king-of-wrath.jpg',
    isbn: '9781111111119',
    isbn13: '9781111111119',
    year: '2021',
    sourceUrl: 'https://books.google.com/books?id=seeded-owned-book',
  },
]

async function ensureUser(): Promise<void> {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === TEST_EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          email_confirm: true,
        }),
        'discover-search createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      // mode PINNED, not 'system': this spec runs an axe contrast scan, and 'system' resolves through
      // prefers-color-scheme at runtime — so the scan would be asserted against whichever surface the
      // environment produced. Observed on PR #252's gate as a real flake (color-contrast failed one
      // run, passed the next, no code change). 'dark' matches the convention across this suite's
      // other axe/colour specs and the app's own fallback when no light preference matches.
      .upsert({ id: uid, display_name: 'Discover E2E', skin: 'tryst', mode: 'dark' }),
    'discover-search profiles upsert',
  )
}

type Client = {
  sb: SupabaseClient
  session: { access_token: string; refresh_token: string }
  uid: string
}

// One password sign-in for the whole file (the per-IP sign_in_sign_ups budget is shared with the
// heavy a11y sweep). The page-side hash sign-in doesn't count against it.
let shared: Client | null = null
async function client(): Promise<Client> {
  if (shared) return shared
  await ensureUser()
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error || !data.session) throw new Error(authFailure('discover-search', TEST_EMAIL, error))
  shared = { sb, session: data.session, uid: data.session.user.id }
  return shared
}

async function reset(c: Client) {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(
      c.sb.from('list_items').delete().in('book_id', ids),
      'discover-search list_items delete',
    )
    await ok(c.sb.from('books').delete().in('id', ids), 'discover-search books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'discover-search lists delete')
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

async function stubBackends(page: Page) {
  // Deterministic search + enrichment. enrich returns a minimal record (the add path pulls it).
  await page.route('**/functions/v1/search**', (r) =>
    r.fulfill({ json: { results: STUB_RESULTS } }),
  )
  await page.route('**/functions/v1/enrich**', (r) => r.fulfill({ json: { rateLimited: false } }))
  await page.route('**/functions/v1/covers**', (r) =>
    r.fulfill({ status: 422, json: { error: 'fetch_failed' } }),
  )
  await page.route('**/functions/v1/embed**', (r) =>
    r.fulfill({ json: { hasTaste: false, scores: [] } }),
  )
  await page.route('**/functions/v1/releases**', (r) => r.fulfill({ json: { hits: [] } }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

const bookByTitle = async (sb: SupabaseClient, uid: string, title: string) =>
  (
    await sb
      .from('books')
      .select('id, ownership, borrowed, wishlist, series, cover_url')
      .eq('owner_id', uid)
      .eq('title', title)
      .maybeSingle()
  ).data as {
    id: string
    ownership: string
    borrowed: boolean
    wishlist: boolean
    series: string | null
    cover_url: string | null
  } | null

test('Discover search: results dedupe against library, add owned + add-to-shelf, taste rail toggles, axe', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  // Seed one owned book that matches a stub result → it should show "On your shelf", not add buttons.
  await ok(
    c.sb.from('books').insert({
      owner_id: c.uid,
      title: 'Seeded Owned Book',
      author_first: 'Ada',
      author_last: 'Known',
      isbn: '9781111111119',
      ownership: 'owned',
    }),
    'discover-search books insert',
  )
  await ok(
    c.sb.from('lists').insert({ owner_id: c.uid, name: 'Weekend TBR', kind: 'tbr' }),
    'discover-search lists insert',
  )
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await page.goto('/discover?browse=true')

    // The taste rail is present before searching (genre chips visible).
    await expect(page.getByRole('group', { name: /browse a genre/i })).toBeVisible()

    // Type a query → debounced search → results replace the rail.
    await page.getByLabel('Search the wider catalog').fill('emberwild')
    await expect(page.getByText('Wildfire Vow')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('group', { name: /browse a genre/i })).toBeHidden() // rail gone while querying
    // series shown on the result
    await expect(page.getByText(/Emberwild/)).toBeVisible()
    // Google results remain a distinct provider block with the official attribution and a
    // prominent source link on every result. The same work may appear in the catalog block too;
    // cross-provider dedupe would alter Google's returned set.
    await expect(page.getByRole('heading', { name: 'Catalog matches' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Google Books search results' })).toBeVisible()
    await expect(page.getByTestId('google-books-attribution')).toHaveAttribute(
      'src',
      '/google-books-powered-by.png',
    )
    await expect(
      page.getByRole('link', { name: /View Seeded Owned Book on Google Books/ }),
    ).toHaveAttribute('href', 'https://books.google.com/books?id=seeded-owned-book')
    // the seeded owned book shows its shelf state, not add actions
    await expect(page.getByRole('link', { name: /On your shelf/i })).toBeVisible()

    // axe on the results surface
    await expectResolvedMode(page, 'dark', 'discover results surface')
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(serious, serious.map((v) => v.id).join(', ')).toHaveLength(0)

    // Add the new result to the library (owned).
    await page.getByRole('button', { name: '＋ Add', exact: true }).first().click()
    await expect
      .poll(async () => (await bookByTitle(c.sb, c.uid, 'Wildfire Vow'))?.ownership, {
        timeout: 15_000,
      })
      .toBe('owned')
    const added = await bookByTitle(c.sb, c.uid, 'Wildfire Vow')
    expect(added?.series).toBe('Emberwild') // full metadata (series) landed, not a thin stub
    // once added, the card flips to "On your shelf" (deduped against the now-larger library)
    await expect(page.getByRole('link', { name: /On your shelf/i })).toHaveCount(2, {
      timeout: 15_000,
    })

    // Clear the search → the taste rail returns intact.
    await page.getByLabel('Clear search').click()
    await expect(page.getByRole('group', { name: /browse a genre/i })).toBeVisible()
  } finally {
    await reset(c)
  }
})

test('Discover search: add a result to a shelf as unowned via the shelf chooser', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const list = await okData(
    c.sb
      .from('lists')
      .insert({ owner_id: c.uid, name: 'Weekend TBR', kind: 'tbr' })
      .select('id')
      .single(),
    'discover-search lists insert',
  )
  const listId = (list as { id: string }).id
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await page.goto('/discover?browse=true')
    await page.getByLabel('Search the wider catalog').fill('wildfire')
    await expect(page.getByText('Wildfire Vow')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: '＋ Shelf', exact: true }).first().click()
    await page
      .getByRole('dialog', { name: 'Add to a shelf' })
      .getByRole('button', { name: /Weekend TBR/ })
      .click()

    // The book lands UNOWNED and is placed on the shelf. Poll the MEMBERSHIP — it's written right
    // after the book in the same mutation, so waiting on the book row alone would race the placement.
    await expect
      .poll(
        async () => {
          const b = await bookByTitle(c.sb, c.uid, 'Wildfire Vow')
          if (!b) return 0
          const { count } = await c.sb
            .from('list_items')
            .select('book_id', { count: 'exact', head: true })
            .eq('list_id', listId)
            .eq('book_id', b.id)
          return count ?? 0
        },
        { timeout: 15_000 },
      )
      .toBe(1)
    // Adding from a wanting context records a WANT, not a possession claim: under the shelf model
    // that is the wishlist flag with ownership left unowned (docs/archive/task-shelf-model.md).
    expect(await bookByTitle(c.sb, c.uid, 'Wildfire Vow')).toMatchObject({
      ownership: 'unowned',
      wishlist: true,
      borrowed: false,
    })
  } finally {
    await reset(c)
  }
})

test('Shelf picker seam: "search everywhere" finds and adds an unowned book to this shelf', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const list = await okData(
    c.sb
      .from('lists')
      .insert({ owner_id: c.uid, name: 'Someday Shelf', kind: 'tbr' })
      .select('id')
      .single(),
    'discover-search lists insert',
  )
  const listId = (list as { id: string }).id
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/shelf/${listId}`)

    // Open the add picker, then the (now-wired) "search everywhere" seam.
    await page.getByRole('button', { name: '＋ Add books', exact: true }).click()
    await page.getByRole('button', { name: /Search everywhere/i }).click()

    const sheet = page.getByRole('dialog', { name: /Search everywhere · Someday Shelf/i })
    await expect(sheet).toBeVisible()
    await sheet.getByLabel('Search the wider catalog').fill('wildfire')
    await expect(sheet.getByText('Wildfire Vow')).toBeVisible({ timeout: 15_000 })
    await sheet.getByRole('button', { name: '＋ Add', exact: true }).first().click()

    await expect
      .poll(
        async () => {
          const b = await bookByTitle(c.sb, c.uid, 'Wildfire Vow')
          if (!b) return 0
          const { count } = await c.sb
            .from('list_items')
            .select('book_id', { count: 'exact', head: true })
            .eq('list_id', listId)
            .eq('book_id', b.id)
          return count ?? 0
        },
        { timeout: 15_000 },
      )
      .toBe(1)
    // Adding from a wanting context records a WANT, not a possession claim: under the shelf model
    // that is the wishlist flag with ownership left unowned (docs/archive/task-shelf-model.md).
    expect(await bookByTitle(c.sb, c.uid, 'Wildfire Vow')).toMatchObject({
      ownership: 'unowned',
      wishlist: true,
      borrowed: false,
    })
  } finally {
    await reset(c)
  }
})

for (const surface of ['Discover', 'Shelf picker'] as const) {
  for (const savedBeforeError of [false, true]) {
    test(`${surface}: retry a failed shelf response without repeating the book save (${savedBeforeError ? 'saved response lost' : 'write rejected'})`, async ({
      page,
    }) => {
      const c = await client()
      await reset(c)
      const list = await okData(
        c.sb
          .from('lists')
          .insert({ owner_id: c.uid, name: 'Retry Shelf', kind: 'tbr' })
          .select('id')
          .single(),
        'retry shelf',
      )
      await stubBackends(page)
      let placements = 0
      let bookWrites = 0
      let enrichments = 0
      page.on('request', (request) => {
        if (request.method() === 'POST' && new URL(request.url()).pathname === '/rest/v1/books')
          bookWrites++
        if (request.url().includes('/functions/v1/enrich')) enrichments++
      })
      await page.route('**/rest/v1/list_items?*', async (route) => {
        if (route.request().method() !== 'POST') return route.continue()
        placements++
        if (placements !== 1) return route.continue()
        if (savedBeforeError) {
          const response = await route.fetch()
          expect(response.ok()).toBe(true)
        }
        await route.fulfill({
          status: 502,
          json: { message: 'An invalid response was received from the upstream server' },
        })
      })
      try {
        await signIn(page, c.session)
        if (surface === 'Shelf picker') {
          await page.goto(`/shelf/${list.id}`)
          await page.getByRole('button', { name: '＋ Add books', exact: true }).click()
          await page.getByRole('button', { name: /Search everywhere/i }).click()
          await page.getByLabel('Search the wider catalog').fill('wildfire')
          await page
            .getByRole('dialog')
            .getByRole('button', { name: '＋ Add', exact: true })
            .first()
            .click()
        } else {
          await page.goto('/discover?browse=true')
          await page.getByLabel('Search the wider catalog').fill('wildfire')
          await page.getByRole('button', { name: '＋ Shelf', exact: true }).first().click()
          await page
            .getByRole('dialog')
            .getByRole('button', { name: /Retry Shelf/ })
            .click()
        }
        await expect(
          page.getByRole('alert').filter({ hasText: 'we couldn’t confirm' }),
        ).toBeVisible()
        if (!savedBeforeError)
          await page.screenshot({ path: test.info().outputPath('shelf-retry.png'), fullPage: true })
        expect(placements).toBe(1)
        const saved = await bookByTitle(c.sb, c.uid, 'Wildfire Vow')
        expect(saved).not.toBeNull()
        const bookId = saved!.id
        const originalItems = await okData(
          c.sb
            .from('list_items')
            .select('position,added_at')
            .eq('list_id', list.id)
            .eq('book_id', bookId),
          'read partial placement',
        )
        expect(originalItems).toHaveLength(savedBeforeError ? 1 : 0)
        await ok(
          c.sb
            .from('books')
            .update({ pages: 321, wishlist: false, borrowed: true })
            .eq('id', bookId),
          'edit saved book before retry',
        )
        const placementSaved = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/rest/v1/list_items' &&
            response.request().method() === 'POST' &&
            response.ok(),
        )
        await page.getByRole('button', { name: 'Retry adding to shelf' }).click()
        await placementSaved
        await expect
          .poll(
            async () =>
              (
                await okData(
                  c.sb
                    .from('list_items')
                    .select('book_id,position,added_at')
                    .eq('list_id', list.id),
                  'read retried membership',
                )
              ).length,
          )
          .toBe(1)
        await expect(page.getByRole('button', { name: 'Retry adding to shelf' })).toHaveCount(0)
        expect(placements).toBe(2)
        expect(bookWrites).toBe(1)
        expect(enrichments).toBe(1)
        const books = await okData(
          c.sb.from('books').select('id,pages,borrowed,wishlist').eq('owner_id', c.uid),
          'read books after retry',
        )
        expect(books).toEqual([{ id: bookId, pages: 321, borrowed: true, wishlist: false }])
        if (savedBeforeError)
          expect(
            await okData(
              c.sb
                .from('list_items')
                .select('position,added_at')
                .eq('list_id', list.id)
                .eq('book_id', bookId),
              'unchanged original membership',
            ),
          ).toEqual(originalItems)
        await page.reload()
        expect(await bookByTitle(c.sb, c.uid, 'Wildfire Vow')).toMatchObject({
          id: bookId,
          borrowed: true,
          wishlist: false,
        })
      } finally {
        await reset(c)
      }
    })
  }
}
