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
  const email = `next-tour-${randomUUID()}@reverie.local`
  const password = 'Next-tour-local-9362'
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
        ? 'id,read_status,progress,ownership,borrowed,wishlist'
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
    books: await okData(Promise.resolve(inserted), 'Next read books fixture'),
    rows,
    vibeRequests: () => vibeRequests,
    async cleanup() {
      const r = await admin.auth.admin.deleteUser(uid)
      if (r.error) throw r.error
    },
  }
}
const guide = (page: Page) => page.getByRole('complementary', { name: 'Live walkthrough' })
async function start(page: Page) {
  await page.getByRole('button', { name: 'Guide my next read', exact: true }).click()
  await expect(guide(page).getByRole('status')).toHaveText('Begin with your shelves')
}
async function picks(page: Page) {
  await guide(page).getByRole('button', { name: 'Go to my picks', exact: true }).click()
  await expect(guide(page).getByRole('status')).toHaveText('Find a book to open')
}

test('entry, demonstration and replay preserve the current scope and unsent mood without writes', async ({
  page,
}) => {
  const account = await setup(page)
  try {
    await page.goto('/match?scope=wishlist&vibeQ=quiet&rereads=true')
    const before = await account.rows('books')
    const field = page.getByLabel('What are you in the mood for?')
    await field.fill('an unfinished thought')
    await start(page)
    await guide(page).getByRole('button', { name: 'Next: a mood', exact: true }).click()
    await guide(page).getByRole('button', { name: 'Show me this step', exact: true }).click()
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('an unfinished thought')
    await page.screenshot({ path: 'test-results/next-read-guide-desktop.png' })
    await guide(page).getByRole('button', { name: 'Pause', exact: true }).click()
    await guide(page).getByRole('button', { name: 'Start over here', exact: true }).click()
    await expect(guide(page).getByRole('status')).toHaveText('Begin with your shelves')
    await expect(page).toHaveURL(/scope=wishlist/)
    await expect(page.getByRole('radio', { name: 'Wishlist', exact: true })).toBeChecked()
    await expect(field).toHaveValue('an unfinished thought')
    await picks(page)
    await expect(page.getByRole('article', { name: 'The Far Shore' })).toBeVisible()
    expect(account.vibeRequests()).toBe(0)
    expect(await account.rows('books')).toEqual(before)
    for (const table of ['reads', 'lists', 'list_items'] as const)
      expect(await account.rows(table)).toEqual([])
  } finally {
    await account.cleanup()
  }
})

test('TBR completion waits for membership, and a retry does not create another shelf', async ({
  page,
}) => {
  const account = await setup(page)
  try {
    await page.goto('/match')
    await start(page)
    await picks(page)
    let fail = true
    await page.route('**/rest/v1/list_items?**', (route) =>
      route.request().method() === 'POST' && fail
        ? route.fulfill({ status: 500, json: { message: 'Test membership unavailable' } })
        : route.continue(),
    )
    const save = page
      .getByRole('article', { name: 'The Quiet Lantern' })
      .getByRole('button', { name: 'Save to TBR', exact: true })
    await save.click()
    await expect(page.getByText('Could not save these picks. Please try again.')).toBeVisible()
    await expect(guide(page).getByRole('status')).toHaveText('Find a book to open')
    expect(await account.rows('lists')).toHaveLength(1)
    expect(await account.rows('list_items')).toEqual([])
    fail = false
    await save.click()
    await expect(guide(page).getByRole('status')).toHaveText('Kept for another day')
    expect(await account.rows('lists')).toHaveLength(1)
    expect(await account.rows('list_items')).toHaveLength(1)
    expect(await account.rows('reads')).toEqual([])
    await guide(page).getByRole('button', { name: 'Keep browsing', exact: true }).click()
    await expect(guide(page)).toHaveCount(0)
  } finally {
    await account.cleanup()
  }
})

test('a delayed TBR success is not credited to a restarted walkthrough', async ({ page }) => {
  const account = await setup(page)
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  try {
    await page.goto('/match')
    await start(page)
    await picks(page)
    let waiting = false
    await page.route('**/rest/v1/list_items?**', async (route) => {
      if (route.request().method() === 'POST') {
        waiting = true
        await held
      }
      await route.continue()
    })
    await page
      .getByRole('article', { name: 'The Quiet Lantern' })
      .getByRole('button', { name: 'Save to TBR', exact: true })
      .click()
    await expect.poll(() => waiting).toBe(true)
    await guide(page).getByRole('button', { name: 'Pause', exact: true }).click()
    await guide(page).getByRole('button', { name: 'Start over here', exact: true }).click()
    release()
    await expect(page.getByText(/Saved to Priority TBR/)).toBeVisible()
    await expect(guide(page).getByRole('status')).toHaveText('Begin with your shelves')
    expect(await account.rows('list_items')).toHaveLength(1)
  } finally {
    release()
    await account.cleanup()
  }
})

test('a failed start stays on the shortlist; a confirmed start guides that exact book without acquiring it', async ({
  page,
}) => {
  const account = await setup(page)
  try {
    await page.goto('/match?scope=wishlist')
    await start(page)
    await picks(page)
    let fail = true
    await page.route('**/rest/v1/books?**', (route) =>
      route.request().method() === 'PATCH' && fail
        ? route.fulfill({ status: 500, json: { message: 'Test start unavailable' } })
        : route.continue(),
    )
    const book = page.getByRole('article', { name: 'The Far Shore' })
    await book.getByRole('button', { name: 'Start reading', exact: true }).click()
    await expect(
      page.getByText('This read could not be started. Please try again.', { exact: true }),
    ).toBeVisible()
    await expect(guide(page).getByRole('status')).toHaveText('Find a book to open')
    fail = false
    await book.getByRole('button', { name: 'Start reading', exact: true }).click()
    const selected = account.books.find((b) => b.title === 'The Far Shore')!
    await expect(page).toHaveURL(new RegExp(`/book/${selected.id}$`))
    await expect(guide(page).getByRole('status')).toHaveText('Keep your place')
    expect((await account.rows('books')).find((b) => b.id === selected.id)).toMatchObject({
      read_status: 'Reading',
      ownership: 'unowned',
      wishlist: true,
      progress: 0,
    })
    expect(await account.rows('reads')).toEqual([])
  } finally {
    await account.cleanup()
  }
})

test('Settings starts the real chapter and opening a choice does not start reading', async ({
  page,
}) => {
  const account = await setup(page)
  try {
    const before = await account.rows('books')
    await page.goto('/settings/guidance')
    await page.getByRole('button', { name: /Find your next read/ }).click()
    await page.getByRole('button', { name: 'Guide my next read', exact: true }).click()
    await expect(page).toHaveURL(/\/match$/)
    await picks(page)
    await page.getByRole('button', { name: 'Open The Quiet Lantern', exact: true }).click()
    const selected = account.books.find((b) => b.title === 'The Quiet Lantern')!
    await expect(page).toHaveURL(new RegExp(`/book/${selected.id}$`))
    await expect(guide(page).getByRole('status')).toHaveText('Begin where you are')
    expect(await account.rows('books')).toEqual(before)
    expect(await account.rows('reads')).toEqual([])
  } finally {
    await account.cleanup()
  }
})

test('an empty library remains empty while its guide offers the real Add action', async ({
  page,
}) => {
  const account = await setup(page, true)
  try {
    await page.goto('/match')
    await start(page)
    await picks(page)
    await expect(
      page.getByRole('heading', { name: 'Start with a book', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add books', exact: true })).toBeVisible()
    await guide(page).getByRole('button', { name: 'Show me this step', exact: true }).click()
    expect(await account.rows('books')).toEqual([])
    expect(await account.rows('lists')).toEqual([])
  } finally {
    await account.cleanup()
  }
})

test.describe('phone Next read coaching', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 740 } })
  test('fits every room, keeps the mood field clear and demonstrates with a touch dot', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const account = await setup(page)
    try {
      await page.goto('/match')
      await start(page)
      for (const skin of SKIN_ORDER)
        for (const mode of ['light', 'dark']) {
          await page.evaluate(
            async ({ skin, mode }) => {
              const path = '/src/skin/useSkin.ts'
              const { useSkin } = await import(path)
              useSkin.getState().setSkin(skin)
              useSkin.getState().setMode(mode)
            },
            { skin, mode },
          )
          await page.evaluate(() => document.fonts.ready)
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            `${skin}/${mode}`,
          ).toBe(true)
          expect(
            (await new AxeBuilder({ page }).include('[data-book-tour-panel]').analyze()).violations,
            `${skin}/${mode}`,
          ).toEqual([])
        }
      await guide(page).getByRole('button', { name: 'Next: a mood', exact: true }).click()
      await expect(guide(page).getByRole('status')).toHaveText('A mood, if you have one')
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await guide(page).getByRole('button', { name: 'Show me this step', exact: true }).tap()
      const field = page.getByLabel('What are you in the mood for?')
      await expect(field).toBeFocused()
      const box = (await field.boundingBox())!
      const coach = (await guide(page).boundingBox())!
      expect(box.y >= coach.y + coach.height || box.y + box.height <= coach.y).toBe(true)
      await expect(page.locator('.book-tour-cue')).toHaveAttribute('data-input', 'touch')
      await expect(page.locator('.book-tour-cue')).toHaveAttribute('data-motion', 'reduced')
      await field.fill('keep this draft')
      await picks(page)
      await expect(guide(page)).toBeInViewport({ ratio: 1 })
      await page.screenshot({ path: 'test-results/next-read-guide-phone.png' })
      expect(account.vibeRequests()).toBe(0)
      expect(await account.rows('reads')).toEqual([])
      expect(await account.rows('list_items')).toEqual([])
    } finally {
      await account.cleanup()
    }
  })
})
