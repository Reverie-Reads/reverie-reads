import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

/**
 * Rename and delete for PERSONAL tropes, on /tropes/$id.
 *
 * ── WHY RENAME IS ASSERTED ACROSS TWO BOOKS ─────────────────────────────────────────────────────
 * `book_tropes` joins to `tropes` by id, so a rename is one UPDATE and every carrier follows. The
 * interesting failure is the opposite — a design that copied the name per book would leave some
 * books renamed and some not. Two carriers is the smallest fixture that can tell those apart; one
 * book would pass either way.
 *
 * ── WHY DELETE IS ASSERTED ON book_tropes, NOT JUST ON THE TROPE ROW ────────────────────────────
 * `book_tropes.trope_id` is `on delete cascade`, so the join rows go with it. Asserting only that
 * the trope is gone would pass against a build that orphaned its assignments — invisible in the UI
 * until something later tried to resolve them.
 *
 * ── CANONICAL TROPES MUST NOT OFFER EITHER ──────────────────────────────────────────────────────
 * The third test is the one that keeps the feature honest: canonical names are shared vocabulary,
 * generated from SEED_TROPES with a parity test pinning the two together. A local rename would put
 * this library out of step with the source of truth. The UI gates on `t.personal`, and the hooks
 * ALSO refuse canonical rows at the query — so this asserts the affordance is absent rather than
 * that the mutation happens to fail.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `trope-edit-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'trope-edit-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
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
        'trope-edit createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Trope Edit', skin: 'tryst', mode: 'dark' }),
    'trope-edit profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('trope-edit', EMAIL(), error))
  const c = { sb, session: s.session, uid: s.session.user.id }
  shared.set(PROJECT(), c)
  return c
}

/** Two books, one personal trope on BOTH — the fixture a per-book copy would fail. */
async function seed(c: Client, tropeName: string) {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await ok(c.sb.from('books').delete().in('id', ids), 'trope-edit books delete')
  await ok(c.sb.from('tropes').delete().eq('owner_id', c.uid), 'trope-edit tropes delete')

  const rows = ['Trope Carrier One', 'Trope Carrier Two'].map((title) => ({
    owner_id: c.uid,
    title,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }))
  const { error } = await c.sb.from('books').insert(rows)
  if (error) throw new Error(`trope-edit seed failed: ${JSON.stringify(error)}`)
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid).order('title')
  const bookIds = ((books as { id: string }[]) ?? []).map((b) => b.id)

  const trope = (await okData(
    c.sb
      .from('tropes')
      .insert({ owner_id: c.uid, name: tropeName, facet: 'vibe' })
      .select('id')
      .single(),
    'trope-edit trope insert',
  )) as { id: string }

  await ok(
    c.sb.from('book_tropes').insert(
      // owner_id is a real column on book_tropes and its RLS policy checks it — omitting it is a
      // 42501, not a default.
      bookIds.map((id) => ({
        book_id: id,
        trope_id: trope.id,
        owner_id: c.uid,
        emphasis: 'present' as const,
      })),
    ),
    'trope-edit book_tropes insert',
  )
  return { tropeId: trope.id, bookIds }
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

test('renaming a personal trope updates it for every book carrying it', async ({ page }) => {
  const c = await client()
  await stub(page)
  const { tropeId, bookIds } = await seed(c, 'Old Coinage Here')
  await signIn(page, c.session)

  // The rename prompt is a window.prompt; answer it before the click that opens it.
  page.once('dialog', (d) => void d.accept('brand new coinage'))
  await page.goto(`/tropes/${tropeId}`)
  await expect(page.getByRole('heading', { name: 'Old Coinage Here' })).toBeVisible({
    timeout: 20_000,
  })
  await page.getByRole('button', { name: /^Rename$/ }).click()

  // Stored title-cased, via the same normalizer creation uses — a rename must not be a way to put
  // un-normalized casing back into the vocabulary.
  await expect
    .poll(
      async () =>
        (
          (await c.sb.from('tropes').select('name').eq('id', tropeId)).data as { name: string }[]
        )?.[0]?.name,
      { message: 'the rename did not persist (or was not normalized)', timeout: 10_000 },
    )
    .toBe('Brand New Coinage')

  // ONE row, so both carriers follow. Asserted through the join rather than by re-reading the
  // trope: this is the property a per-book copy would break.
  const { data: joins } = await c.sb.from('book_tropes').select('book_id').eq('trope_id', tropeId)
  expect(
    ((joins as { book_id: string }[]) ?? []).map((j) => j.book_id).sort(),
    'both carriers should still point at the one renamed row',
  ).toEqual([...bookIds].sort())
})

test('deleting a personal trope confirms first, then removes it from every book', async ({
  page,
}) => {
  const c = await client()
  await stub(page)
  const { tropeId } = await seed(c, 'Doomed Coinage')
  await signIn(page, c.session)

  await page.goto(`/tropes/${tropeId}`)
  await expect(page.getByRole('heading', { name: 'Doomed Coinage' })).toBeVisible({
    timeout: 20_000,
  })
  const deleteButton = page.getByRole('button', { name: /^Delete$/ })
  await expect(
    deleteButton,
    'deletion must stay unavailable until the carrier inventory is confirmed',
  ).toBeEnabled()

  // FIRST: dismissing the confirm must delete nothing. A destructive action that fires on cancel is
  // the failure worth catching, and it is invisible if the test only ever accepts.
  let seenMessage = ''
  page.once('dialog', (d) => {
    seenMessage = d.message()
    void d.dismiss()
  })
  await deleteButton.click()
  await page.waitForTimeout(600)
  expect(
    seenMessage,
    'the confirm should name how many books lose the tag — the carrier count is already on screen',
  ).toMatch(/2 books/i)
  expect(
    ((await c.sb.from('tropes').select('id').eq('id', tropeId)).data ?? []).length,
    'dismissing the confirm deleted the trope anyway',
  ).toBe(1)

  // THEN: accepting removes the trope and, by the on-delete-cascade, its assignments.
  page.once('dialog', (d) => void d.accept())
  await deleteButton.click()

  await expect
    .poll(
      async () => ((await c.sb.from('tropes').select('id').eq('id', tropeId)).data ?? []).length,
      {
        message: 'the trope survived the confirmed delete',
        timeout: 10_000,
      },
    )
    .toBe(0)
  expect(
    ((await c.sb.from('book_tropes').select('book_id').eq('trope_id', tropeId)).data ?? []).length,
    'the assignments were orphaned instead of cascading',
  ).toBe(0)
})

test('a CANONICAL trope offers neither rename nor delete', async ({ page }) => {
  const c = await client()
  await stub(page)
  await seed(c, 'Unused Personal Coinage')
  await signIn(page, c.session)

  // Any seeded canonical row — owner_id null is what makes it canonical.
  const canonical = (
    (await c.sb.from('tropes').select('id, name').is('owner_id', null).limit(1)).data as
      | { id: string; name: string }[]
      | null
  )?.[0]
  expect(
    canonical,
    'no canonical trope in the database — this test would prove nothing',
  ).toBeTruthy()

  await page.goto(`/tropes/${canonical!.id}`)
  await expect(page.getByRole('heading', { name: canonical!.name })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByRole('button', { name: /^Rename$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Delete$/ })).toHaveCount(0)
})
