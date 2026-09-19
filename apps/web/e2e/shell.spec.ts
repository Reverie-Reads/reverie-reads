import { expect, test } from './support/fixtures'

// The signed-out front door is the Midniht brand landing + a password/social auth screen
// (the magic-link screen is gone). The a11y sweep's seeded signInWithPassword exercises the same
// password path these screens use.

test('signed-out landing shows the personal-library front door', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'The quiet place your stories return to.' }),
  ).toBeVisible()
  await expect(
    page.locator('#midniht-content').getByRole('link', { name: 'Start your library' }),
  ).toBeVisible()
})

// Reverie's Newsreader display face belongs to the brand; the sample rooms keep their own fonts.
// The mechanism (served vs. dead stylesheet, both directions) is covered once in e2e/fonts.spec.ts;
// the all-nine-skins matrix lives in src/skin/fontConfig.test.ts.
test('the landing asks for Newsreader and applies it to the display face', async ({ page }) => {
  await page.goto('/')
  const heading = page.getByTestId('landing-display-heading')
  await expect(heading).toBeVisible()

  // The brand stylesheet is loaded independently of the active room.
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="stylesheet"]')].map(
      (l) => l.getAttribute('href') ?? '',
    ),
  )
  expect(hrefs).toContain('/fonts/brand.css')

  // …whose @font-face rules the browser parsed into registered Newsreader faces.
  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready)
  const families = await page.evaluate(() =>
    [...(document as Document & { fonts: FontFaceSet }).fonts].map((f) => f.family),
  )
  expect(families).toContain('Newsreader')

  // Applied: the display element resolves to a stack led by Newsreader, with a real generic behind
  // it — so a missing font file degrades to system serif rather than to nothing.
  const stack = await heading.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(stack).toContain('Newsreader')
  expect(stack.toLowerCase()).toMatch(/serif/)
})

test('auth screen offers password + social, and toggles sign-in / sign-up', async ({ page }) => {
  await page.goto('/auth')
  // Log in (default) — password is the functional path.
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
  // Social present (inert until the provider apps are provisioned).
  await expect(page.getByRole('button', { name: 'Google' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apple' })).toBeVisible()
  // Toggle to sign-up.
  await page.getByRole('button', { name: 'Create an account' }).click()
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible()
})
