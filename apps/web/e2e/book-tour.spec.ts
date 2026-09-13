import { randomUUID } from 'node:crypto'
import { SKIN_ORDER } from '@reverie/core'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
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
  await expect(page.getByRole('heading', { name: 'Your library guide', exact: true })).toBeVisible()
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

async function clearTarget(page: Page, target: string) {
  const box = await page
    .locator(`[data-book-tour="${target}"]`)
    .filter({ visible: true })
    .first()
    .boundingBox()
  const panel = await page.getByRole('complementary', { name: 'Live walkthrough' }).boundingBox()
  expect(box).not.toBeNull()
  expect(panel).not.toBeNull()
  if (box && panel)
    expect(
      box.x >= panel.x + panel.width ||
        box.x + box.width <= panel.x ||
        box.y >= panel.y + panel.height ||
        box.y + box.height <= panel.y,
    ).toBe(true)
}

for (const touch of [false, true]) {
  test.describe(touch ? 'touch walkthrough' : 'desktop walkthrough', () => {
    test.use({
      hasTouch: touch,
      viewport: touch ? { width: 390, height: 844 } : { width: 1100, height: 900 },
    })
    test('demonstrates real navigation, waits for a deliberate save, then opens the saved book', async ({
      page,
    }) => {
      test.setTimeout(120_000)
      const account = await firstReader(page)
      const title = `Tour Lantern ${randomUUID().slice(0, 8)}`
      try {
        await page.route('**/functions/v1/search**', (route) =>
          route.fulfill({
            json: {
              results: [
                {
                  title,
                  authors: ['Avery Tutorial'],
                  source: 'hardcover',
                  cover: '',
                  isbn: '',
                  year: '',
                },
              ],
            },
          }),
        )
        await page.getByRole('button', { name: 'Guide me in the app', exact: true }).click()
        const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
        await expect(guide.getByRole('status')).toHaveText('Bring a book home')
        const show = () => {
          const button = guide.getByRole('button', { name: /Show me (this step|again)/ })
          return touch ? button.tap() : button.click()
        }
        await show()
        await expect(page).toHaveURL(/\/add$/)
        await expect(guide.getByRole('status')).toHaveText('Find a book you know')
        await show()
        await expect(page.getByRole('textbox', { name: 'Search for a book' })).toBeFocused()
        await expect(page.locator('.book-tour-cue')).toHaveAttribute(
          'data-input',
          touch ? 'touch' : 'mouse',
        )
        await clearTarget(page, 'book-search')
        await page.getByRole('textbox', { name: 'Search for a book' }).fill(title)
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Choose the right book')
        await page
          .getByTestId('add-result')
          .getByRole('button', { name: new RegExp(title) })
          .click()
        await expect(guide.getByRole('status')).toHaveText('Make it yours')
        await show()
        await expect(
          page.getByRole('button', { name: 'Add to my library', exact: true }),
        ).toBeFocused()
        await clearTarget(page, 'book-save')
        expect(await account.rows()).toHaveLength(0)
        await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('-1')
        await page.getByRole('button', { name: 'Add to my library', exact: true }).click()
        await expect(page.getByRole('alert')).toContainText(/page|greater|positive|between/i)
        await expect(guide.getByRole('status')).toHaveText('Make it yours')
        expect(await account.rows()).toHaveLength(0)
        await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('')
        if (!touch) await page.getByRole('radio', { name: 'Owned', exact: true }).click()
        await page.getByRole('button', { name: 'Add to my library', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Your book is saved', {
          timeout: 20_000,
        })
        const saved = await account.rows()
        expect(saved).toHaveLength(1)
        expect(saved[0]?.ownership).toBe(touch ? 'unowned' : 'owned')
        expect(saved[0]?.read_status).toBe('unset')
        await guide.getByRole('button', { name: 'End live walkthrough' }).click()
        await page.getByRole('button', { name: 'Guide me in the app', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Your book is saved')
        await page.getByRole('button', { name: 'Change cover', exact: true }).click()
        const coverDialog = page.getByRole('dialog')
        await expect(coverDialog).toBeVisible()
        await expect(guide).toHaveCount(0)
        await coverDialog.getByRole('button', { name: 'Close', exact: true }).click()
        await expect(guide).toContainText('Walkthrough paused')
        await guide.getByRole('button', { name: 'Resume', exact: true }).click()
        await show()
        await expect(page).toHaveURL(/\/library$/)
        await expect(guide.getByRole('status')).toHaveText('A place on your shelf')
        if (touch)
          await expect(page.getByRole('region', { name: 'Your added book' })).toContainText(title)
        await show()
        if (touch) await expect(page).toHaveURL(new RegExp(`/book/${saved[0]!.id}$`))
        else {
          const drawer = page.getByRole('dialog', { name: `${title} details` })
          await expect(drawer).toBeVisible()
          await expect(
            drawer.getByRole('complementary', { name: 'Live walkthrough' }),
          ).toBeVisible()
        }
        await expect(guide.getByRole('status')).toHaveText('You have found your way')
        const violations = (
          await new AxeBuilder({ page })
            .include('[data-book-tour-panel]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
        expect(violations).toEqual([])
        await page.screenshot({
          path: `test-results/live-tour-${touch ? 'phone' : 'desktop'}.png`,
          fullPage: true,
        })
        await guide.getByRole('button', { name: 'Keep exploring', exact: true }).click()
        await expect(guide).toHaveCount(0)
        expect(await account.rows()).toEqual(saved)
      } finally {
        await account.cleanup()
      }
    })
  })
}

test('a reader can interrupt a demonstration and resume without losing their entry', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const account = await firstReader(page)
  try {
    await page.getByRole('button', { name: 'Guide me in the app' }).click()
    const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
    await guide.getByRole('button', { name: 'Show me this step' }).click()
    await expect(guide.getByRole('status')).toHaveText('Find a book you know')
    const input = page.getByRole('textbox', { name: 'Search for a book' })
    await input.fill('My unfinished search')
    await guide.getByRole('button', { name: 'End live walkthrough' }).click()
    await page.getByRole('button', { name: 'Guide me in the app', exact: true }).click()
    await expect(input).toHaveValue('My unfinished search')
    await expect(guide.getByRole('status')).toHaveText('Find a book you know')
    await guide.getByRole('button', { name: 'Show me this step' }).click()
    await page.keyboard.press('Escape')
    await expect(guide).toContainText('Walkthrough paused')
    await expect(input).toHaveValue('My unfinished search')
    await guide.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(guide.getByRole('status')).toHaveText('Find a book you know')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await guide.getByRole('button', { name: 'Show me this step' }).click()
    await expect(input).toBeFocused()
    expect(
      await page
        .locator('.book-tour-cue')
        .evaluate(
          (element) =>
            element.getAnimations({ subtree: true }).filter((a) => a.playState === 'running')
              .length,
        ),
    ).toBe(0)
    await expect(input).toHaveValue('My unfinished search')
    await guide.getByRole('button', { name: 'End live walkthrough' }).click()
    await expect(guide).toHaveCount(0)
    expect(await account.rows()).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})

// Render the actual guide in every authored room, then exercise a shortened phone viewport
// as a keyboard-layout check. A physical mobile keyboard remains in the owner smoke register.
test('the live guide keeps its target clear and readable in every room and a short phone viewport', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const account = await firstReader(page)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Guide me in the app', exact: true }).click()
    const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
    await guide.getByRole('button', { name: 'Show me this step' }).click()
    await expect(guide.getByRole('status')).toHaveText('Find a book you know')
    for (const skin of SKIN_ORDER) {
      for (const mode of ['light', 'dark']) {
        await page.evaluate(
          ({ skin, mode }) => {
            document.documentElement.dataset.skin = skin
            document.documentElement.dataset.mode = mode
          },
          { skin, mode },
        )
        await clearTarget(page, 'book-search')
        const violations = (
          await new AxeBuilder({ page })
            .include('[data-book-tour-panel]')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze()
        ).violations
        expect(violations, `${skin}/${mode}`).toEqual([])
      }
    }
    await page.setViewportSize({ width: 390, height: 450 })
    await guide.getByRole('button', { name: 'Show me this step' }).click()
    await expect(page.getByRole('textbox', { name: 'Search for a book' })).toBeFocused()
    await clearTarget(page, 'book-search')
    await expect(page.locator('[data-book-tour-panel]')).toHaveAttribute('data-compact', '')
    const panel = await guide.boundingBox()
    expect(panel!.y + panel!.height).toBeLessThanOrEqual(450)
    expect(await account.rows()).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})
