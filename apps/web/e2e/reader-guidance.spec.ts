import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { SKIN_ORDER } from '@reverie/core'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'

const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const localService =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function freshReader(page: Page) {
  const admin = createClient(endpoint, localService, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `guidance-${randomUUID()}@reverie.local`
  const password = 'Guidance-Local-6621'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No test reader')
  const uid = created.data.user.id
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await reader.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No test session')
  await keepOfflineCacheEmpty(page)
  // A previous account's legacy browser flag must not skip this new account's choice.
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Come in at your own pace.' })).toBeVisible({
    timeout: 20_000,
  })
  return {
    uid,
    reader,
    async guidance() {
      const result = await reader.from('profiles').select('guidance').eq('id', uid).single()
      if (result.error) throw result.error
      return result.data.guidance
    },
    async cleanup() {
      const result = await admin.auth.admin.deleteUser(uid)
      if (result.error) throw result.error
    },
  }
}

test('a new phone reader starts gently, imports history and keeps introductions across reloads', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const account = await freshReader(page)
  try {
    await page.screenshot({ path: 'test-results/guidance-choice-phone.png', fullPage: true })
    await page.getByRole('button', { name: 'Start gently', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Start with some books.' })).toBeVisible()
    const fileChooser = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import a file', exact: true }).click()
    await (
      await fileChooser
    ).setFiles({
      name: 'my-library.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Title,Author,Exclusive Shelf\nA first reading,Robin Reader,currently-reading\n',
      ),
    })
    await expect(
      page.getByRole('heading', { name: 'Your books are here.', exact: true }),
    ).toBeVisible({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Continue →', exact: true }).click()
    await page.getByRole('button', { name: 'Open my library', exact: true }).click()
    await expect(page.getByRole('main')).toBeVisible()
    await expect.poll(async () => (await account.guidance()).milestones).toContain('reading')
    await page.getByRole('button', { name: 'More', exact: true }).click()
    const menu = page.getByRole('navigation', { name: 'More destinations' })
    await expect(menu.getByRole('link', { name: 'Series', exact: true })).toBeVisible()
    await expect(menu.getByRole('link', { name: 'Stats', exact: true })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Clubs', exact: true })).toHaveCount(0)
    await menu.getByRole('link', { name: 'Library guide', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your library guide' })).toBeVisible()
    await page.getByRole('combobox', { name: 'Choose a stop', exact: true }).selectOption('plan')
    await expect(
      page.getByRole('heading', { name: 'Leave a place for what comes next' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Pause walkthrough', exact: true }).click()
    await page.reload()
    await expect(
      page.getByRole('heading', { name: 'Leave a place for what comes next' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Resume walkthrough', exact: true }),
    ).toBeVisible()
    await page.getByRole('combobox', { name: 'Choose a stop', exact: true }).selectOption('share')
    await page.getByRole('button', { name: 'Add this to my navigation', exact: true }).click()
    await expect.poll(async () => (await account.guidance()).revealed).toContain('share')
    await page.getByRole('button', { name: 'Show all features', exact: true }).click()
    await expect.poll(async () => (await account.guidance()).mode).toBe('full')
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/guidance-guide-phone.png', fullPage: true })
    const violations = (
      await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations
    expect(violations).toEqual([])
  } finally {
    await account.cleanup()
  }
})

test('the full walkthrough keeps its place and failed saves stay put', async ({ page }) => {
  test.setTimeout(90_000)
  const account = await freshReader(page)
  try {
    await page.route('**/rest/v1/rpc/update_reader_guidance', (route) =>
      route.fulfill({ status: 503, json: { message: 'Test connection interrupted' } }),
    )
    await page.getByRole('button', { name: 'Show me around', exact: true }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'Your choice could not be saved' }),
    ).toBeVisible()
    expect(await account.guidance()).toBeNull()
    await page.unroute('**/rest/v1/rpc/update_reader_guidance')
    await page.getByRole('button', { name: 'Show me around', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your library guide' })).toBeVisible()
    await expect(page.getByRole('main')).toContainText('Stop 1 of 10')
    await page.getByRole('main').getByRole('button', { name: 'Next stop', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Settle into a book' })).toBeVisible()
    await page.getByRole('link', { name: 'Open Home', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Your library guide' })).toContainText(
      'Settle into a book',
    )
    await page.reload()
    await expect(page.getByRole('complementary', { name: 'Your library guide' })).toContainText(
      'Settle into a book',
    )
    await page.getByRole('button', { name: 'Pause', exact: true }).click()
    await expect(page.getByRole('complementary', { name: 'Your library guide' })).toHaveCount(0)
    expect(await account.guidance()).toMatchObject({
      mode: 'full',
      setupComplete: true,
      tour: null,
      resume: 'reading',
    })
  } finally {
    await account.cleanup()
  }
})

test('independent exploration creates no books and its guide fits every room on a small phone', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await page.setViewportSize({ width: 320, height: 740 })
  const account = await freshReader(page)
  try {
    await page.getByRole('button', { name: 'Explore on my own', exact: true }).click()
    await expect(page).toHaveURL(/\/library$/)
    await expect.poll(async () => (await account.guidance())?.setupComplete).toBe(true)
    expect(await account.guidance()).toMatchObject({ mode: 'full', tour: null })
    const books = await account.reader.from('books').select('id', { count: 'exact', head: true })
    if (books.error) throw books.error
    expect(books.count).toBe(0)
    await page.goto('/guide')
    for (const skin of SKIN_ORDER)
      for (const mode of ['light', 'dark'] as const) {
        const saved = await account.reader
          .from('profiles')
          .update({ skin, mode })
          .eq('id', account.uid)
        if (saved.error) throw saved.error
        await page.reload()
        await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
        await page.evaluate(() => document.fonts.ready)
        await page.getByRole('button', { name: 'Change my pace', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Start gently', exact: true })).toBeVisible()
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${skin}/${mode}: no sideways scrolling`,
        ).toBe(true)
        // Measure painted text, not the span's assigned width: overflowing glyphs can crowd
        // another dock item without ever increasing the document's scrollWidth.
        const dockLabels = await page.locator('.rv-mobile-tab').evaluateAll((tabs) =>
          tabs.map((tab) => {
            const label = tab.querySelector('.skin-label')!
            const range = document.createRange()
            range.selectNodeContents(label)
            const text = range.getBoundingClientRect()
            const bounds = tab.getBoundingClientRect()
            return {
              label: label.textContent,
              text: { left: text.left, right: text.right },
              tab: { left: bounds.left, right: bounds.right },
              contained: text.left >= bounds.left && text.right <= bounds.right,
            }
          }),
        )
        expect(dockLabels.length).toBeGreaterThan(0)
        expect(
          dockLabels.filter((label) => !label.contained),
          `${skin}/${mode}: dock labels`,
        ).toEqual([])
        const result = await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
        expect(result.violations, `${skin}/${mode}: guide accessibility`).toEqual([])
        if (skin === 'aphelion' && mode === 'dark')
          await page.screenshot({
            path: 'test-results/guidance-aphelion-small-phone.png',
            fullPage: true,
          })
      }
  } finally {
    await account.cleanup()
  }
})
