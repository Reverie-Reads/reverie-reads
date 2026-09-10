import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// A month-level plan, end to end through the real UI.
//
// The point of the plan trio is that "sometime in March" is sayable. The old `<input type="date">`
// could not express it — a reader either invented a day or set nothing — so the guard that matters
// is not "a plan saves" but "a plan saves WITHOUT a day, and nothing downstream puts one back".
// Three surfaces could each reintroduce one: the editor (by requiring the field), the mapper's
// render (by formatting a null day as 1). This asserts the stored row and the rendered text,
// because those fail differently.
//
// plan_date is gone entirely — the app stopped writing it (#120) and 20260805010000 dropped the
// column. These assertions are trio-only now; there is no legacy column left to check against.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'plan-precision-e2e@reverie.local'
const PASSWORD = 'plan-precision-e2e-password'

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
        'plan-precision auth createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Plan Precision', skin: 'tryst', mode: 'system' }),
    'plan-precision profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('plan-precision', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

async function reset(c: Client) {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await ok(c.sb.from('books').delete().in('id', ids), 'plan-precision books delete')
}

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
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

const makeBook = async (c: Client, title = 'Plan Precision Book') => {
  const { data, error } = await c.sb
    .from('books')
    .insert({
      owner_id: c.uid,
      title,
      author_first: 'Ines',
      author_last: 'Quill',
      genre: 'fantasy',
      ownership: 'owned',
      status: 'standalone',
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

const planRow = async (c: Client, id: string) =>
  (
    await c.sb
      .from('books')
      .select('plan_y, plan_m, plan_d, plan_position, plan_intention')
      .eq('id', id)
      .single()
  ).data as {
    plan_y: number | null
    plan_m: number | null
    plan_d: number | null
    plan_position: number | null
    plan_intention: string
  }

const planField = (page: Page, label: string) => page.getByLabel(`Planned read ${label}`)

test('a month-only plan persists as a month, with no day invented anywhere', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Plan Precision Book' })).toBeVisible({
      timeout: 20_000,
    })

    // Year and month only. The day field is left untouched — the reader is never made to pick one.
    await planField(page, 'year').fill('2026')
    await planField(page, 'month').fill('3')
    await planField(page, 'month').blur()

    // The stored row is the assertion that matters: plan_d stays NULL. A month-only plan that
    // fabricated a day would pass every visual check and fail here.
    await expect
      .poll(async () => await planRow(c, id), { timeout: 15_000 })
      .toMatchObject({ plan_y: 2026, plan_m: 3, plan_d: null })

    // Survives a reload as a MONTH — the fields come back from the database, not from local state.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Plan Precision Book' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(planField(page, 'year')).toHaveValue('2026')
    await expect(planField(page, 'month')).toHaveValue('3')
    await expect(planField(page, 'day')).toHaveValue('')

    // And renders as a month wherever a plan is shown, without printing a raw ISO string.
    await page.goto('/planner')
    await expect(page.getByText('Mar 2026', { exact: true })).toBeVisible({ timeout: 20_000 })
  } finally {
    await reset(c)
  }
})

test('a full-precision plan still round-trips through the trio', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const id = await makeBook(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Plan Precision Book' })).toBeVisible({
      timeout: 20_000,
    })

    await planField(page, 'year').fill('2026')
    await planField(page, 'month').fill('3')
    await planField(page, 'day').fill('14')
    await planField(page, 'day').blur()

    await expect
      .poll(async () => await planRow(c, id), { timeout: 15_000 })
      .toMatchObject({ plan_y: 2026, plan_m: 3, plan_d: 14 })

    await page.goto('/planner')
    await expect(page.getByText('Mar 14, 2026', { exact: true })).toBeVisible({ timeout: 20_000 })

    await page.getByRole('button', { name: /Calendar/ }).click()
    await expect(page).toHaveURL(/\/planner\?tab=calendar/)
    await expect(page.getByRole('group', { name: 'Choose a month in 2026' })).toBeVisible()
    await expect(
      page.getByRole('button', {
        name: 'Mar 2026: 0 finished, 1 planned. Show Mar.',
      }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Mar 2026: 0 finished, 1 planned. Show Mar.' }).click()
    await expect(page.getByRole('heading', { name: 'Mar 2026' })).toBeVisible()
  } finally {
    await reset(c)
  }
})

test('Soon, intention, reorder, remove and Undo survive the real persistence boundary', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const firstId = await makeBook(c)
  const secondId = await makeBook(c, 'Second Plan Book')
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${firstId}`)
    await page.getByRole('button', { name: 'Soon' }).click()
    await expect
      .poll(async () => await planRow(c, firstId), { timeout: 15_000 })
      .toMatchObject({ plan_y: null, plan_position: 1000 })

    await page.goto('/planner')
    await page.getByRole('button', { name: 'Add to your plan' }).click()
    await page.getByRole('button', { name: 'Choose Second Plan Book' }).click()
    await page.getByPlaceholder('What draws you to this book?').fill('For a quiet weekend.')
    await page.getByRole('button', { name: 'Save plan' }).click()

    await expect(
      page.getByLabel('Reading plan').getByText('For a quiet weekend.', { exact: true }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Move Second Plan Book earlier' }).click()
    await expect
      .poll(async () => (await planRow(c, secondId)).plan_position, { timeout: 15_000 })
      .toBeLessThan((await planRow(c, firstId)).plan_position!)

    await page.getByRole('button', { name: 'Remove Second Plan Book' }).click()
    await expect
      .poll(async () => (await planRow(c, secondId)).plan_position, { timeout: 15_000 })
      .toBeNull()
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect
      .poll(async () => await planRow(c, secondId), { timeout: 15_000 })
      .toMatchObject({ plan_y: null, plan_position: 0, plan_intention: 'For a quiet weekend.' })
  } finally {
    await reset(c)
  }
})
