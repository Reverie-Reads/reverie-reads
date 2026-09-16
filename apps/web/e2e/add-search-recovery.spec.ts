import { randomUUID } from 'node:crypto'
import AxeBuilder from '@axe-core/playwright'
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

for (const touch of [false, true]) {
  test.describe(touch ? 'phone Add recovery' : 'desktop Add recovery', () => {
    test.use({
      hasTouch: touch,
      viewport: touch ? { width: 390, height: 844 } : { width: 1100, height: 900 },
    })
    test('a first reader can retry an outage, distinguish no matches, and enter their own book', async ({
      page,
    }) => {
      const account = await firstReader(page)
      try {
        let mode: 'failure' | 'found' | 'empty' = 'failure'
        const queries: string[] = []
        await page.route('**/functions/v1/search**', (route) => {
          queries.push(route.request().postDataJSON().q)
          return mode === 'failure'
            ? route.fulfill({ status: 503, json: { error: 'temporary test outage' } })
            : route.fulfill({
                json: {
                  results:
                    mode === 'empty'
                      ? []
                      : [
                          {
                            title: 'The Quiet Lantern',
                            authors: ['Avery Reader'],
                            source: 'hardcover',
                            cover: '',
                            isbn: '',
                            year: '',
                          },
                        ],
                },
              })
        })
        const input = page.getByRole('textbox', { name: 'Search for a book' })
        const search = page.getByRole('button', { name: 'Search', exact: true })
        const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
        await input.fill('It')
        await search.click()
        await expect(page.getByRole('alert')).toContainText('at least 3 characters')
        await expect(input).toHaveAttribute('aria-invalid', 'true')
        expect(queries).toEqual([])
        await input.fill('The Quiet Lantern')
        await search.click()
        await expect(page.getByRole('alert')).toContainText('Search is unavailable')
        await expect(input).toHaveValue('The Quiet Lantern')
        await expect(input).not.toHaveAttribute('aria-invalid', 'true')
        await expect(
          page.getByRole('button', { name: 'Add it manually', exact: true }),
        ).toHaveCount(0)
        await expect(guide.getByRole('status')).toHaveText('Find a book you know')
        const retry = page.getByRole('button', { name: 'Try search again' })
        await expect(retry).toBeVisible()
        await expect(retry).toBeEnabled()
        expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        expect(
          (await new AxeBuilder({ page }).include('#add-search-issue').analyze()).violations,
        ).toEqual([])
        await page.screenshot({
          path: `test-results/add-search-${touch ? 'phone' : 'desktop'}.png`,
          fullPage: true,
        })
        mode = 'found'
        await retry.click()
        await expect(page.getByTestId('add-result')).toContainText('The Quiet Lantern')
        await expect(guide.getByRole('status')).toHaveText('Choose the right book')
        expect(queries).toEqual(['The Quiet Lantern', 'The Quiet Lantern'])
        await expect(page.getByRole('alert')).toHaveCount(0)

        mode = 'failure'
        await input.fill('Another book')
        await search.click()
        await expect(page.getByRole('alert')).toContainText('Search is unavailable')
        await expect(page.getByTestId('add-result')).toHaveCount(0)
        mode = 'empty'
        await retry.click()
        await expect(
          page.getByRole('button', { name: 'Add it manually', exact: true }),
        ).toBeVisible()
        await expect(page.getByRole('alert')).toHaveCount(0)
        await page.getByRole('button', { name: 'Add it manually', exact: true }).click()
        await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue('Another book')
        await expect(guide.getByRole('status')).toHaveText('Make it yours')
        expect(await account.rows()).toEqual([])
      } finally {
        await account.cleanup()
      }
    })
  })
}
