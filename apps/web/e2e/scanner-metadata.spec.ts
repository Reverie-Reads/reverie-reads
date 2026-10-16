import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { test, expect } from './support/fixtures'
import { configureReturningReader } from './support/readerGuidance'
import { keepOfflineCacheEmpty } from './support/offlineCache'
const url = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const service =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
test.setTimeout(120_000)
const isbn = '9780306406157'
for (const width of [320, 390]) {
  test(`phone ${width}: large camera decodes real EAN pixels and requires review before saving`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const email = `scanner-${randomUUID()}@reverie.local`
    const password = 'Scanner-fixture-34!'
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
    if (created.error || !created.data.user)
      throw created.error || new Error('Missing fixture user')
    const uid = created.data.user.id
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    try {
      const auth = await client.auth.signInWithPassword({ email, password })
      if (auth.error || !auth.data.session) throw auth.error || new Error('Missing session')
      await configureReturningReader(auth.data.session.access_token)
      await keepOfflineCacheEmpty(page)
      await page.addInitScript(() => {
        const canvas = document.createElement('canvas')
        canvas.width = 720
        canvas.height = 960
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = 'white'
        ctx.fillRect(0, 0, 720, 960)
        const stream = canvas.captureStream(10)
        Object.defineProperty(window, 'BarcodeDetector', { configurable: true, value: undefined })
        Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
          configurable: true,
          value: async () => stream,
        })
        Object.assign(window, { testCameraStream: stream })
        window.addEventListener('show-test-barcode', () => {
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
          const right = left.map((v) => [...v].map((b) => (b === '1' ? '0' : '1')).join(''))
          const parity = 'LGGLGL' // first digit 9
          const value = '9780306406157'
          let bits = '101'
          for (let i = 1; i < 7; i++)
            bits += (parity[i - 1] === 'L' ? left : even)[Number(value[i])]
          bits += '01010'
          for (let i = 7; i < 13; i++) bits += right[Number(value[i])]
          bits += '101'
          ctx.fillStyle = 'black'
          for (let i = 0; i < bits.length; i++)
            if (bits[i] === '1') ctx.fillRect(122 + i * 5, 340, 5, 280)
        })
      })
      const detailRequests: Record<string, unknown>[] = []
      await page.route('**/functions/v1/enrich', (route) => {
        detailRequests.push(route.request().postDataJSON())
        return route.fulfill({
          json: {
            admissionVersion: 2,
            confidence: 'high',
            title: 'The Quiet Observatory',
            authors: ['Alex Example'],
            isbn13: isbn,
            isbn,
            pageCount: 345,
            pubY: 2024,
            pubM: 5,
            pubD: 1,
            genre: 'science fiction',
            genres: ['science fiction'],
            cover: '',
            publisher: 'Example Press',
            language: 'en',
            source: 'hardcover',
            provenance: { isbn13: { source: 'hardcover', at: '2026-10-14' } },
          },
        })
      })
      for (const name of ['embed', 'series', 'covers'])
        await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
      const { access_token, refresh_token } = auth.data.session
      await page.goto(
        `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
      )
      await expect(page.getByRole('button', { name: /enter your library/i })).toBeVisible()
      await page.getByRole('button', { name: /enter your library/i }).click()
      await page.goto('/add')
      await page.getByRole('button', { name: /scan/i }).first().click()
      const dialog = page.getByRole('dialog', { name: 'Scan books' })
      await dialog.getByRole('button', { name: 'Start camera' }).click()
      await expect(dialog.getByRole('button', { name: 'Pause camera' })).toBeVisible()
      const preview = await dialog.locator('video').boundingBox()
      expect(preview!.height).toBeGreaterThan(400)
      expect(preview!.width).toBeGreaterThan(width - 65)
      await page.evaluate(() => window.dispatchEvent(new Event('show-test-barcode')))
      await expect(dialog.getByRole('heading', { name: 'Captured books · 1' })).toBeVisible({
        timeout: 15_000,
      })
      await page.screenshot({ path: test.info().outputPath(`scanner-${width}.png`) })
      await dialog.getByRole('button', { name: 'Pause camera' }).click()
      expect(
        await page.evaluate(() =>
          (window as unknown as { testCameraStream: MediaStream }).testCameraStream
            .getTracks()
            .every((t) => t.readyState === 'ended'),
        ),
      ).toBe(true)
      const readRows = async () => {
        const r = await client
          .from('books')
          .select('id,title,isbn,pages,pub_y,pub_m,pub_d')
          .eq('owner_id', uid)
        if (r.error) throw r.error
        return r.data
      }
      expect(await readRows()).toEqual([])
      await dialog.getByRole('button', { name: `Review capture 1: ${isbn}` }).click()
      await page.getByRole('button', { name: /The Quiet Observatory/ }).click()
      await expect(page.getByRole('button', { name: '🔎 Fetch details' })).toBeVisible()
      await expect.poll(() => detailRequests.length).toBeGreaterThanOrEqual(2)
      await page.getByRole('button', { name: 'Review book', exact: true }).click()
      await expect(page.getByRole('dialog', { name: /Review/i })).toBeVisible()
      expect(await readRows()).toEqual([])
      await page
        .getByRole('button', { name: /Confirm.*add|Add book/i })
        .last()
        .click()
      await expect.poll(readRows).toEqual([
        expect.objectContaining({
          title: 'The Quiet Observatory',
          isbn,
          pages: 345,
          pub_y: 2024,
          pub_m: 5,
          pub_d: 1,
        }),
      ])
    } finally {
      const deleted = await admin.auth.admin.deleteUser(uid)
      expect(deleted.error).toBeNull()
    }
  })
}
