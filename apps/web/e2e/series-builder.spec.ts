import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// The /series index's arranging surface (feat/series-builder). Everything below drives the real UI.
//
// WHY BOTH A DRAG AND A ▲▼ TEST, when both call the same reposition: because they reach it through
// different machinery. The drag proves dnd-kit's PointerSensor is wired to the grip and that pointer
// events produce a reorder — which is the entire reason dnd-kit is a dependency, since the app's four
// hand-rolled HTML5 drags do not fire from touch on iOS Safari or Android Chrome. The buttons prove
// the visible keyboard-reachable affordance still works. A regression in either is invisible to the
// other's test.
//
// PERSISTENCE IS ASSERTED ACROSS A RELOAD, not against the in-memory list. The list re-renders from
// the mutation's own cache invalidation, so reading it back proves the optimistic path and nothing
// about the write. Only a reload proves the position reached Postgres. Series reads are deliberately
// side-effect-free in Phase 2B, so the reload must reproduce structured authority without seeding.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const TEST_EMAIL = 'series-builder-e2e@reverie.local'
const TEST_PASSWORD = 'series-builder-e2e-password'

const ALPHA = 'Builder Alpha'
const BETA = 'Builder Beta'

test.describe.configure({ mode: 'serial' })

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
        'series-builder createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Series Builder E2E', skin: 'tryst', mode: 'light' }),
    'series-builder profiles upsert',
  )
}

type Client = {
  sb: SupabaseClient
  session: { access_token: string; refresh_token: string }
  uid: string
}
let shared: Client | null = null
async function client(): Promise<Client> {
  if (shared) return shared
  await ensureUser()
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error || !data.session) throw new Error(authFailure('series-builder', TEST_EMAIL, error))
  shared = { sb, session: data.session, uid: data.session.user.id }
  return shared
}

async function reset(c: Client) {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: archived, error: archivedError } = await c.sb.rpc('list_archived_personal_series')
  if (archivedError) throw archivedError
  for (const row of (archived ?? []) as { id: string }[]) {
    await ok(
      c.sb.rpc('restore_personal_series', { p_series: row.id }),
      'series-builder archived series restore',
    )
  }
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(
      c.sb.from('list_items').delete().in('book_id', ids),
      'series-builder list_items delete',
    )
    await ok(c.sb.from('books').delete().in('id', ids), 'series-builder books delete')
  }
  const { data: ser } = await c.sb.from('series').select('id').eq('owner_id', c.uid)
  const sids = ((ser as { id: string }[]) ?? []).map((s) => s.id)
  if (sids.length) await c.sb.from('series_entries').delete().in('series_id', sids)
  const { error: seriesDeleteError } = await c.sb.from('series').delete().eq('owner_id', c.uid)
  if (seriesDeleteError) {
    // A successful merge deliberately leaves a protected survivor ruling. Raw access to that
    // history is denied even to the API service role, so fixture cleanup uses the same auth-admin
    // account cascade as real account deletion, then recreates this reusable local test identity.
    const { error: userDeleteError } = await admin.auth.admin.deleteUser(c.uid)
    if (userDeleteError) throw userDeleteError
    shared = null
    await ensureUser()
    const sb = createClient(SUPABASE_URL, ANON)
    const { data, error } = await sb.auth.signInWithPassword({
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    })
    if (error || !data.session)
      throw new Error(authFailure('series-builder reset', TEST_EMAIL, error))
    c.sb = sb
    c.session = data.session
    c.uid = data.session.user.id
    shared = c
    return
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'series-builder lists delete')
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
  for (const p of ['search', 'enrich', 'embed', 'releases'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/functions/v1/covers**', (r) =>
    r.fulfill({ status: 422, json: { error: 'fetch_failed' } }),
  )
  // No catalog entries: this suite arranges what the reader has, and a source refresh inserting
  // ghosts mid-test would change the list under the assertions.
  await page.route('**/functions/v1/series**', (r) =>
    r.fulfill({ json: { sourceRef: 'stub', entries: [] } }),
  )
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

async function seed(c: Client, series: string, titles: string[]) {
  const ids: string[] = []
  for (let i = 0; i < titles.length; i++) {
    const { data, error } = await c.sb
      .from('books')
      .insert({
        owner_id: c.uid,
        title: titles[i],
        author_first: 'Nell',
        author_last: 'Marrow',
        series,
        series_claim: { origin: 'reader', source: 'e2e_fixture' },
        position: i + 1,
        status: 'ongoing',
        genre: 'fantasy',
        ownership: 'owned',
        cover_url: '/landing-covers/everflame.jpg',
      })
      .select('id')
      .single()
    if (error) throw error
    ids.push((data as { id: string }).id)
  }
  return ids
}

const openIndex = async (page: Page) => {
  await page.goto('/series')
  await expect(page.getByRole('heading', { name: 'Series', level: 1 })).toBeVisible({
    timeout: 20_000,
  })
}

/** Expand one series' arranging panel and wait for its rows. */
async function expand(page: Page, series: string, rows: number) {
  await page.getByRole('button', { name: new RegExp(`${series}`) }).click()
  await expect
    .poll(async () => page.locator(`[data-testid="arrange-${series}"] li`).count(), {
      timeout: 20_000,
    })
    .toBe(rows)
}

/** Row titles in rendered order. Keyed on a testid, not on styling — the first draft selected by
 *  inline `color` and matched the position badge instead, which reads as a wrong order rather than a
 *  bad selector. */
const titlesIn = (page: Page, series: string) =>
  page
    .locator(`[data-testid="arrange-${series}"] li [data-testid="row-title"]`)
    .allTextContents()
    .then((xs) => xs.map((x) => x.trim()))

/** Order straight from the database, which is the only thing a reload can restore from. */
async function dbOrder(c: Client, series: string) {
  const { data: s } = await c.sb
    .from('series')
    .select('id')
    .eq('owner_id', c.uid)
    .eq('name', series)
    .maybeSingle()
  if (!s) return []
  const { data } = await c.sb
    .from('series_entries')
    .select('title, position, sort_order')
    .eq('series_id', (s as { id: string }).id)
    .is('removed_at', null)
    .order('sort_order')
    .order('position')
  return ((data ?? []) as { title: string; position: number; sort_order: number }[]).map(
    (e) => e.title,
  )
}

/** Drag row `from` onto row `to` by its grip, with pointer events — the touch-capable path. */
async function dragRow(page: Page, series: string, from: number, to: number) {
  const rows = page.locator(`[data-testid="arrange-${series}"] li`)
  const grip = rows.nth(from).getByRole('button', { name: /^Reorder / })
  // A reader scrolls until the handle they intend to grab is on screen. The canonical Series card
  // now carries covers and progress above its arranger, so the last row can begin just below a
  // 720px test viewport; raw page.mouse coordinates cannot start a gesture outside that viewport.
  await grip.scrollIntoViewIfNeeded()
  const g = await grip.boundingBox()
  const t = await rows.nth(to).boundingBox()
  if (!g || !t) throw new Error('row not measurable')
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
  await page.mouse.down()
  // Past dnd-kit's 4px activation constraint, then onto the target in steps so the sortable
  // strategy sees the move rather than a teleport.
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 - 10, { steps: 3 })
  await page.mouse.move(g.x + g.width / 2, t.y + t.height / 2, { steps: 12 })
  await page.mouse.up()
}

// ── Guard 1: a real pointer drag reorders, and the new order survives a reload ──
test('a drag reorders the series and the new order persists across a reload', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await seed(c, ALPHA, ['Alpha One', 'Alpha Two', 'Alpha Three'])
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await openIndex(page)
    await expand(page, ALPHA, 3)
    expect(await titlesIn(page, ALPHA)).toEqual(['Alpha One', 'Alpha Two', 'Alpha Three'])

    await dragRow(page, ALPHA, 2, 0) // Alpha Three to the front

    await expect
      .poll(async () => dbOrder(c, ALPHA), { timeout: 20_000 })
      .toEqual(['Alpha Three', 'Alpha One', 'Alpha Two'])

    const { data: canonical } = await c.sb
      .from('series_entries')
      .select('title, position')
      .eq('owner_id', c.uid)
      .is('removed_at', null)
      .order('position')
    expect(canonical).toEqual([
      { title: 'Alpha One', position: 1 },
      { title: 'Alpha Two', position: 2 },
      { title: 'Alpha Three', position: 3 },
    ])

    // The reload is the assertion: it re-reads from Postgres, so an order that only ever existed
    // in the query cache fails here.
    await page.reload()
    await openIndex(page)
    await expand(page, ALPHA, 3)
    expect(await titlesIn(page, ALPHA)).toEqual(['Alpha Three', 'Alpha One', 'Alpha Two'])
  } finally {
    await reset(c)
  }
})

// ── Guard 2: the visible ▲▼ affordance does the same, and also persists ──
test('the ▲▼ fallback reorders and persists across a reload', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await seed(c, ALPHA, ['Alpha One', 'Alpha Two', 'Alpha Three'])
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await openIndex(page)
    await expand(page, ALPHA, 3)

    await page.getByRole('button', { name: `Move Alpha One later in ${ALPHA}` }).click()

    await expect
      .poll(async () => dbOrder(c, ALPHA), { timeout: 20_000 })
      .toEqual(['Alpha Two', 'Alpha One', 'Alpha Three'])

    await page.reload()
    await openIndex(page)
    await expand(page, ALPHA, 3)
    expect(await titlesIn(page, ALPHA)).toEqual(['Alpha Two', 'Alpha One', 'Alpha Three'])
  } finally {
    await reset(c)
  }
})

// ── Guard 3: a GHOST reorders alongside real books ──
test('a ghost slot reorders alongside real books and keeps its new place', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await seed(c, ALPHA, ['Alpha One', 'Alpha Two'])
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    // Trusted fixture writes materialize entries; add the ghost on the full page because the index
    // arranges slots and does not create them.
    await page.goto(`/series/${encodeURIComponent(ALPHA)}`)
    await expect(page.locator('ol li').first()).toBeVisible({ timeout: 20_000 })
    const prompts = ['Alpha Ghost', 'Nell Marrow']
    page.on('dialog', (d) => void d.accept(prompts.shift() ?? ''))
    await page.getByRole('button', { name: /One you don’t have yet/i }).click()
    await expect(page.locator('ol li').filter({ hasText: 'Alpha Ghost' })).toBeVisible({
      timeout: 20_000,
    })

    await openIndex(page)
    await expand(page, ALPHA, 3)
    expect(await titlesIn(page, ALPHA)).toEqual(['Alpha One', 'Alpha Two', 'Alpha Ghost'])

    // A ghost is a position with no book yet — dragging it is exactly the act of deciding where the
    // book will go before it arrives, so it must be draggable like any other slot.
    await dragRow(page, ALPHA, 2, 0)

    await expect
      .poll(async () => dbOrder(c, ALPHA), { timeout: 20_000 })
      .toEqual(['Alpha Ghost', 'Alpha One', 'Alpha Two'])

    // A ghost has no book, and reading-order moves never rewrite canonical books.position.
    const { data: booksAfter } = await c.sb
      .from('books')
      .select('title, position')
      .eq('owner_id', c.uid)
      .order('position')
    expect(booksAfter).toEqual([
      { title: 'Alpha One', position: 1 },
      { title: 'Alpha Two', position: 2 },
    ])

    await page.reload()
    await openIndex(page)
    await expand(page, ALPHA, 3)
    expect(await titlesIn(page, ALPHA)).toEqual(['Alpha Ghost', 'Alpha One', 'Alpha Two'])
  } finally {
    await reset(c)
  }
})

// ── Guard 4: a cross-series drop changes nothing and writes nothing ──
test('a cross-series drop is refused — neither series reorders and nothing is written', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await seed(c, ALPHA, ['Alpha One', 'Alpha Two'])
  await seed(c, BETA, ['Beta One', 'Beta Two'])
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await openIndex(page)
    // Both expanded at once, so the drag is genuinely ATTEMPTABLE across the boundary rather than
    // impossible to express. Each series owns its own DndContext, and `resolveReorder` refuses a
    // foreign id on top of that — see its unit tests for the refusal branch itself.
    await expand(page, ALPHA, 2)
    await expand(page, BETA, 2)

    const before = { alpha: await dbOrder(c, ALPHA), beta: await dbOrder(c, BETA) }

    const writes: string[] = []
    const onReq = (r: { method: () => string; url: () => string }) => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(r.method())) return
      const { pathname } = new URL(r.url())
      if (pathname.startsWith('/rest/v1/'))
        writes.push(`${r.method()} ${pathname.replace('/rest/v1/', '')}`)
    }
    page.on('request', onReq)

    // Alpha's first row, dragged onto a row inside Beta's list.
    const alphaGrip = page
      .locator(`[data-testid="arrange-${ALPHA}"] li`)
      .nth(0)
      .getByRole('button', { name: /^Reorder / })
    const betaRow = page.locator(`[data-testid="arrange-${BETA}"] li`).nth(1)
    const g = await alphaGrip.boundingBox()
    const t = await betaRow.boundingBox()
    if (!g || !t) throw new Error('rows not measurable')
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + 10, { steps: 3 })
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 15 })
    await page.mouse.up()
    await page.waitForTimeout(1500) // a write, if one were coming, would have been issued by now
    page.off('request', onReq)

    expect(writes.filter((w) => w.startsWith('PATCH series_entries'))).toEqual([])
    expect(writes.filter((w) => w.startsWith('PATCH books'))).toEqual([])
    expect(await dbOrder(c, ALPHA)).toEqual(before.alpha)
    expect(await dbOrder(c, BETA)).toEqual(before.beta)
  } finally {
    await reset(c)
  }
})

// ── Guard 5: the canonical browser owns the complete reversible record lifecycle ──
test('rename, merge, delete, and restore preserve every series entry through the real UI', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await seed(c, ALPHA, ['Alpha One', 'Alpha Two'])
  await seed(c, BETA, ['Beta One', 'Beta Two'])
  await stubBackends(page)
  const renamed = `${ALPHA} Renamed`

  try {
    await signIn(page, c.session)
    await openIndex(page)

    const alphaCard = page.locator('[data-testid="series-browser-card"]', { hasText: ALPHA })
    await alphaCard.getByRole('button', { name: 'Rename' }).click()
    const renameDialog = page.getByRole('dialog', { name: `Rename ${ALPHA}` })
    await renameDialog.getByLabel('Series name').fill(renamed)
    await renameDialog.getByRole('button', { name: 'Rename series' }).click()
    await expect
      .poll(async () => dbOrder(c, renamed), { timeout: 20_000 })
      .toEqual(['Alpha One', 'Alpha Two'])

    await page.getByRole('button', { name: 'Merge series' }).click()
    const mergeDialog = page.getByRole('dialog', { name: 'Merge series' })
    await mergeDialog.getByLabel('First series').selectOption({ label: renamed })
    await mergeDialog.getByLabel('Second series').selectOption({ label: BETA })
    await mergeDialog.getByRole('radio', { name: renamed }).check()
    await mergeDialog.getByRole('button', { name: 'Merge series' }).click()
    await expect
      .poll(async () => dbOrder(c, renamed), { timeout: 20_000 })
      .toEqual(['Alpha One', 'Alpha Two', 'Beta One', 'Beta Two'])
    expect(await dbOrder(c, BETA)).toEqual([])

    const mergedCard = page.locator('[data-testid="series-browser-card"]', { hasText: renamed })
    await mergedCard.getByRole('button', { name: 'Delete' }).click()
    const deleteDialog = page.getByRole('dialog', { name: `Delete ${renamed}?` })
    await deleteDialog.getByRole('button', { name: 'Delete series' }).click()

    await expect
      .poll(async () => {
        const { data } = await c.sb.rpc('list_archived_personal_series')
        return ((data ?? []) as { name: string; entry_count: number }[]).map((row) => [
          row.name,
          Number(row.entry_count),
        ])
      })
      .toEqual([[renamed, 4]])

    await page.getByRole('button', { name: 'View' }).click()
    await page.getByRole('button', { name: 'Restore' }).click()
    await expect
      .poll(async () => dbOrder(c, renamed), { timeout: 20_000 })
      .toEqual(['Alpha One', 'Alpha Two', 'Beta One', 'Beta Two'])
  } finally {
    await reset(c)
  }
})

test('an incorrect category can be permanently deleted from its series page while its books stay', async ({
  page,
}, testInfo) => {
  const c = await client()
  await reset(c)
  await seed(c, ALPHA, ['Keep This Book', 'Keep This Too'])
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/series/${encodeURIComponent(ALPHA)}`)
    await page.getByRole('button', { name: 'Not a series? Remove this category' }).click()
    const dialog = page.getByRole('dialog', { name: `Not a series: ${ALPHA}` })
    await expect(dialog.getByRole('radio', { name: /This is not a series/ })).toBeChecked()
    await page.screenshot({ path: testInfo.outputPath('remove-series-category.png') })
    await dialog.getByRole('button', { name: 'Keep series' }).click()
    expect(await dbOrder(c, ALPHA)).toEqual(['Keep This Book', 'Keep This Too'])
    await page.getByRole('button', { name: 'Not a series? Remove this category' }).click()
    await dialog.getByRole('button', { name: 'Permanently delete category' }).click()
    await expect(page).toHaveURL(/\/series$/)
    await page.reload()
    await expect(page.getByTestId('series-browser-card').filter({ hasText: ALPHA })).toHaveCount(0)
    const rows = await c.sb
      .from('books')
      .select('title,series,series_user_chosen')
      .eq('owner_id', c.uid)
      .order('title')
    expect(rows.error).toBeNull()
    expect(rows.data).toEqual([
      { title: 'Keep This Book', series: null, series_user_chosen: true },
      { title: 'Keep This Too', series: null, series_user_chosen: true },
    ])
    const archived = await c.sb.rpc('list_archived_personal_series')
    expect(archived.error).toBeNull()
    expect(archived.data).toEqual([])
  } finally {
    await reset(c)
  }
})
