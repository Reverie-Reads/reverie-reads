import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { SKIN_ORDER } from '@reverie/core'
import { expect, test } from './support/fixtures'
import { localAdminKey } from './support/localSupabase'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { configureReturningReader } from './support/readerGuidance'
import { ok } from './support/ok'

const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

test('gallery defers offscreen material work and renders each room when revealed', async ({
  page,
}, testInfo) => {
  // This test reveals every room, not only the initially visible row. Navigation stays at 45s.
  test.setTimeout(90_000)
  const admin = createClient(endpoint, localAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const reader = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `gallery-${randomUUID()}@reverie.local`
  const password = 'Gallery-local-9843'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No local reader')
  const uid = created.data.user.id
  try {
    await ok(
      admin.from('profiles').update({ skin: 'grimoire', mode: 'light' }).eq('id', uid),
      'gallery profile appearance',
    )
    const auth = await reader.auth.signInWithPassword({ email, password })
    if (auth.error || !auth.data.session) throw auth.error ?? new Error('No local session')
    const { access_token, refresh_token } = auth.data.session
    await configureReturningReader(access_token)
    await keepOfflineCacheEmpty(page)
    await page.goto(
      `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
    )
    await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })

    // Keep the original navigation ceiling and load event. No synthetic renderer or font stub.
    await page.goto('/skins', { timeout: 45_000 })
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'grimoire')
    const rooms = page.getByTestId('appearance-room')
    await expect(rooms).toHaveCount(SKIN_ORDER.length)
    const previews = rooms.getByTestId('skin-atmosphere')
    await expect(previews.first()).toHaveAttribute('data-renderer', /Canvas/)
    await expect(rooms.last()).not.toBeInViewport()
    // This fails on the original eager renderer: even the last, far-offscreen card was painted.
    await expect(previews.last()).not.toHaveAttribute('data-renderer')

    const initiallyPainted = await previews.evaluateAll(
      (elements) => elements.filter((element) => element.hasAttribute('data-renderer')).length,
    )
    expect(initiallyPainted).toBeGreaterThan(0)
    expect(initiallyPainted).toBeLessThan(SKIN_ORDER.length)
    const observations = []
    for (let i = 0; i < SKIN_ORDER.length; i++) {
      await rooms.nth(i).scrollIntoViewIfNeeded()
      const canvas = previews.nth(i)
      await expect(canvas).toHaveAttribute('data-renderer', /Canvas/)
      observations.push(
        await canvas.evaluate((element) => {
          if (!(element instanceof HTMLCanvasElement)) throw new Error('Expected room canvas')
          const pixels = (source: HTMLCanvasElement) => {
            const context = source.getContext('2d')
            if (!context) throw new Error('No canvas pixels available for inspection')
            const data = context.getImageData(0, 0, source.width, source.height).data
            const alphas = [0.1, 0.5, 0.9].flatMap((x) =>
              [0.1, 0.5, 0.9].map(
                (y) =>
                  data[
                    (Math.floor(source.height * y) * source.width + Math.floor(source.width * x)) *
                      4 +
                      3
                  ],
              ),
            )
            const colors = new Set<string>()
            // Read the whole raster so sparse stars or grain cannot be missed by a few samples.
            for (let i = 0; i < data.length && colors.size < 2; i += 4)
              if (data[i + 3] === 255) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
            return {
              opaqueSamples: alphas.filter((alpha) => alpha === 255).length,
              distinctColors: colors.size,
            }
          }
          return {
            scene: element.dataset.atmosphere,
            renderer: element.dataset.renderer,
            pixels: Number(element.dataset.materialPixels),
            paintMs: Number(element.dataset.paintMs),
            painted: pixels(element),
            // The same instrument must reject a known empty canvas, regardless of receipts.
            emptyControl: pixels(document.createElement('canvas')),
          }
        }),
      )
    }
    expect(observations.every((entry) => entry.pixels > 0 && entry.pixels <= 900_000)).toBe(true)
    for (const entry of observations) {
      expect(entry.emptyControl).toEqual({ opaqueSamples: 0, distinctColors: 0 })
      expect(entry.painted.opaqueSamples, entry.scene).toBe(9)
      expect(entry.painted.distinctColors, entry.scene).toBeGreaterThan(1)
    }
    await testInfo.attach('gallery-material-observations.json', {
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ initiallyPainted, observations }, null, 2)),
    })
    await page.screenshot({ path: testInfo.outputPath('gallery-revealed.png') })
  } finally {
    await reader.auth.signOut()
    await ok(admin.auth.admin.deleteUser(uid), 'gallery reader cleanup')
  }
})
