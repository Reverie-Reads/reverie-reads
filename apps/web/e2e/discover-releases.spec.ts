import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'discover-releases-e2e@reverie.local'
const PASSWORD = 'discover-releases-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
  session: { access_token: string; refresh_token: string }
  uid: string
}
let shared: Client | null = null

async function client(): Promise<Client> {
  if (shared) return shared
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'discover-releases createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Discover Releases E2E', skin: 'tryst', mode: 'dark' }),
    'discover-releases profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('discover-releases', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  await keepOfflineCacheEmpty(page)
  await configureReturningReader(session.access_token)
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

function sampleRelease(title: string, days: number, kind?: 'new_work' | 'new_edition') {
  const now = new Date()
  now.setUTCDate(now.getUTCDate() + days)
  return {
    title,
    authors: ['Release Author'],
    isbn: '',
    cover: '',
    pub: now.toISOString().slice(0, 10),
    description: 'An edition-specific release for browser verification.',
    release: {
      source: 'hardcover',
      precision: 'day',
      sourceUrl: 'https://hardcover.app/books/example',
      checkedAt: new Date().toISOString(),
      kind,
      territory: 'US',
      formats: ['Hardcover'],
    },
  }
}
for (const width of [390, 1280]) {
  test(`release views separate current books, editions and catalog at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const c = await client()
    await page.route('**/functions/v1/releases', (route) =>
      route.fulfill({
        json: {
          hits: [
            sampleRelease('Fresh publication', -2, 'new_work'),
            sampleRelease('Future publication', 20, 'new_work'),
            sampleRelease('Old backlist', -400, 'new_work'),
            sampleRelease('Reprinted edition', -3, 'new_edition'),
            sampleRelease('Unconfirmed first publication', -1),
          ],
          providers: { hardcover: 'ready', prh: 'not_configured' },
          checkedAt: new Date().toISOString(),
        },
      }),
    )
    await page.route('**/functions/v1/enrich', (route) => route.fulfill({ json: {} }))
    await page.route('**/functions/v1/embed', (route) =>
      route.fulfill({ json: { hasTaste: false, scores: [] } }),
    )
    await signIn(page, c.session)
    await page.goto('/discover?view=releases')
    const nav = page.getByRole('navigation', { name: 'Discover sections' })
    await expect(nav.getByRole('link', { name: 'New & upcoming' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      page.getByRole('button', { name: 'View details for Fresh publication', exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Shared catalog', exact: true })).toHaveCount(0)
    await expect(page.getByText('Old backlist', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Reprinted edition', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: 'New books only', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'View details for Reprinted edition', exact: true }),
    ).toBeVisible()
    await expect(page.getByText('New edition', { exact: true })).toBeVisible()
    await expect(page.getByText('Edition release', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Next six months', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'View details for Future publication', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'View details for Fresh publication', exact: true }),
    ).toHaveCount(0)
    await page.screenshot({ path: info.outputPath(`releases-${width}.png`), fullPage: true })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    const before = await c.sb.from('books').select('id').eq('owner_id', c.uid)
    if (before.error) throw before.error
    await page
      .getByRole('button', { name: 'View details for Future publication', exact: true })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Future publication', exact: true })
    await expect(dialog.getByText('Release date', { exact: true })).toBeVisible()
    const after = await c.sb.from('books').select('id').eq('owner_id', c.uid)
    if (after.error) throw after.error
    expect(after.data).toEqual(before.data)
    await dialog.getByRole('link', { name: 'Add to wishlist', exact: true }).click()
    await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue('Future publication')
    await expect(page).toHaveURL(/want=true/)
    await page.goBack()
    await expect(nav.getByRole('link', { name: 'New & upcoming' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await nav.getByRole('link', { name: 'Curated picks', exact: true }).click()
    await page.getByRole('button', { name: 'Romance', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Curated picks', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'New & upcoming', exact: true })).toHaveCount(0)
    await nav.getByRole('link', { name: 'Shared catalog', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Shared catalog', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Curated picks', exact: true })).toHaveCount(0)
  })
}

test('release failure offers recovery instead of claiming an empty shelf', async ({ page }) => {
  const c = await client()
  let fail = true
  await page.route('**/functions/v1/releases', (route) =>
    fail
      ? route.fulfill({ status: 503, json: { error: 'unavailable' } })
      : route.fulfill({
          json: {
            hits: [],
            providers: { hardcover: 'ready', prh: 'unavailable' },
            checkedAt: new Date().toISOString(),
          },
        }),
  )
  await signIn(page, c.session)
  await page.goto('/discover?view=releases')
  await expect(page.getByRole('alert')).toContainText('couldn’t be refreshed')
  await expect(page.getByText(/No releases match/)).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText(/One release source is unavailable/)).toBeVisible()
  await expect(page.getByText(/No releases match/)).toBeVisible()
})

for (const { width, changeFormat } of [
  { width: 1280, changeFormat: false },
  { width: 390, changeFormat: false },
  { width: 1280, changeFormat: true },
]) {
  test(`selected release saves one wanted edition and returns to the same window at ${width}px (change format: ${changeFormat})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const c = await client()
    const title = 'Edition Handoff Journey'
    await ok(
      c.sb.from('books').delete().eq('owner_id', c.uid).eq('title', title),
      'clear handoff fixture',
    )
    const sourceUrl = 'https://hardcover.app/books/edition-handoff-journey'
    const pub = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10)
    const release = {
      title,
      authors: ['Nell Writer', 'Tariq Writer'],
      isbn: '9798991234504',
      pub,
      cover: '',
      release: {
        source: 'hardcover',
        precision: 'day',
        sourceUrl,
        publisher: 'Example Press',
        formats: width === 1280 ? ['Hardback'] : ['Collectors edition'],
        checkedAt: new Date().toISOString(),
      },
    }
    await page.route('**/functions/v1/enrich', (r) => r.fulfill({ json: {} }))
    await page.route('**/functions/v1/covers**', (r) => r.fulfill({ status: 422, json: {} }))
    await page.route('**/functions/v1/embed', (r) =>
      r.fulfill({ json: { hasTaste: false, scores: [] } }),
    )
    await page.route('**/functions/v1/releases', (r) =>
      r.fulfill({
        json: {
          hits: [release],
          providers: { hardcover: 'ready', prh: 'not_configured' },
          checkedAt: new Date().toISOString(),
        },
      }),
    )
    const rows = async () => {
      const result = await c.sb.from('books').select('*').eq('owner_id', c.uid).eq('title', title)
      if (result.error) throw result.error
      return result.data
    }
    try {
      await signIn(page, c.session)
      await page.goto('/discover?view=releases&window=upcoming&editions=true')
      await page.getByRole('button', { name: `View details for ${title}`, exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('link', { name: 'Add to wishlist', exact: true })
        .click()
      await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue(title)
      await expect(page.getByLabel('Publication date', { exact: true })).toHaveValue(pub)
      await expect(page.getByLabel('Edition format', { exact: true })).toHaveValue(
        width === 1280 ? 'Hardcover' : '',
      )
      await expect(
        page.getByRole('link', { name: 'Release listing ↗', exact: true }),
      ).toHaveAttribute('href', sourceUrl)
      await expect(page.getByText(`ISBN ${release.isbn}`, { exact: true })).toBeVisible()
      expect(await rows()).toHaveLength(0)
      await page.reload()
      await expect(page.getByLabel('Publication date', { exact: true })).toHaveValue(pub)
      expect(await rows()).toHaveLength(0)
      if (changeFormat) {
        await page.getByLabel('Edition format', { exact: true }).selectOption('Paperback')
        await expect(page.getByRole('status')).toContainText('no longer match this release')
      }
      await page.screenshot({
        path: test.info().outputPath(`edition-draft-${width}.png`),
        fullPage: true,
      })
      await page.locator('[data-book-tour="book-save"]').click()
      await expect(page.getByRole('heading', { name: 'Added — finish the details' })).toBeVisible()
      const saved = await rows()
      expect(saved).toHaveLength(1)
      expect(saved[0]).toMatchObject({
        isbn: changeFormat ? null : release.isbn,
        ...(changeFormat ? { pub_y: null, pub_m: null, pub_d: null } : {}),
        ownership: 'unowned',
        wishlist: true,
        borrowed: false,
        read_status: 'unset',
        progress: 0,
        owned_physical: null,
      })
      expect(saved[0].copy_inventory.copies).toHaveLength(1)
      expect(saved[0].copy_inventory.copies[0].state).toBe('wishlist')
      expect(saved[0].copy_inventory.editions[0]).toMatchObject({
        isbn: changeFormat ? '' : release.isbn,
        published: changeFormat ? '' : pub,
        publisher: changeFormat ? '' : 'Example Press',
        ...(!changeFormat ? { sourceUrl } : {}),
        format: changeFormat ? 'paperback' : width === 1280 ? 'hardcover' : 'unknown',
      })
      await page.getByRole('link', { name: 'Open your book', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Manage copies', exact: true })).toBeVisible()
      if (changeFormat) {
        expect(saved[0].copy_inventory.editions[0]).not.toHaveProperty('sourceUrl')
        await expect(
          page.getByRole('link', { name: 'Release listing ↗', exact: true }),
        ).toHaveCount(0)
      } else {
        await expect(
          page.getByRole('link', { name: 'Release listing ↗', exact: true }),
        ).toHaveAttribute('href', sourceUrl)
      }
      const authors = await c.sb
        .from('book_authors')
        .select('authors(name)')
        .eq('book_id', saved[0].id)
      if (authors.error) throw authors.error
      expect(JSON.stringify(authors.data)).toContain('Nell Writer')
      expect(JSON.stringify(authors.data)).toContain('Tariq Writer')
      await page.goBack()
      await page.getByRole('link', { name: 'Return to releases', exact: true }).click()
      await expect(page).toHaveURL(/window=upcoming/)
      await expect(page).toHaveURL(/editions=true/)
    } finally {
      await ok(
        c.sb.from('books').delete().eq('owner_id', c.uid).eq('title', title),
        'remove handoff fixture',
      )
    }
  })
}

test('a selected release can be reviewed and added to an existing personal book', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  const c = await client()
  const id = 'f9700000-0000-4000-8000-000000000010'
  const title = 'Existing Edition Journey'
  const sourceUrl = 'https://hardcover.app/books/existing-edition-journey'
  const pub = new Date(Date.now() + 20 * 864e5).toISOString().slice(0, 10)
  await ok(c.sb.from('books').delete().eq('id', id), 'clear existing-edition fixture')
  await ok(
    c.sb.from('books').insert({
      id,
      owner_id: c.uid,
      title,
      author_first: 'Nell',
      author_last: 'Writer',
      ownership: 'owned',
      owned_physical: 'paperback',
      read_status: 'Reading',
      progress: 30,
      rating: 4,
    }),
    'insert existing-edition fixture',
  )
  await page.route('**/functions/v1/enrich', (route) => route.fulfill({ json: {} }))
  await page.route('**/functions/v1/covers**', (route) => route.fulfill({ status: 422, json: {} }))
  await page.route('**/functions/v1/embed', (route) =>
    route.fulfill({ json: { hasTaste: false, scores: [] } }),
  )
  await page.route('**/functions/v1/releases', (route) =>
    route.fulfill({
      json: {
        hits: [
          {
            title,
            authors: ['Nell Writer'],
            isbn: '9798991234504',
            pub,
            cover: '',
            release: {
              source: 'hardcover',
              precision: 'day',
              sourceUrl,
              publisher: 'Example Press',
              formats: ['Hardback'],
              checkedAt: new Date().toISOString(),
            },
          },
        ],
        providers: { hardcover: 'ready', prh: 'not_configured' },
        checkedAt: new Date().toISOString(),
      },
    }),
  )
  try {
    await signIn(page, c.session)
    await page.goto('/discover?view=releases&window=upcoming&editions=true')
    await page.getByRole('button', { name: `View details for ${title}`, exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('link', { name: 'Add to wishlist', exact: true })
      .click()
    await page.locator('[data-book-tour="book-save"]').click()
    await expect(page.getByText(`You may already have ${title}`)).toBeVisible()
    await page.getByRole('button', { name: 'Add edition to existing book' }).click()

    const editor = page.getByRole('dialog', { name: 'Add edition to existing book' })
    await expect(editor).toBeVisible()
    await expect(editor.getByRole('group', { name: 'Edition 1' })).toBeVisible()
    await expect(editor.getByRole('group', { name: 'Edition 2' })).toBeVisible()
    await expect(editor.getByDisplayValue(sourceUrl)).toBeVisible()
    await editor.getByRole('button', { name: 'Add edition & copy' }).click()

    await expect(page.getByRole('heading', { name: 'Edition added', exact: true })).toBeVisible()
    const saved = await c.sb
      .from('books')
      .select('copy_inventory,ownership,wishlist,read_status,progress,rating')
      .eq('id', id)
      .single()
    if (saved.error) throw saved.error
    expect(saved.data).toMatchObject({
      ownership: 'owned',
      wishlist: true,
      read_status: 'Reading',
      progress: 30,
      rating: 4,
    })
    expect(saved.data.copy_inventory.editions).toHaveLength(2)
    expect(saved.data.copy_inventory.copies.map((copy: { state: string }) => copy.state)).toEqual([
      'owned',
      'wishlist',
    ])
    expect(saved.data.copy_inventory.editions[1]).toMatchObject({
      format: 'hardcover',
      isbn: '9798991234504',
      published: pub,
      publisher: 'Example Press',
      sourceUrl,
    })
    await page.getByRole('link', { name: 'Open your book', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Manage copies', exact: true })).toBeVisible()
    await expect(
      page.getByRole('link', { name: 'Release listing ↗', exact: true }),
    ).toHaveAttribute('href', sourceUrl)
  } finally {
    await ok(c.sb.from('books').delete().eq('id', id), 'remove existing-edition fixture')
  }
})
