import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from './support/fixtures'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'indie-bookstores-e2e@reverie.local'
const PASSWORD = 'indie-bookstores-e2e-password'

test.describe.configure({ mode: 'serial' })

async function session() {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((user) => user.email === EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'indie-bookstores createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Indie E2E', skin: 'almanac', mode: 'light' }),
    'indie-bookstores profile',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: signedIn, error } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  })
  if (error || !signedIn.session) throw new Error(authFailure('indie-bookstores', EMAIL, error))
  return signedIn.session
}

async function signIn(page: Page) {
  const signedIn = await session()
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  await page.goto(
    `/#access_token=${signedIn.access_token}&refresh_token=${signedIn.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

test('place search returns a useful list before the optional map and can expand its radius', async ({
  page,
}) => {
  const radii: number[] = []
  await page.route('**/api/bookstores?*', async (route) => {
    radii.push(Number(new URL(route.request().url()).searchParams.get('radius')))
    return route.fulfill({
      json: {
        payload: {
          elements: [
            {
              type: 'node',
              id: 1,
              lat: 44.274,
              lon: -121.176,
              tags: {
                name: 'Juniper Books',
                website: 'juniper-books.example',
                opening_hours: 'Mo-Sa 10:00-18:00',
              },
            },
            {
              type: 'node',
              id: 2,
              lat: 44.28,
              lon: -121.18,
              tags: { name: 'Barnes & Noble' },
            },
          ],
        },
        source: 'web',
      },
    })
  })
  await page.route('**/functions/v1/geo', async (route) => {
    const input = route.request().postDataJSON() as { op: string; radius?: number }
    if (input.op === 'geocode') {
      return route.fulfill({
        json: {
          payload: [{ lat: '44.2726', lon: '-121.1739', display_name: 'Redmond, Oregon' }],
          source: 'cache',
        },
      })
    }
    throw new Error(`Unexpected geo operation: ${input.op}`)
  })

  await signIn(page)
  await page.goto('/indie')
  await page.getByLabel('ZIP code, city, or neighborhood').fill('Redmond, Oregon')
  await page.getByRole('button', { name: 'Find', exact: true }).click()

  await expect(page.getByText('Near Redmond, Oregon')).toBeVisible()
  await expect(page.getByText('Juniper Books', { exact: true })).toBeVisible()
  await expect(page.getByText('Barnes & Noble', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('region', { name: 'Map of nearby independent bookstores' }),
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Website ↗' })).toHaveAttribute(
    'href',
    'https://juniper-books.example/',
  )
  await expect(page.getByRole('link', { name: 'Directions ↗' })).toHaveAttribute(
    'href',
    /openstreetmap\.org\/directions/,
  )
  expect(radii).toEqual([40000])

  await page.getByRole('button', { name: 'Show map' }).click()
  await expect(
    page.getByRole('region', { name: 'Map of nearby independent bookstores' }),
  ).toBeVisible()
  await page.getByRole('button', { name: '50 miles' }).click()
  await expect.poll(() => radii).toEqual([40000, 80000])
})

test('the Edge directory cache carries a web route outage', async ({ page }) => {
  await page.route('**/api/bookstores?*', (route) =>
    route.fulfill({ status: 502, json: { statusMessage: 'Bookstore directory unavailable' } }),
  )
  await page.route('**/functions/v1/geo', async (route) => {
    const input = route.request().postDataJSON() as { op: string }
    if (input.op === 'geocode') {
      return route.fulfill({
        json: { payload: [{ lat: '44.2726', lon: '-121.1739', display_name: 'Redmond, Oregon' }] },
      })
    }
    return route.fulfill({
      json: {
        payload: {
          elements: [
            {
              type: 'node',
              id: 3,
              lat: 44.274,
              lon: -121.176,
              tags: { name: 'Cached Juniper Books' },
            },
          ],
        },
        source: 'cache',
      },
    })
  })

  await signIn(page)
  await page.goto('/indie')
  await page.getByLabel('ZIP code, city, or neighborhood').fill('Redmond, Oregon')
  await page.getByRole('button', { name: 'Find', exact: true }).click()
  await expect(page.getByText('Cached Juniper Books', { exact: true })).toBeVisible()
})

test('directory failure keeps the location and offers a working retry', async ({ page }) => {
  let storeAttempts = 0
  await page.route('**/api/bookstores?*', (route) =>
    route.fulfill({ status: 502, json: { statusMessage: 'Bookstore directory unavailable' } }),
  )
  await page.route('**/functions/v1/geo', async (route) => {
    const input = route.request().postDataJSON() as { op: string }
    if (input.op === 'geocode') {
      return route.fulfill({
        json: { payload: [{ lat: '44.2726', lon: '-121.1739', display_name: 'Redmond, Oregon' }] },
      })
    }
    storeAttempts += 1
    if (storeAttempts === 1)
      return route.fulfill({
        // Exercise the application envelope guard directly. The Supabase SDK wraps non-2xx
        // Edge responses as FunctionsHttpError before their payload reaches application code.
        status: 200,
        json: { error: 'location provider unavailable', payload: null },
      })
    return route.fulfill({ json: { payload: { elements: [] }, source: 'live' } })
  })

  await signIn(page)
  await page.goto('/indie')
  await page.getByLabel('ZIP code, city, or neighborhood').fill('Redmond, Oregon')
  await page.getByRole('button', { name: 'Find', exact: true }).click()
  await expect(page.getByText(/directory couldn’t answer/i)).toBeVisible()
  await expect(page.getByText('Near Redmond, Oregon')).toBeVisible()
  await page.getByRole('button', { name: 'Try the directory again' }).click()
  await expect(page.getByText(/No independent bookstores were listed within/)).toBeVisible()
  expect(storeAttempts).toBe(2)
})

test('the persistent add glyph is geometrically centered in Marginalia and Almanac', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page)
  const add = page.locator('[data-testid="persistent-add"]:visible')
  for (const skin of ['folio', 'almanac']) {
    await page.evaluate((nextSkin) => {
      document.documentElement.dataset.skin = nextSkin
    }, skin)
    const geometry = await add.evaluate((button) => {
      const glyph = button.querySelector('svg')
      if (!glyph) return null
      const outer = button.getBoundingClientRect()
      const inner = glyph.getBoundingClientRect()
      return {
        x: Math.abs(outer.left + outer.width / 2 - (inner.left + inner.width / 2)),
        y: Math.abs(outer.top + outer.height / 2 - (inner.top + inner.height / 2)),
      }
    })
    expect(geometry, skin).not.toBeNull()
    expect(geometry!.x, skin).toBeLessThan(0.5)
    expect(geometry!.y, skin).toBeLessThan(0.5)
  }
})
