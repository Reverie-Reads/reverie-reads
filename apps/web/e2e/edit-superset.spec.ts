import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// Edit-as-superset + the gradient source change.
//
// The post-#80 matrix found "edit details" was not actually where you edit the details: page count
// wasn't in the model at all, subgenres were locked to the primary genre's vocabulary by the PICKER
// (never by storage), and ownership / read status / owned formats lived only on the book page's
// inline controls. The gradient rode on subgenre[0] — an array index — which the cross-genre
// disclosure would have turned into a visible mis-tint.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'edit-superset-e2e@reverie.local'
const PASSWORD = 'edit-superset-e2e-password'

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
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'edit-superset auth createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Edit Superset', skin: 'tryst', mode: 'system' }),
    'edit-superset profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('edit-superset', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

async function reset(c: Client) {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await c.sb.from('books').delete().in('id', ids)
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

const makeBook = async (c: Client, patch: Record<string, unknown> = {}) => {
  const { data, error } = await c.sb
    .from('books')
    .insert({
      owner_id: c.uid,
      title: 'Superset Probe',
      author_first: 'Nell',
      author_last: 'Marrow',
      genre: 'fantasy',
      ownership: 'unowned',
      read_status: 'unset',
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
      .select('pages, subgenres, subgenre, ownership, borrowed, wishlist, read_status, genre')
      .eq('id', id)
      .single()
  ).data as {
    pages: number | null
    subgenres: string[]
    subgenre: string
    ownership: string
    borrowed: boolean
    wishlist: boolean
    read_status: string
    genre: string
  }

const openEdit = async (page: Page) => {
  await page.getByRole('button', { name: /^Edit details$/i }).click()
  const dlg = page.getByRole('dialog', { name: /Edit details/i })
  await expect(dlg).toBeVisible()
  return dlg
}

// ── Page count ──
test('page count: blank when unknown, settable, persists', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Superset Probe' })).toBeVisible({
      timeout: 20_000,
    })
    // Unknown renders as NOTHING — no pill, no fabricated 0.
    await expect(page.getByText(/\bpp\b/)).toHaveCount(0)
    expect((await rowOf(c, id)).pages).toBeNull()

    const dlg = await openEdit(page)
    await dlg.getByLabel('Pages').fill('352')
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })
    await expect.poll(async () => (await rowOf(c, id)).pages, { timeout: 15_000 }).toBe(352)

    await page.reload()
    await expect(page.getByText('352 pp')).toBeVisible({ timeout: 20_000 })
  } finally {
    await reset(c)
  }
})

test('page count: out-of-range is refused in the form, matching the pub-date treatment', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { pages: 300 })
  const rejected: string[] = []
  page.on('response', (r) => {
    if (r.url().includes('/rest/v1/books') && r.request().method() === 'PATCH' && r.status() >= 400)
      rejected.push(r.url())
  })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Superset Probe' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)
    await dlg.getByLabel('Pages').fill('0')
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeVisible()
    await expect(dlg.getByText(/Pages must be 1 or more/i)).toBeVisible()
    expect(rejected, 'books_pages_check must never be reached').toEqual([])
    expect((await rowOf(c, id)).pages).toBe(300)
  } finally {
    await reset(c)
  }
})

// ── Cross-genre subgenres ──
test('subgenres: another genre’s shelf is a disclosure away, and the pick persists', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { genre: 'horror', subgenres: ['Gothic'], subgenre: 'Gothic' })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Superset Probe' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)

    // Hidden by default — the genre's own shelf stays the obvious first answer.
    await expect(dlg.getByRole('button', { name: 'Dark Romance' })).toHaveCount(0)
    await dlg.getByRole('button', { name: /Other genres’ subgenres/i }).click()
    const cross = dlg.getByRole('button', { name: 'Dark Romance' })
    await expect(cross).toBeVisible()
    await cross.click()
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })

    // A horror-romance is a real shape; storage always allowed it.
    await expect
      .poll(async () => (await rowOf(c, id)).subgenres, { timeout: 15_000 })
      .toContain('Dark Romance')
    expect((await rowOf(c, id)).genre).toBe('horror')
  } finally {
    await reset(c)
  }
})

// ── The gradient no longer takes its genre from an array index ──
test('gradient: a horror book whose first subgenre is Dark Romance does not tint romance', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  // subgenre[0] = Dark Romance on a HORROR book — the exact ordering accident.
  const horror = await makeBook(c, {
    title: 'Oxblood Probe',
    genre: 'horror',
    subgenres: ['Dark Romance'],
    subgenre: 'Dark Romance',
  })
  const romance = await makeBook(c, {
    title: 'Rose Probe',
    genre: 'romance',
    subgenres: ['Dark Romance'],
    subgenre: 'Dark Romance',
  })
  await stub(page)
  try {
    await signIn(page, c.session)

    /** The first gradient stop on the cover frame, as the browser serialises it. */
    const tintOf = async (id: string, title: string): Promise<[number, number, number]> => {
      await page.goto(`/book/${id}`)
      await expect(page.getByRole('heading', { level: 1, name: title, exact: true })).toBeVisible({
        timeout: 20_000,
      })
      const frame = page.getByRole('button', { name: /Change cover|Add a cover/ }).first()
      const style = (await frame.getAttribute('style')) ?? ''
      // The browser normalises the inline hsl() to rgb() on read-back, so compare the colour itself.
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(style)
      if (!m) throw new Error(`no gradient on the cover frame: ${style.slice(0, 140)}`)
      return [Number(m[1]), Number(m[2]), Number(m[3])]
    }

    // Same subgenre, DIFFERENT genre → different colour. Pre-fix these were byte-identical, because
    // the tint came from subgenre[0] alone and both books' first pick was "Dark Romance".
    const h = await tintOf(horror, 'Oxblood Probe')
    const r = await tintOf(romance, 'Rose Probe')
    expect(h, 'the horror book must not wear the romance family').not.toEqual(r)
    // And horror reads as oxblood: red-dominant, not the rose the romance family uses.
    expect(h[0]).toBeGreaterThan(h[2])
  } finally {
    await reset(c)
  }
})

// ── Reader state in edit details ──
test('edit details carries ownership and read status, persisting immediately', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Superset Probe' })).toBeVisible({
      timeout: 20_000,
    })
    // A freshly catalogued book claims nothing — no ownership, no borrowed copy, no want. Under the
    // four-state enum this was the single value 'unset'; it is now the absence of every flag.
    expect(await rowOf(c, id)).toMatchObject({
      ownership: 'unowned',
      borrowed: false,
      wishlist: false,
      read_status: 'unset',
    })

    const dlg = await openEdit(page)
    await expect(dlg.getByText('Your copies').first()).toBeVisible()
    await expect(dlg.getByText('Reading status')).toBeVisible()

    // These persist immediately, like MoodPicker — the same behaviour they have on the book page.
    await dlg
      .getByRole('button', { name: /^Reading$/ })
      .first()
      .click()
    await expect
      .poll(async () => (await rowOf(c, id)).read_status, { timeout: 15_000 })
      .toBe('Reading')
  } finally {
    await reset(c)
  }
})
