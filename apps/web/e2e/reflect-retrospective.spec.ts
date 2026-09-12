import { configureReturningReader } from './support/readerGuidance'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from './support/fixtures'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const EMAIL = 'reflect-retrospective-e2e@reverie.local'
const PASSWORD = 'reflect-retrospective-local-password'

async function setup(page: Page) {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const listed = await admin.auth.admin.listUsers({ perPage: 1000 })
  if (listed.error) throw listed.error
  let uid = listed.data.users.find((user) => user.email === EMAIL)?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'reflect retrospective createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Reflect', skin: 'tryst', mode: 'dark' }),
    'reflect retrospective profile upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (auth.error || !auth.data.session)
    throw new Error(authFailure('reflect retrospective', EMAIL, auth.error))
  const existing = await sb.from('books').select('id').eq('owner_id', uid)
  if (existing.error) throw existing.error
  const ids = (existing.data ?? []).map((book) => book.id)
  if (ids.length) await ok(sb.from('books').delete().in('id', ids), 'reflect books delete')
  const books = await sb
    .from('books')
    .insert([
      {
        owner_id: uid,
        title: 'The Familiar Harbour',
        author_first: 'Nell',
        author_last: 'Marrow',
        genre: 'fantasy',
        ownership: 'owned',
        read_status: 'Read',
      },
      {
        owner_id: uid,
        title: 'A Map of Quiet Places',
        author_first: 'Ada',
        author_last: 'Vale',
        genre: 'literary',
        ownership: 'owned',
        read_status: 'Read',
      },
    ])
    .select('id,title')
  if (books.error) throw books.error
  const byTitle = new Map((books.data ?? []).map((book) => [book.title, book.id]))
  const familiarId = byTitle.get('The Familiar Harbour')
  const quietId = byTitle.get('A Map of Quiet Places')
  if (!familiarId || !quietId) throw new Error('Reflect fixtures were not returned')
  await ok(
    sb.from('reads').insert([
      {
        owner_id: uid,
        book_id: familiarId,
        read_on: '2025-06-10',
        format: 'Paperback',
        rating: 4,
        notes: 'The first crossing.',
      },
      {
        owner_id: uid,
        book_id: familiarId,
        read_on: '2026-03-04',
        format: 'Audiobook',
        rating: 5,
        notes: 'I heard the tide differently this time.',
      },
      {
        owner_id: uid,
        book_id: quietId,
        read_on: '2026-03-19',
        format: 'Hardcover',
        rating: 4,
        notes: null,
      },
    ]),
    'reflect reads insert',
  )
  await keepOfflineCacheEmpty(page)
  const { access_token, refresh_token } = auth.data.session
  await configureReturningReader(access_token)
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20_000 })
  return { admin, uid }
}

test('Reflect opens an accurate private period story and carries the reader into Plan', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const c = await setup(page)
  try {
    await page.goto('/stats')
    const opener = page.getByRole('button', { name: /Open your retrospective/ })
    await expect(opener).toBeVisible()
    await opener.click()

    const story = page.getByRole('dialog', { name: 'Your 2026 in books' })
    await expect(story).toBeVisible()
    await expect(story.getByText(/2 logged reads across 2 books/)).toBeVisible()
    await expect(story.getByText(/One was a return to familiar company/)).toBeVisible()
    await expect(story.getByRole('blockquote')).toContainText(
      'I heard the tide differently this time.',
    )
    await expect(story.getByRole('button', { name: /^Open / })).toHaveCount(2)
    const placeholderJackets = story.getByRole('img', { name: /placeholder cover/ })
    await expect(placeholderJackets).toHaveCount(2)
    const jacket = await placeholderJackets.first().boundingBox()
    expect(jacket?.width).toBeGreaterThanOrEqual(64)
    expect((jacket?.height ?? 0) / (jacket?.width ?? 1)).toBeGreaterThan(1.4)

    const layout = await story.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1)
    const axe = await new AxeBuilder({ page })
      .include('dialog')
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    expect(axe.violations).toEqual([])

    await story.getByRole('button', { name: 'Close' }).click()
    await expect(opener).toBeFocused()
    await opener.click()
    await page.getByRole('button', { name: /Turn toward what’s next/ }).click()
    await expect(page).toHaveURL(/\/planner$/)
  } finally {
    await c.admin.auth.admin.deleteUser(c.uid)
  }
})
