import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from './support/fixtures'
import { configureReturningReader } from './support/readerGuidance'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const LOCAL_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

test('a non-administrator opens every shared series slot by ID and returns to the catalog without writes', async ({
  page,
}, testInfo) => {
  const admin = createClient(LOCAL_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const id = randomUUID(),
    peerId = randomUUID()
  const email = `shared-series-${id}@reverie.local`
  const password = 'SharedSeries-Local-5912'
  const user = await okUser(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'shared series local reader',
  )
  const name = `Catalog sequence ${id.slice(0, 8)}`
  try {
    await ok(
      admin.from('corpus_series').insert([
        { id, name, name_key: id, creator_key: 'inez north' },
        { id: peerId, name, name_key: id, creator_key: 'other author' },
      ]),
      'same-name shared series fixtures',
    )
    await ok(
      admin.from('corpus_series_entries').insert([
        ...Array.from({ length: 8 }, (_, i) => ({
          series_id: id,
          title: `Catalog chapter ${i + 1}`,
          author_text: 'Inez North',
          position: i === 7 ? null : i + 1,
          removed_at: null,
        })),
        {
          series_id: id,
          title: 'Removed slot',
          author_text: 'Inez North',
          position: 9,
          removed_at: '2026-01-01T00:00:00Z',
        },
        {
          series_id: peerId,
          title: 'Different same-name series',
          author_text: 'Other Author',
          position: 1,
          removed_at: null,
        },
      ]),
      'shared series slots',
    )
    const book = await ok(
      admin
        .from('books')
        .insert({
          owner_id: user.id,
          title: 'Reader choice stays private',
          author_first: 'Test',
          author_last: 'Writer',
          series: 'My chosen series',
          position: 3,
          series_claim: { origin: 'reader', source: 'e2e_fixture' },
          series_user_chosen: true,
        })
        .select('*')
        .single(),
      'protected personal choice',
    )
    const beforeSeries = await ok(
      admin.from('corpus_series').select('*').in('id', [id, peerId]).order('id'),
      'shared series baseline',
    )
    const beforeEntries = await ok(
      admin.from('corpus_series_entries').select('*').in('series_id', [id, peerId]).order('id'),
      'shared entries baseline',
    )
    const personalBefore = await ok(
      admin.from('series_entries').select('*').eq('owner_id', user.id).order('id'),
      'personal membership baseline',
    )
    const sb = createClient(LOCAL_URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const auth = await sb.auth.signInWithPassword({ email, password })
    if (auth.error || !auth.data.session) throw auth.error ?? new Error('Missing local session')
    await keepOfflineCacheEmpty(page)
    const { access_token, refresh_token } = auth.data.session
    await configureReturningReader(access_token)
    for (const provider of ['series', 'search', 'enrich', 'embed', 'releases']) {
      await page.route(`**/functions/v1/${provider}**`, (route) => route.fulfill({ json: {} }))
    }
    await page.goto(
      `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
    )
    await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20000 })
    await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
    await page.goto('/series')
    await page.getByRole('button', { name: 'Reverie catalog', exact: true }).click()
    await page.getByRole('searchbox', { name: 'Find a series' }).fill(name)
    const card = page.getByTestId('shared-series-card').filter({ hasText: 'Catalog chapter 1' })
    await expect(card.getByText('+2 more slots')).toBeVisible()
    const link = card.getByRole('link', { name: `Open the ${name} shared series` })
    await link.focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/catalog/series/${id}$`))
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
    const entries = page.getByRole('list', { name: 'Shared series books' })
    await expect(entries.getByRole('listitem')).toHaveCount(8)
    await expect(page.getByRole('heading', { name: 'Catalog chapter 8' })).toBeVisible()
    await expect(page.getByText('Position not confirmed')).toBeVisible()
    await expect(page.getByText(/Series length not confirmed/)).toBeVisible()
    await expect(page.getByText('Different same-name series')).toHaveCount(0)
    await expect(page.getByText('Removed slot', { exact: true })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /Rename series|Fetch series data|Remove this category/ }),
    ).toHaveCount(0)
    await page.setViewportSize({ width: 390, height: 844 })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true)
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
    await page.screenshot({ path: testInfo.outputPath('shared-series-mobile.png'), fullPage: true })
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Catalog chapter 8' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to shared catalog' }).click()
    await expect(
      page.getByRole('button', { name: 'Reverie catalog', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: 'Shared catalog', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'My series', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: 'My series', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(
      await ok(admin.from('books').select('*').eq('id', book.id).single(), 'personal after'),
    ).toEqual(book)
    expect(
      await ok(admin.from('books').select('id').eq('owner_id', user.id), 'personal count after'),
    ).toHaveLength(1)
    expect(
      await ok(
        admin.from('series_entries').select('*').eq('owner_id', user.id).order('id'),
        'personal memberships after',
      ),
    ).toEqual(personalBefore)
    expect(
      await ok(
        admin.from('corpus_series').select('*').in('id', [id, peerId]).order('id'),
        'shared series after',
      ),
    ).toEqual(beforeSeries)
    expect(
      await ok(
        admin.from('corpus_series_entries').select('*').in('series_id', [id, peerId]).order('id'),
        'shared entries after',
      ),
    ).toEqual(beforeEntries)
  } finally {
    await ok(admin.from('corpus_series').delete().in('id', [id, peerId]), 'shared fixture cleanup')
    await okUser(admin.auth.admin.deleteUser(user.id), 'local reader cleanup')
  }
})
