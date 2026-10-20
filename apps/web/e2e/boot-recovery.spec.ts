import { test, expect } from './support/fixtures'

// Match the fresh bundle's application entry, not its shared vendor chunks.
const entryModule = /\/assets\/index-[\w-]+\.js(?:\?.*)?$/

for (const width of [320, 390, 1280]) {
  test(`a failed entry module offers safe app-file recovery at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    // Reproduce the production failure mode: a retired module URL receives the SPA document.
    await page.route(entryModule, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Stale shell</html>' }),
    )
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Midniht couldn’t open.' })).toBeVisible()
    await page.evaluate(async () => {
      localStorage.setItem('recovery-test-preference', 'preserve')
      sessionStorage.setItem('recovery-test-draft', 'preserve')
      const stale = await caches.open('midniht-shell-v3')
      await stale.put('/assets/retired.js', new Response('<html>Stale shell</html>'))
      const other = await caches.open('recovery-test-other')
      await other.put('/keep', new Response('preserve'))
    })
    const recovery = page.getByRole('button', { name: 'Reload app files' })
    const box = await recovery.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    )
    await page.screenshot({ path: test.info().outputPath(`boot-recovery-${width}.png`) })
    await page.unroute(entryModule)
    await Promise.all([page.waitForEvent('load'), recovery.click()])
    await expect(page.getByRole('heading', { name: /The quiet place/ })).toBeVisible()
    const retained = await page.evaluate(async () => ({
      preference: localStorage.getItem('recovery-test-preference'),
      draft: sessionStorage.getItem('recovery-test-draft'),
      caches: await caches.keys(),
    }))
    expect(retained.preference).toBe('preserve')
    expect(retained.draft).toBe('preserve')
    expect(retained.caches).not.toContain('midniht-shell-v3')
    expect(retained.caches).toContain('recovery-test-other')
    await expect(page.getByRole('heading', { name: 'Midniht couldn’t open.' })).toBeHidden()
  })
}
