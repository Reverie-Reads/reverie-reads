import { createClient } from '@supabase/supabase-js'
import { expect, test, type Locator, type Page } from './support/fixtures'
import { configureReturningReader } from './support/readerGuidance'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { localAdminKey } from './support/localSupabase'
import { ok, okData, okUser } from './support/ok'

const URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const PASSWORD = 'long-title-workflows-local-only'
const UNBROKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(4)
const TITLES = [
  'It',
  'A Thoroughly Unreasonable and Deliberately Overlong Title That Will Not Wrap Politely',
  UNBROKEN,
  '星のない夜に長い物語を読みながら帰り道を探している図書館の記録',
  'حكايات المكتبة البعيدة والرحلة الطويلة للبحث عن كتاب ضائع في المدينة',
  'L’Étrange bibliothèque — À la recherche des histoires oubliées à São Tomé',
]
const admin = createClient(URL, localAdminKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
})
let uid = ''
let memberId = ''
let email = ''
let household = ''
let session: { access_token: string; refresh_token: string }
let books: { id: string; title: string }[] = []

test.beforeAll(async ({ browserName }, info) => {
  email = `long-title-workflows-${browserName}-${info.project.name}@reverie.local`
  const listed = await okData(
    admin.auth.admin.listUsers({ perPage: 1000 }),
    'long titles list users',
  )
  const old = listed.users.find((user) => user.email === email)
  if (old) await ok(admin.auth.admin.deleteUser(old.id), 'long titles old fixture cleanup')
  uid = (
    await okUser(
      admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true }),
      'long titles create user',
    )
  ).id
  await ok(
    admin.from('profiles').update({ skin: 'folio', mode: 'light' }).eq('id', uid),
    'long titles room',
  )
  const reader = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await okData(
    reader.auth.signInWithPassword({ email, password: PASSWORD }),
    'long titles sign in',
  )
  if (!auth.session) throw new Error('long titles session missing')
  session = auth.session
  await configureReturningReader(session.access_token)
  const memberEmail = `long-title-workflows-member-${info.project.name}@reverie.local`
  const oldMember = listed.users.find((user) => user.email === memberEmail)
  if (oldMember)
    await ok(admin.auth.admin.deleteUser(oldMember.id), 'long titles old member cleanup')
  memberId = (
    await okUser(
      admin.auth.admin.createUser({ email: memberEmail, password: PASSWORD, email_confirm: true }),
      'long titles create member',
    )
  ).id
  household = await okData(
    admin.rpc('link_household', {
      p_name: 'Long title readers',
      p_owner: uid,
      p_members: [memberId],
    }),
    'long titles household',
  )
  books = await okData(
    reader
      .from('books')
      .insert(
        TITLES.map((title) => ({
          owner_id: uid,
          title,
          author_first: 'Wilhelmina',
          author_last: 'FeatherstonehaughMarchbanks'.repeat(3),
          status: 'standalone',
          ownership: 'owned',
          genre: 'literary',
        })),
      )
      .select('id,title'),
    'long titles books',
  )
  await ok(
    reader.from('lists').insert({ owner_id: uid, name: UNBROKEN, kind: 'collection' }),
    'long titles shelf',
  )
})

test.afterAll(async () => {
  if (household)
    await ok(admin.from('households').delete().eq('id', household), 'long titles household cleanup')
  if (uid) await ok(admin.auth.admin.deleteUser(uid), 'long titles account cleanup')
  if (memberId) await ok(admin.auth.admin.deleteUser(memberId), 'long titles member cleanup')
})

async function signIn(page: Page) {
  await keepOfflineCacheEmpty(page)
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click()
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible()
}

async function fits(element: Locator) {
  await expect(element).toBeVisible({ timeout: 20_000 })
  const m = await element.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const p = el.closest('.skin-panel, .rv-modal')?.getBoundingClientRect()
    return {
      left: r.left,
      right: r.right,
      content: el.scrollWidth,
      width: el.clientWidth,
      min: Math.max(0, p?.left ?? 0),
      max: Math.min(
        document.documentElement.clientWidth,
        p?.right ?? document.documentElement.clientWidth,
      ),
    }
  })
  expect(m.left).toBeGreaterThanOrEqual(m.min - 1)
  expect(m.right).toBeLessThanOrEqual(m.max + 1)
  expect(m.content).toBeLessThanOrEqual(m.width + 1)
}

test('an account-service failure keeps the credentials and a deliberate retry opens the library', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByTestId('room-example').first().waitFor()
  await page.getByRole('link', { name: 'Return to your library', exact: true }).click()
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email)
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(PASSWORD)
  const token = '**/auth/v1/token?grant_type=password'
  await page.route(token, (route) => route.fulfill({ status: 503, json: {} }))
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    'The account service is unavailable. Please try again.',
  )
  await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toHaveValue(email)
  await expect(page.getByRole('textbox', { name: 'Password', exact: true })).toHaveValue(PASSWORD)
  await page.unroute(token)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
  await expect(page.getByRole('heading', { name: 'My library', exact: true })).toBeVisible()
  expect(errors).toEqual([])
})

for (const width of [320, 390, 1440]) {
  test(`complete book titles and shelf actions remain reachable at ${width}px`, async ({
    page,
  }, info) => {
    // Six title scripts/shapes, each opened in both personal and household detail.
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 900 })
    await signIn(page)
    for (const book of books) {
      await page.goto(`/book/${book.id}`)
      await fits(page.getByRole('heading', { level: 1, name: book.title, exact: true }))
      await fits(page.getByRole('button', { name: 'Add to favorites', exact: true }))
      if (book.title === UNBROKEN)
        await page.screenshot({ path: info.outputPath(`book-${width}.png`) })
      await page.goto('/library?scope=household')
      await page
        .getByRole('button', { name: `View ${book.title} in the household library`, exact: true })
        .click()
      await fits(page.getByRole('heading', { name: book.title, exact: true }))
      if (book.title === UNBROKEN)
        await page.screenshot({ path: info.outputPath(`household-${width}.png`) })
      if (width < 1024)
        await page.getByRole('button', { name: 'Close household details', exact: true }).click()
    }

    await page.goto('/shelves?tab=collection')
    await fits(page.getByRole('heading', { name: UNBROKEN, exact: true }))
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: UNBROKEN, exact: true })
    await fits(dialog.getByRole('heading', { name: UNBROKEN, exact: true }))
    const close = dialog.getByRole('button', { name: 'Close', exact: true })
    await fits(close)
    await page.screenshot({ path: info.outputPath(`shelf-dialog-${width}.png`) })
    // A visible button can still be obscured. Use the real close action and verify its result.
    await close.click()
    await expect(dialog).toHaveCount(0)
  })
}

for (const { width, bearded } of [
  { width: 390, bearded: false },
  { width: 1440, bearded: false },
  { width: 390, bearded: true },
]) {
  test(`Add returns to its entry and Edit keeps its draft through cover selection at ${width}px (${bearded ? 'Bearded Mode' : 'full interface'})`, async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width, height: 900 })
    await signIn(page)
    if (bearded) {
      await page.goto('/settings')
      await page.getByRole('radio', { name: /^Bearded Mode/ }).check()
    }
    await page.goto('/shelves')
    const add = page.getByTestId('persistent-add').filter({ visible: true })
    await add.click()
    await expect(page.getByRole('button', { name: 'Back to Shelves', exact: true })).toBeVisible()
    await page.getByRole('radio', { name: /My library only/ }).check()
    await page.getByRole('button', { name: 'Add manually', exact: true }).click()
    const title = `A new book from my shelves ${width} ${bearded ? 'bearded' : 'full'}`
    await page.getByPlaceholder('Title', { exact: true }).fill(title)
    await page.getByRole('button', { name: 'Back to Shelves', exact: true }).click()
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue(title)
    await page.getByRole('button', { name: 'Add to my library', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Your book was saved' })).toBeVisible()
    await page.getByRole('button', { name: 'Return to Shelves', exact: true }).click()
    await expect(page).toHaveURL(/\/shelves$/)
    const saved = await okData(
      admin.from('books').select('id,title').eq('owner_id', uid).eq('title', title),
      'return flow saved book',
    )
    expect(saved).toHaveLength(1)

    // A small correction must not force unrelated metadata choices on a newly added book.
    await page.goto(`/book/${saved[0].id}`)
    if (bearded)
      await page
        .locator('summary')
        .filter({ hasText: /^More about this book$/ })
        .click()
    await page.getByRole('button', { name: 'Edit details', exact: true }).click()
    const correction = page.getByRole('dialog', { name: 'Edit details', exact: true })
    await correction
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill(`${title} — corrected`)
    await correction.getByRole('button', { name: 'Save details', exact: true }).click()
    await expect(correction).toHaveCount(0)
    const corrected = await okData(
      admin
        .from('books')
        .select('title,genre,ownership,read_status,series_user_chosen,series_claim')
        .eq('id', saved[0].id)
        .single(),
      'unclassified book correction',
    )
    expect(corrected).toEqual({
      title: `${title} — corrected`,
      genre: '',
      ownership: 'unowned',
      read_status: 'unset',
      series_user_chosen: false,
      series_claim: expect.objectContaining({ origin: 'unknown' }),
    })

    await page.goto(`/book/${books[0].id}`)
    if (bearded)
      await page
        .locator('summary')
        .filter({ hasText: /^More about this book$/ })
        .click()
    await page.getByRole('button', { name: 'Edit details', exact: true }).click()
    const edit = page.getByRole('dialog', { name: 'Edit details', exact: true })
    await edit
      .getByRole('textbox', { name: 'Title', exact: true })
      .fill(`My unfinished title ${width}`)
    await edit.getByRole('button', { name: 'Change cover…', exact: true }).click()
    const cover = page.getByRole('dialog', { name: 'Cover', exact: true })
    await expect(cover).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(edit).toBeVisible()
    await expect(edit.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      `My unfinished title ${width}`,
    )
    await edit.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(edit.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue(
      `My unfinished title ${width}`,
    )
    await edit.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('button', { name: 'Leave changes', exact: true }).click()
    await expect(edit).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'It', exact: true })).toBeVisible()
  })
}
