import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { SKIN_ORDER } from '@reverie/core'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { configureReturningReader } from './support/readerGuidance'
const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const service =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function setup(page: Page, readStatus = 'Unread', progress = 0) {
  const admin = createClient(endpoint, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `reading-tour-${randomUUID()}@reverie.local`
  const password = 'Reading-tour-local-9843'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No reader')
  const uid = created.data.user.id
  const result = await admin
    .from('books')
    .insert({
      owner_id: uid,
      title: 'The Quiet Lantern',
      author_first: 'Iona',
      author_last: 'Vale',
      ownership: 'owned',
      read_status: readStatus,
      progress,
    })
    .select('id')
    .single()
  if (result.error) throw result.error
  const bookId = result.data.id
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await reader.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No session')
  await keepOfflineCacheEmpty(page)
  for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers', 'taste', 'geo'])
    await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
  await configureReturningReader(auth.data.session.access_token)
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  return {
    admin,
    reader,
    uid,
    bookId,
    async book() {
      const r = await reader
        .from('books')
        .select('read_status,progress,ownership')
        .eq('id', bookId)
        .single()
      if (r.error) throw r.error
      return r.data
    },
    async reads() {
      const r = await reader.from('reads').select('id,notes').eq('book_id', bookId)
      if (r.error) throw r.error
      return r.data
    },
    async cleanup() {
      const r = await admin.auth.admin.deleteUser(uid)
      if (r.error) throw r.error
    },
  }
}
async function start(page: Page, openBook = true) {
  await page.goto('/settings/guidance')
  await expect(
    page.getByRole('heading', { name: 'Walkthroughs and guidance', exact: true }),
  ).toBeVisible()
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByLabel('Choose a stop').selectOption('reading')
  else await page.getByRole('button', { name: /Settle into a book/ }).click()
  await page.getByRole('button', { name: 'Guide my reading', exact: true }).click()
  await expect(
    page.getByRole('complementary', { name: 'Live walkthrough' }).getByRole('status'),
  ).toHaveText('Choose a book to spend time with')
  if (openBook)
    await page
      .getByRole('button', { name: /^Open The Quiet Lantern(?:, did not finish)?$/ })
      .click()
}
async function show(page: Page) {
  await page
    .getByRole('complementary', { name: 'Live walkthrough' })
    .getByRole('button', { name: /Show me (this step|again)/ })
    .click()
}
async function clearOfCoach(page: Page, target: string) {
  const rect = await page.locator(`[data-book-tour="${target}"]`).boundingBox()
  const coach = await page.getByRole('complementary', { name: 'Live walkthrough' }).boundingBox()
  expect(rect).not.toBeNull()
  expect(coach).not.toBeNull()
  if (rect && coach)
    expect(
      rect.x >= coach.x + coach.width ||
        rect.x + rect.width <= coach.x ||
        rect.y >= coach.y + coach.height ||
        rect.y + rect.height <= coach.y,
    ).toBe(true)
}
for (const touch of [false, true]) {
  test.describe(touch ? 'phone reading guide' : 'desktop reading guide', () => {
    test.use({
      hasTouch: touch,
      viewport: touch ? { width: 390, height: 844 } : { width: 1280, height: 900 },
    })
    test('observes real starts and saves, preserves cancellation and retries a partial finish without another log', async ({
      page,
    }) => {
      test.setTimeout(120_000)
      const account = await setup(page)
      try {
        await start(page)
        const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
        await expect(guide.getByRole('status')).toHaveText('Begin where you are')
        await show(page)
        await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeFocused()
        expect((await account.book()).read_status).toBe('Unread')
        let fail = true
        await page.route('**/rest/v1/books?**', (route) =>
          route.request().method() === 'PATCH' && fail
            ? route.fulfill({ status: 500, json: { message: 'Test write unavailable' } })
            : route.continue(),
        )
        await page.getByRole('button', { name: 'Start reading', exact: true }).click()
        await expect(page.getByRole('button', { name: 'Start reading', exact: true })).toBeEnabled()
        await expect(guide.getByRole('status')).toHaveText('Begin where you are')
        expect((await account.book()).read_status).toBe('Unread')
        fail = false
        await page.getByRole('button', { name: 'Start reading', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Keep your place')
        await show(page)
        const progress = page.getByRole('dialog', { name: 'Update progress', exact: true })
        await expect(progress).toBeVisible()
        await page.screenshot({
          path: test
            .info()
            .outputPath(touch ? 'reading-guide-phone.png' : 'reading-guide-desktop.png'),
        })
        await expect(
          progress.getByRole('complementary', { name: 'Live walkthrough' }),
        ).toBeVisible()
        await progress.getByRole('spinbutton', { name: 'Progress (%)', exact: true }).fill('32')
        await clearOfCoach(page, 'reading-progress-save')
        await progress.getByRole('button', { name: 'Cancel', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Keep your place')
        expect((await account.book()).progress).toBe(0)
        await show(page)
        await progress.getByRole('spinbutton', { name: 'Progress (%)', exact: true }).fill('32')
        fail = true
        await progress.getByRole('button', { name: 'Save progress', exact: true }).click()
        await expect(progress.getByRole('button', { name: 'Try again', exact: true })).toBeEnabled()
        await expect(guide.getByRole('status')).toHaveText('Your place, in your own time')
        await expect(
          progress.getByRole('spinbutton', { name: 'Progress (%)', exact: true }),
        ).toHaveValue('32')
        expect((await account.book()).progress).toBe(0)
        fail = false
        await progress.getByRole('button', { name: 'Try again', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('Your place is saved')
        expect((await account.book()).progress).toBe(32)
        expect(await account.reads()).toHaveLength(0)
        await guide.getByRole('button', { name: 'When I finish', exact: true }).click()
        await show(page)
        const finish = page.getByRole('dialog', { name: 'Finish this read', exact: true })
        await expect(finish).toBeVisible()
        await show(page)
        expect(await account.reads()).toHaveLength(0)
        await clearOfCoach(page, 'reading-finish-save')
        await finish
          .getByRole('textbox', { name: 'Your thoughts on this read' })
          .fill('A quiet ending worth returning to.')
        fail = true
        await finish.getByRole('button', { name: 'Save finished read', exact: true }).click()
        await expect(
          finish.getByRole('button', { name: 'Retry status update', exact: true }),
        ).toBeEnabled()
        await expect(guide.getByRole('status')).toHaveText('Keep what this read leaves with you')
        expect(await account.reads()).toHaveLength(1)
        expect((await account.book()).read_status).toBe('Reading')
        fail = false
        await finish.getByRole('button', { name: 'Retry status update', exact: true }).click()
        await expect(guide.getByRole('status')).toHaveText('A moment before your next book')
        await expect(page.getByRole('dialog', { name: 'Just finished', exact: true })).toBeVisible()
        await show(page)
        await expect(guide.getByRole('status')).toHaveText('A read to return to')
        expect(await account.reads()).toHaveLength(1)
        expect((await account.book()).read_status).toBe('Read')
        await show(page)
        await expect(
          page.getByText('A quiet ending worth returning to.', { exact: true }).first(),
        ).toBeVisible()
        await guide.getByRole('button', { name: 'Continue reading', exact: true }).click()
        await expect(guide).toHaveCount(0)
      } finally {
        await account.cleanup()
      }
    })
  })
}

test('reading forms keep their controls clear in all rooms, reduced motion and a short phone viewport', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const account = await setup(page, 'Reading', 12)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await start(page)
    await show(page)
    const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
    const dialog = page.getByRole('dialog', { name: 'Update progress', exact: true })
    await expect(dialog.getByRole('complementary', { name: 'Live walkthrough' })).toBeVisible()
    await expect(page.locator('.book-tour-cue')).toHaveAttribute('data-motion', 'reduced')
    for (const skin of SKIN_ORDER) {
      for (const mode of ['light', 'dark']) {
        await page.evaluate(
          ({ skin, mode }) => {
            document.documentElement.dataset.skin = skin
            document.documentElement.dataset.mode = mode
          },
          { skin, mode },
        )
        await clearOfCoach(page, 'reading-progress-save')
        expect(
          (
            await new AxeBuilder({ page })
              .include('[data-book-tour-panel]')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations,
          `${skin}/${mode}`,
        ).toEqual([])
      }
    }
    await page.setViewportSize({ width: 390, height: 450 })
    const input = dialog.getByRole('spinbutton', { name: 'Progress (%)', exact: true })
    await input.fill('24')
    await expect(input).toBeFocused()
    await clearOfCoach(page, 'reading-progress-save')
    await expect(page.locator('[data-book-tour-panel]')).toHaveAttribute('data-inline', 'true')
    await dialog.getByRole('button', { name: 'Save progress', exact: true }).click()
    await expect(guide.getByRole('status')).toHaveText('Your place is saved')
    await guide.getByRole('button', { name: 'Continue reading', exact: true }).click()
    expect((await account.book()).progress).toBe(24)
    expect(await account.reads()).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})

for (const prior of [
  { status: 'Unread', progress: 38, action: 'Resume reading', expected: 38 },
  { status: 'Read', progress: 100, action: 'Read again', expected: 0 },
]) {
  test(`the guide respects ${prior.action.toLowerCase()} and earlier reading history`, async ({
    page,
  }) => {
    const account = await setup(page, prior.status, prior.progress)
    try {
      const result = await account.reader.from('reads').insert({
        owner_id: account.uid,
        book_id: account.bookId,
        read_on: '2025-03-05',
        notes: 'An earlier read',
      })
      if (result.error) throw result.error
      await start(page)
      const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
      await expect(guide.getByRole('status')).toHaveText('Begin where you are')
      await show(page)
      expect((await account.book()).progress).toBe(prior.progress)
      await page.getByRole('button', { name: prior.action, exact: true }).click()
      await expect(guide.getByRole('status')).toHaveText('Keep your place')
      expect((await account.book()).progress).toBe(prior.expected)
      expect((await account.reads()).map((read) => read.notes)).toEqual(['An earlier read'])
      await guide.getByRole('button', { name: 'Pause', exact: true }).click()
      await page.getByRole('button', { name: 'Update progress', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Update progress', exact: true })
      await expect(guide).toContainText('Walkthrough paused')
      await dialog.getByRole('spinbutton', { name: 'Progress (%)', exact: true }).fill('42')
      await dialog.getByRole('button', { name: 'Save progress', exact: true }).click()
      await expect(guide.getByRole('status')).toHaveText('Your place is saved')
      await expect(guide).toContainText('Walkthrough paused')
      await guide.getByRole('button', { name: 'Resume', exact: true }).click()
      await guide.getByRole('button', { name: 'Continue reading', exact: true }).click()
      expect((await account.book()).ownership).toBe('owned')
    } finally {
      await account.cleanup()
    }
  })
}

test('an empty reading walkthrough hands off to actual book intake without adding a sample', async ({
  page,
}) => {
  const account = await setup(page)
  try {
    const removed = await account.admin.from('books').delete().eq('id', account.bookId)
    if (removed.error) throw removed.error
    await start(page, false)
    const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
    await guide.getByRole('button', { name: 'Start with a book', exact: true }).click()
    await expect(guide.getByRole('status')).toHaveText('Bring a book home')
    await show(page)
    await expect(page).toHaveURL(/\/add$/)
    await expect(guide.getByRole('status')).toHaveText('Find a book you know')
    const books = await account.reader.from('books').select('id').eq('owner_id', account.uid)
    if (books.error) throw books.error
    expect(books.data).toEqual([])
  } finally {
    await account.cleanup()
  }
})

test('a changed reading status cannot turn a demonstrated dialog opener into an automatic write', async ({
  page,
}) => {
  const account = await setup(page, 'Reading', 12)
  try {
    await start(page)
    const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
    await expect(guide.getByRole('status')).toHaveText('Keep your place')
    // The reader changes the real status control while the walkthrough is on this step.
    await page
      .getByRole('region', { name: 'Your reading', exact: true })
      .getByRole('button', { name: 'Unread', exact: true })
      .click()
    await expect.poll(async () => (await account.book()).read_status).toBe('Unread')
    await expect(page.getByRole('button', { name: 'Resume reading', exact: true })).toBeVisible()
    await expect(
      guide.getByRole('button', { name: 'Show me this step', exact: true }),
    ).toBeDisabled()
    expect((await account.book()).progress).toBe(12)
    expect(await account.reads()).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})

test('a finish target below the fold keeps the guide reachable before demonstrating navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 600 })
  const account = await setup(page, 'Reading', 20)
  try {
    await start(page)
    await show(page)
    const progress = page.getByRole('dialog', { name: 'Update progress', exact: true })
    await progress.getByRole('spinbutton', { name: 'Progress (%)', exact: true }).fill('32')
    await progress.getByRole('button', { name: 'Save progress', exact: true }).click()
    const guide = page.getByRole('complementary', { name: 'Live walkthrough' })
    await expect(guide.getByRole('status')).toHaveText('Your place is saved')
    const finishButton = page.getByRole('button', { name: 'Finish this read', exact: true })
    expect((await finishButton.boundingBox())!.y).toBeGreaterThanOrEqual(600)
    await guide.getByRole('button', { name: 'When I finish', exact: true }).click()
    await expect(guide.getByRole('status')).toHaveText('When you reach the end')
    // Checking visibility alone would accept a fixed panel below the viewport; the reader must
    // be able to reach the action without scripted scrolls or a forced click.
    await expect
      .poll(async () => {
        const box = await guide.boundingBox()
        return (
          !!box &&
          box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= 1280 &&
          box.y + box.height <= 600
        )
      })
      .toBe(true)
    await show(page)
    const finish = page.getByRole('dialog', { name: 'Finish this read', exact: true })
    await expect(finish).toBeVisible()
    await finish.getByRole('button', { name: 'Close', exact: true }).click()
    expect((await account.book()).progress).toBe(32)
    expect(await account.reads()).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})
