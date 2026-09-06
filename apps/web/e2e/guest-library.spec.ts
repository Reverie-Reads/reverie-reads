import { expect, test } from '@playwright/test'

test('the sample library uses large cover sources and saves only after consent', async ({
  page,
}) => {
  await page.route('**books.google.com/books/content**', (route) =>
    route.fulfill({ path: 'public/landing-covers/acotar.jpg' }),
  )
  await page.goto('/')
  const demo = page.getByTestId('guest-library-compact')
  const covers = demo.locator('img')

  await expect(covers).toHaveCount(2)
  for (const cover of await covers.all()) {
    await expect(cover).toHaveAttribute('src', /books\.google\.com\/books\/content.*zoom=0/)
  }
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('reverie.guest-handoff.v1')))
    .toBeNull()

  await demo.getByRole('button', { name: 'Keep this library', exact: true }).click()
  await expect(demo.getByRole('heading', { name: 'Keep this little library?' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('reverie.guest-handoff.v1')))
    .toBeNull()

  await demo.getByRole('button', { name: 'Continue to my account', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\?mode=signup&guest=true$/)
  await expect(page.getByRole('heading', { name: 'Your guest library is waiting' })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('reverie.guest-handoff.v1')))
    .not.toBeNull()

  await page.getByRole('button', { name: 'Let it go', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Your guest library is waiting' }),
  ).not.toBeVisible()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('reverie.guest-handoff.v1')))
    .toBeNull()
})

for (const width of [1440, 390]) {
  test(`opening a hero-demo book does not move the surrounding landing page at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    const demo = page.getByTestId('guest-library-compact')
    await demo.scrollIntoViewIfNeeded()
    const before = await page.evaluate(() => window.scrollY)
    await demo.getByRole('button', { name: 'Open Jane Eyre', exact: true }).click()
    await expect(demo.getByRole('heading', { name: 'Book details', exact: true })).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before)
  })
}

for (const width of [1440, 390]) {
  test.describe(`${width}px guest library`, () => {
    test.use({ viewport: { width, height: 844 }, isMobile: width === 390, hasTouch: width === 390 })
    test(`a visitor adds books, keeps a note, finishes a read, and changes their dock at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/')
      const demo = page.getByTestId('guest-library-compact')
      const full = page.getByTestId('guest-library-full')
      await demo.getByRole('button', { name: 'Add books', exact: true }).click()
      await demo.getByRole('combobox', { name: 'Your copy' }).selectOption('owned')
      await demo.getByRole('checkbox', { name: /Frankenstein/ }).check()
      await demo.getByRole('checkbox', { name: /Braiding Sweetgrass/ }).check()
      await demo.getByRole('button', { name: 'Add 2 books to my library' }).click()
      await expect(demo).toContainText('4 books')
      await expect(full).toContainText('4 books')
      await demo.getByRole('button', { name: 'Next read', exact: true }).click()
      const pick = demo.getByRole('article', { name: 'Frankenstein', exact: true })
      await pick.getByRole('button', { name: 'Open Frankenstein', exact: true }).click()
      await expect(demo.getByRole('heading', { name: 'Frankenstein', exact: true })).toBeVisible()
      await demo.getByRole('button', { name: 'Start reading', exact: true }).click()
      await demo.getByRole('spinbutton', { name: 'Progress (%)' }).fill('73')
      await demo
        .getByRole('textbox', { name: 'A note to keep', exact: true })
        .fill('A question I want to sit with.')
      await demo.getByRole('slider', { name: 'Your rating' }).press('End')
      await demo.getByRole('slider', { name: 'Your rating' }).press('ArrowLeft')
      await demo.getByRole('button', { name: 'Save changes' }).click()
      await expect(full.getByRole('spinbutton', { name: 'Progress (%)' })).toHaveValue('73')
      await expect(full.getByRole('textbox', { name: 'A note to keep', exact: true })).toHaveValue(
        'A question I want to sit with.',
      )
      await demo.getByRole('button', { name: 'Finish this read' }).click()
      await demo.getByRole('button', { name: 'Reading journal', exact: true }).click()
      const entry = demo.getByRole('article', { name: 'Frankenstein, read 1' })
      await expect(entry).toContainText('A question I want to sit with.')
      await expect(entry.getByRole('img', { name: 'Rated 4.5 stars of 5' })).toBeVisible()
      await demo.getByRole('button', { name: 'Arrange dock' }).click()
      await expect(demo).toContainText('customizable docks are planned for the full app')
      await demo.getByRole('button', { name: /Remember my reading/ }).click()
      await demo.getByRole('button', { name: 'Hide Next read', exact: true }).click()
      await demo.getByRole('button', { name: 'Move Library earlier', exact: true }).click()
      await demo.getByRole('button', { name: 'Use this arrangement', exact: true }).click()
      await expect(
        demo.getByRole('navigation', { name: 'Guest library dock' }).getByRole('button'),
      ).toHaveText(['Reading journal', 'Library', 'Reading now'])
      await expect(
        full.getByRole('navigation', { name: 'Guest library dock' }).getByRole('button'),
      ).toHaveText(['Reading journal', 'Library', 'Reading now'])
      await expect(entry).toBeVisible()
      await demo.getByRole('button', { name: 'Start over', exact: true }).click()
      await demo.getByRole('button', { name: 'Reset guest library', exact: true }).click()
      await expect(demo).toContainText('2 books')
      await expect(full).not.toContainText('A question I want to sit with.')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    })
  })
}

test('CSV upload, reimport, invalid files, and manual additions remain in the tab', async ({
  page,
}) => {
  const writes: string[] = []
  page.on('request', (request) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url())
  })
  await page.goto('/')
  const demo = page.getByTestId('guest-library-compact')
  const csv = {
    name: 'books.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Title,Author,Exclusive Shelf\nFrankenstein,Mary Shelley,to-read\nBraiding Sweetgrass,Robin Wall Kimmerer,currently-reading\n',
    ),
  }
  for (let i = 0; i < 2; i++) {
    await demo.getByRole('button', { name: 'Add books', exact: true }).click()
    await demo.getByRole('button', { name: 'Upload CSV', exact: true }).click()
    await demo.getByLabel('Choose a CSV file').setInputFiles(csv)
    await expect(demo.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()
    await expect(demo).toContainText('4 books')
  }
  await expect(demo.getByTestId('guest-notice')).toContainText('2 existing books updated')
  await demo.getByRole('button', { name: 'Add books', exact: true }).click()
  await demo.getByRole('button', { name: 'Upload CSV', exact: true }).click()
  await demo
    .getByLabel('Choose a CSV file')
    .setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: Buffer.from('No books here') })
  await expect(demo.getByRole('alert')).toContainText('no book rows')
  await demo.getByLabel('Choose a CSV file').setInputFiles({
    name: 'large.csv',
    mimeType: 'text/csv',
    buffer: Buffer.alloc(1024 * 1024 + 1),
  })
  await expect(demo.getByRole('alert')).toContainText('smaller than 1 MB')
  await demo.getByRole('button', { name: 'Enter a book', exact: true }).click()
  await demo.getByRole('textbox', { name: 'Book title' }).fill('My own little book')
  await demo.getByRole('textbox', { name: 'Author', exact: true }).fill('An Author')
  await demo.getByRole('button', { name: 'Add this book' }).click()
  await expect(demo).toContainText('5 books')
  await demo.getByRole('button', { name: /^Open My own little book/ }).click()
  await expect(demo).toContainText('No reading status yet')
  await expect(demo.getByRole('checkbox', { name: 'Owned', exact: true })).not.toBeChecked()
  expect(writes).toEqual([])
  expect(
    await page.evaluate(() => JSON.stringify(localStorage) + JSON.stringify(sessionStorage)),
  ).not.toMatch(/My own little book|A question I want to sit with/)
  const cached = await page.evaluate(async () => {
    const names = await indexedDB.databases()
    const contents: unknown[] = []
    for (const { name } of names) {
      if (!name) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      try {
        for (const store of Array.from(db.objectStoreNames))
          contents.push(
            await new Promise((resolve, reject) => {
              const request = db.transaction(store).objectStore(store).getAll()
              request.onsuccess = () => resolve(request.result)
              request.onerror = () => reject(request.error)
            }),
          )
      } finally {
        db.close()
      }
    }
    return JSON.stringify(contents)
  })
  expect(cached).not.toContain('My own little book')
  await page.reload()
  await expect(demo).toContainText('2 books')
  await expect(demo).not.toContainText('My own little book')
})

test('a note written below the rooms appears on the real guest book without losing keyboard focus', async ({
  page,
}) => {
  await page.goto('/')
  const record = page.locator('#keep form')
  await record
    .getByRole('textbox', { name: 'A thought to return to' })
    .fill('I want to remember this feeling.')
  await record.getByRole('button', { name: 'Save this note' }).click()
  await expect(record.getByRole('button', { name: 'Note saved' })).toBeFocused()
  const demo = page.getByTestId('guest-library-compact')
  await demo.getByRole('button', { name: 'Open Jane Eyre', exact: true }).click()
  await expect(demo.getByRole('textbox', { name: 'A note to keep', exact: true })).toHaveValue(
    'I want to remember this feeling.',
  )
})

test('a larger CSV stays browsable without stretching the landing into a wall of books', async ({
  page,
}) => {
  await page.goto('/')
  const demo = page.getByTestId('guest-library-compact')
  await demo.getByRole('button', { name: 'Add books', exact: true }).click()
  await demo.getByRole('button', { name: 'Upload CSV', exact: true }).click()
  await demo.getByLabel('Choose a CSV file').setInputFiles({
    name: 'eight.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Title,Author\n' +
        Array.from({ length: 8 }, (_, i) => `Example book ${i + 1},Example Author`).join('\n'),
    ),
  })
  await expect(demo).toContainText('10 books')
  await expect(demo.getByRole('button', { name: /^Open / })).toHaveCount(4)
  await expect(demo.getByRole('button', { name: /^Open Example book 8/ })).toBeVisible()
  await demo.getByRole('button', { name: 'Next books', exact: true }).click()
  await demo.getByRole('button', { name: /^Open Example book 1/ }).click()
  await expect(demo.getByRole('heading', { name: 'Example book 1', exact: true })).toBeVisible()
  await expect(
    page
      .getByTestId('guest-library-full')
      .getByRole('heading', { name: 'Example book 1', exact: true }),
  ).toBeAttached()
})

test.describe('phone library navigation', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  test('opening a lower book and paging brings the active view into the screen', async ({
    page,
  }) => {
    await page.goto('/')
    const full = page.getByTestId('guest-library-full')
    await full.getByRole('button', { name: 'Add books', exact: true }).tap()
    await full.getByRole('button', { name: 'Upload CSV', exact: true }).tap()
    await full.getByLabel('Choose a CSV file').setInputFiles({
      name: 'dozen.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        'Title,Author\n' +
          Array.from({ length: 12 }, (_, i) => `Visitor book ${i + 1},Sample Author`).join('\n'),
      ),
    })
    await full.getByRole('button', { name: 'Visitor book 1 Sample Author', exact: true }).tap()
    // A reader taps the last row and expects the newly opened record to be on screen.
    // Do not scroll it into view from the test: that would hide the product failure.
    const details = full.getByRole('heading', { name: 'Book details', exact: true })
    await expect(details).toBeFocused()
    await expect(details).toBeInViewport({ ratio: 1 })
    await expect(full.getByRole('heading', { name: 'Visitor book 1', exact: true })).toBeInViewport(
      { ratio: 1 },
    )
    await full.getByRole('button', { name: 'Back to library', exact: true }).tap()
    const library = full.getByRole('heading', { name: 'Library', exact: true })
    await expect(library).toBeFocused()
    await expect(library).toBeInViewport({ ratio: 1 })
    await full.getByRole('button', { name: 'Next books', exact: true }).tap()
    await expect(library).toBeFocused()
    await expect(library).toBeInViewport({ ratio: 1 })
    await expect(
      full.getByRole('button', { name: 'Jane Eyre Charlotte Brontë', exact: true }),
    ).toBeInViewport({ ratio: 1 })
  })
})

test.describe('small phone rating', () => {
  test.use({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true })
  test('the nested note example keeps half-star targets large enough for a thumb', async ({
    page,
  }) => {
    await page.goto('/')
    const rating = page.locator('#keep').getByRole('slider', { name: 'Your rating' })
    await rating.scrollIntoViewIfNeeded()
    const third = rating.locator('[data-star="3"]')
    const fourth = rating.locator('[data-star="4"]')
    for (const star of await rating.locator('[data-star]').all()) {
      const box = await star.boundingBox()
      expect(box!.width / 2).toBeGreaterThanOrEqual(24)
      expect(box!.height).toBeGreaterThanOrEqual(24)
    }
    const left = await third.boundingBox()
    const right = await fourth.boundingBox()
    expect(right!.x).toBeCloseTo(left!.x + left!.width, 0)
    await page.touchscreen.tap(right!.x + right!.width / 4, right!.y + right!.height / 2)
    await expect(rating).toHaveAttribute('aria-valuetext', '3.5 stars')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  })
})
