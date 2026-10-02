import { devices, type Locator } from '@playwright/test'
import { expect, test } from './support/fixtures'

// WebKit does not reproduce a physical notch or native Safari chrome. These explicit
// safe-area values exercise the CSS contract; native installation remains a device check.
const screens = [
  { name: 'small iPhone', width: 320, height: 568, top: 0, right: 0, bottom: 0, left: 0 },
  { name: 'notched iPhone', width: 390, height: 844, top: 47, right: 0, bottom: 34, left: 0 },
  { name: 'island iPhone', width: 393, height: 852, top: 59, right: 0, bottom: 34, left: 0 },
  { name: 'landscape iPhone', width: 844, height: 390, top: 0, right: 47, bottom: 21, left: 47 },
  { name: 'iPad', width: 820, height: 1180, top: 24, right: 0, bottom: 20, left: 0 },
] as const

for (const screen of screens) {
  test.describe(screen.name, () => {
    const device = screen.name === 'iPad' ? devices['iPad (gen 7)'] : devices['iPhone 13']
    test.use({
      // The project owns the WebKit worker; only context options vary by device here.
      userAgent: device.userAgent,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      viewport: { width: screen.width, height: screen.height },
      reducedMotion: 'reduce',
    })
    test('keeps the app, beard choices and dialog actions within simulated safe areas', async ({
      page,
    }) => {
      await page.goto('/lab/reading-mode')
      await page.addStyleTag({
        content: `:root { --safe-top: ${screen.top}px; --safe-right: ${screen.right}px; --safe-bottom: ${screen.bottom}px; --safe-left: ${screen.left}px; }`,
      })
      const inSafeArea = async (control: Locator) => {
        await expect(control).toBeVisible()
        const box = await control.boundingBox()
        expect(box).not.toBeNull()
        expect(box!.x).toBeGreaterThanOrEqual(screen.left)
        expect(box!.x + box!.width).toBeLessThanOrEqual(screen.width - screen.right + 1)
        expect(box!.y).toBeGreaterThanOrEqual(screen.top)
        expect(box!.y + box!.height).toBeLessThanOrEqual(screen.height - screen.bottom + 1)
      }
      const dock = page.getByRole('navigation', { name: 'Primary' })
      await inSafeArea(dock.getByRole('link', { name: 'Home', exact: true }))
      await inSafeArea(dock.getByRole('button', { name: 'More', exact: true }))
      const beard = page.getByRole('button', { name: 'Choose your beard', exact: true })
      await beard.click()
      const dialog = page.getByRole('dialog', { name: 'Choose your beard', exact: true })
      await inSafeArea(dialog.getByRole('button', { name: 'Close', exact: true }))
      await dialog.getByText('Braided', { exact: true }).click()
      await dialog.getByText('Rainbow', { exact: true }).click()
      const rainbow = dialog.getByText('Rainbow', { exact: true })
      await inSafeArea(rainbow)
      await inSafeArea(dialog.getByRole('button', { name: 'Use this beard', exact: true }))
      await page.screenshot({ path: `test-results/beard-${screen.name.replaceAll(' ', '-')}.png` })
      await dialog.getByRole('button', { name: 'Use this beard', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      await expect(beard.locator('svg')).toHaveAttribute('data-beard-color', 'rainbow')
      await expect(beard.locator('svg')).toHaveAttribute('data-beard-style', 'braided')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await dock.getByRole('button', { name: 'More', exact: true }).click()
      const more = page.getByRole('dialog', { name: 'More tools', exact: true })
      await inSafeArea(more.getByRole('button', { name: 'Close', exact: true }))
      await more.getByRole('link', { name: 'Settings', exact: true }).scrollIntoViewIfNeeded()
      await inSafeArea(more.getByRole('link', { name: 'Settings', exact: true }))
    })
  })
}

test('offers Safari installation steps and omits the invitation in simulated installed mode', async ({
  page,
}) => {
  await page.goto('/lab/reading-mode')
  await page.getByRole('button', { name: 'Preview first welcome', exact: true }).click()
  const help = page.getByText('Add Midniht to your Home Screen', { exact: true })
  await expect(page.getByText('Open this website in Safari.', { exact: true })).toBeHidden()
  await help.click()
  await expect(page.getByRole('radio', { name: 'iPhone or iPad', exact: true })).toBeChecked()
  await expect(page.getByText('Open this website in Safari.', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/Scroll the share options and choose Add to Home Screen/),
  ).toBeVisible()
  await page.getByRole('radio', { name: 'Android', exact: true }).check()
  await expect(page.getByText('Open this website in Chrome.', { exact: true })).toBeVisible()
  // This models the iOS navigator signal; it cannot install the site or operate Safari's UI.
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }))
  await page.reload()
  await page.getByRole('button', { name: 'Preview first welcome', exact: true }).click()
  await expect(help).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
})
