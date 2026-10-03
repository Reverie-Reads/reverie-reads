import { expect, type Page } from './fixtures'

/** Publication keeps its stated precision in the common Add/Edit fields. */
export async function expectPublicationDate(page: Page, date: string) {
  const [year = '', month = '', day = ''] = date.split('-')
  await expect(page.getByLabel('Pub year', { exact: true })).toHaveValue(year)
  await expect(page.getByLabel('Month', { exact: true })).toHaveValue(month)
  await expect(page.getByLabel('Day', { exact: true })).toHaveValue(day)
}
