import { expect, test, type Locator } from '@playwright/test'

test.describe('signed-out landing', () => {
  test('the guest library works without an account or persistent writes', async ({ page }) => {
    const writes: string[] = []
    page.on('request', (request) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    })
    await page.goto('/')
    const demo = page.getByTestId('guest-library-compact')
    await demo.getByRole('button', { name: 'Next read', exact: true }).click()
    const book = demo.getByRole('article', { name: 'The Left Hand of Darkness' })
    await book.getByRole('button', { name: 'Save for later' }).click()
    await expect(demo.getByTestId('guest-notice')).toContainText('saved for later')
    await book.getByRole('button', { name: 'Start reading' }).click()
    await expect(demo.getByRole('heading', { name: 'Book details' })).toBeFocused()
    await expect(demo.getByRole('checkbox', { name: 'Borrowed', exact: true })).toBeChecked()
    await expect(demo.getByRole('checkbox', { name: 'Owned', exact: true })).not.toBeChecked()
    await page.reload()
    await expect(demo).toContainText('2 books')
    await demo.getByRole('button', { name: 'Next read', exact: true }).click()
    await expect(book).toBeVisible()
    await expect(book).toContainText('Already in your hands')
    expect(writes).toEqual([])
  })

  test('tells the shipped product story and preserves explicit auth destinations', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(
      page.getByRole('heading', { level: 1, name: 'Find your next read in your own library.' }),
    ).toBeVisible()
    await expect(page.getByTestId('guest-library-compact')).toBeVisible()
    await expect(page.getByTestId('guest-library-full')).toBeAttached()
    for (const heading of [
      'Find a room that feels like you.',
      'Keep what the book leaves with you.',
      'A few books. A place to begin.',
    ]) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeAttached()
    }

    await expect(page.getByRole('link', { name: 'Start your library' }).first()).toHaveAttribute(
      'href',
      '/auth?mode=signup',
    )
    await expect(page.getByRole('link', { name: 'Return to Reverie' })).toHaveAttribute(
      'href',
      '/auth?mode=signin',
    )

    await expect(page).toHaveTitle('Reverie — Find your next read in your own library')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      /books you own or have borrowed/i,
    )
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      'content',
      'https://reveriereads.app/reverie-next-read-share.png',
    )

    const shareSize = await page.evaluate(async () => {
      const image = new Image()
      const loaded = new Promise<void>((resolve, reject) => {
        image.addEventListener('load', () => resolve(), { once: true })
        image.addEventListener('error', () => reject(new Error('share preview did not load')), {
          once: true,
        })
      })
      image.src = '/reverie-next-read-share.png'
      await loaded
      return { width: image.naturalWidth, height: image.naturalHeight }
    })
    expect(shareSize).toEqual({ width: 1200, height: 630 })

    const identityAssets = await page.evaluate(async () => {
      const manifest = (await fetch('/manifest.webmanifest').then((response) =>
        response.json(),
      )) as {
        background_color: string
        theme_color: string
        icons: Array<{ src: string; sizes: string; purpose: string }>
      }
      const favicon = await fetch('/favicon.svg').then((response) => response.text())
      return { manifest, favicon }
    })
    expect(identityAssets.manifest).toMatchObject({
      background_color: '#10121c',
      theme_color: '#10121c',
    })
    expect(identityAssets.manifest.icons).toContainEqual({
      src: '/icon-maskable-512.png',
      sizes: '512x512',
      type: 'image/png',
      purpose: 'maskable',
    })
    expect(identityAssets.favicon).toContain('Reverie open-book mark')
    expect(identityAssets.favicon).not.toContain('<circle')
  })

  test('the short tour moves through real guest-library views without changing reader data', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    const writes: string[] = []
    page.on('request', (request) => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method()))
        writes.push(`${request.method()} ${new URL(request.url()).pathname}`)
    })
    await page.goto('/')

    const demo = page.getByTestId('guest-library-compact')
    const tour = demo.getByRole('complementary', { name: 'A short tour of Reverie' })
    const clickVisible = async (target: Locator) => {
      const bounds = await target.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.y).toBeGreaterThanOrEqual(0)
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844)
      await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
    }
    await tour.getByRole('button', { name: 'Show me around' }).scrollIntoViewIfNeeded()
    await tour.getByRole('button', { name: 'Show me around' }).click()
    await expect(tour).toContainText('1 of 4')
    await expect(tour.getByRole('button', { name: 'Next stop' })).toBeFocused()
    await expect(demo.getByRole('heading', { name: 'Library', exact: true })).toBeVisible()

    await tour.getByRole('button', { name: 'Next stop' }).scrollIntoViewIfNeeded()
    const tourScroll = await page.evaluate(() => window.scrollY)
    await clickVisible(tour.getByRole('button', { name: 'Next stop' }))
    await expect(tour).toContainText('2 of 4')
    await expect(demo.getByRole('heading', { name: 'Next read', exact: true })).toBeVisible()
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - tourScroll)).toBeLessThanOrEqual(
      1,
    )

    await clickVisible(tour.getByRole('button', { name: 'Next stop' }))
    await expect(tour).toContainText('3 of 4')
    await expect(demo.getByRole('heading', { name: 'Book details' })).toBeVisible()
    await expect(demo.getByLabel('Progress (%)')).toHaveValue('24')
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - tourScroll)).toBeLessThanOrEqual(
      1,
    )

    await clickVisible(tour.getByRole('button', { name: 'Next stop' }))
    await expect(tour).toContainText('4 of 4')
    await expect(demo.getByRole('heading', { name: 'Arrange your dock' })).toBeVisible()
    await expect(demo).toContainText('2 books')
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - tourScroll)).toBeLessThanOrEqual(
      1,
    )
    expect(writes).toEqual([])

    await clickVisible(tour.getByRole('button', { name: 'Explore on my own' }))
    await expect(tour.getByRole('button', { name: 'Show me around' })).toBeFocused()
  })

  test('mobile navigation is touch-sized and the complete story stays within the viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByRole('heading', { name: 'Your next read may already be waiting.' }).waitFor({
      state: 'attached',
    })

    const nav = page.getByRole('navigation', { name: 'Landing', exact: true })
    const menu = nav.getByRole('button', { name: 'Menu' })
    await expect(menu).toBeVisible()
    expect(await menu.boundingBox()).toMatchObject({ width: 44, height: 44 })

    await menu.click()
    await expect(nav.getByRole('link', { name: 'Rooms' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'How it works' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Log in' })).toBeVisible()
    await menu.click()

    for (const viewport of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width: viewport, height: 844 })
      const width = await page.evaluate(() => ({
        viewport: window.innerWidth,
        root: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
      }))
      expect(width).toEqual({ viewport, root: viewport, body: viewport })
    }
  })

  test('reduced motion keeps the page still without removing its story', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/')

    await expect(
      page.getByRole('heading', { name: 'Find a room that feels like you.' }),
    ).toBeAttached()
    const light = page.getByTestId('brand-lamplight')
    await expect(light).toHaveCount(1)
    expect(await light.evaluate((el) => el.getAnimations().length)).toBe(0)
    const animations = await page.locator('.rv-anim').evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: getComputedStyle(node).animationName,
        duration: getComputedStyle(node).animationDuration,
      })),
    )
    expect(animations.every(({ name, duration }) => name === 'none' || duration === '0s')).toBe(
      true,
    )
  })

  test('lamplight moves gently behind steady text and stops when reduced motion is requested', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    const light = page.getByTestId('brand-lamplight')
    const heading = page.getByTestId('landing-display-heading')
    await expect(heading).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const before = await heading.boundingBox()
    await expect
      .poll(() => light.evaluate((el) => el.getAnimations()[0]?.playState))
      .toBe('running')
    const transform = await light.evaluate((el) => getComputedStyle(el).transform)
    await expect
      .poll(() => light.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(transform)
    expect(
      await light.evaluate((el) => Number(el.getAnimations()[0]?.effect?.getTiming().duration)),
    ).toBeGreaterThanOrEqual(10000)
    expect(await heading.boundingBox()).toEqual(before)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect.poll(() => light.evaluate((el) => el.getAnimations().length)).toBe(0)
    expect(await light.evaluate((el) => getComputedStyle(el).transform)).toBe('none')
    const demo = page.getByTestId('guest-library-compact')
    await demo.getByRole('button', { name: 'Next read', exact: true }).click()
    await demo.getByRole('button', { name: 'Save for later' }).click()
    await expect(demo.getByTestId('guest-notice')).toContainText('saved for later')
  })

  test('the nine-room atlas changes the complete product stage and its mode', async ({ page }) => {
    await page.goto('/')

    const rooms = page.getByRole('tablist', { name: 'Reverie reading rooms' })
    await expect(rooms.getByRole('tab')).toHaveCount(9)

    await rooms.getByRole('tab', { name: /Gaslight/i }).click()
    const stage = page.getByTestId('active-reading-room')
    await expect(stage).toHaveAttribute('data-active-skin', 'umbra')
    await expect(stage.getByRole('heading', { name: 'The Gaslight room' })).toBeVisible()
    await expect(stage.getByTestId('guest-library-full')).toBeVisible()

    await stage.getByRole('button', { name: 'Day' }).click()
    await expect(stage).toHaveAttribute('data-active-mode', 'light')

    await rooms.getByRole('tab', { name: /Gaslight/i }).press('ArrowRight')
    await expect(stage).toHaveAttribute('data-active-skin', 'folio')
    await expect(rooms.getByRole('tab', { name: /Marginalia/i })).toBeFocused()
  })
})

test('room selection reaches earlier examples, changes real cover structures, and keeps sample state', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const demo = page.getByTestId('guest-library-compact')
  await demo.getByRole('button', { name: 'Add books', exact: true }).click()
  await demo.getByRole('button', { name: 'Enter a book', exact: true }).click()
  await demo.getByRole('textbox', { name: 'Book title' }).fill('A book of my own')
  await demo.getByRole('button', { name: 'Add this book', exact: true }).click()
  await page.getByRole('tab', { name: /Aphelion/ }).click()
  const examples = page.getByTestId('room-example')
  await expect(examples).toHaveCount(3)
  for (const example of await examples.all())
    await expect(example).toHaveAttribute('data-skin', 'aphelion')
  for (const canvas of await page.getByTestId('skin-atmosphere').all()) {
    await expect(canvas).toHaveAttribute('data-atmosphere', 'instrument-grid-starfield')
    await expect(canvas).toHaveAttribute('data-renderer', /Canvas restored sky/)
  }
  await expect(demo.getByRole('img', { name: /A book of my own.*placeholder/ })).toContainText(
    'APH·',
  )
  await expect(demo).toContainText('3 books')
  await page.getByTestId('active-reading-room').getByRole('button', { name: 'Night' }).click()
  for (const example of await examples.all())
    await expect(example).toHaveAttribute('data-mode', 'dark')
  const still = await examples
    .first()
    .locator('canvas')
    .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())
  await page.waitForTimeout(350)
  expect(
    await examples
      .first()
      .locator('canvas')
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()),
  ).toBe(still)
})

test('guest-library actions keep each landing preview anchored in the viewport', async ({
  page,
}) => {
  await page.goto('/')

  const compact = page.getByTestId('guest-library-compact')
  await compact.getByRole('button', { name: 'Next read', exact: true }).scrollIntoViewIfNeeded()
  const heroScroll = await page.evaluate(() => window.scrollY)
  await compact.getByRole('button', { name: 'Next read', exact: true }).click()
  await expect(compact.getByRole('heading', { name: 'Next read' })).toBeFocused()
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - heroScroll)).toBeLessThanOrEqual(1)

  const full = page.getByTestId('guest-library-full')
  await full.getByRole('button', { name: 'Reading journal', exact: true }).scrollIntoViewIfNeeded()
  const showcaseScroll = await page.evaluate(() => window.scrollY)
  await full.getByRole('button', { name: 'Reading journal', exact: true }).click()
  await expect(full.getByRole('heading', { name: 'Reading journal' })).toBeFocused()
  expect(
    Math.abs((await page.evaluate(() => window.scrollY)) - showcaseScroll),
  ).toBeLessThanOrEqual(1)
})
