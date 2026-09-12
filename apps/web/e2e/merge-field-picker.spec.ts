import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

/**
 * PER-FIELD MERGE SELECTION, VERIFIED AT THE ROW — not at the checkbox.
 *
 * The component test beside this one (duplicateReviewPicker.test.tsx) asserts what a reader sees
 * and what argument reaches `resolveCandidate`. Neither can see the actual write: `foldIn` builds
 * a patch from `applyFieldPicks` and sends it to PostgREST, and a picker that renders perfectly
 * while the patch ignores it would pass every assertion in that file. This reads the row back.
 *
 * Two properties, and they must be checked TOGETHER on one merge:
 *   · a DECLINED add leaves the reader's blank alone   (series stays empty)
 *   · a TAKEN replace overwrites a set value           (rating 4.5 -> 5)
 * plus the control that makes them meaningful: an untouched field on the SAME card still follows
 * the engine (position takes 2). Without that third assertion, "nothing moved" and "the whole
 * card was declined" look identical.
 *
 * WHY THE FIXTURE IS SHAPED THIS WAY: `matchBook` reaches its fuzzy branch — the one that routes a
 * candidate to this review list rather than folding silently — when the title+author key does NOT
 * match but the same author has a title equal after the subtitle is dropped. So the seeded row
 * carries ': A Novel' and the CSV row does not. The CSV's "(Ashfall Cycle, #2)" is parsed by the
 * importer into series + position, giving the card two blank-fills to offer beside the contested
 * rating.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `merge-picker-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'merge-picker-e2e-password'

const EXISTING_TITLE = 'Ember and Ash: A Novel'
const MERGED_TITLE = 'Ember and Ash' // the import's title is NOT taken; the reader's row survives
const FIXTURE = fileURLToPath(new URL('./fixtures/picker-duplicate.csv', import.meta.url))

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
        'merge-picker createUser',
      )
    ).id
  await ok(
    admin.from('profiles').upsert({ id: uid, display_name: 'Picker', skin: 'tryst', mode: 'dark' }),
    'merge-picker profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('merge-picker', EMAIL(), error))
  return { sb, session: s.session, uid: s.session.user.id }
}

async function reset(c: Client) {
  const { data } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((data as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'merge-picker list_items delete')
    await ok(c.sb.from('reads').delete().in('book_id', ids), 'merge-picker reads delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'merge-picker books delete')
  }
  await ok(
    c.sb.from('lists').delete().eq('owner_id', c.uid).in('name', ['Imported TBR']),
    'merge-picker lists delete',
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

test('a per-field merge writes exactly the fields the reader left checked', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await stub(page)
  await reset(c)

  await ok(
    c.sb.from('books').insert({
      owner_id: c.uid,
      title: EXISTING_TITLE,
      author_first: 'Nell',
      author_last: 'Marrow',
      genre: 'fantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
      rating: 4.5, // the contested value
      series: '', // blank: the import offers to fill it, and the reader will decline
    }),
    'merge-picker seed existing',
  )

  await signIn(page, c.session)

  /*
   * WAIT FOR THE LIBRARY BEFORE IMPORTING — and this is not test hygiene, it is working around a
   * real race found by this spec failing.
   *
   * `SettingsRoute` passes `books ?? []` from `useBooks()` into `importDetectedExport`, so an
   * import fired before that query resolves compares every row against an EMPTY library: nothing
   * matches, nothing is offered for review, and the duplicate is inserted silently. Observed
   * directly — this spec's first run reached the review list; later runs (warm Vite, faster to the
   * file input) reported "brought in 1 new, and folded 0 into what you had" and left two rows in
   * the database.
   *
   * The navigation is a CLICK, not a `goto`. `page.goto('/settings')` is a full reload, which
   * discards the TanStack Query cache — so waiting for the library to render and then `goto`-ing
   * re-opens the identical race, which is exactly what the second attempt at this spec did. A
   * client-side navigation keeps the warm cache, and is what a reader actually does.
   *
   * The race itself is reported, not fixed, on this branch — the fix belongs on the import
   * control, not on the merge picker.
   */
  await page.goto('/library')
  await expect(
    page.getByRole('button', { name: `Open ${EXISTING_TITLE}` }),
    'the seeded book never loaded, so an import here would race the library query',
  ).toBeVisible({ timeout: 30_000 })

  await page
    .getByRole('link', { name: /^Settings$/ })
    .first()
    .click()
  await expect(page.getByRole('heading', { name: /Backup & import/i })).toBeVisible({
    timeout: 30_000,
  })
  await page.locator('input[type="file"][accept*="csv"]').setInputFiles(FIXTURE)

  const card = page.getByText(/Review possible duplicates/i)
  await expect(card, 'the fuzzy CSV row did not reach the duplicate review list').toBeVisible({
    timeout: 60_000,
  })

  // ── collapsed by default ────────────────────────────────────────────────────────────────────
  // This is the claim that a several-hundred-row import pays nothing for the capability, and it
  // can only be made in a real browser: <details> keeps its children in the DOM when closed and
  // hides them by UA stylesheet, so jsdom cannot tell the two states apart.
  const picker = page.getByTestId('merge-field-picker')
  await expect(
    picker,
    'the picker rows are showing before anyone opened the disclosure',
  ).toBeHidden()

  const disclosure = page.getByText(/choose fields/)
  await expect(disclosure).toBeVisible()
  await disclosure.click()
  await expect(picker).toBeVisible()

  // ── the three decisions on one card ─────────────────────────────────────────────────────────
  const row = (name: RegExp) => picker.getByRole('checkbox', { name })
  await expect(row(/series position/), 'position should default to the engine (take)').toBeChecked()
  await expect(
    row(/rating/),
    'a contested field must never default to taking theirs',
  ).not.toBeChecked()

  // Anchored on 'series add' rather than 'series': the accessible name of a row is its whole
  // label, and a bare /series/ would also match the 'series position' row beneath it.
  await row(/^series add/).uncheck() // DECLINE an add
  await row(/rating/).check() // TAKE theirs on a contested field
  // series position is left alone — the untouched control

  // exact: 'Always merge Ember and Ash' also contains 'Merge Ember and Ash' case-insensitively.
  await page.getByRole('button', { name: `Merge ${MERGED_TITLE}`, exact: true }).click()

  // ── what actually reached the database ──────────────────────────────────────────────────────
  await expect
    .poll(
      async () => {
        const { data } = await c.sb
          .from('books')
          .select('title, series, position, rating')
          .eq('owner_id', c.uid)
        return data ?? []
      },
      { message: 'the merged row never settled', timeout: 30_000 },
    )
    .toEqual([
      {
        title: EXISTING_TITLE, // the reader's row, folded into — not replaced
        series: '', // DECLINED: the blank the reader kept blank
        position: 2, // untouched: the engine's own answer still applies
        rating: 5, // TAKEN: the contested value the reader asked for
      },
    ])
})
