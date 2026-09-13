import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './support/fixtures'

for (const width of [390, 1280]) {
  test(`the website guide is complete and readable without an account at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const privateRequests: string[] = []
    page.on('request', (request) => {
      if (/\/rest\/v1\/(profiles|books)(\?|$)/.test(request.url()))
        privateRequests.push(request.url())
    })
    await page.goto('/')
    await page
      .getByRole('navigation', { name: 'Landing sections' })
      .getByRole('link', { name: 'Library guide', exact: true })
      .click()
    await expect(page).toHaveURL(/\/guide$/)
    await expect(
      page.getByRole('heading', { name: 'Your library guide', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('main').getByRole('heading', { level: 2 })).toHaveCount(10)
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toHaveCount(0)
    await page
      .getByRole('navigation', { name: 'Guide chapters' })
      .getByRole('link', { name: 'Know what stays yours' })
      .click()
    await expect(page.getByRole('heading', { name: 'Know what stays yours' })).toBeInViewport()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    expect(privateRequests).toEqual([])
    await page.screenshot({ path: `test-results/public-guide-${width}.png`, fullPage: true })
  })
}
