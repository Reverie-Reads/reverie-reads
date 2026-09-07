import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { PNG } from 'pngjs'
import { SKIN_LIST } from '@reverie/core'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const OLD = 'https://books.google.com/books/content?id=reviewOld&img=1&zoom=1'
const NEXT = 'https://books.google.com/books/content?id=reviewNew&img=1&zoom=1'

function png(width: number, height: number) {
  const image = new PNG({ width, height })
  for (let i = 0; i < image.data.length; i += 4) {
    image.data[i] = 80
    image.data[i + 1] = 95
    image.data[i + 2] = 110
    image.data[i + 3] = 255
  }
  return PNG.sync.write(image)
}
const small = png(128, 192)
const large = png(800, 1200)

async function setup(page: Page, isAdmin = true, broken = false) {
  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `cover-review-${randomUUID()}@reverie.local`
  const password = 'CoverReview-Local-9362'
  const user = await okUser(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'cover review user',
  )
  if (isAdmin)
    await ok(admin.from('corpus_admins').insert({ user_id: user.id }), 'cover review grant')
  const workId = randomUUID()
  const title = `Cover review ${workId.slice(0, 8)}`
  await ok(
    admin.from('works').insert({
      id: workId,
      work_key: `${title.toLowerCase()}|test writer`,
      title,
      author_text: 'Test Writer',
      contributors: [{ name: 'Test Writer', role: 'author' }],
      cover_url: OLD,
      cover_source: 'google',
    }),
    'cover review work',
  )
  const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const auth = await sb.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No local session')
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  await page.route('https://books.google.com/**', async (route) => {
    if (route.request().resourceType() !== 'image') return route.fallback()
    if (broken) return route.fulfill({ status: 404, body: '' })
    return route.fulfill({
      contentType: 'image/png',
      body: route.request().url().includes('reviewNew') ? large : small,
    })
  })
  await page.route('**/functions/v1/covers**', (route) =>
    route.fulfill({
      json: {
        editions: [
          {
            source: 'google',
            title,
            cover: NEXT,
            isbn13: '9780306406157',
            format: 'Paperback',
            year: 2025,
          },
        ],
      },
    }),
  )
  const { access_token, refresh_token } = auth.data.session
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20000 })
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
  return {
    admin,
    sb,
    user,
    workId,
    title,
    cleanup: async () => {
      await ok(
        admin.from('corpus_cover_review_events').delete().eq('work_id', workId),
        'review events cleanup',
      )
      await ok(
        admin.from('work_metadata_edits').delete().eq('work_id', workId),
        'work edits cleanup',
      )
      await ok(
        admin.from('books').delete().eq('corpus_work_id', workId),
        'personal fixture cleanup',
      )
      await ok(admin.from('works').delete().eq('id', workId), 'review work cleanup')
      const result = await admin.auth.admin.deleteUser(user.id)
      if (result.error) throw result.error
    },
  }
}

test('an administrator compares and saves a shared cover without altering their personal copy', async ({
  page,
}) => {
  test.setTimeout(120000)
  const c = await setup(page)
  try {
    const personalId = randomUUID()
    await ok(
      c.admin.from('books').insert({
        id: personalId,
        owner_id: c.user.id,
        corpus_work_id: c.workId,
        title: c.title,
        authors_display: 'Test Writer',
        cover_url: OLD,
        cover_source: 'google',
        cover_user_chosen: true,
        ownership: 'owned',
      }),
      'personal fixture',
    )
    const before = await ok(
      c.admin.from('books').select('*').eq('id', personalId).single(),
      'personal baseline',
    )
    await page.goto('/settings')
    await page.getByRole('link', { name: 'Review catalog covers' }).click()
    await page.getByLabel('Find a catalog book').fill(c.title)
    await page.getByRole('button', { name: 'Search catalog' }).click()
    await page
      .getByRole('list', { name: 'Catalog cover review queue' })
      .getByRole('link', { name: new RegExp(c.title) })
      .click()
    await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
    await expect(page.getByRole('figure').getByText('May look soft', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve current cover' })).toBeDisabled()
    await page.getByText('Find an alternative cover', { exact: true }).click()
    await page.getByRole('button', { name: 'Look for covers' }).click()
    await page.getByRole('button', { name: /Sharp in detail/ }).click()
    await expect(page.getByText('Your proposed cover', { exact: true })).toBeVisible()
    await page.getByRole('checkbox', { name: /I checked that this artwork/ }).check()
    await page.getByLabel('Review note').fill('Checked the title, author and edition on the cover.')
    await page.getByRole('button', { name: 'Approve replacement' }).click()
    await expect(page.getByRole('status')).toContainText('Shared cover replaced')
    const saved = await ok(
      c.admin.from('works').select('cover_url').eq('id', c.workId).single(),
      'saved shared cover',
    )
    expect(saved.cover_url).toContain('reviewNew')
    expect(
      await ok(
        c.admin.from('books').select('*').eq('id', personalId).single(),
        'unchanged personal copy',
      ),
    ).toEqual(before)
    await page.reload()
    await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
    await page.getByText('Review history', { exact: true }).click()
    await expect(page.getByText('Shared cover replaced ·')).toBeVisible()
    await expect(
      page
        .getByRole('group', { name: 'Review history' })
        .getByText('Checked the title, author and edition on the cover.', { exact: true }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Back to review queue' }).click()
    await expect(
      page.getByRole('list', { name: 'Catalog cover review queue' }).getByRole('link'),
    ).toHaveCount(0)
    await page.getByLabel('Review queue', { exact: true }).selectOption('approved')
    await expect(
      page
        .getByRole('list', { name: 'Catalog cover review queue' })
        .getByRole('link', { name: new RegExp(c.title) }),
    ).toBeVisible()
  } finally {
    await c.cleanup()
  }
})

test('stale decisions fail visibly and a broken image cannot be approved', async ({ page }) => {
  test.setTimeout(90000)
  const c = await setup(page, true, true)
  try {
    await page.goto(`/catalog/covers?work=${c.workId}`)
    await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
    await expect(
      page.getByRole('figure').getByText('Image unavailable', { exact: true }),
    ).toBeVisible()
    await page.getByRole('checkbox', { name: /I checked that this artwork/ }).check()
    await expect(page.getByRole('button', { name: 'Approve current cover' })).toBeDisabled()
    await ok(
      c.admin.from('works').update({ author_text: 'Another Writer' }).eq('id', c.workId),
      'concurrent work edit',
    )
    await expect(page.getByRole('button', { name: 'Flag for review' })).toBeDisabled()
    await page.getByLabel('What needs attention?').selectOption('identity')
    await page.getByRole('button', { name: 'Flag for review' }).click()
    await expect(
      page.getByRole('alert').filter({ hasText: 'This catalog record or review changed.' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Refresh this record' }).click()
    await expect(page.getByText('Another Writer', { exact: true })).toBeVisible()
    await page.getByLabel('What needs attention?').selectOption('broken')
    await page.getByRole('button', { name: 'Set aside for later' }).click()
    await expect(page.getByRole('status')).toContainText('Set aside for later')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Return to review' })).toBeVisible()
    await page.getByRole('button', { name: 'Return to review' }).click()
    await expect(page.getByRole('status')).toContainText('Returned to review')
  } finally {
    await c.cleanup()
  }
})

test('ordinary readers cannot open the administrator workspace', async ({ page }) => {
  const c = await setup(page, false)
  try {
    await page.goto('/catalog/covers')
    await expect(
      page.getByText('This workspace is available to catalog administrators.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search catalog' })).toHaveCount(0)
  } finally {
    await c.cleanup()
  }
})

test('the comparison and writing controls remain usable in all nine rooms on a phone', async ({
  page,
}) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 390, height: 844 })
  const c = await setup(page)
  try {
    await page.goto(`/catalog/covers?work=${c.workId}`)
    await expect(page.getByRole('heading', { name: c.title, exact: true })).toBeVisible()
    for (const skin of SKIN_LIST)
      for (const mode of ['light', 'dark']) {
        await page.evaluate(
          ({ skin, mode }) => {
            document.documentElement.dataset.skin = skin
            document.documentElement.dataset.mode = mode
          },
          { skin: skin.id, mode },
        )
        await expect(page.locator('html')).toHaveAttribute('data-skin', skin.id)
        const violations = await new AxeBuilder({ page })
          .include('main')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze()
        expect(violations.violations, `${skin.id} ${mode}`).toEqual([])
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${skin.id} ${mode} overflow`,
        ).toBe(true)
        const field = page.getByLabel('Review note')
        await expect(field).toBeVisible()
        expect(
          await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
        ).toBeGreaterThanOrEqual(16)
      }
  } finally {
    await c.cleanup()
  }
})
