import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// Guards for the two data-integrity defects the tester reported, and for the machinery that let
// them hide:
//   · Publication info "saved" and reverted. Two causes — `Number(v) || null` silently turned any
//     non-numeric input into null, and an out-of-range month/day reached Postgres, where
//     books_pub_m_check / books_pub_d_check rejected the WHOLE patch, discarding every other field
//     in the dialog. Nothing was ever shown to the reader.
//   · A rating typed into the reading log overwrote the book's own rating — the input to stats,
//     taste matching and recommendations.
// The through-line is that a failed write looked exactly like a successful one, so these also
// assert the error actually surfaces.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'write-integrity-e2e@reverie.local'
const PASSWORD = 'write-integrity-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
  admin: SupabaseClient
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
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'write-integrity auth createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Write Integrity', skin: 'tryst', mode: 'system' }),
    'write-integrity profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('write-integrity', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
  return shared
}

async function reset(c: Client) {
  // Deleting a series book deliberately preserves an empty canonical slot. This serial fixture
  // reuses one owner and series name, so remove its own prior series artifacts before recreating
  // the position-0 case; otherwise a second run conflicts with the ghost the first run preserved.
  const { data: seriesRows } = await c.admin.from('series').select('id').eq('owner_id', c.uid)
  const seriesIds = ((seriesRows as { id: string }[]) ?? []).map(({ id }) => id)
  if (seriesIds.length) {
    await ok(
      c.admin.from('series_entries').delete().in('series_id', seriesIds),
      'write-integrity series_entries delete',
    )
  }
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('reads').delete().in('book_id', ids), 'write-integrity reads delete')
    await ok(
      c.sb.from('list_items').delete().in('book_id', ids),
      'write-integrity list_items delete',
    )
    await ok(c.sb.from('books').delete().in('id', ids), 'write-integrity books delete')
  }
  if (seriesIds.length) {
    await ok(c.admin.from('series').delete().in('id', seriesIds), 'write-integrity series delete')
  }
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
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/functions/v1/covers**', (r) => r.fulfill({ status: 422, json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

const makeBook = async (c: Client, patch: Record<string, unknown> = {}) => {
  const { data, error } = await c.sb
    .from('books')
    .insert({
      owner_id: c.uid,
      title: 'Integrity Book',
      author_first: 'Nell',
      author_last: 'Marrow',
      genre: 'fantasy',
      ownership: 'owned',
      status: 'standalone',
      ...patch,
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

const rowOf = async (c: Client, id: string) =>
  (
    await c.sb
      .from('books')
      .select('pub_y, pub_m, pub_d, pages, rating, series_count, read_status, position')
      .eq('id', id)
      .single()
  ).data as {
    pub_y: number | null
    pub_m: number | null
    pub_d: number | null
    pages: number | null
    rating: number | null
    series_count: number | null
    read_status: string | null
    position: number | null
  }

const openEdit = async (page: Page) => {
  await page.getByRole('button', { name: /^Edit details$/i }).click()
  const dlg = page.getByRole('dialog', { name: /Edit details/i })
  await expect(dlg).toBeVisible()
  return dlg
}
const field = (dlg: ReturnType<Page['getByRole']>, label: string) =>
  dlg.locator('label', { hasText: new RegExp(`^${label}`) }).locator('input')

// ── Publication info: the happy path actually persists ──
test('publication info saves and survives a reload', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { pub_y: 2020, pub_m: 1, pub_d: 2 })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)
    await field(dlg, 'Pub year').fill('2015')
    await field(dlg, 'Month').fill('3')
    await field(dlg, 'Day').fill('4')
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })

    await expect
      .poll(async () => await rowOf(c, id), { timeout: 15_000 })
      .toMatchObject({ pub_y: 2015, pub_m: 3, pub_d: 4 })
    await page.reload()
    await expect(page.getByText('📅 Mar 4, 2015')).toBeVisible({ timeout: 20_000 })
  } finally {
    await reset(c)
  }
})

// ── The CHECK-constraint case: caught in the form, so the patch is never rejected ──
test('an out-of-range month is refused in the form, and takes nothing else down with it', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { pub_y: 2020, pub_m: 1, pub_d: 2 })
  const rejected: string[] = []
  page.on('response', (r) => {
    if (r.url().includes('/rest/v1/books') && r.request().method() === 'PATCH' && r.status() >= 400)
      rejected.push(r.url())
  })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)
    await field(dlg, 'Month').fill('13')
    // The canary must be an unrelated book field. Series length is now deliberately a projection
    // of a confirmed primary series membership, so a standalone book cannot retain it.
    await field(dlg, 'Pages').fill('777')
    await dlg.getByRole('button', { name: /Save details/i }).click()

    // Refused locally: the dialog stays open, the bad field says why, nothing is sent.
    await expect(dlg).toBeVisible()
    await expect(dlg.getByText('Month must be 12 or less.')).toBeVisible()
    await expect(field(dlg, 'Month')).toHaveAttribute('aria-invalid', 'true')
    expect(rejected, 'no PATCH should ever be rejected by the database now').toEqual([])
    expect(await rowOf(c, id)).toMatchObject({ pub_y: 2020, pub_m: 1, pub_d: 2 })

    // Correct it and the whole save — canary included — lands in one go.
    await field(dlg, 'Month').fill('6')
    await expect(dlg.getByText('Month must be 12 or less.')).toHaveCount(0) // typing clears it
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })
    await expect
      .poll(async () => await rowOf(c, id), { timeout: 15_000 })
      .toMatchObject({ pub_m: 6, pages: 777 })
  } finally {
    await reset(c)
  }
})

test('an out-of-range day is refused the same way', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { pub_y: 2020, pub_m: 1, pub_d: 2 })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)
    await field(dlg, 'Day').fill('32')
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg.getByText('Day must be 31 or less.')).toBeVisible()
    expect(await rowOf(c, id)).toMatchObject({ pub_d: 2 })
  } finally {
    await reset(c)
  }
})

// ── The silent-coercion case: non-numeric input is now visible, not turned into null ──
const JUNK: { name: string; label: string; value: string; error: string }[] = [
  {
    name: 'a month typed as a name',
    label: 'Month',
    value: 'June',
    error: 'Month must be a number.',
  },
  {
    name: 'a whole date pasted into the year',
    label: 'Pub year',
    value: '2021-06-08',
    error: 'Pub year must be a number.',
  },
  {
    name: 'a year with a thousands comma',
    label: 'Pub year',
    value: '2,021',
    error: 'Pub year must be a number.',
  },
]
for (const j of JUNK) {
  test(`non-numeric input is rejected visibly — ${j.name}`, async ({ page }) => {
    test.setTimeout(180_000)
    const c = await client()
    await reset(c)
    const id = await makeBook(c, { pub_y: 2020, pub_m: 1, pub_d: 2 })
    await stub(page)
    try {
      await signIn(page, c.session)
      await page.goto(`/book/${id}`)
      await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
        timeout: 20_000,
      })
      const dlg = await openEdit(page)
      await field(dlg, j.label).fill(j.value)
      await dlg.getByRole('button', { name: /Save details/i }).click()
      // Pre-fix: the dialog closed, the value became null, and nothing was said.
      await expect(dlg).toBeVisible()
      await expect(dlg.getByText(j.error)).toBeVisible()
      expect(await rowOf(c, id)).toMatchObject({ pub_y: 2020, pub_m: 1, pub_d: 2 })
    } finally {
      await reset(c)
    }
  })
}

// ── #77's position fix must survive being routed through the shared parser ──
test('position 0 is still settable through the shared parser', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { series: 'Integrity Cycle', position: 3, status: 'ongoing' })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)
    await field(dlg, 'Position').fill('0')
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })
    await expect.poll(async () => (await rowOf(c, id)).position, { timeout: 15_000 }).toBe(0)
  } finally {
    await reset(c)
  }
})

// ── A failed write must never again look like a successful one ──
test('a rejected save keeps the dialog open, says so, and stops the rest of the chain', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { pub_y: 2020 })
  await stub(page)
  // Force the book PATCH to fail with input the form considers perfectly valid, so we're testing
  // the FAILURE path rather than the validator.
  await page.route('**/rest/v1/books?id=eq.*', async (r) => {
    if (r.request().method() === 'PATCH') {
      await r.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'simulated failure' }),
      })
      return
    }
    await r.continue()
  })
  let contributorCalls = 0
  await page.route('**/rest/v1/rpc/set_book_contributors', async (r) => {
    contributorCalls++
    await r.continue()
  })
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)
    await field(dlg, 'Pub year').fill('2015')
    await dlg.getByRole('button', { name: /Save details/i }).click()

    // Told, in two places: the global toast and inside the dialog.
    await expect(
      page
        .getByRole('alert')
        .filter({ hasText: /didn’t save/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(dlg).toBeVisible()
    await expect(field(dlg, 'Pub year')).toHaveValue('2015') // the reader keeps what they typed

    // The partial-write hazard: contributors must NOT have been written once the book patch failed.
    await page.waitForTimeout(1500)
    expect(contributorCalls, 'the chain must stop at the first failure').toBe(0)
  } finally {
    await reset(c)
  }
})

// ── Bug 2: the reading log's rating is the READ's, not the book's ──
test('a rating in the reading log leaves the book’s own rating untouched', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { rating: 5 })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
      timeout: 20_000,
    })
    expect((await rowOf(c, id)).rating).toBe(5)

    await page
      .getByRole('button', { name: /Log a past read/i })
      .first()
      .click()
    const dlg = page.getByRole('dialog', { name: /Log a past read/i })
    await expect(dlg).toBeVisible({ timeout: 15_000 })
    // Give THIS read 2 stars — pre-fix that overwrote the book's 5. The control is the
    // WAI-ARIA slider now (half stars); drive it by keyboard, which doubles as e2e proof of
    // the a11y contract: four ArrowRights at step 0.5 = 2 stars, no pointer needed.
    const stars = dlg.getByRole('slider', { name: /Your rating/i })
    await stars.focus()
    for (let i = 0; i < 4; i++) await stars.press('ArrowRight')
    await expect(stars).toHaveAttribute('aria-valuenow', '2')
    await dlg.getByRole('button', { name: /Save to read log/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })

    // A past read carries its rating without changing the book rating or current status.
    await expect
      .poll(
        async () =>
          ((await c.sb.from('reads').select('rating').eq('book_id', id)).data ?? []).length,
        { timeout: 15_000 },
      )
      .toBe(1)
    const reads = (await c.sb.from('reads').select('rating').eq('book_id', id)).data as {
      rating: number
    }[]
    expect(reads[0]!.rating).toBe(2)
    const after = await rowOf(c, id)
    expect(after.rating, 'the book’s own rating must not move').toBe(5)
    expect(after.read_status).toBe('unset')

    // And it survives a reload — the book page still shows five stars.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Integrity Book' })).toBeVisible({
      timeout: 20_000,
    })
    expect((await rowOf(c, id)).rating).toBe(5)
  } finally {
    await reset(c)
  }
})
