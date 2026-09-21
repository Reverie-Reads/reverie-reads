import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { localAdminKey } from './support/localSupabase'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const EMAIL = 'copy-inventory-e2e@reverie.local'
const PASSWORD = 'copy-inventory-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
  session: { access_token: string; refresh_token: string }
  uid: string
}
let shared: Client | null = null
async function client(): Promise<Client> {
  if (shared) return shared
  const admin = createClient(SUPABASE_URL, localAdminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'copy-inventory auth createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Copy Inventory', skin: 'tryst', mode: 'system' }),
    'copy-inventory profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('copy-inventory', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

async function reset(c: Client) {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await ok(c.sb.from('books').delete().in('id', ids), 'copy-inventory books delete')
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

const makeBook = async (c: Client, title = 'Copy Inventory Book') => {
  const { data, error } = await c.sb
    .from('books')
    .insert({
      owner_id: c.uid,
      title,
      author_first: 'Ines',
      author_last: 'Quill',
      genre: 'fantasy',
      ownership: 'owned',
      owned_physical: 'paperback',
      read_status: 'Reading',
      progress: 45,
      rating: 4,
      status: 'standalone',
    })
    .select('id')
    .single()
  if (error) throw error
  return (data as { id: string }).id
}

test('two hardbacks, paperback and wanted edition persist under one reading history', async ({
  page,
}) => {
  const c = await client()
  await reset(c)
  const id = await makeBook(c)
  await stub(page)
  await signIn(page, c.session)
  await page.goto(`/book/${id}`)
  await page.getByRole('button', { name: 'Set up editions & copies', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Editions & copies', exact: true })
  const first = dialog.getByRole('region', { name: 'Edition 1', exact: true })
  await expect(first.getByLabel('Format', { exact: true })).toHaveValue('paperback')
  await first.getByLabel('Edition name').fill('Everyday paperback')
  await dialog.getByRole('button', { name: 'Add another edition', exact: true }).click()
  const second = dialog.getByRole('region', { name: 'Edition 2', exact: true })
  await second.getByLabel('Edition name').fill('Signed anniversary edition')
  await second.getByLabel('Format', { exact: true }).selectOption('hardcover')
  await second.getByLabel('Possession').selectOption('owned')
  await second.getByLabel('Location (private)').fill('Study shelf')
  await second.getByRole('button', { name: 'Add another copy', exact: true }).click()
  await second.getByLabel('Possession').nth(1).selectOption('owned')
  await dialog.getByRole('button', { name: 'Add another edition', exact: true }).click()
  const third = dialog.getByRole('region', { name: 'Edition 3', exact: true })
  await third.getByLabel('Edition name').fill('Illustrated edition')
  await third.getByLabel('Possession').selectOption('wishlist')
  await dialog.getByRole('button', { name: 'Save editions & copies' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(page.getByText('4 copy records · 3 editions')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Signed anniversary edition', { exact: true })).toBeVisible()
  const row = await c.sb.from('books').select('*').eq('id', id).single()
  if (row.error) throw row.error
  expect(row.data.copy_inventory.copies).toHaveLength(4)
  expect(row.data).toMatchObject({
    ownership: 'owned',
    wishlist: true,
    owned_physical: 'yes',
    read_status: 'Reading',
    progress: 45,
    rating: 4,
  })
  const books = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  expect(books.data).toHaveLength(1)
  await page.getByRole('button', { name: 'Manage copies', exact: true }).click()
  await expect(dialog.getByLabel('Edition name').nth(1)).toHaveValue('Signed anniversary edition')
  await expect(dialog.getByLabel('Location (private)').nth(1)).toHaveValue('Study shelf')
  const geometry = await dialog.evaluate((el) => ({
    width: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }))
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1)
  await page.screenshot({ path: 'test-results/copy-inventory-editor.png', fullPage: true })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await reset(c)
})

test('failed saves retain the draft and stale edits cannot overwrite another tab', async ({
  page,
}) => {
  const c = await client()
  await reset(c)
  const id = await makeBook(c)
  await stub(page)
  await signIn(page, c.session)
  await page.goto(`/book/${id}`)
  await page.getByRole('button', { name: 'Set up editions & copies', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Editions & copies', exact: true })
  await dialog.getByLabel('Edition name').fill('My deliberate draft')
  await page.route('**/rest/v1/rpc/save_copy_inventory', (route) =>
    route.fulfill({ status: 503, json: { message: 'Temporarily unavailable' } }),
  )
  await dialog.getByRole('button', { name: 'Save editions & copies' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Temporarily unavailable')
  await expect(dialog.getByLabel('Edition name')).toHaveValue('My deliberate draft')
  await page.unroute('**/rest/v1/rpc/save_copy_inventory')
  await ok(
    c.sb.from('books').update({ owned_physical: 'hardcover' }).eq('id', id),
    'other tab changes legacy format',
  )
  await dialog.getByRole('button', { name: 'Save editions & copies' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Copies changed elsewhere')
  await expect(dialog.getByLabel('Edition name')).toHaveValue('My deliberate draft')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await dialog.getByRole('button', { name: 'Discard changes', exact: true }).click()
  await reset(c)
})
