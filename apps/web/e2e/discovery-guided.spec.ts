import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'
import { SKIN_ORDER } from '@reverie/core'
import AxeBuilder from '@axe-core/playwright'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'discovery-guided-e2e@reverie.local'
const PASSWORD = 'discovery-guided-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  admin: ReturnType<typeof createClient>
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
        'discovery-guided createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Corpus E2E', skin: 'folio', mode: 'light' }),
    'discovery-guided profile',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('discovery-guided', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
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

async function stub(page: Page) {
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

const titles = ['Aaa Discovery Beginning', 'Aaa Discovery Journey', 'Aaa Discovery Welcome']
let workIds: string[] = []
let sharedSeriesId: string | undefined
test.beforeAll(async () => {
  const c = await client()
  await ok(c.admin.from('books').delete().eq('owner_id', c.uid), 'fixture books cleanup')
  await ok(
    c.admin.from('discovery_sessions').delete().eq('owner_id', c.uid),
    'fixture shortlist cleanup',
  )
  await ok(
    c.admin.from('works').delete().like('work_key', 'discovery-guided-%'),
    'fixture works cleanup',
  )
  const works = await ok(
    c.admin
      .from('works')
      .insert(
        titles.map((title, index) => ({
          work_key: `discovery-guided-${index}`,
          title,
          contributors: [{ name: 'Nell Discovery', role: 'author', position: 0 }],
          author_text: 'Nell Discovery',
          genre: 'discovery fixture',
          tags: [],
          description: 'An introspective and hopeful journey into an unfamiliar world.',
          cover_url: null,
          pub_y: 2020 + index,
        })),
      )
      .select('id,title'),
    'fixture works',
  )
  workIds = titles.map(
    (title) => works.find((w: { id: string; title: string }) => w.title === title)!.id,
  )
  await ok(
    c.admin.from('books').insert({
      owner_id: c.uid,
      corpus_work_id: workIds[0],
      title: titles[0],
      author_first: 'Nell',
      author_last: 'Discovery',
      genre: 'discovery fixture',
      ownership: 'owned',
      fave: true,
    }),
    'starting book',
  )
})
test.afterAll(async () => {
  if (!shared) return
  if (sharedSeriesId)
    await ok(
      shared.admin.from('corpus_series').delete().eq('id', sharedSeriesId),
      'fixture shared series cleanup',
    )
  await ok(shared.admin.auth.admin.deleteUser(shared.uid), 'fixture account cleanup')
  await ok(
    shared.admin.from('works').delete().like('work_key', 'discovery-guided-%'),
    'fixture catalog cleanup',
  )
})
async function enter(page: Page) {
  const c = await client()
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/discover')
  await expect(page.getByRole('heading', { name: 'Find a book to get lost in.' })).toBeVisible()
}
test('a real shortlist keeps order through details, save, wishlist add and return', async ({
  page,
}) => {
  const c = await client()
  await enter(page)
  await expect(page.getByRole('button', { name: /Aaa Discovery Beginning/ })).toBeVisible()
  await page.screenshot({ path: '../../output/playwright/discover-app-entry.png', fullPage: true })
  await page.getByRole('button', { name: 'Find a few books', exact: true }).click()
  const cards = page.locator('.discovery-recommendation')
  await expect(cards).toHaveCount(2)
  await page.screenshot({
    path: '../../output/playwright/discover-app-shortlist.png',
    fullPage: true,
  })
  const order = await cards.locator('h3').allTextContents()
  const opener = page.getByRole('button', { name: `View details for ${titles[1]}`, exact: true })
  await opener.scrollIntoViewIfNeeded()
  const y = await page.evaluate(() => scrollY)
  await opener.click()
  await expect(page.getByRole('dialog', { name: titles[1] })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'About this book' })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(Math.abs((await page.evaluate(() => scrollY)) - y)).toBeLessThan(3)
  await expect(opener).toBeFocused()
  await page.goForward()
  await expect(page.getByRole('dialog', { name: titles[1] })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goForward()
  await expect(page.getByRole('dialog', { name: titles[1] })).toBeVisible()
  await page.getByRole('button', { name: 'Keep browsing', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: `Not this time: ${titles[2]}` }).click()
  await page.getByRole('button', { name: 'Save shortlist', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Shortlist saved')
  const rows = await ok(c.sb.from('discovery_sessions').select('id,document'), 'saved snapshot')
  expect(rows).toHaveLength(1)
  expect(rows[0].document.picks.map((p: { book: { title: string } }) => p.book.title)).toEqual([
    titles[1],
  ])
  const sid = rows[0].id
  await opener.click()
  await page.getByRole('link', { name: 'Add to wishlist', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`discoverSession=${sid}`))
  await page.getByRole('button', { name: 'Add to my library', exact: true }).click()
  await expect(page.getByRole('button', { name: /Done|Keep browsing/ })).toBeVisible()
  await page.getByRole('link', { name: 'Return to your shortlist', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`session=${sid}`))
  await expect(cards.locator('h3')).toHaveText([titles[1]!])
  await expect(cards).toContainText('On your wishlist')
  const personal = await ok(
    c.sb
      .from('books')
      .select('ownership,borrowed,wishlist,corpus_work_id')
      .eq('corpus_work_id', workIds[1]!),
    'added copy',
  )
  expect(personal).toMatchObject([{ ownership: 'unowned', borrowed: false, wishlist: true }])
  expect(order).toEqual([titles[1], titles[2]])
  await page.reload()
  await expect(cards.locator('h3')).toHaveText([titles[1]!])
})
test('mobile mood choices, saved return and accessible layout', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await enter(page)
  await page.getByRole('button', { name: /Meet me in this mood/ }).click()
  await page.getByRole('button', { name: 'Hopeful', exact: true }).click()
  await page.getByRole('button', { name: 'Unsettling', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Choose up to two moods')
  await expect(page.getByRole('button', { name: 'Unsettling', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByRole('button', { name: 'Find a few books', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'A few books to sit with.' })).toBeVisible()
  await expect(page.locator('.discovery-recommendation').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  const audit = await new AxeBuilder({ page })
    .include('.discover-experience')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(audit.violations).toEqual([])
  await page.getByRole('button', { name: /Saved shortlists/ }).click()
  await page.getByRole('button', { name: 'Return to these books' }).click()
  await expect(page.locator('.discovery-recommendation h3')).toHaveText([titles[1]!])
})

test('saved choices remain stable through all nine rooms in both modes', async ({ page }) => {
  test.setTimeout(120_000)
  await enter(page)
  await page.getByRole('button', { name: /Saved shortlists/ }).click()
  await page.getByRole('button', { name: 'Return to these books' }).click()
  const before = await page.locator('.discovery-recommendation h3').allTextContents()
  for (const skin of SKIN_ORDER)
    for (const mode of ['light', 'dark'] as const) {
      await page.evaluate(
        async ({ skin, mode }) => {
          // Exercise the same store actions used by Appearance, including fonts and the room renderer.
          const path = '/src/skin/useSkin.ts'
          const module = await import(/* @vite-ignore */ path)
          module.useSkin.getState().setSkin(skin)
          module.useSkin.getState().setMode(mode)
          await document.fonts.ready
        },
        { skin, mode },
      )
      await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
      await expect(page.locator('.discovery-recommendation h3')).toHaveText(before)
      const audit = await new AxeBuilder({ page })
        .include('.discover-experience')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
      expect(audit.violations, `${skin}/${mode}`).toEqual([])
      await page.setViewportSize({ width: 320, height: 800 })
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        `${skin}/${mode} overflow`,
      ).toBe(false)
      const clipped = await page
        .locator('.discover-experience button')
        .evaluateAll((nodes) =>
          nodes.filter((n) => n.scrollWidth > n.clientWidth + 1).map((n) => n.textContent),
        )
      expect(clipped, `${skin}/${mode} clipped controls`).toEqual([])
      await page.setViewportSize({ width: 1280, height: 900 })
    }
})

test('offline save is refused immediately and cannot replay after reconnecting', async ({
  page,
  context,
}) => {
  const c = await client()
  await enter(page)
  await page.getByRole('button', { name: /Saved shortlists/ }).click()
  await page.getByRole('button', { name: 'Return to these books' }).click()
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/discovery_sessions') && r.method() === 'POST')
      writes.push(r.url())
  })
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Update saved shortlist' }).click()
  await expect(page.getByRole('status')).toContainText('Reconnect to save')
  await context.setOffline(false)
  await page.getByRole('button', { name: /Saved shortlists/ }).click()
  await expect(page.getByRole('button', { name: 'Return to these books' })).toBeVisible()
  expect(writes).toEqual([])
  const rows = await ok(c.sb.from('discovery_sessions').select('id'), 'offline saved records')
  expect(rows).toHaveLength(1)
})

test('series invitation needs reviewed membership and disappears after removing the personal category', async ({
  page,
}) => {
  const c = await client()
  const [book] = await ok(
    c.sb.from('books').select('id').eq('corpus_work_id', workIds[0]!),
    'series starting copy',
  )
  await ok(
    c.sb
      .from('reads')
      .insert({ book_id: book.id, owner_id: c.uid, read_on: '2026-09-01', format: 'physical' }),
    'completed read fixture',
  )
  const [personal] = await ok(
    c.sb
      .from('series')
      .insert({ owner_id: c.uid, name: 'Discovery fixture saga', source: 'manual' })
      .select('id'),
    'personal series fixture',
  )
  const claim = { origin: 'reader', source: 'fixture' }
  await ok(
    c.sb.from('series_entries').insert({
      owner_id: c.uid,
      series_id: personal.id,
      book_id: book.id,
      title: titles[0],
      author: 'Nell Discovery',
      position: 1,
      sort_order: 1,
      sort_user_edited: false,
      is_primary: false,
      membership_claim: claim,
      position_claim: claim,
    }),
    'personal membership fixture',
  )
  const [corpus] = await ok(
    c.admin
      .from('corpus_series')
      .insert({
        name: 'Discovery fixture saga',
        name_key: 'discovery fixture saga',
        creator_key: 'nell discovery',
        catalog_state: 'confirmed',
      })
      .select('id'),
    'confirmed shared series fixture',
  )
  sharedSeriesId = corpus.id
  await ok(
    c.admin.from('corpus_series_entries').insert(
      [0, 2].map((index, position) => ({
        series_id: corpus.id,
        work_id: workIds[index],
        position: position + 1,
        title: titles[index],
        author_text: 'Nell Discovery',
        membership_claim: claim,
        position_claim: claim,
        source: 'manual',
      })),
    ),
    'reviewed shared memberships',
  )
  await enter(page)
  await expect(
    page.getByRole('heading', { name: 'There’s more of Discovery fixture saga.' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'See the next book' }).click()
  await expect(page.getByRole('dialog', { name: titles[2] })).toBeVisible()
  await page.getByRole('button', { name: 'Keep browsing', exact: true }).click()
  await ok(
    c.admin
      .from('corpus_series_entries')
      .update({ position_claim: { origin: 'unknown' } })
      .eq('series_id', corpus.id),
    'uncertain order fixture',
  )
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Find a book to get lost in.' })).toBeVisible()
  await expect(page.locator('.discovery-series')).toHaveCount(0)
  await ok(
    c.admin
      .from('corpus_series_entries')
      .update({ position_claim: claim })
      .eq('series_id', corpus.id),
    'review order fixture',
  )
  await ok(
    c.sb.rpc('delete_personal_series', { p_series: personal.id }),
    'reader removes incorrect category',
  )
  await page.reload()
  await page.waitForLoadState('networkidle')
  await expect(page.getByRole('heading', { name: 'Find a book to get lost in.' })).toBeVisible()
  await expect(page.locator('.discovery-series')).toHaveCount(0)
})
