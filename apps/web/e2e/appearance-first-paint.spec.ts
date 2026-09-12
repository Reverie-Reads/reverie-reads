import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './support/fixtures'
import { authFailure } from './support/authError'
import { localAdminKey } from './support/localSupabase'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYXNlLWRlbW8iLCJyb2xlIjoiYW5vbiIsImV4cCI6MTk4MzgxMjk5Nn0.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const EMAIL = 'appearance-first-paint@reverie.local'
const PASSWORD = 'appearance-first-paint-password'

test('a first sign-in reveals the application only after the saved room is applied', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const admin = createClient(SUPABASE_URL, localAdminKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const listed = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listed.error) throw listed.error
  const stale = listed.data.users.find((user) => user.email === EMAIL)
  if (stale) await ok(admin.auth.admin.deleteUser(stale.id), 'appearance delete stale user')
  const user = await okUser(
    admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
    'appearance createUser',
  )

  try {
    await ok(
      admin.from('profiles').update({ skin: 'aphelion', mode: 'dark' }).eq('id', user.id),
      'appearance profile update',
    )
    const reader = createClient(SUPABASE_URL, ANON, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const auth = await reader.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
    if (auth.error || !auth.data.session)
      throw new Error(authFailure('appearance first paint', EMAIL, auth.error))

    // This is a configured reader arriving on a new device, not a first-use welcome.
    await ok(
      reader.rpc('update_reader_guidance', { p_mode: 'full', p_complete: true }),
      'appearance reader guidance',
    )

    await keepOfflineCacheEmpty(page)
    await page.addInitScript(() => {
      localStorage.removeItem('reverie.skin')
      localStorage.removeItem('reverie.mode')
      Object.assign(window, { __wrongAppearanceReachedShell: false })
      new MutationObserver(() => {
        const shell = document.querySelector('nav[aria-label="Primary"]')
        if (
          shell &&
          (document.documentElement.dataset.skin !== 'aphelion' ||
            document.documentElement.dataset.mode !== 'dark' ||
            document.documentElement.hasAttribute('data-appearance-pending'))
        ) {
          Object.assign(window, { __wrongAppearanceReachedShell: true })
        }
      }).observe(document, { subtree: true, childList: true, attributes: true })
    })

    let releaseProfile!: () => void
    let profileRequested!: () => void
    const requestStarted = new Promise<void>((resolve) => {
      profileRequested = resolve
    })
    const profileGate = new Promise<void>((resolve) => {
      releaseProfile = resolve
    })
    await page.route('**/rest/v1/profiles*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      profileRequested()
      await profileGate
      await route.continue()
    })

    const { access_token, refresh_token } = auth.data.session
    await page.goto(
      `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
    )
    await page.getByRole('button', { name: /enter your library/i }).click()
    await requestStarted

    await expect(page.locator('html')).toHaveAttribute('data-appearance-pending', '')
    await expect(page.locator('html')).toHaveClass(/gold-brand/)
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'light')
    await expect(page.getByRole('status')).toHaveText('Opening your reading room…')
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      'rgb(16, 18, 28)',
    )
    const loadingAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(loadingAxe.violations).toEqual([])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    releaseProfile()
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'aphelion')
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
    await expect(page.locator('html')).not.toHaveAttribute('data-appearance-pending')
    await expect(page.locator('html')).not.toHaveClass(/gold-brand/)
    expect(
      await page.evaluate(
        () =>
          (window as Window & { __wrongAppearanceReachedShell?: boolean })
            .__wrongAppearanceReachedShell,
      ),
    ).toBe(false)

    await page.route('**/rest/v1/profiles*', async (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    })
    await page.evaluate(() => {
      localStorage.removeItem('reverie.skin')
      localStorage.removeItem('reverie.mode')
    })
    await page.reload()

    await expect(page.getByRole('heading', { name: 'Your room is out of reach.' })).toBeVisible({
      timeout: 20_000,
    })
    await expect(page.getByText(/Your library is unchanged/)).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toHaveCount(0)
    const recoveryAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(recoveryAxe.violations).toEqual([])
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.getByRole('button', { name: 'Use default room' }).click()
    await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'tryst')
    await expect(page.locator('html')).not.toHaveAttribute('data-appearance-pending')
    await expect(page.locator('html')).not.toHaveClass(/gold-brand/)
  } finally {
    await admin.auth.admin.deleteUser(user.id)
  }
})
