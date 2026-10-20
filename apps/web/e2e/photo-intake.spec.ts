import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { PNG } from 'pngjs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { okData } from './support/ok'

const endpoint = 'http://127.0.0.1:55321'
// Committed local-stack demo credentials, as in the existing Add recovery regressions.
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const service =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
async function reader(page: Page) {
  const admin = createClient(endpoint, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const client = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `photo-${randomUUID()}@reverie.local`,
    password = 'Photo-local-9843'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No local reader')
  const uid = created.data.user.id
  const configured = await admin
    .from('profiles')
    .update({
      skin: 'tryst',
      mode: 'light',
      guidance: {
        version: 1,
        mode: 'full',
        setupComplete: true,
        milestones: [],
        revealed: [],
        tour: null,
      },
    })
    .eq('id', uid)
  if (configured.error) throw configured.error
  const auth = await client.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No local session')
  await keepOfflineCacheEmpty(page)
  for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${name}**`, (r) => r.fulfill({ json: {} }))
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await page.goto('/add')
  return {
    client,
    uid,
    async cleanup() {
      const result = await admin.auth.admin.deleteUser(uid)
      if (result.error) throw result.error
    },
  }
}
/** Self-authored EAN-13 raster; exercises the packaged decoder, no native detector stub. */
function barcodePhoto() {
  const left = [
    '0001101',
    '0011001',
    '0010011',
    '0111101',
    '0100011',
    '0110001',
    '0101111',
    '0111011',
    '0110111',
    '0001011',
  ]
  const even = [
    '0100111',
    '0110011',
    '0011011',
    '0100001',
    '0011101',
    '0111001',
    '0000101',
    '0010001',
    '0001001',
    '0010111',
  ]
  const parity = 'LGGLGL' // Leading 9 in 9780306406157.
  const digits = '9780306406157'
  const bars =
    '101' +
    digits
      .slice(1, 7)
      .split('')
      .map((d, i) => (parity[i] === 'L' ? left : even)[Number(d)])
      .join('') +
    '01010' +
    digits
      .slice(7)
      .split('')
      .map((d) =>
        left[Number(d)]!.split('')
          .map((v) => (v === '0' ? '1' : '0'))
          .join(''),
      )
      .join('') +
    '101'
  const png = new PNG({ width: 460, height: 240 })
  png.data.fill(255)
  for (let m = 0; m < bars.length; m++)
    if (bars[m] === '1')
      for (let x = 40 + m * 4; x < 44 + m * 4; x++)
        for (let y = 30; y < 210; y++) {
          const i = (y * png.width + x) * 4
          png.data[i] = png.data[i + 1] = png.data[i + 2] = 0
        }
  return PNG.sync.write(png)
}
test('photo pixels stay private through deliberate review and the ordinary confirmed Add', async ({
  page,
}, testInfo) => {
  const account = await reader(page)
  try {
    await page.getByRole('button', { name: 'Review photos · local pilot' }).click()
    await expect(page.getByLabel('Title-page photo')).toBeDisabled()
    await page.getByLabel('I have permission to process these photos locally.').check()
    const uploads: string[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST' && /\/storage\/|\/functions\/v1\/covers/.test(request.url()))
        uploads.push(request.url())
    })
    await page.getByLabel('Title-page photo').setInputFiles({
      name: 'synthetic-barcode.png',
      mimeType: 'image/png',
      buffer: barcodePhoto(),
    })
    await expect(
      page.getByRole('button', { name: 'Use observed ISBN 9780306406157' }),
    ).toBeVisible()
    await expect(page.getByLabel('Reviewed title')).toHaveValue('')
    await page.getByLabel('Reviewed title').fill('Synthetic photo review')
    await page.getByLabel('Whole-work authors, one full name per line').fill('Avery Reader')
    await page.getByRole('button', { name: 'Use observed ISBN 9780306406157' }).click()
    await expect(page.getByRole('button', { name: 'Review in Add', exact: true })).toBeDisabled()
    const before = await account.client.from('books').select('id').eq('owner_id', account.uid)
    if (before.error) throw before.error
    expect(before.data).toHaveLength(0)
    await page.getByLabel(/I inspected the source pixels/).check()
    await expect(page.getByRole('img', { name: 'title source pixels' })).toBeVisible()
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const handoff = page.getByRole('button', { name: 'Review in Add', exact: true })
    await handoff.scrollIntoViewIfNeeded()
    const box = await handoff.boundingBox()
    expect(
      box &&
        box.width >= 44 &&
        box.height >= 44 &&
        box.x >= 0 &&
        box.x + box.width <= page.viewportSize()!.width,
    ).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('photo-review.png'), fullPage: true })
    await page.getByRole('button', { name: 'Review in Add', exact: true }).click()
    await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue(
      'Synthetic photo review',
    )
    await expect(page.getByLabel('Reviewed title')).toBeDisabled()
    await page.locator('[data-book-tour="book-save"]').click()
    await expect(page.getByRole('button', { name: 'Confirm and add', exact: true })).toBeVisible()
    const reviewed = await account.client.from('books').select('id').eq('owner_id', account.uid)
    if (reviewed.error) throw reviewed.error
    expect(reviewed.data).toHaveLength(0)
    await page.getByRole('button', { name: 'Confirm and add', exact: true }).click()
    await expect(
      page.getByRole('heading', { name: 'Your book was saved', exact: true }),
    ).toBeVisible({ timeout: 20_000 })
    const saved = await okData(
      account.client
        .from('books')
        .select(
          'id,title,isbn,ownership,borrowed,wishlist,owned_physical,owned_ebook,owned_audiobook,read_status,copy_inventory,pages,cover_user_chosen',
        )
        .eq('owner_id', account.uid),
      'photo saved book',
    )
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({
      title: 'Synthetic photo review',
      isbn: '9780306406157',
      ownership: 'unowned',
      borrowed: false,
      wishlist: false,
      owned_physical: null,
      owned_ebook: false,
      owned_audiobook: false,
      read_status: 'unset',
      copy_inventory: null,
      pages: null,
      cover_user_chosen: false,
    })
    const reads = await account.client.from('reads').select('id').eq('book_id', saved[0]!.id)
    if (reads.error) throw reads.error
    expect(reads.data).toHaveLength(0)
    expect(uploads).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('photo-saved.png'), fullPage: true })
  } finally {
    await account.cleanup()
  }
})

test('phone photo decoding applies EXIF mirrors and rotation before presenting review pixels', async ({
  page,
}) => {
  const account = await reader(page)
  try {
    await page.getByRole('button', { name: 'Review photos · local pilot' }).click()
    await page.getByLabel('I have permission to process these photos locally.').check()
    const photo = page.getByRole('img', { name: 'cover source pixels' })
    const pixels = () =>
      photo.evaluate((el: HTMLImageElement) => {
        const canvas = document.createElement('canvas')
        canvas.width = el.naturalWidth
        canvas.height = el.naturalHeight
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(el, 0, 0)
        return {
          width: canvas.width,
          height: canvas.height,
          corner: [...ctx.getImageData(30, 30, 1, 1).data],
        }
      })
    await page
      .getByLabel('Cover photo')
      .setInputFiles(
        fileURLToPath(new URL('./fixtures/photo-intake/mirrored.jpg', import.meta.url)),
      )
    await expect(photo).toBeVisible()
    const mirrored = await pixels()
    expect([mirrored.width, mirrored.height]).toEqual([1200, 800])
    expect(mirrored.corner[0]! < 80 && mirrored.corner[1]! > 180 && mirrored.corner[2]! < 80).toBe(
      true,
    )
    await page.getByLabel('Reviewed title').fill('Preserve this draft')
    await page
      .getByLabel('Cover photo')
      .setInputFiles(fileURLToPath(new URL('./fixtures/photo-intake/rotated.jpg', import.meta.url)))
    await expect
      .poll(async () => {
        const p = await pixels()
        return [p.width, p.height]
      })
      .toEqual([800, 1200])
    const rotated = await pixels()
    expect(rotated.corner[0]! < 80 && rotated.corner[1]! < 80 && rotated.corner[2]! > 180).toBe(
      true,
    )
    await expect(page.getByLabel('Reviewed title')).toHaveValue('Preserve this draft')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const rows = await okData(
      account.client.from('books').select('id').eq('owner_id', account.uid),
      'photo preparation remains read-only',
    )
    expect(rows).toHaveLength(0)
  } finally {
    await account.cleanup()
  }
})
