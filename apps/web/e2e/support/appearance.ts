import type { SkinId } from '@reverie/core'
import { expect, type Page } from './fixtures'

export async function setTestAppearance(page: Page, skin: SkinId, mode: 'light' | 'dark') {
  await page.evaluate(
    async ({ skin, mode }) => {
      const path = '/assets/test-appearance.js'
      const { setAppearance } = await import(path)
      await setAppearance(skin, mode)
    },
    { skin, mode },
  )
  await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
  await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
}
