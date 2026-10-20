import { expect, type Page } from './fixtures'

const statusPaths = ['/api/corpus-sweeps/current', '/api/series-recovery/current'] as const

/** These catalog-review journeys do not start workflows. Match the normal server's disabled
 * status response explicitly when the SPA-only browser server omits Nitro routes. */
export async function stubDisabledWorkflowStatusReads(page: Page) {
  const origin = new URL(page.url()).origin
  const matches = (url: URL) =>
    url.origin === origin && !url.search && statusPaths.some((path) => url.pathname === path)
  await page.route(matches, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    await route.fulfill({ json: { run: null } })
  })

  // Register before Settings mounts, so a fast response cannot evade the assertion.
  const responses = statusPaths.map((path) =>
    page.waitForResponse(
      (response) => response.request().method() === 'GET' && response.url() === `${origin}${path}`,
    ),
  )
  return {
    async expectBothRequested() {
      for (const response of await Promise.all(responses)) {
        expect(response.ok()).toBe(true)
        expect(await response.json()).toEqual({ run: null })
      }
    },
  }
}
