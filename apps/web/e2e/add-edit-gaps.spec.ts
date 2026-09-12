import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// The matrix in the #80 follow-up found the same defect class the original tester reported, sitting
// one screen over:
//   · Add still parsed its position with `Number(v) || ''` — the exact coercion #78 fixed in Edit,
//     so 0 became "unset" and "1.5 (novella)" vanished silently.
//   · Spice was settable in Add and NOWHERE else; title and ISBN nowhere at all after creation —
//     write-once through the UI, which compounds badly with adopting a wrong search hit.
//   · "Add it manually" rendered only when a search returned ZERO results, so a search that found
//     the WRONG books left no way in.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
// PER-PROJECT ISOLATION. `rest` and `mobile` run this file concurrently (it is not in mobile's
// testIgnore), and both raced one shared account: each calls listUsers(), each sees no such user,
// each calls createUser(), and the loser gets `422 email_exists` before a single assertion runs.
// Observed on a full-suite run as 2 failures with that exact error. Scoping the account by project
// name removes the shared state instead of timing around it — the same fix scroll-restoration and
// the search-param specs already carry.
const PROJECT = (): string => test.info().project.name
const EMAIL = () => `add-edit-gaps-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'add-edit-gaps-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
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
        'add-edit-gaps auth createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Add Edit Gaps', skin: 'tryst', mode: 'system' }),
    'add-edit-gaps profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('add-edit-gaps', EMAIL(), error))
  const c = { sb, session: s.session, uid: s.session.user.id }
  shared.set(PROJECT(), c)
  return c
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
      title: 'Gaps Probe',
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
  (await c.sb.from('books').select('title, isbn, intensity, position').eq('id', id).single())
    .data as {
    title: string
    isbn: string | null
    intensity: number | null
    position: number | null
  }

const openEdit = async (page: Page) => {
  await page.getByRole('button', { name: /^Edit details$/i }).click()
  const dlg = page.getByRole('dialog', { name: /Edit details/i })
  await expect(dlg).toBeVisible()
  return dlg
}

// ── Add: the position field gets what Edit got in #78 ──
test('Add: position 0 and decimals are settable; junk is refused visibly', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto('/add')
    // The manual path — now reachable without searching first (see the peer-button test below).
    await page.getByRole('button', { name: /^Add manually$/i }).click()

    const title = page.getByPlaceholder('Title', { exact: true })
    await expect(title).toBeVisible({ timeout: 15_000 })
    await title.fill('Zero Slot Probe')
    const position = page.getByPlaceholder('Book #')

    // Junk is refused in the form — pre-fix it became '' with no word said.
    await position.fill('1.5 (novella)')
    await page.getByRole('button', { name: /^Add to my library$/ }).click()
    await expect(page.getByRole('alert').filter({ hasText: /must be a number/i })).toBeVisible({
      timeout: 10_000,
    })
    await expect(position).toHaveAttribute('aria-invalid', 'true')
    expect((await c.sb.from('books').select('id').eq('owner_id', c.uid)).data).toEqual([]) // nothing written

    // 0 is a real slot (the prequel position) — `Number(v) || ''` swallowed it.
    await position.fill('0')
    await page.getByRole('button', { name: /^Add to my library$/ }).click()
    await expect
      .poll(
        async () =>
          ((await c.sb.from('books').select('position, title').eq('owner_id', c.uid)).data ?? [])
            .length,
        { timeout: 20_000 },
      )
      .toBe(1)
    const rows = (await c.sb.from('books').select('position').eq('owner_id', c.uid)).data as {
      position: number | null
    }[]
    expect(Number(rows[0]!.position)).toBe(0)
  } finally {
    await reset(c)
  }
})

test('Add: a decimal position survives', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto('/add')
    await page.getByRole('button', { name: /^Add manually$/i }).click()
    await page.getByPlaceholder('Title', { exact: true }).fill('Novella Probe')
    await page.getByPlaceholder('Book #').fill('2.5')
    await page.getByRole('button', { name: /^Add to my library$/ }).click()
    await expect
      .poll(
        async () =>
          ((await c.sb.from('books').select('position').eq('owner_id', c.uid)).data ?? []).length,
        { timeout: 20_000 },
      )
      .toBe(1)
    const rows = (await c.sb.from('books').select('position').eq('owner_id', c.uid)).data as {
      position: number | null
    }[]
    expect(Number(rows[0]!.position)).toBe(2.5)
  } finally {
    await reset(c)
  }
})

// ── "Add manually" is a peer of Search and Scan ──
test('Add: "Add manually" is reachable without a search returning empty', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto('/add')
    // Present on arrival — no search run at all. Pre-fix it existed only in the results-empty branch.
    const manual = page.getByRole('button', { name: /^Add manually$/i })
    await expect(manual).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: /^Search$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Scan/ })).toBeVisible()

    await manual.click()
    await expect(page.getByPlaceholder('Title', { exact: true })).toBeVisible({ timeout: 15_000 })
  } finally {
    await reset(c)
  }
})

// ── Edit: title, ISBN and spice are no longer write-once ──
test('Edit details: title, ISBN and spice are editable and persist', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { title: 'Wrong Hit Title', isbn: '', intensity: 0 })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Wrong Hit Title' })).toBeVisible({
      timeout: 20_000,
    })

    const dlg = await openEdit(page)
    await dlg.getByLabel('Title').fill('The Corrected Title')
    await dlg.getByLabel('ISBN').fill('9780316580792')
    // Spice: the same 1-5 control Add uses. Click the 3rd notch.
    //
    // Anchored on the AXIS NAME, not on a trailing digit. Two things changed under this spec: the
    // buttons now carry their level's definition in the accessible name ("Spice 3 — On the page,
    // not dwelt on"), so a `/\b3$/` match no longer reaches them; and a second DARKNESS picker sits
    // beside this one with its own "3", which the old `.first()` only survived by ordering luck.
    await dlg.getByRole('button', { name: /^Spice 3\b/ }).click()
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })

    await expect
      .poll(async () => await rowOf(c, id), { timeout: 15_000 })
      .toMatchObject({
        title: 'The Corrected Title',
        isbn: '9780316580792',
        intensity: 3,
      })

    // Survives a reload, and the page heading follows the new title.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'The Corrected Title' })).toBeVisible({
      timeout: 20_000,
    })
  } finally {
    await reset(c)
  }
})

test('Edit details: an emptied title is refused, not silently reverted', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c, { title: 'Keep My Name' })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Keep My Name' })).toBeVisible({
      timeout: 20_000,
    })
    const dlg = await openEdit(page)
    await dlg.getByLabel('Title').fill('   ')
    await dlg.getByRole('button', { name: /Save details/i }).click()

    // Refused in the form: the dialog STAYS OPEN, the field says why, and nothing is written.
    // Quietly restoring the old title would look identical to a successful save — the exact
    // invisible-write pattern #78 exists to eliminate.
    await expect(dlg).toBeVisible()
    await expect(dlg.getByText('A book needs a title.')).toBeVisible()
    await expect(dlg.getByLabel('Title')).toHaveAttribute('aria-invalid', 'true')
    expect((await rowOf(c, id)).title).toBe('Keep My Name')

    // Typing clears the error, and a real title saves.
    await dlg.getByLabel('Title').fill('A Real Title')
    await expect(dlg.getByText('A book needs a title.')).toHaveCount(0)
    await dlg.getByRole('button', { name: /Save details/i }).click()
    await expect(dlg).toBeHidden({ timeout: 15_000 })
    await expect
      .poll(async () => (await rowOf(c, id)).title, { timeout: 15_000 })
      .toBe('A Real Title')
  } finally {
    await reset(c)
  }
})
