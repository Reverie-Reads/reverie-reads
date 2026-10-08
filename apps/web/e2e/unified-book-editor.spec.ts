import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from './support/fixtures'
import { okData } from './support/ok'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { configureReturningReader } from './support/readerGuidance'
const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const service =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function setup(page: Page) {
  const admin = createClient(endpoint, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `book-editor-${randomUUID()}@reverie.local`
  const password = 'Book-editor-local-9362'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No reader')
  const uid = created.data.user.id
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await reader.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No session')
  await okData(
    admin.from('profiles').update({ skin: 'folio', mode: 'light' }).eq('id', uid).select('id'),
    'Editor appearance',
  )
  await configureReturningReader(auth.data.session.access_token)
  await keepOfflineCacheEmpty(page)
  for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers', 'taste', 'geo'])
    await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  return {
    reader,
    uid,
    async cleanup() {
      const result = await admin.auth.admin.deleteUser(uid)
      if (result.error) throw result.error
    },
  }
}

for (const width of [320, 390, 1440]) {
  test(`Add and contextual Edit share metadata and retain subgenres at ${width}px`, async ({
    page,
  }, info) => {
    test.skip(info.project.name !== 'rest', 'Explicit phone and desktop sizes below')
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    const account = await setup(page)
    try {
      await page.goto('/add')
      await page.getByRole('button', { name: 'Add manually', exact: true }).click()
      await page
        .getByRole('button', { name: 'Additional information (optional)', exact: true })
        .click()
      const title = `A Map of Every Quiet Island ${width} ` + 'Unbroken'.repeat(12)
      await page.getByLabel('Title', { exact: true }).fill(title)
      await page.getByRole('button', { name: /Add contributor/ }).click()
      await page.getByLabel('Contributor 1 name').fill('Iona Vale')
      await page.getByRole('combobox', { name: 'Genre', exact: true }).selectOption('horror')
      await page.getByRole('button', { name: 'Gothic', exact: true }).click()
      await page.getByRole('button', { name: /Other genres’ subgenres/ }).click()
      await page.getByRole('button', { name: 'Dark Romance', exact: true }).click()
      await page.getByRole('button', { name: 'Hide other genres’ subgenres', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Dark Romance', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await page.getByRole('button', { name: /^Also tag as/ }).click()
      await page.getByRole('button', { name: 'Fantasy', exact: true }).click()
      await page.getByLabel('ISBN', { exact: true }).fill('9780316580792')
      await page.getByLabel('Pages', { exact: true }).fill('352')
      await page.getByRole('textbox', { name: 'Series', exact: true }).fill('The Quiet Islands')
      await page.getByLabel('Position', { exact: true }).fill('1.5')
      await page.getByLabel('Series length', { exact: true }).fill('4')
      await page
        .getByRole('combobox', { name: 'Series status', exact: true })
        .selectOption({ label: 'Completed' })
      await page.getByText('Reading details (optional)', { exact: true }).click()
      await page.getByRole('slider', { name: 'Your rating', exact: true }).press('End')
      await page.getByRole('slider', { name: 'Your rating', exact: true }).press('ArrowLeft')
      await page.getByLabel('Pub year', { exact: true }).fill('2025')
      await page.getByLabel('Month', { exact: true }).fill('2')
      await page.getByLabel('Day', { exact: true }).fill('28')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: info.outputPath(`add-genres-${width}.png`) })
      let releaseSave = () => {}
      const saving = new Promise<void>((resolve) => {
        releaseSave = resolve
      })
      await page.route('**/rest/v1/books?*', async (route) => {
        if (route.request().method() === 'POST') await saving
        return route.fallback()
      })
      try {
        await page.getByRole('button', { name: 'Review book', exact: true }).click()
        const reviewDialog = page.getByRole('dialog', { name: 'Review your book' })
        await expect(reviewDialog).toContainText(title)
        await expect(reviewDialog).toContainText('352')
        await page.screenshot({ path: info.outputPath(`quick-add-review-${width}.png`) })
        const beforeConfirm = await account.reader
          .from('books')
          .select('id')
          .eq('owner_id', account.uid)
        expect(beforeConfirm.error).toBeNull()
        expect(beforeConfirm.data).toEqual([])
        await reviewDialog.getByRole('button', { name: 'Back to information' }).click()
        await expect(page.getByLabel('Pages', { exact: true })).toHaveValue('352')
        await page.getByRole('button', { name: 'Review book', exact: true }).click()
        await reviewDialog.getByRole('button', { name: 'Confirm and add', exact: true }).click()
        await expect(page.locator('[data-book-tour="book-save"]')).toBeDisabled()
        await expect(page.getByRole('slider', { name: 'Your rating', exact: true })).toHaveCount(0)
        await expect(page.getByRole('dialog', { name: 'Review your book' })).toContainText(
          '4.5 / 5',
        )
      } finally {
        releaseSave()
      }
      await expect(
        page.getByRole('heading', { name: 'Your book was saved', exact: true }),
      ).toBeVisible()
      const row = await okData(
        account.reader
          .from('books')
          .select(
            'id,subgenres,subgenre,genres,pages,pub_y,pub_m,pub_d,isbn,rating,series,position,series_count,status,series_user_chosen',
          )
          .eq('owner_id', account.uid)
          .single(),
        'Added metadata',
      )
      expect(row).toMatchObject({
        subgenre: 'Gothic',
        subgenres: ['Gothic', 'Dark Romance'],
        genres: ['horror', 'fantasy'],
        pages: 352,
        rating: 4.5,
        series: 'The Quiet Islands',
        position: 1.5,
        series_count: 4,
        status: 'completed',
        series_user_chosen: true,
        pub_y: 2025,
        pub_m: 2,
        pub_d: 28,
        isbn: '9780316580792',
      })
      await page.goto(`/book/${row.id}`)
      await page.getByRole('button', { name: 'Edit genres & subgenres', exact: true }).click()
      const editor = page.getByRole('dialog', { name: 'Edit details', exact: true })
      await expect(
        editor.getByRole('heading', { name: 'Genres & subgenres', exact: true }),
      ).toBeFocused()
      await expect(editor.getByRole('button', { name: 'Gothic', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(
        editor.getByRole('button', { name: 'Dark Romance', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      await editor.getByLabel('Pages', { exact: true }).fill('360')
      await editor.getByRole('button', { name: 'Save details', exact: true }).click()
      await expect(editor).toHaveCount(0)
      await page.reload()
      await page.getByRole('button', { name: 'Edit edition details', exact: true }).click()
      await expect(
        editor.getByRole('heading', { name: 'Edition details', exact: true }),
      ).toBeFocused()
      await expect(editor.getByLabel('Pages', { exact: true })).toHaveValue('360')
      await expect(
        editor.getByRole('button', { name: 'Save details', exact: true }),
      ).toBeInViewport()
      await expect(editor.getByRole('button', { name: 'Close', exact: true })).toBeInViewport()
      const navigation = await editor
        .getByRole('navigation', { name: 'Book information sections' })
        .boundingBox()
      const section = await editor
        .getByRole('heading', { name: 'Edition details', exact: true })
        .boundingBox()
      expect(navigation).not.toBeNull()
      expect(section).not.toBeNull()
      const sectionGap = section!.y - navigation!.y - navigation!.height
      expect(sectionGap).toBeGreaterThanOrEqual(0)
      expect(sectionGap).toBeLessThanOrEqual(24)
      expect(await editor.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
      await expect(editor.getByLabel('Pub year', { exact: true })).toHaveValue('2025')
      await expect(editor.getByLabel('Month', { exact: true })).toHaveValue('2')
      await expect(editor.getByLabel('Day', { exact: true })).toHaveValue('28')
      await page.screenshot({ path: info.outputPath(`edit-edition-${width}.png`) })
      await editor.getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('button', { name: 'Edit rating', exact: true }).click()
      await expect(editor.getByRole('heading', { name: 'Your reading', exact: true })).toBeFocused()
      await expect(editor.getByText('Your rating', { exact: true })).toBeVisible()
    } finally {
      await account.cleanup()
    }
  })
}

test('Bearded Next read starts with one pick and retains the refinement draft across mode changes', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'rest', 'Explicit phone and desktop sizes below')
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const account = await setup(page)
  try {
    await okData(
      account.reader
        .from('books')
        .insert(
          [
            'The Quiet Lantern',
            'An Atlas of Faraway Orchards',
            'Glass',
            'The Last Long Journey Beyond the Familiar Shore',
          ].map((title) => ({
            owner_id: account.uid,
            title,
            author_first: 'Iona',
            author_last: 'Vale',
            ownership: 'owned',
            read_status: 'Unread',
            genre: 'literary',
          })),
        )
        .select('id'),
      'Next read candidates',
    )
    await page.goto('/settings')
    await page.getByRole('radio', { name: /^Bearded Mode/ }).check()
    await page.goto('/match')
    await expect(page.getByRole('article')).toHaveCount(1)
    const refine = page.locator('summary').filter({ hasText: /^Refine choices/ })
    const mood = page.getByLabel('What are you in the mood for?')
    await expect(mood).toBeHidden()
    await page.screenshot({ path: info.outputPath('next-read-bearded-390.png') })
    await refine.click()
    await mood.fill('An unsent quiet adventure')
    await page
      .locator('summary')
      .filter({ hasText: /^More options$/ })
      .click()
    await page.getByLabel('Include rereads', { exact: true }).check()
    const other = await page.context().newPage()
    await other.goto('/settings')
    await other.getByRole('radio', { name: /^Full interface/ }).check()
    await expect(page.getByRole('article')).toHaveCount(3)
    await expect(mood).toHaveValue('An unsent quiet adventure')
    await expect(page.getByLabel('Include rereads', { exact: true })).toBeChecked()
    await other.getByRole('radio', { name: /^Bearded Mode/ }).check()
    await expect(page.getByRole('article')).toHaveCount(1)
    await expect(mood).toHaveValue('An unsent quiet adventure')
    await other.close()
    await refine.click()
    await expect(mood).toBeHidden()
    await page.getByRole('button', { name: 'See 3 more books', exact: true }).click()
    await expect(page.getByRole('article')).toHaveCount(4)
  } finally {
    await account.cleanup()
  }
})

test('pasted lists look up without writing and retain unresolved items after a confirmed add', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const account = await setup(page)
  let finishLookup = () => {}
  const pendingLookup = new Promise<void>((resolve) => {
    finishLookup = resolve
  })
  try {
    await page.route('**/functions/v1/search**', async (route) => {
      const body = route.request().postDataJSON()
      if (JSON.stringify(body).includes('Unavailable')) {
        await pendingLookup
        return route.fulfill({ status: 503, json: { error: 'Unavailable' } })
      }
      return route.fulfill({
        json: {
          results: [
            {
              source: 'hardcover',
              title: 'A Quiet Atlas',
              authors: ['Iona Vale'],
              isbn: '9780316580792',
              year: '2025',
              cover: '',
            },
          ],
        },
      })
    })
    await page.goto('/add')
    await page.getByText('Bulk add — paste a list', { exact: true }).click()
    await page
      .getByLabel('Books to add, one title or ISBN per line')
      .fill('A Quiet Atlas\nUnavailable')
    await page.getByRole('button', { name: 'Look up list', exact: true }).click()
    await expect(page.getByRole('button', { name: /Review A Quiet Atlas/ })).toBeEnabled()
    const before = await account.reader.from('books').select('id').eq('owner_id', account.uid)
    expect(before.error).toBeNull()
    expect(before.data).toEqual([])
    await page.getByRole('button', { name: /Review A Quiet Atlas/ }).click()
    await page.getByRole('button', { name: 'Review book', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Review your book' })
    await expect(review).toContainText('Not set')
    await page.screenshot({ path: test.info().outputPath('quick-add-phone-review.png') })
    await review.getByRole('button', { name: 'Confirm and add' }).click()
    await expect(page.getByRole('heading', { name: 'Your book was saved' })).toBeVisible()
    await page.getByRole('link', { name: 'Open your book', exact: true }).click()
    const exit = page.getByRole('dialog', { name: 'Leave this draft?' })
    await expect(exit).toBeVisible()
    await exit.getByRole('button', { name: 'Keep editing' }).click()
    finishLookup()
    await page.getByRole('button', { name: 'Continue with your list' }).click()
    await expect(page.getByText('1 saved · 1 to review', { exact: true })).toBeVisible()
    await expect(
      page.getByText('Lookup unavailable. Your entry is still here.', { exact: true }),
    ).toBeVisible()
    const after = await account.reader
      .from('books')
      .select('title,genre,ownership,read_status,format')
      .eq('owner_id', account.uid)
    expect(after.error).toBeNull()
    expect(after.data).toEqual([
      {
        title: 'A Quiet Atlas',
        genre: '',
        ownership: 'unowned',
        read_status: 'unset',
        format: null,
      },
    ])
  } finally {
    finishLookup()
    await account.cleanup()
  }
})

test('a spreadsheet stays a reviewable draft until the reader confirms the file', async ({
  page,
}) => {
  const account = await setup(page)
  let releaseImport = () => {}
  const heldImport = new Promise<void>((resolve) => {
    releaseImport = resolve
  })
  try {
    await page.goto('/settings')
    await page.getByRole('heading', { name: 'Backup & import' }).click()
    await page.getByTestId('import-library').waitFor({ state: 'visible' })
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles({
      name: 'review.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Title,Author,ISBN,Exclusive Shelf\nThe Window,Iona Vale,9780316580792,to-read',
      ),
    })
    const review = page.getByRole('dialog', { name: 'Review your import' })
    await expect(review).toContainText('1 book')
    await review.locator('summary').filter({ hasText: 'The Window' }).click()
    await expect(review).toContainText('Wishlist')
    const before = await account.reader.from('books').select('id').eq('owner_id', account.uid)
    expect(before.error).toBeNull()
    expect(before.data).toEqual([])
    await review.getByRole('button', { name: 'Cancel import' }).click()
    const afterCancel = await account.reader.from('books').select('id').eq('owner_id', account.uid)
    expect(afterCancel.error).toBeNull()
    expect(afterCancel.data).toEqual([])
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles({
      name: 'review.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Title,Author,ISBN,Exclusive Shelf\nThe Window,Iona Vale,9780316580792,to-read',
      ),
    })
    let writes = 0
    await page.route('**/rest/v1/books?*', async (route) => {
      if (route.request().method() === 'POST') {
        writes++
        await heldImport
      }
      return route.fallback()
    })
    await review.getByRole('button', { name: 'Confirm import of 1 book', exact: true }).click()
    await expect.poll(() => writes).toBe(1)
    await expect(review.getByRole('button', { name: 'Importing…', exact: true })).toBeDisabled()
    await expect(review.getByRole('button', { name: 'Cancel import', exact: true })).toBeDisabled()
    await expect(review).not.toContainText('Nothing has been imported')
    releaseImport()
    await expect(review).toHaveCount(0)
    const after = await account.reader
      .from('books')
      .select('title,wishlist')
      .eq('owner_id', account.uid)
    expect(after.error).toBeNull()
    expect(after.data).toEqual([{ title: 'The Window', wishlist: true }])
  } finally {
    releaseImport()
    await account.cleanup()
  }
})
