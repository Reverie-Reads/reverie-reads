import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { authFailure } from './support/authError'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'restore-preflight-e2e@reverie.local'
const PASSWORD = 'restore-preflight-e2e-password'
const TITLE = 'The Restore Before Dawn'

type Client = {
  sb: SupabaseClient
  uid: string
  session: { access_token: string; refresh_token: string }
}

test.describe.configure({ mode: 'serial' })

async function client(): Promise<Client> {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users.find((user) => user.email === EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'restore-preflight createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Restore Reader', skin: 'hearth', mode: 'dark' }),
    'restore-preflight profile upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: signedIn, error } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  })
  if (error || !signedIn.session) throw new Error(authFailure('restore-preflight', EMAIL, error))
  return { sb, uid, session: signedIn.session }
}

async function reset(c: Client) {
  const { data } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((data as { id: string }[]) ?? []).map((book) => book.id)
  if (ids.length)
    await ok(c.sb.from('books').delete().in('id', ids), 'restore-preflight books delete')
}

async function seed(c: Client) {
  await reset(c)
  await ok(
    c.sb.from('books').insert({
      owner_id: c.uid,
      title: TITLE,
      author_first: 'Mara',
      author_last: 'Vesper',
      genre: 'mystery',
      status: 'standalone',
      ownership: 'owned',
      read_status: 'Read',
      fave: true,
      plan_position: 1024,
    }),
    'restore-preflight seed book',
  )
}

async function signIn(page: Page, session: Client['session']) {
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

const rowCount = async (c: Client) =>
  ((await c.sb.from('books').select('id').eq('owner_id', c.uid)).data ?? []).length

async function chooseBackup(page: Page, path: string) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByTestId('restore-backup').click()
  await (await chooser).setFiles(path)
}

test('a backup is inspected with real counts and writes only after confirmation', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await seed(c)
  try {
    await signIn(page, c.session)
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Backup & import' })).toBeVisible({
      timeout: 20_000,
    })

    // Export the one-book account so this test consumes a real current backup, including its
    // completeness record, rather than a hand-maintained fixture that can drift from the writer.
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: /Export library \(JSON\)/ }).click()
    const backup = await download
    const path = await backup.path()
    if (!path) throw new Error('Playwright did not retain the downloaded backup')

    await chooseBackup(page, path)
    const dialog = page.getByRole('dialog', { name: 'Review your restore' })
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Library after restore')
    await expect(dialog).toContainText('add 1 book to the 1 book already here')
    await expect(dialog).toContainText('completeness record matches')
    await expect(dialog.getByText('2', { exact: true }).first()).toBeVisible()
    expect(
      await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
      'the restore review must fit the active viewport without sideways scrolling',
    ).toBe(true)
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(axe.violations).toEqual([])
    expect(await rowCount(c)).toBe(1)

    // Cancel proves that file selection and preview are read-only.
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByTestId('restore-backup')).toBeFocused()
    expect(await rowCount(c)).toBe(1)

    // The same immutable file is re-inspected, then the explicit confirmation performs the add.
    await chooseBackup(page, path)
    await page.getByRole('button', { name: 'Restore this backup' }).click()
    await expect(page.getByText(/Restored 1 book,/)).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => rowCount(c), { timeout: 30_000 }).toBe(2)
  } finally {
    await reset(c)
  }
})
