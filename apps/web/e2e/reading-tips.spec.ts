import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { SKIN_ORDER } from '@reverie/core'
import { expect, test, type Page } from './support/fixtures'
import { localAdminKey } from './support/localSupabase'
import { configureReturningReader } from './support/readerGuidance'
import { keepOfflineCacheEmpty } from './support/offlineCache'

const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

async function returningReader(page: Page) {
  const admin = createClient(endpoint, localAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `reading-tips-${randomUUID()}@reverie.local`
  const password = 'Reading-Tips-Local-6621'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No test reader')
  const uid = created.data.user.id
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await reader.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No test session')
  const session = auth.data.session
  // This scenario starts with a reader who has already learned the app. First-use walkthroughs
  // are covered in reader-guidance.spec.ts; the preference must work independently of that choice.
  await configureReturningReader(session.access_token)
  async function enter(target: Page) {
    await keepOfflineCacheEmpty(target)
    for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
      await target.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
    const { access_token, refresh_token } = session
    await target.goto(
      `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
    )
    await target.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
    await expect(target.getByRole('main')).toBeVisible({ timeout: 20_000 })
  }
  await enter(page)
  return {
    enter,
    async preference() {
      const result = await reader
        .from('profiles')
        .select('show_reading_tips')
        .eq('id', uid)
        .single()
      if (result.error) throw result.error
      return result.data.show_reading_tips as boolean
    },
    async room(skin: string, mode: string) {
      const result = await reader.from('profiles').update({ skin, mode }).eq('id', uid)
      if (result.error) throw result.error
    },
    async cleanup() {
      const result = await admin.auth.admin.deleteUser(uid)
      if (result.error) throw result.error
    },
  }
}

const tipsCheckbox = (page: Page) =>
  page.getByRole('checkbox', { name: 'Show reading tips', exact: true })

test('reading tips save across sessions, preserve essential copy and the guide, and fail honestly', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const account = await returningReader(page)
  try {
    await page.goto('/settings')
    const tips = tipsCheckbox(page)
    await expect(tips).toBeChecked()
    await expect(tips).toBeEnabled()
    await page.route('**/rest/v1/profiles?*', (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 503, json: { message: 'Test connection interrupted' } })
        : route.fallback(),
    )
    await tips.click()
    await expect(page.getByRole('alert')).toContainText('Your profile didn’t save')
    await expect(tips).toBeChecked()
    expect(await account.preference()).toBe(true)
    await page.unroute('**/rest/v1/profiles?*')
    await tips.click()
    await expect.poll(() => account.preference()).toBe(false)
    await expect(tips).not.toBeChecked()

    await page.goto('/match')
    await expect(page.getByRole('heading', { name: 'Next read', exact: true })).toBeVisible()
    await expect(page.getByText('Find something you want to open.', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add books', exact: true })).toBeVisible()
    await expect(
      page.getByText('Add a book or import your reading history. Then choose your next read here.'),
    ).toBeVisible()
    const refine = page.locator('summary').filter({ hasText: 'Refine choices' })
    await refine.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('checkbox', { name: 'Include rereads' })).toBeVisible()

    await page.goto('/discover')
    await expect(page.getByRole('heading', { name: 'Find a book to get lost in.' })).toBeVisible()
    await expect(
      page.getByText(
        'A familiar feeling, a passing mood, a door you haven’t opened. Where shall we begin?',
      ),
    ).toHaveCount(0)
    await expect(
      page.getByRole('textbox', { name: 'Search by title, author, or ISBN' }),
    ).toBeVisible()
    await expect(
      page.getByText('Choose a starting book. It doesn’t have to be one you own.'),
    ).toBeVisible()

    await page.goto('/library')
    await expect(page.getByRole('heading', { name: 'My library', exact: true })).toBeVisible()
    await expect(
      page.getByText(
        'Search, filter, and rediscover the books you’ve made part of your reading life.',
      ),
    ).toHaveCount(0)
    await expect(page.getByRole('link', { name: '＋ Add books', exact: true })).toBeVisible()

    await page.goto('/planner')
    await expect(page.getByRole('button', { name: 'Add to your plan', exact: true })).toBeVisible()
    await expect(
      page.getByText('Soon, a month, or a particular day. Nothing here is a deadline.'),
    ).toHaveCount(0)
    await expect(
      page.getByText(
        'Moving or removing a plan never changes a finish, a reread, a rating, or a note.',
      ),
    ).toBeVisible()

    await page.goto('/stats')
    await expect(
      page.getByText('Reflect · your reading life is private', { exact: true }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'The stories you finished, the ones you returned to, and a little of what stayed.',
      ),
    ).toHaveCount(0)
    await expect(page.getByLabel('Stats year')).toBeVisible()

    await page.goto('/guide')
    await page.getByRole('combobox', { name: 'Choose a stop', exact: true }).selectOption('plan')
    await expect(
      page.getByRole('heading', { name: 'Leave a place for what comes next' }),
    ).toBeVisible()
    await expect(
      page.getByText(
        'Use a book’s planning control or Planner to add it to Soon or choose a date.',
        { exact: true },
      ),
    ).toBeVisible()
    expect(await account.preference()).toBe(false)

    // A second browser has no persisted query cache or local preferences from the first.
    const secondContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const secondPage = await secondContext.newPage()
      await account.enter(secondPage)
      await secondPage.goto('/settings')
      await expect(tipsCheckbox(secondPage)).not.toBeChecked()
      await secondPage.reload()
      await expect(tipsCheckbox(secondPage)).not.toBeChecked()
    } finally {
      await secondContext.close()
    }
  } finally {
    await account.cleanup()
  }
})

test('reading tips and the smaller disclosure remain usable in all eighteen room appearances', async ({
  page,
}) => {
  test.setTimeout(300_000)
  await page.setViewportSize({ width: 320, height: 740 })
  const account = await returningReader(page)
  try {
    // A separate reader keeps the default despite the previous scenario choosing otherwise.
    expect(await account.preference()).toBe(true)
    for (const skin of SKIN_ORDER) {
      for (const mode of ['light', 'dark']) {
        await account.room(skin, mode)
        await page.goto('/settings')
        await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
        const tips = tipsCheckbox(page)
        await expect(tips).toBeChecked()
        await expect(tips).toBeEnabled()
        await tips.focus()
        await page.keyboard.press('Shift+Tab')
        await page.keyboard.press('Tab')
        await expect(tips).toBeFocused()
        const focus = await tips.evaluate((el) => ({
          outline: getComputedStyle(el).outlineStyle,
          width: getComputedStyle(el).outlineWidth,
        }))
        expect(focus.outline).not.toBe('none')
        expect(parseFloat(focus.width)).toBeGreaterThan(0)
        const label = tips.locator('..')
        expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        const scan = await new AxeBuilder({ page })
          .include('label:has(#reading-tips-label)')
          .analyze()
        expect(scan.violations, `${skin}/${mode} preference accessibility`).toEqual([])
        await page.keyboard.press('Space')
        await expect.poll(() => account.preference()).toBe(false)
        await expect(tips).not.toBeChecked()
        await page.goto('/match')
        const refine = page.locator('summary').filter({ hasText: 'Refine choices' })
        await expect(refine).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        const geometry = await refine.evaluate((el) => ({
          font: getComputedStyle(el).fontSize,
          weight: getComputedStyle(el).fontWeight,
          height: el.getBoundingClientRect().height,
          width: el.getBoundingClientRect().width,
          scrollWidth: el.scrollWidth,
        }))
        expect(geometry.font, `${skin}/${mode}`).toBe('13px')
        expect(geometry.weight).toBe('500')
        expect(geometry.height).toBeGreaterThanOrEqual(44)
        expect(geometry.scrollWidth).toBeLessThanOrEqual(Math.ceil(geometry.width))
        await expect(
          page.getByText('Find something you want to open.', { exact: true }),
        ).toHaveCount(0)
        if (skin === 'aphelion' && mode === 'light') {
          await refine.scrollIntoViewIfNeeded()
          await page.screenshot({ path: 'test-results/reading-tips-next-read-phone.png' })
        }
        await page.goto('/settings')
        await expect(tipsCheckbox(page)).not.toBeChecked()
        await tipsCheckbox(page).click()
        await expect.poll(() => account.preference()).toBe(true)
        if (skin === 'folio' && mode === 'light') {
          await tipsCheckbox(page).scrollIntoViewIfNeeded()
          await page.screenshot({ path: 'test-results/reading-tips-setting-phone.png' })
        }
        await page.goto('/match')
        await expect(
          page.getByText('Find something you want to open.', { exact: true }),
        ).toBeVisible()
      }
    }
  } finally {
    await account.cleanup()
  }
})
