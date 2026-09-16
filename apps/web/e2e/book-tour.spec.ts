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
  await expect(
    page.getByRole('heading', { name: 'Walkthroughs and guidance', exact: true }),
  ).toBeVisible()
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
    test('guides the first book into reading and restores its place after returning home', async ({
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
        // Replay is reachable from Settings, with no permanent help destination in the dock.
        await page.goto('/guide')
        await expect(
          page.getByRole('heading', { name: 'Your library guide', exact: true }),
        ).toBeVisible()
        await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toHaveCount(0)
        await page.goto('/settings')
        await expect(
          page.getByRole('heading', { name: 'Walkthroughs and guidance', exact: true }),
        ).toBeVisible()
        await expect(page.getByRole('complementary', { name: 'Your library guide' })).toHaveCount(0)
        await expect(
          page
            .getByRole('navigation', { name: 'Primary', exact: true })
            .getByRole('link', { name: 'Library guide', exact: true }),
        ).toHaveCount(0)
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
        if (touch) {
          await expect(guide).toHaveAttribute('data-inline', 'true')
          await expect(page.locator('[data-book-tour-inline="book-search"]')).toContainText(
            'Find a book you know',
          )
          // A reduced viewport tests layout containment, not a physical keyboard.
          await page.setViewportSize({ width: 390, height: 420 })
          await clearTarget(page, 'book-search')
          await page.setViewportSize({ width: 390, height: 844 })
        }
        await clearTarget(page, 'book-search')
        await page.getByRole('textbox', { name: 'Search for a book' }).fill(title)
        await page.getByRole('button', { name: 'Search', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Choose the right book')
        if (touch) {
          await expect(guide).toHaveAttribute('data-inline', 'true')
          await clearTarget(page, 'book-results')
        }
        await page
          .getByTestId('add-result')
          .getByRole('button', { name: new RegExp(title) })
          .click()
        await expect(guide.getByRole('status')).toHaveText('Make it yours')
        await show()
        await expect(
          page.getByRole('button', { name: 'Add to my library', exact: true }),
        ).toBeFocused()
        if (touch) await expect(guide).toHaveAttribute('data-inline', 'true')
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
        if (touch) {
          await expect(guide).toHaveAttribute('data-inline', 'true')
          await clearTarget(page, 'book-done')
        }
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
        // Continue from the selected book, including the desktop drawer, without choosing again.
        await guide.getByRole('button', { name: 'Guide my reading', exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/book/${saved[0]!.id}$`))
        await expect(guide.getByRole('status')).toHaveText('Begin where you are')
        // The handoff itself has not started a read or changed the reader's book.
        expect(await account.rows()).toEqual(saved)
        await page.getByRole('button', { name: 'Start reading', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Keep your place')
        await show()
        const progress = page.getByRole('dialog', { name: 'Update progress', exact: true })
        await expect(progress).toBeVisible()
        await progress.getByRole('spinbutton', { name: 'Progress (%)', exact: true }).fill('24')
        await clearTarget(page, 'reading-progress-save')
        await progress.getByRole('button', { name: 'Save progress', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Your place is saved')
        await guide.getByRole('button', { name: 'Continue reading', exact: true }).click()
        await expect(guide).toHaveCount(0)

        // Re-enter through Home after a reload, rather than relying on the tour's in-memory book.
        await page.goto('/')
        await page.reload()
        const readingNow = page.locator('[data-home-module="reading"]')
        await expect(readingNow.getByRole('heading', { name: title, exact: true })).toBeVisible()
        await readingNow.getByRole('button', { name: `Open ${title}`, exact: true }).click()
        await expect(page).toHaveURL(new RegExp(`/book/${saved[0]!.id}$`))
        await expect(guide).toHaveCount(0)
        await page.getByRole('button', { name: 'Update progress', exact: true }).click()
        await expect(
          progress.getByRole('spinbutton', { name: 'Progress (%)', exact: true }),
        ).toHaveValue('24')
        await progress.getByRole('button', { name: 'Cancel', exact: true }).click()
        const persisted = await account.reader
          .from('books')
          .select('read_status,progress')
          .eq('id', saved[0]!.id)
          .single()
        expect(persisted.error).toBeNull()
        expect(persisted.data).toEqual({ read_status: 'Reading', progress: 24 })
        const history = await account.reader.from('reads').select('id').eq('book_id', saved[0]!.id)
        expect(history.error).toBeNull()
        expect(history.data).toEqual([])
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
    // Inline coaching scrolls with the page; short viewports must not hide its instructions.
    await expect(guide).toHaveAttribute('data-inline', 'true')
    await expect(guide).not.toHaveAttribute('data-compact', '')
    await guide.scrollIntoViewIfNeeded()
    await clearTarget(page, 'book-search')
    const panel = await guide.boundingBox()
    expect(panel!.x).toBeGreaterThanOrEqual(0)
    expect(panel!.x + panel!.width).toBeLessThanOrEqual(390)
    await page.screenshot({
      path: test.info().outputPath('first-book-inline-phone.png'),
      fullPage: true,
    })
    expect(await account.rows()).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})
