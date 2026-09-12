import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

/**
 * IMPORTING BEFORE THE LIBRARY QUERY RESOLVES MUST NOT DUPLICATE — asserted at the row.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 * `SettingsScreen` did `const all = books ?? []` and handed `all` to `importDetectedExport`. While
 * `useBooks()` is in flight, `books` is `undefined`, so the importer was told the reader owns
 * NOTHING — every incoming row matched nothing, nothing reached the duplicate review queue, and the
 * entire file was inserted as new. Observed as "brought in 1 new, and folded 0 into what you had"
 * with two rows in the database where there should be one.
 *
 * The window is precisely when a reader is most likely to act: they came to this screen in order to
 * import, the file picker is right there, and the larger their library the longer the query takes.
 *
 * ── WHY THIS TEST IS A COLD LOAD, WHEN THE MERGE-PICKER SPEC IS DELIBERATELY A CLICK ─────────────
 * Same fact, opposite use. `page.goto()` is a full reload and DISCARDS the TanStack Query cache, so
 * a fresh load of /settings is the reliable way to reach the screen with `books` still unresolved —
 * which is what this test needs. A spec that wants to AVOID the race must therefore navigate by
 * click (keeping the warm cache), which is what merge-field-picker.spec.ts does and why. Reaching
 * for `goto` there re-opens this race and makes a correct feature look broken.
 *
 * ── WHY THIS DRIVES THE BUTTON AND NOT `setInputFiles` ──────────────────────────────────────────
 * Measured, not assumed: `setInputFiles` does NOT perform the "enabled" actionability check, so it
 * sets files on a disabled <input type=file> and the change handler runs anyway. A spec written that
 * way fails against the FIXED tree and tempts you to "fix" it by disabling the hidden input — which
 * stops nothing, for the same reason. `click()` does wait for enabled, and clicking the button is
 * the only way a person reaches the file dialog, so that is the path under test.
 *
 * ── WHY THE BOOKS QUERY IS DELIBERATELY SLOWED ──────────────────────────────────────────────────
 * Without it the window is real but short, so a pre-fix run fails only USUALLY — which is a flaky
 * test in the guarding direction and worthless as a regression guard. Holding the books GET open
 * makes the pre-fix failure structural rather than lucky. Verified by running this file against the
 * unfixed tree: two rows, every time.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `import-race-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'import-race-e2e-password'

/** Title + author match the CSV row EXACTLY, so a loaded library folds it with no review needed. */
const TITLE = 'Emberfall Reckoning'
const FIXTURE = fileURLToPath(new URL('./fixtures/import-race.csv', import.meta.url))

/** Long enough that the import cannot win the race by luck; short enough not to dominate the run. */
const BOOKS_QUERY_DELAY_MS = 4000

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  session: { access_token: string; refresh_token: string }
  uid: string
}

async function client(): Promise<Client> {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL())?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL(), password: PASSWORD, email_confirm: true }),
        'import-race createUser',
      )
    ).id
  await ok(
    admin.from('profiles').upsert({ id: uid, display_name: 'Race', skin: 'tryst', mode: 'dark' }),
    'import-race profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('import-race', EMAIL(), error))
  return { sb, session: s.session, uid: s.session.user.id }
}

async function seedOneBook(c: Client) {
  const { data } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((data as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'import-race list_items delete')
    await ok(c.sb.from('reads').delete().in('book_id', ids), 'import-race reads delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'import-race books delete')
  }
  await ok(
    c.sb.from('lists').delete().eq('owner_id', c.uid).in('name', ['Imported TBR']),
    'import-race lists delete',
  )
  await ok(
    c.sb.from('books').insert({
      owner_id: c.uid,
      title: TITLE,
      author_first: 'Nell',
      author_last: 'Marrow',
      genre: 'fantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
    }),
    'import-race seed',
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

/** Hold every books SELECT open, so /settings renders with the library genuinely unresolved. */
async function slowBooksQuery(page: Page) {
  await page.route('**/rest/v1/books*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    await new Promise((r) => setTimeout(r, BOOKS_QUERY_DELAY_MS))
    return route.continue()
  })
}

/** Import through the control a reader actually uses: the button, then the file dialog it opens. */
async function importFile(page: Page) {
  const chooser = page.waitForEvent('filechooser')
  // BY TESTID, NOT BY LABEL. The label changes to "Loading your library…" while the query is in
  // flight, so a name-based locator waits for the text to flip and passes even with the guard
  // deleted — measured, not theorised: that mutant survived until this line changed.
  await page.getByTestId('import-library').click()
  await (await chooser).setFiles(FIXTURE)
}

const rowCount = async (c: Client) =>
  ((await c.sb.from('books').select('id').eq('owner_id', c.uid)).data ?? []).length

test('an import fired before the library resolves folds instead of duplicating', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await stub(page)
  await seedOneBook(c)

  await signIn(page, c.session)
  await slowBooksQuery(page)

  // A COLD load of /settings — see the header. This is the state a reader reaches by opening the
  // screen directly, and the only reliable way to be on it with `books` still undefined.
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: /Backup & import/i })).toBeVisible({
    timeout: 30_000,
  })

  // Reach for the import at the earliest possible moment. Against the unfixed tree the button is
  // live the instant it renders, so the file lands while `books` is undefined and the whole row is
  // inserted as new. Against the fix the button is disabled until the library is KNOWN and this
  // click waits — the guard doing its job, not the test being lenient.
  await importFile(page)

  await expect(page.getByText(/Detected your generic export/i)).toBeVisible({ timeout: 60_000 })

  // The whole assertion: one row. Polled, because the duplicate this guards against is written
  // asynchronously — a single immediate read could pass before it happened.
  await expect
    .poll(() => rowCount(c), {
      message:
        'the import was compared against an empty library and inserted a duplicate — the books ' +
        'query had not resolved when the file was handed over',
      timeout: 30_000,
    })
    .toBe(1)

  // …and it is genuinely the folded row, not a survivor of a delete. The import carries a rating
  // the seeded row does not, so a fold is observable rather than merely counted.
  const { data } = await c.sb.from('books').select('title, rating').eq('owner_id', c.uid)
  expect(data).toEqual([{ title: TITLE, rating: 5 }])
})

test('an import after the library resolves is unchanged', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await stub(page)
  await seedOneBook(c)

  await signIn(page, c.session)

  // The control path: navigate by CLICK so the query cache stays warm and the library is already
  // known on arrival. No artificial delay — this is the ordinary case the fix must not disturb.
  await page.goto('/library')
  await expect(page.getByRole('button', { name: `Open ${TITLE}` })).toBeVisible({ timeout: 30_000 })
  await page
    .getByRole('link', { name: /^Settings$/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: /Backup & import/i })).toBeVisible({
    timeout: 30_000,
  })

  await importFile(page)
  await expect(page.getByText(/Detected your generic export/i)).toBeVisible({ timeout: 60_000 })

  await expect
    .poll(() => rowCount(c), { message: 'a warm-cache import duplicated', timeout: 30_000 })
    .toBe(1)
})
