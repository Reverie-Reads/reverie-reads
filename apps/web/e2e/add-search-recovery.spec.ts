import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
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
  await expect(page.getByRole('heading', { name: 'Make this your library.' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
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
        let mode: 'failure' | 'found' | 'empty' | 'malformed' = 'failure'
        let releaseMalformed!: () => void
        const malformedGate = new Promise<void>((resolve) => {
          releaseMalformed = resolve
        })
        const queries: string[] = []
        await page.route('**/functions/v1/search**', async (route) => {
          queries.push(route.request().postDataJSON().q)
          if (mode === 'malformed') await malformedGate
          return mode === 'failure'
            ? route.fulfill({ status: 503, json: { error: 'temporary test outage' } })
            : mode === 'malformed'
              ? route.fulfill({ json: {} })
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
        // A 200 response without a result array must use the same honest recovery path.
        mode = 'malformed'
        await retry.click()
        // Observe the pending request before releasing it; the old outage alert cannot satisfy
        // the next assertion before the malformed response has actually reached the client.
        await expect(page.getByRole('alert')).toHaveCount(0)
        releaseMalformed()
        await expect(page.getByRole('alert')).toContainText('Search is unavailable')
        await expect(input).toHaveValue('The Quiet Lantern')
        await expect(
          page.getByRole('button', { name: 'Add it manually', exact: true }),
        ).toHaveCount(0)
        await expect(guide.getByRole('status')).toHaveText('Find a book you know')
        await page.screenshot({
          path: `test-results/add-search-${touch ? 'phone' : 'desktop'}.png`,
          fullPage: true,
        })
        mode = 'found'
        await retry.click()
        await expect(page.getByTestId('add-result')).toContainText('The Quiet Lantern')
        await expect(guide.getByRole('status')).toHaveText('Choose the right book')
        expect(queries).toEqual(['The Quiet Lantern', 'The Quiet Lantern', 'The Quiet Lantern'])
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

for (const touch of [false, true]) {
  test.describe(touch ? 'phone local Add diagnostics' : 'desktop local Add diagnostics', () => {
    test.use({
      hasTouch: touch,
      viewport: touch ? { width: 390, height: 844 } : { width: 1100, height: 900 },
    })
    test('counts only explicitly enabled lookups, exports no identities and clears on reload', async ({
      page,
    }) => {
      const account = await firstReader(page)
      const settings = async () => {
        const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
        await expect(guide).toBeVisible()
        if (!touch) {
          // Both active and paused coaching must leave the entire desktop rail reachable.
          await expect
            .poll(async () => {
              const rail = await page.locator('[data-book-tour-navigation]').boundingBox()
              const panel = await guide.boundingBox()
              return !!rail && !!panel && panel.x >= rail.x + rail.width
            })
            .toBe(true)
        }
        if (touch)
          await page
            .getByRole('navigation', { name: 'Primary', exact: true })
            .getByRole('button', { name: 'More', exact: true })
            .click()
        await page.getByRole('link', { name: 'Settings', exact: true }).click()
        await expect(page).toHaveURL(/\/settings$/)
      }
      try {
        let failed = false
        await page.route('**/functions/v1/search**', (route) =>
          failed
            ? route.fulfill({ status: 503, json: { error: 'Synthetic outage' } })
            : route.fulfill({ json: { results: [] } }),
        )
        const search = async (query: string) => {
          await page.getByRole('textbox', { name: 'Search for a book' }).fill(query)
          await page.getByRole('button', { name: 'Search', exact: true }).click()
          if (failed) await expect(page.getByRole('alert')).toContainText('Search is unavailable')
          else
            await expect(
              page.getByRole('button', { name: 'Add it manually', exact: true }),
            ).toBeVisible()
        }
        await search('PRIVATE BEFORE OPT IN')
        await settings()
        const region = page.getByRole('region', { name: 'Add lookup diagnostics', exact: true })
        await expect(region.getByRole('status')).toHaveText(
          'Diagnostics are off. 0 of 20 attempts; 0 pending.',
        )
        await region.getByRole('button', { name: 'Start diagnostic session', exact: true }).click()
        await page.getByRole('link', { name: 'Add a book', exact: true }).click()
        await search('PRIVATE EMPTY QUERY')
        failed = true
        await search('PRIVATE FAILED QUERY')
        await settings()
        await expect(region.getByRole('status')).toHaveText(
          'Counting Add lookups. 2 of 20 attempts; 0 pending.',
        )
        await region.getByRole('button', { name: 'Stop diagnostics', exact: true }).click()
        const downloadPromise = page.waitForEvent('download')
        await region
          .getByRole('button', { name: 'Download diagnostic counts', exact: true })
          .click()
        const download = await downloadPromise
        const file = await download.path()
        expect(file).not.toBeNull()
        const exported = await readFile(file!, 'utf8')
        expect(JSON.parse(exported)).toMatchObject({
          basis: 'explicit_local_add_lookup_session',
          counts: { attempted: 2, pending: 0, results: { empty: 1, unavailable: 1 } },
        })
        for (const secret of ['PRIVATE', account.uid, 'tour-', 'Synthetic outage'])
          expect(exported).not.toContain(secret)
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-testid="intake-lookup-diagnostics"]')
              .analyze()
          ).violations,
        ).toEqual([])
        await page.screenshot({
          path: `test-results/add-diagnostics-${touch ? 'phone' : 'desktop'}.png`,
          fullPage: true,
        })
        expect(await account.rows()).toEqual([])
        await page.reload()
        await expect(region.getByRole('status')).toHaveText(
          'Diagnostics are off. 0 of 20 attempts; 0 pending.',
        )
      } finally {
        await account.cleanup()
      }
    })
  })
}
