import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'

const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const service =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function firstReader(page: Page) {
  const admin = createClient(endpoint, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `tour-${randomUUID()}@reverie.local`
  const password = 'Live-tour-local-9843'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No test reader')
  const uid = created.data.user.id
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await reader.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No test session')
  await keepOfflineCacheEmpty(page)
  for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Show me around', exact: true }).click()
  await expect(page).toHaveURL(/\/add$/)
  await expect(
    page.getByRole('complementary', { name: 'Live walkthrough' }).getByRole('status'),
  ).toHaveText('Find a book you know')
  return {
    reader,
    uid,
    async rows() {
      const result = await reader
        .from('books')
        .select('id,title,ownership,read_status')
        .eq('owner_id', uid)
      if (result.error) throw result.error
      return result.data
    },
    async cleanup() {
      const result = await admin.auth.admin.deleteUser(uid)
      if (result.error) throw result.error
    },
  }
}

function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
async function draft(page: Page, title: string) {
  await page.getByRole('button', { name: 'Add manually', exact: true }).click()
  await page.getByPlaceholder('Title', { exact: true }).fill(title)
  await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('220')
  await page.getByRole('radio', { name: 'Wishlist', exact: true }).click()
}
for (const touch of [false, true]) {
  test.describe(touch ? 'phone save recovery' : 'desktop save recovery', () => {
    test.use({
      hasTouch: touch,
      viewport: touch ? { width: 390, height: 844 } : { width: 1100, height: 900 },
    })
    test('a rejected save retains the draft and a deliberate retry creates one book', async ({
      page,
    }) => {
      const account = await firstReader(page)
      const gate = barrier()
      let inserts = 0
      const ids: string[] = []
      try {
        await draft(page, 'One Quiet Evening')
        await page.route('**/rest/v1/books?*', async (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          inserts++
          ids.push(route.request().postDataJSON().id)
          if (inserts === 1) {
            await gate.promise
            return route.fulfill({
              status: 503,
              json: { message: 'test write rejected', code: 'TEST' },
            })
          }
          return route.fallback()
        })
        const add = page.locator('[data-book-tour="book-save"]')
        await add.click()
        await expect(add).toHaveText('Saving…')
        await expect(add).toBeDisabled()
        await expect(page.getByPlaceholder('Title', { exact: true })).toBeDisabled()
        await add.evaluate((node: HTMLButtonElement) => {
          node.click()
          node.click()
        })
        await expect.poll(() => inserts).toBe(1)
        gate.release()
        await expect(page.getByRole('alert')).toContainText('couldn’t confirm the save')
        await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue(
          'One Quiet Evening',
        )
        await expect(page.getByRole('textbox', { name: 'Pages', exact: true })).toHaveValue('220')
        await expect(page.getByRole('radio', { name: 'Wishlist', exact: true })).toHaveAttribute(
          'aria-checked',
          'true',
        )
        expect(await account.rows()).toEqual([])
        await expect(
          page.getByRole('complementary', { name: 'Live walkthrough' }).getByRole('status'),
        ).toHaveText('Make it yours')
        // The coach must occupy layout space instead of covering the failure or retry control.
        await expect
          .poll(async () => {
            const coach = await page
              .getByRole('complementary', { name: 'Live walkthrough' })
              .boundingBox()
            const alert = await page.getByRole('alert').boundingBox()
            const button = await add.boundingBox()
            return (
              !!coach &&
              !!alert &&
              !!button &&
              alert.y + alert.height <= coach.y &&
              coach.y + coach.height <= button.y
            )
          })
          .toBe(true)
        await page.screenshot({
          path: `test-results/add-save-${touch ? 'phone' : 'desktop'}.png`,
          fullPage: true,
        })
        await page.getByRole('button', { name: 'Try saving again', exact: true }).click()
        await expect(
          page.getByRole('heading', { name: 'Added — finish the details' }),
        ).toBeVisible()
        expect(inserts).toBe(2)
        expect(ids[0]).toBeTruthy()
        expect(ids[1]).toBe(ids[0])
        const rows = await account.reader
          .from('books')
          .select('id,title,pages,wishlist,read_status')
          .eq('owner_id', account.uid)
        expect(rows.error).toBeNull()
        expect(rows.data).toEqual([
          {
            id: ids[0],
            title: 'One Quiet Evening',
            pages: 220,
            wishlist: true,
            read_status: 'unset',
          },
        ])
      } finally {
        gate.release()
        await account.cleanup()
      }
    })

    test('a lost insert response is found without inserting or completing details again', async ({
      page,
    }) => {
      const account = await firstReader(page)
      let inserts = 0
      try {
        await draft(page, 'A Lost Reply')
        await page.route('**/rest/v1/books?*', async (route) => {
          if (route.request().method() !== 'POST') return route.fallback()
          inserts++
          const saved = await route.fetch()
          expect(saved.ok()).toBe(true)
          return route.fulfill({
            status: 503,
            json: { message: 'response lost after write', code: 'TEST' },
          })
        })
        await page.locator('[data-book-tour="book-save"]').click()
        await expect(page.getByRole('alert')).toContainText('couldn’t confirm the save')
        const rows = await account.rows()
        expect(rows).toHaveLength(1)
        await page.getByRole('button', { name: 'Try saving again', exact: true }).click()
        await expect(page.getByRole('alert')).toContainText('not every detail was confirmed')
        await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue('A Lost Reply')
        await expect(page.locator('[data-book-tour="book-save"]')).toBeDisabled()
        expect(inserts).toBe(1)
        expect(await account.rows()).toEqual(rows)
        await page.getByRole('link', { name: 'Review saved book' }).click()
        await expect(page).toHaveURL(new RegExp(`/book/${rows[0]!.id}$`))
      } finally {
        await account.cleanup()
      }
    })
  })
}

test('a contributor failure after insertion keeps the book and offers review without repeating the write', async ({
  page,
}) => {
  const account = await firstReader(page)
  let contributorWrites = 0
  try {
    await draft(page, 'A Partial Save')
    await page.getByRole('button', { name: '＋ Add contributor', exact: true }).click()
    await page.getByPlaceholder('Name', { exact: true }).fill('Avery Reader')
    await page.route('**/rest/v1/rpc/set_book_contributors', (route) => {
      contributorWrites++
      return route.fulfill({
        status: 503,
        json: { message: 'contributor save rejected', code: 'TEST' },
      })
    })
    await page.locator('[data-book-tour="book-save"]').click()
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm the save')
    expect(await account.rows()).toHaveLength(1)
    await page.getByRole('button', { name: 'Try saving again' }).click()
    await expect(page.getByRole('link', { name: 'Review saved book' })).toBeVisible()
    expect(contributorWrites).toBe(1)
    expect(await account.rows()).toHaveLength(1)
  } finally {
    await account.cleanup()
  }
})

test('Keep both cannot insert a third copy after the duplicate preference fails', async ({
  page,
}) => {
  const account = await firstReader(page)
  try {
    const existing = await account.reader.from('books').insert({
      owner_id: account.uid,
      title: 'Ember and Ash: A Novel',
      author_first: 'Nell',
      author_last: 'Marrow',
    })
    if (existing.error) throw existing.error
    await page.reload()
    await draft(page, 'Ember and Ash')
    await page.getByRole('button', { name: '＋ Add contributor', exact: true }).click()
    await page.getByPlaceholder('Name', { exact: true }).fill('Nell Marrow')
    await page.locator('[data-book-tour="book-save"]').click()
    const keep = page.getByRole('button', { name: 'Keep both', exact: true })
    await expect(keep).toBeVisible()
    await expect(page.locator('[data-book-tour="book-save"]')).toBeDisabled()
    await page.route('**/rest/v1/merge_verdicts*', (route) =>
      route.fulfill({ status: 503, json: { message: 'verdict save rejected', code: 'TEST' } }),
    )
    await keep.click()
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm the save')
    await expect(page.getByRole('button', { name: 'Merge into it' })).toBeDisabled()
    expect(await account.rows()).toHaveLength(2)
    await page.getByRole('button', { name: 'Try keeping both again', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Review saved book' })).toBeVisible()
    expect(await account.rows()).toHaveLength(2)
  } finally {
    await account.cleanup()
  }
})
