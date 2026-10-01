import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { test, expect, type Page } from './support/fixtures'
import { configureReturningReader } from './support/readerGuidance'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const service =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const reader = {
  version: 1,
  enabledProducts: ['reader'],
  activeProduct: 'reader',
  initialChoiceComplete: true,
  presentation: {},
}
const collector = {
  ...reader,
  enabledProducts: ['collector'],
  activeProduct: 'collector',
  presentation: { collector: { version: 8, layout: ['locations'] } },
}

async function account(page: Page) {
  const admin = createClient(endpoint, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `product-entry-${randomUUID()}@reverie.local`
  const password = 'Product-entry-local-test-123!'
  const user = await okUser(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'entry user',
  )
  const sb = createClient(endpoint, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const signed = await sb.auth.signInWithPassword({ email, password })
  if (signed.error || !signed.data.session) throw signed.error ?? new Error('No entry session')
  const session = signed.data.session
  await configureReturningReader(session.access_token)
  await ok(
    sb.from('profiles').update({ skin: 'aphelion', mode: 'dark' }).eq('id', user.id),
    'entry appearance',
  )
  const row = async () =>
    await ok(
      sb
        .from('profiles')
        .select(
          'product_preferences, product_preferences_revision, skin, mode, guidance, arrangement',
        )
        .eq('id', user.id)
        .single(),
      'entry readback',
    )
  const save = async (document: unknown, revision: number) =>
    await ok(
      sb.rpc('save_product_preferences', {
        p_owner_id: user.id,
        p_expected_revision: revision,
        p_document: document,
      }),
      'entry preference',
    )
  await keepOfflineCacheEmpty(page)
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
  return {
    row,
    save,
    cleanup: async () => {
      await ok(admin.auth.admin.deleteUser(user.id), 'entry cleanup')
    },
  }
}

for (const width of [390, 1280]) {
  test(`explicit Reader choice saves once and preserves the existing room at ${width}px`, async ({
    page,
  }, info) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width, height: 900 })
    const c = await account(page)
    try {
      const before = await c.row()
      await page.goto('/settings')
      await page.getByRole('link', { name: 'Choose your experience' }).click()
      await expect(page.getByRole('button', { name: 'Use Reader', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: /collector/i })).toHaveCount(0)
      expect((await c.row()).product_preferences).toBeNull()
      const violations = (await new AxeBuilder({ page }).analyze()).violations
      expect(violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.screenshot({ path: info.outputPath(`entry-${width}.png`), fullPage: true })
      await page.getByRole('button', { name: 'Use Reader', exact: true }).click()
      await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
      const after = await c.row()
      expect(after).toEqual({
        ...before,
        product_preferences: reader,
        product_preferences_revision: 1,
      })
      await page.goto('/start')
      await page.getByRole('button', { name: 'Open Reader', exact: true }).click()
      await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
      expect(await c.row()).toEqual(after)
    } finally {
      await c.cleanup()
    }
  })
}

test('unavailable Collector opens Reader without overwriting the saved choice', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const c = await account(page)
  try {
    await c.save(collector, 0)
    const before = await c.row()
    await page.goto('/start')
    await expect(page.getByText(/Collector experience isn’t available/)).toBeVisible()
    await page.getByRole('button', { name: 'Open Reader for now' }).click()
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
    expect(await c.row()).toEqual(before)
    await page.goto('/start')
    await page.getByRole('button', { name: 'Use Reader', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
    expect((await c.row()).product_preferences).toEqual({
      ...collector,
      enabledProducts: ['collector', 'reader'],
      activeProduct: 'reader',
    })
  } finally {
    await c.cleanup()
  }
})

test('a lost successful response retries the same choice without another revision', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const c = await account(page)
  try {
    await page.goto('/start')
    await page.route(
      '**/rest/v1/rpc/save_product_preferences',
      async (route) => {
        const response = await route.fetch()
        expect(response.ok()).toBe(true)
        await route.fulfill({ status: 503, body: 'Simulated response loss' })
      },
      { times: 1 },
    )
    await page.getByRole('button', { name: 'Use Reader', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('couldn’t confirm')
    expect((await c.row()).product_preferences_revision).toBe(1)
    await page.getByRole('button', { name: 'Use Reader', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
    expect((await c.row()).product_preferences_revision).toBe(1)
  } finally {
    await c.cleanup()
  }
})

test('a concurrent differing choice needs an explicit reload and decision', async ({ page }) => {
  test.setTimeout(90_000)
  const c = await account(page)
  try {
    await page.goto('/start')
    await expect(page.getByRole('button', { name: 'Use Reader', exact: true })).toBeVisible()
    await c.save(collector, 0)
    await page.getByRole('button', { name: 'Use Reader', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('changed in another window')
    expect((await c.row()).product_preferences).toEqual(collector)
    await page.getByRole('button', { name: 'Load current choices' }).click()
    await expect(page.getByText(/Collector experience isn’t available/)).toBeVisible()
    expect((await c.row()).product_preferences_revision).toBe(1)
    await page.getByRole('button', { name: 'Use Reader', exact: true }).click()
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
    expect((await c.row()).product_preferences_revision).toBe(2)
  } finally {
    await c.cleanup()
  }
})
