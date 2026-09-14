import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { SKIN_ORDER } from '@reverie/core'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from './support/fixtures'
import { okData } from './support/ok'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { configureReturningReader } from './support/readerGuidance'
const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const service =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function setup(page: Page, empty = false) {
  const admin = createClient(endpoint, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `planner-tour-${randomUUID()}@reverie.local`
  const password = 'Planner-tour-local-9362'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No reader')
  const uid = created.data.user.id
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await reader.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No session')
  const books = empty
    ? []
    : [
        { title: 'The Quiet Lantern', ownership: 'owned', wishlist: false },
        { title: 'The Far Shore', ownership: 'unowned', wishlist: true },
      ]
  const inserted = books.length
    ? await admin
        .from('books')
        .insert(
          books.map((b) => ({
            ...b,
            owner_id: uid,
            author_first: 'Iona',
            author_last: 'Vale',
            borrowed: false,
            read_status: 'Unread',
            progress: 0,
          })),
        )
        .select('id,title')
    : { data: [], error: null }
  if (inserted.error) throw inserted.error
  let vibeRequests = 0
  await keepOfflineCacheEmpty(page)
  for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers', 'taste', 'geo'])
    await page.route(`**/functions/v1/${name}**`, (route) => {
      if (name === 'embed' && route.request().postDataJSON()?.mode === 'vibe') vibeRequests++
      return route.fulfill({ json: {} })
    })
  await configureReturningReader(auth.data.session.access_token)
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  async function rows(table: 'books' | 'reads' | 'lists' | 'list_items') {
    const columns =
      table === 'books'
        ? 'id,read_status,progress,ownership,borrowed,wishlist,plan_y,plan_m,plan_d,plan_position,plan_intention'
        : table === 'list_items'
          ? 'list_id,book_id'
          : 'id'
    const result = await reader.from(table).select(columns).eq('owner_id', uid)
    if (result.error) throw result.error
    return result.data
  }
  return {
    reader,
    uid,
    books: await okData(Promise.resolve(inserted), 'Planner books fixture'),
    rows,
    vibeRequests: () => vibeRequests,
    async cleanup() {
      const r = await admin.auth.admin.deleteUser(uid)
      if (r.error) throw r.error
    },
  }
}
const guide = (page: Page) => page.getByRole('complementary', { name: 'Live walkthrough' })
const editor = (page: Page) => page.getByRole('dialog', { name: 'Make a little room', exact: true })
const status = (page: Page) => guide(page).getByRole('status')
async function choose(page: Page) {
  await page.getByRole('button', { name: 'Add to your plan', exact: true }).click()
  await page.getByRole('button', { name: 'Choose The Quiet Lantern', exact: true }).click()
}
async function replay(page: Page) {
  await guide(page).getByRole('button', { name: 'Pause', exact: true }).click()
  await guide(page).getByRole('button', { name: 'Start over here', exact: true }).click()
}

test('an open plan draft survives entry, replay, a failed save and an explicit month-only save', async ({
  page,
}) => {
  const account = await setup(page)
  try {
    await page.goto('/planner')
    const before = await account.rows('books')
    await choose(page)
    const modal = editor(page)
    await modal.getByRole('radio', { name: 'A month', exact: true }).check()
    await modal.getByLabel('Planned month', { exact: true }).fill('2027-04')
    await modal
      .getByRole('textbox', { name: /A note to your future self/ })
      .fill('For a quiet weekend.')
    await modal.getByRole('button', { name: 'Guide my planning', exact: true }).click()
    await expect(status(page)).toHaveText('As open-ended as you like')
    await page.screenshot({ path: test.info().outputPath('planner-guide-desktop.png') })
    await replay(page)
    await expect(modal.getByLabel('Planned month', { exact: true })).toHaveValue('2027-04')
    await expect(modal.getByRole('textbox', { name: /A note to your future self/ })).toHaveValue(
      'For a quiet weekend.',
    )
    await guide(page).getByRole('button', { name: 'Next: a note', exact: true }).click()
    await guide(page).getByRole('button', { name: 'Show me this step', exact: true }).click()
    await expect(modal.getByRole('textbox', { name: /A note to your future self/ })).toBeFocused()
    await guide(page).getByRole('button', { name: 'Go to saving', exact: true }).click()
    await guide(page).getByRole('button', { name: 'Show me this step', exact: true }).click()
    await expect(modal.getByRole('button', { name: 'Save plan', exact: true })).toBeFocused()
    expect(await account.rows('books')).toEqual(before)
    let fail = true
    await page.route('**/rest/v1/books?**', (route) =>
      route.request().method() === 'PATCH' && fail
        ? route.fulfill({ status: 500, json: { message: 'Test save unavailable' } })
        : route.continue(),
    )
    await modal.getByRole('button', { name: 'Save plan', exact: true }).click()
    await expect(modal.getByRole('alert')).toContainText('could not be saved')
    await expect(status(page)).toHaveText('Keep this possibility')
    expect(await account.rows('books')).toEqual(before)
    fail = false
    await modal.getByRole('button', { name: 'Save plan', exact: true }).click()
    await expect(status(page)).toHaveText('A place is waiting')
    await expect(modal).toHaveCount(0)
    const saved = (await account.rows('books')).find((b) => b.id === account.books[0].id)
    expect(saved).toMatchObject({
      plan_y: 2027,
      plan_m: 4,
      plan_d: null,
      plan_intention: 'For a quiet weekend.',
      read_status: 'Unread',
      progress: 0,
      ownership: 'owned',
    })
    expect(saved?.plan_position).not.toBeNull()
    expect(await account.rows('reads')).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})

test('the animated picker preserves its query and cancellation never saves', async ({ page }) => {
  const account = await setup(page)
  try {
    await page.goto('/planner')
    const before = await account.rows('books')
    await page.getByRole('button', { name: 'Guide my planning', exact: true }).click()
    await expect(status(page)).toHaveText('Leave a little room')
    await guide(page).getByRole('button', { name: 'Show me this step', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Leave a place for a book', exact: true })
    await expect(picker).toBeVisible()
    await expect(status(page)).toHaveText('A book of your choosing')
    const search = picker.getByRole('searchbox')
    await search.fill('Lantern')
    await replay(page)
    await expect(search).toHaveValue('Lantern')
    await expect(
      picker.getByRole('button', { name: 'Choose The Far Shore', exact: true }),
    ).toHaveCount(0)
    await picker.getByRole('button', { name: 'Choose The Quiet Lantern', exact: true }).click()
    await expect(status(page)).toHaveText('As open-ended as you like')
    await editor(page)
      .getByRole('textbox', { name: /A note to your future self/ })
      .fill('Unsent note')
    await editor(page).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(status(page)).toHaveText('Leave a little room')
    expect(await account.rows('books')).toEqual(before)
    expect(await account.rows('reads')).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})

test('calendar and releases start where the reader is, and return from elsewhere explicitly', async ({
  page,
}) => {
  const account = await setup(page)
  try {
    await page.goto('/planner?tab=calendar')
    await page.getByRole('button', { name: 'Next month', exact: true }).click()
    const month = await page.locator('#plan-calendar-heading').textContent()
    await page.getByRole('button', { name: 'Guide my planning', exact: true }).click()
    await expect(status(page)).toHaveText('Your reading life in view')
    await replay(page)
    await expect(page.locator('#plan-calendar-heading')).toHaveText(month!)
    await page.getByRole('button', { name: /Releases Watch what is coming/ }).click()
    await expect(status(page)).toHaveText('What is coming into view')
    await page
      .getByRole('navigation', { name: 'Primary', exact: true })
      .getByRole('link', { name: 'Library', exact: true })
      .click()
    await expect(guide(page)).toContainText('Walkthrough paused')
    await guide(page).getByRole('button', { name: 'Return to this task', exact: true }).click()
    await expect(page).toHaveURL(/planner\?tab=releases$/)
    await expect(status(page)).toHaveText('What is coming into view')
    expect((await account.rows('books')).every((b) => b.plan_position == null)).toBe(true)
  } finally {
    await account.cleanup()
  }
})

test('an empty library and unavailable library remain honest', async ({ page }) => {
  const account = await setup(page, true)
  try {
    await page.goto('/planner')
    await page.getByRole('button', { name: 'Add to your plan', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Leave a place for a book', exact: true })
    await picker.getByRole('button', { name: 'Guide my planning', exact: true }).click()
    await expect(picker.getByText('No available matches.', { exact: false })).toBeVisible()
    await expect(status(page)).toHaveText('A book of your choosing')
    expect(await account.rows('books')).toHaveLength(0)
    await guide(page).getByRole('button', { name: 'End live walkthrough', exact: true }).click()
    await picker.getByRole('button', { name: 'Close', exact: true }).click()
    await page.route('**/rest/v1/books?**', (route) =>
      route.fulfill({ status: 500, json: { message: 'Test library unavailable' } }),
    )
    await page.reload()
    await page.getByRole('button', { name: 'Guide my planning', exact: true }).click()
    await expect(status(page)).toHaveText('Your library comes first')
    await expect(page.getByRole('button', { name: 'Add to your plan', exact: true })).toHaveCount(0)
    expect(await account.rows('books')).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})

test.describe('phone Planner guide', () => {
  test.use({ viewport: { width: 390, height: 650 }, hasTouch: true, reducedMotion: 'reduce' })
  test('keeps the real editor usable in every room without changing its draft', async ({
    page,
  }) => {
    const account = await setup(page)
    try {
      await page.goto('/planner')
      await choose(page)
      await editor(page)
        .getByRole('textbox', { name: /A note to your future self/ })
        .fill('A note to keep.')
      await editor(page).getByRole('button', { name: 'Guide my planning', exact: true }).click()
      for (const skin of SKIN_ORDER)
        for (const mode of ['light', 'dark']) {
          await page.evaluate(
            async ({ skin, mode }) => {
              const path = '/src/skin/useSkin.ts'
              const { useSkin } = await import(path)
              useSkin.getState().setSkin(skin)
              useSkin.getState().setMode(mode)
              await document.fonts.ready
            },
            { skin, mode },
          )
          await expect(status(page)).toHaveText('As open-ended as you like')
          const panel = await guide(page).boundingBox()
          const timing = await page.locator('[data-book-tour="plan-timing"]').boundingBox()
          expect(panel).not.toBeNull()
          expect(timing).not.toBeNull()
          expect(panel!.y + panel!.height).toBeLessThanOrEqual(timing!.y)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          ).toBe(true)
        }
      await guide(page).getByRole('button', { name: 'Go to saving', exact: true }).click()
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await guide(page).getByRole('button', { name: 'Show me this step', exact: true }).tap()
      await expect(page.locator('.book-tour-cue')).toHaveAttribute('data-motion', 'reduced')
      await expect(page.locator('.book-tour-cue[data-shown="true"]')).toHaveAttribute(
        'data-input',
        'touch',
      )
      await expect(
        editor(page).getByRole('button', { name: 'Save plan', exact: true }),
      ).toBeFocused()
      await expect(
        editor(page).getByRole('textbox', { name: /A note to your future self/ }),
      ).toHaveValue('A note to keep.')
      expect((await account.rows('books')).every((b) => b.plan_position == null)).toBe(true)
      await expect(
        editor(page).getByRole('button', { name: 'Save plan', exact: true }),
      ).toBeInViewport()
      await page.keyboard.press('Tab')
      await expect(page.locator('.book-tour-cue')).toHaveAttribute('data-shown', 'false')
      await guide(page).scrollIntoViewIfNeeded()
      await page.screenshot({ path: test.info().outputPath('planner-guide-phone.png') })
      const scan = await new AxeBuilder({ page }).include('dialog[open]').analyze()
      expect(scan.violations).toEqual([])
    } finally {
      await account.cleanup()
    }
  })
})

test('a delayed successful save is not credited to a replayed guide', async ({ page }) => {
  const account = await setup(page)
  let release: (() => void) | undefined
  try {
    await page.goto('/planner')
    await choose(page)
    await editor(page).getByRole('button', { name: 'Guide my planning', exact: true }).click()
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let arrived = false
    await page.route('**/rest/v1/books?**', async (route) => {
      if (route.request().method() === 'PATCH') {
        arrived = true
        await held
      }
      await route.continue()
    })
    await editor(page).getByRole('button', { name: 'Save plan', exact: true }).click()
    await expect.poll(() => arrived).toBe(true)
    await replay(page)
    await expect(status(page)).toHaveText('As open-ended as you like')
    release!()
    await expect(editor(page)).toHaveCount(0)
    await expect(status(page)).toHaveText('Leave a little room')
    expect(
      (await account.rows('books')).find((b) => b.id === account.books[0].id)?.plan_position,
    ).not.toBeNull()
    expect(await account.rows('reads')).toHaveLength(0)
  } finally {
    release?.()
    await account.cleanup()
  }
})
