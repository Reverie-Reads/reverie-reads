import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

/**
 * LIBRARY-merge field picking, verified at the ROW — the sibling of merge-field-picker.spec.ts,
 * one seam over. That spec proves the IMPORT picker (DuplicateReview -> foldIn -> PostgREST
 * update); this one proves the LIBRARY picker (MergePreview -> usePerformMerge -> the merge_books
 * RPC's p_fields). The unit tests beside each assert what the reader sees and what payload the
 * hook builds; neither can see the RPC actually apply it, and a picker that renders perfectly
 * while p_fields ignores it would pass every one of them. This reads the survivor back.
 *
 * Three properties on ONE merge, same discipline as the sibling:
 *   · a TAKEN replace overwrites the engine's keep   (rating 4.5 -> 5, the reader's override)
 *   · an untouched replace still follows the engine  (title keeps the primary's)
 *   · an untouched fill still follows the engine     (blank series takes the loser's)
 * plus the merge's own contract: the loser row is gone afterwards.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `merge-book-picker-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'merge-book-picker-e2e-password'

const PRIMARY_TITLE = 'Ember and Ash: A Novel'
const LOSER_TITLE = 'Ember and Ash (duplicate copy)'

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
  let uid = data?.users?.find((u) => u.email === EMAIL())?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL(), password: PASSWORD, email_confirm: true }),
        'merge-book-picker createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Merge Picker', skin: 'tryst', mode: 'dark' }),
    'merge-book-picker profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('merge-book-picker', EMAIL(), error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

/** Two rows, IDENTICAL key sets — a bulk insert's column list is the union of every row's keys,
 *  and a row missing one gets an explicit NULL, not the default (the a11y.spec.ts lesson). */
async function reset(c: Client): Promise<{ primaryId: string; loserId: string }> {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'merge-picker list_items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'merge-picker books delete')
  }
  const row = {
    owner_id: c.uid,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }
  const inserted = await okData(
    c.sb
      .from('books')
      .insert([
        { ...row, title: PRIMARY_TITLE, rating: 4.5, series: null },
        { ...row, title: LOSER_TITLE, rating: 5, series: 'Ashfall Cycle' },
      ])
      .select('id, title'),
    'merge-picker seed',
  )
  const rows = inserted as { id: string; title: string }[]
  const primaryId = rows.find((r) => r.title === PRIMARY_TITLE)!.id
  const loserId = rows.find((r) => r.title === LOSER_TITLE)!.id
  return { primaryId, loserId }
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
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: {} }))
}

test('an overridden field reaches the surviving row; untouched fields stay the engine’s', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await stub(page)
  const { primaryId, loserId } = await reset(c)

  await signIn(page, c.session)
  await page.goto(`/book/${primaryId}`)
  await expect(page.getByRole('button', { name: 'Merge…' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Merge…' }).click()

  await page.getByLabel('Search for a book to merge').fill('duplicate copy')
  await page.getByRole('button', { name: new RegExp(LOSER_TITLE.replace(/[()]/g, '\\$&')) }).click()

  // The preview, before any pick: the engine keeps the primary's 4.5.
  await expect(page.getByText('Review the merge')).toBeVisible()
  await expect(page.getByText('4.5★', { exact: true })).toBeVisible()

  // Open the picker and take the loser's rating. The preview row must follow the pick — that is
  // the "rows above update as you pick" contract, asserted before anything is written.
  await page.getByText(/Choose fields \(\d+\)/).click()
  const pickerRow = page.getByTestId('merge-book-picker').locator('label', { hasText: 'Rating' })
  await pickerRow.getByRole('checkbox').check()
  await expect(page.getByText('5★', { exact: true })).toBeVisible()
  await expect(page.getByText('4.5★', { exact: true })).not.toBeVisible()

  await page.getByRole('button', { name: 'Merge — no undo' }).click()

  // The dialog closes on success; then read the ROW, which is the thing this spec exists for.
  await expect(page.getByText('Review the merge')).not.toBeVisible({ timeout: 30_000 })
  type Row = { id: string; title: string; rating: number; series: string | null }
  const readRows = async (): Promise<Row[]> =>
    (await okData(
      c.sb.from('books').select('id, title, rating, series').eq('owner_id', c.uid),
      'merge-picker survivor read',
    )) as Row[]
  await expect.poll(readRows, { timeout: 30_000 }).toHaveLength(1)

  const rows2 = await readRows()
  const survivor = rows2[0]!
  expect(survivor.id).toBe(primaryId)
  expect(survivor.rating).toBe(5) // the reader's override — NOT the engine's 4.5
  expect(survivor.title).toBe(PRIMARY_TITLE) // untouched replace: engine keeps the primary's
  expect(survivor.series).toBe('Ashfall Cycle') // untouched fill: engine takes the loser's
  // and the loser is genuinely gone, not merely absent from a filtered view
  expect(rows2.some((r) => r.id === loserId)).toBe(false)
})
