import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const LOCAL_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function setup(page: Page) {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `arrangements-${randomUUID()}@reverie.local`
  const password = 'Arrangements-Local-9362'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No test user')
  const uid = created.data.user.id
  const sb = createClient(SUPABASE_URL, LOCAL_ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await sb.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No test session')
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 })
  return {
    admin,
    sb,
    uid,
    cleanup: async () => {
      const result = await admin.auth.admin.deleteUser(uid)
      if (result.error) throw result.error
    },
  }
}

test('an arrangement follows the account into navigation and Home', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 390, height: 844 })
  const c = await setup(page)
  try {
    await page.goto('/settings')
    await page.getByRole('button', { name: /Remember my reading/ }).click()
    await page.getByRole('button', { name: 'Save arrangement' }).click()
    await expect(page.getByRole('status')).toContainText('Arrangement saved')

    await expect
      .poll(async () => {
        const result = await c.sb.from('profiles').select('arrangement').eq('id', c.uid).single()
        if (result.error) throw result.error
        return result.data.arrangement
      })
      .toEqual({
        version: 1,
        priorityDestinations: ['home', 'library', 'stats'],
        homeModules: ['reading', 'year', 'priority'],
      })

    await page.reload()
    await expect(page.getByRole('button', { name: /Remember my reading/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Library' })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Stats' })).toBeVisible()
    await nav.getByRole('button', { name: 'More' }).click()
    await expect(page.getByRole('link', { name: 'Next read' })).toBeVisible()

    const year = new Date().getFullYear()
    const goal = await c.sb
      .from('profiles')
      .update({ goal_year: year, goal_target: 12 })
      .eq('id', c.uid)
    if (goal.error) throw goal.error
    await page.goto('/')
    await page.reload()
    await expect(page.locator('[data-home-module]')).toHaveCount(3)
    // Both the default and saved arrangements contain three modules. Wait for identity,
    // not just count, while account preferences hydrate after a full reload.
    await expect
      .poll(() =>
        page
          .locator('[data-home-module]')
          .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-home-module'))),
      )
      .toEqual(['reading', 'year', 'priority'])
  } finally {
    await c.cleanup()
  }
})
