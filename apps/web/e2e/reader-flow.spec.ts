import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { keepOfflineCacheEmpty } from './support/offlineCache'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function setup(page: Page) {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `reader-flow-${randomUUID()}@reverie.local`
  const password = 'ReaderFlow-Local-9362'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No test user')
  const uid = created.data.user.id
  const sb = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await sb.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No test session')
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers']) {
    await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
  }
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 })
  async function add(title: string, patch: Record<string, unknown> = {}) {
    const result = await sb
      .from('books')
      .insert({
        owner_id: uid,
        title,
        genre: 'fantasy',
        read_status: 'Unread',
        ownership: 'owned',
        ...patch,
      })
      .select('id')
      .single()
    if (result.error) throw result.error
    return result.data.id as string
  }
  async function row(id: string) {
    const result = await sb
      .from('books')
      .select('read_status, progress, ownership, borrowed, wishlist, rating')
      .eq('id', id)
      .single()
    if (result.error) throw result.error
    return result.data
  }
  async function reads(id: string) {
    const result = await sb
      .from('reads')
      .select('id, read_on, rating, notes')
      .eq('book_id', id)
      .order('read_on')
    if (result.error) throw result.error
    return result.data
  }
  return {
    sb,
    uid,
    add,
    row,
    reads,
    cleanup: async () => {
      const result = await admin.auth.admin.deleteUser(uid)
      if (result.error) throw result.error
    },
  }
}

test('Next read scopes lead to a real saved choice and an active read without acquiring a copy', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await setup(page)
  try {
    await c.add('Owned choice')
    const borrowed = await c.add('Borrowed choice', { ownership: 'unowned', borrowed: true })
    await c.add('Wanted choice', { ownership: 'unowned', wishlist: true })
    await c.add('Latent format', { ownership: 'unowned', owned_ebook: true })
    await c.add('Finished choice', { read_status: 'Read' })
    const historyOnly = await c.add('History-only choice')
    const past = await c.sb
      .from('reads')
      .insert({ owner_id: c.uid, book_id: historyOnly, read_on: '2026-01-01' })
    if (past.error) throw past.error
    await c.add('Stopped choice', { read_status: 'DNF' })
    await c.add('Current choice', { read_status: 'Reading', progress: 20 })
    await page.goto('/match')
    await expect(page.getByRole('heading', { name: 'Next read', exact: true })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(2)
    await expect(page.getByRole('article', { name: 'History-only choice' })).toHaveCount(0)
    await expect(page.getByRole('article', { name: 'Borrowed choice' })).toBeVisible()
    await expect(page.getByText(/\d+% match/)).toHaveCount(0)
    await page.getByRole('radio', { name: 'Wishlist', exact: true }).check()
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(page.getByRole('article', { name: 'Wanted choice' })).toBeVisible()
    await page.getByRole('radio', { name: 'My whole library', exact: true }).check()
    await page.getByRole('button', { name: /See \d+ more books?/ }).click()
    await expect(page.getByRole('article', { name: 'Latent format' })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Finished choice' })).toHaveCount(0)
    await page.getByText('Refine choices', { exact: true }).click()
    await page.getByRole('checkbox', { name: 'Include rereads', exact: true }).check()
    await page.getByRole('button', { name: /See \d+ more books?/ }).click()
    await expect(page.getByRole('article', { name: 'Finished choice' })).toBeVisible()
    await expect(page.getByRole('article', { name: 'History-only choice' })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Stopped choice' })).toHaveCount(0)
    await page
      .getByRole('checkbox', { name: 'Include books I stopped reading', exact: true })
      .check()
    await page.getByRole('button', { name: /See \d+ more books?/ }).click()
    await expect(page.getByRole('article', { name: 'Stopped choice' })).toBeVisible()
    await expect(page.getByRole('article', { name: 'Current choice' })).toHaveCount(0)
    await page.getByRole('radio', { name: 'Available to read' }).check()
    await page.getByRole('checkbox', { name: 'Include rereads', exact: true }).uncheck()
    await page
      .getByRole('checkbox', { name: 'Include books I stopped reading', exact: true })
      .uncheck()
    const card = page.getByRole('article', { name: 'Borrowed choice' })
    await card.getByRole('button', { name: 'Save for later' }).click()
    await expect(
      page.getByRole('status').filter({ hasText: 'Saved to Priority TBR' }),
    ).toBeVisible()
    const saved = await c.sb.from('list_items').select('book_id').eq('book_id', borrowed)
    expect(saved.error).toBeNull()
    expect(saved.data).toHaveLength(1)
    await card.getByRole('button', { name: 'Start reading' }).click()
    await expect(page).toHaveURL(new RegExp(`/book/${borrowed}`))
    await expect(page.getByRole('button', { name: 'Update progress', exact: true })).toBeVisible()
    expect(await c.row(borrowed)).toMatchObject({
      read_status: 'Reading',
      ownership: 'unowned',
      borrowed: true,
      wishlist: false,
      progress: 0,
    })
    expect(await c.reads(borrowed)).toHaveLength(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Update progress', exact: true })).toBeVisible()
  } finally {
    await c.cleanup()
  }
})

test('on a compact phone a reread preserves history through start, progress, and finish', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const c = await setup(page)
  try {
    const id = await c.add('A book worth returning to', {
      read_status: 'Read',
      progress: 100,
      rating: 5,
      ownership: 'unowned',
      wishlist: true,
    })
    const inserted = await c.sb.from('reads').insert({
      book_id: id,
      owner_id: c.uid,
      read_on: '2026-01-10',
      format: 'Paperback',
      rating: 4,
      notes: 'Keep my first impression',
    })
    if (inserted.error) throw inserted.error
    await page.goto(`/book/${id}`)
    const memory = page.getByRole('region', { name: 'From your reading journal' })
    await expect(memory).toContainText('Keep my first impression')
    await expect(memory).toContainText('Paperback')
    await expect(memory.getByRole('img', { name: 'Rated 4 stars of 5' })).toBeVisible()
    await page.getByRole('button', { name: 'Read again', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Update progress', exact: true })).toBeVisible()
    // The button updates optimistically; verify the durable write instead of racing its response.
    await expect
      .poll(() => c.row(id))
      .toMatchObject({
        read_status: 'Reading',
        progress: 0,
        rating: 5,
        ownership: 'unowned',
        wishlist: true,
      })
    expect(await c.reads(id)).toHaveLength(1)
    await page.goto('/')
    const cover = page.getByRole('button', { name: 'Open A book worth returning to', exact: true })
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await expect(cover).toBeVisible()
      const bounds = await cover.boundingBox()
      expect(bounds!.height / bounds!.width).toBeCloseTo(1.5, 1)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    }
    await page.setViewportSize({ width: 390, height: 844 })
    await cover.click()
    await page.getByRole('button', { name: 'Update progress', exact: true }).click()
    const progressDialog = page.getByRole('dialog', { name: 'Update progress', exact: true })
    const exactProgress = progressDialog.getByRole('spinbutton', { name: 'Progress (%)' })
    await expect(exactProgress).toBeFocused()
    const progress = progressDialog.getByRole('slider', { name: /Reading progress slider/ })
    await progress.focus()
    await progress.press('ArrowRight')
    await expect(exactProgress).toHaveValue('1')
    await progress.press('Tab')
    await page.waitForTimeout(300)
    expect((await c.row(id)).progress).toBe(0)
    await progressDialog.getByRole('button', { name: 'Save progress' }).click()
    await expect(progressDialog).toBeHidden()
    await expect.poll(async () => (await c.row(id)).progress).toBeGreaterThan(0)
    await page.getByRole('button', { name: 'Finish this read' }).click()
    const dialog = page.getByRole('dialog', { name: 'Finish this read', exact: true })
    await dialog.getByRole('button', { name: 'Save finished read' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await c.row(id)).read_status).toBe('Read')
    expect(await c.row(id)).toMatchObject({
      progress: 100,
      rating: 5,
      ownership: 'unowned',
      wishlist: true,
    })
    const history = await c.reads(id)
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      read_on: '2026-01-10',
      rating: 4,
      notes: 'Keep my first impression',
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav).toContainText('Home')
    await expect(nav).toContainText('Next read')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: 'test-results/reader-flow-home-phone.png', fullPage: true })
  } finally {
    await c.cleanup()
  }
})

test('onboarding starts with import and reaches a reading choice from the real imported rows', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await setup(page)
  try {
    await page.goto('/onboarding')
    await expect(page.getByRole('button', { name: 'Import a file', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a book', exact: true })).toBeVisible()
    // Use the actual file button: a reader cannot pick a file while library context is loading.
    const chooseFile = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: 'Import a file', exact: true }).click()
    await (
      await chooseFile
    ).setFiles({
      name: 'reading.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Title,Author,Exclusive Shelf\nA portable beginning,Robin Reader,currently-reading\n',
      ),
    })
    await expect(
      page.getByRole('heading', { name: 'Your books are here.', exact: true }),
    ).toBeVisible({ timeout: 20_000 })
    const finishImport = page.getByRole('button', { name: /Continue/ })
    await finishImport.click()
    await expect(page.getByRole('button', { name: 'Continue reading', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue reading', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'A portable beginning' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update progress', exact: true })).toBeVisible()
  } finally {
    await c.cleanup()
  }
})

test('the reading navigation and shortlist remain usable in compact rooms', async ({ page }) => {
  test.setTimeout(150_000)
  const c = await setup(page)
  try {
    await c.add('A quiet adventure')
    for (const skin of ['tryst', 'aphelion', 'folio']) {
      const profile = await c.sb.from('profiles').update({ skin, mode: 'light' }).eq('id', c.uid)
      if (profile.error) throw profile.error
      await page.evaluate((nextSkin) => {
        localStorage.setItem('reverie.skin', nextSkin)
        localStorage.setItem('reverie.mode', 'light')
      }, skin)
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 844 })
        await page.goto('/match')
        await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
        await expect(page.getByRole('article', { name: 'A quiet adventure' })).toBeVisible()
        const primary = page.getByRole('navigation', { name: 'Primary', exact: true })
        const nextRead = primary.getByRole('link', { name: 'Next read', exact: true })
        const bounds = await nextRead.boundingBox()
        expect(bounds!.height).toBeGreaterThanOrEqual(44)
        expect(bounds!.width).toBeGreaterThanOrEqual(44)
        const labelCenters = await nextRead.evaluate((link) => {
          const icon = link.querySelector('svg')!.getBoundingClientRect()
          const text = document.createRange()
          text.selectNodeContents(link.querySelector('.skin-label')!)
          return [...text.getClientRects()].map((line) =>
            Math.abs(line.left + line.width / 2 - (icon.left + icon.width / 2)),
          )
        })
        expect(labelCenters.length).toBeGreaterThan(0)
        for (const distance of labelCenters) expect(distance).toBeLessThanOrEqual(1.5)
        await primary.getByRole('button', { name: 'More', exact: true }).click()
        const more = page.getByRole('navigation', { name: 'More destinations' })
        const appearance = more.getByRole('link', { name: 'Appearance' })
        await expect(appearance).toBeVisible()
        const fits = await appearance.evaluate((link) => {
          const label = link.querySelector('.skin-label')!
          const text = document.createRange()
          text.selectNodeContents(label)
          const textBox = text.getBoundingClientRect()
          const box = link.getBoundingClientRect()
          return textBox.left >= box.left - 1 && textBox.right <= box.right + 1
        })
        expect(fits, `${skin}/${width}: Appearance stays inside its target`).toBe(true)
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `${skin}/${width}: no horizontal overflow`,
        ).toBe(true)
        await page.screenshot({
          path: `test-results/reader-flow-${skin}-${width}-menu.png`,
          fullPage: true,
        })
        await primary.getByRole('button', { name: 'More', exact: true }).click()
        await page.screenshot({
          path: `test-results/reader-flow-${skin}-${width}-next-read.png`,
          fullPage: true,
        })
      }
    }
  } finally {
    await c.cleanup()
  }
})

test('Appearance shows the complete binding of every spine in both modes', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await setup(page)
  try {
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.goto('/skins')
      for (const mode of ['light', 'dark']) {
        const toggle = page.getByRole('button', {
          name: mode === 'light' ? '☀ Light' : '☾ Dark',
          exact: true,
        })
        await toggle.click()
        await expect(page.getByTestId('appearance-room').first()).toHaveAttribute('data-mode', mode)
        await page.evaluate(() => document.fonts.ready)
        const previews = page.getByTestId('appearance-spine')
        await expect(previews).toHaveCount(9)
        for (const preview of await previews.all()) {
          const geometry = await preview.evaluate((wrapper) => {
            const spine = wrapper.firstElementChild!
            const box = spine.getBoundingClientRect()
            const clips = []
            for (let parent = spine.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent)
              if (
                [style.overflowX, style.overflowY].some((value) =>
                  ['hidden', 'clip'].includes(value),
                )
              ) {
                const area = parent.getBoundingClientRect()
                clips.push(
                  box.left >= area.left - 1 &&
                    box.right <= area.right + 1 &&
                    box.top >= area.top - 1 &&
                    box.bottom <= area.bottom + 1,
                )
              }
            }
            const frame = wrapper.getBoundingClientRect()
            return {
              height: box.height,
              contained: box.top >= frame.top && box.bottom <= frame.bottom,
              clips,
            }
          })
          expect(geometry.height).toBeGreaterThanOrEqual(150)
          expect(geometry.contained).toBe(true)
          expect(geometry.clips.every(Boolean)).toBe(true)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        for (const room of await page.getByTestId('appearance-room').all()) {
          const skin = await room.getAttribute('data-skin')
          await room.screenshot({ path: `test-results/appearance-${skin}-${mode}-${width}.png` })
        }
      }
    }
  } finally {
    await c.cleanup()
  }
})

test('mood refinements survive a book visit and bounded mood results have an honest fallback', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await setup(page)
  try {
    await c.add('Available adventure')
    const wanted = await c.add('Wanted adventure', { ownership: 'unowned', wishlist: true })
    let requests = 0
    await page.route('**/functions/v1/embed**', (route) => {
      if (route.request().postDataJSON()?.mode === 'vibe') {
        requests++
        return route.fulfill({ json: { hits: [{ book_id: wanted, similarity: 0.92 }] } })
      }
      return route.fulfill({ json: {} })
    })
    await page.goto('/match')
    await page.getByText('Refine choices', { exact: true }).click()
    await page.getByLabel('Describe tonight’s vibe').fill('an adventure')
    await page.getByRole('button', { name: 'Find this mood' }).click()
    await expect(page.getByText(/No returned mood matches are in this selection/)).toBeVisible()
    await expect(page.getByRole('article', { name: 'Available adventure' })).toBeVisible()
    await page.getByRole('radio', { name: 'Wishlist', exact: true }).check()
    await expect(page.getByRole('heading', { name: 'Picks for your mood' })).toBeVisible()
    await page.getByRole('button', { name: 'Open Wanted adventure' }).click()
    await expect(page.getByRole('heading', { name: 'Wanted adventure' })).toBeVisible()
    await page.goBack()
    await expect(page.getByRole('heading', { name: 'Picks for your mood' })).toBeVisible()
    expect(requests, 'a book visit reuses results instead of charging for another search').toBe(1)
    await page.getByRole('button', { name: 'Clear mood' }).click()
    await page.getByText('Refine choices', { exact: true }).click()
    await page.getByRole('button', { name: 'Use mood questions' }).click()
    for (const answer of [
      'Sweeping adventure & magic',
      'Gentle & comforting',
      'Slow and simmering',
      'Enemies, rivals & sharp edges',
      'Thrilled & on edge',
    ]) {
      await page.getByRole('button', { name: answer, exact: true }).click()
    }
    await expect(page).toHaveURL(/mood=0\.0\.0\.0\.0/)
    const mood = await page.getByText(/^Mood:/).innerText()
    await page.getByRole('button', { name: 'Open Wanted adventure' }).click()
    await page.goBack()
    await expect(page.getByText(/^Mood:/)).toHaveText(mood)
  } finally {
    await c.cleanup()
  }
})
