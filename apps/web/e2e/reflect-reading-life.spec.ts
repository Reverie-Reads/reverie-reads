import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  for (const name of ['search', 'embed', 'releases', 'series', 'covers', 'taste', 'geo'])
    await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

async function setup(page: Page) {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `reflect-${randomUUID()}@reverie.local`
  const password = 'Reflect-Local-9362'
  const user = await okUser(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'reflect createUser',
  )
  const year = new Date().getFullYear()
  await ok(
    admin
      .from('profiles')
      .update({
        display_name: 'Reflect Reader',
        skin: 'folio',
        mode: 'light',
        goal_year: year,
        goal_target: 12,
      })
      .eq('id', user.id),
    'reflect profile update',
  )
  const books = await okData(
    admin
      .from('books')
      .insert([
        {
          owner_id: user.id,
          title: 'The Lantern Archive',
          author_first: 'Iona',
          author_last: 'Vale',
          genre: 'fantasy',
          genres: ['Fantasy', ' fantasy '],
          cover_url: '/landing-covers/throne-of-glass.jpg',
          read_status: 'Read',
          ownership: 'owned',
        },
        {
          owner_id: user.id,
          title: 'The Sea Between Rooms',
          author_first: 'Iona',
          author_last: 'Vale',
          genre: 'literary',
          genres: ['Literary fiction'],
          cover_url: '/landing-covers/love-and-other-killers.jpg',
          read_status: 'Read',
          ownership: 'owned',
        },
        {
          owner_id: user.id,
          title: 'A Map of Quiet Places',
          author_first: 'Mara',
          author_last: 'North',
          genre: 'nonfiction',
          genres: ['Nonfiction'],
          cover_url: '/landing-covers/everflame.jpg',
          read_status: 'Read',
          ownership: 'owned',
        },
      ])
      .select('id,title'),
    'reflect books insert',
  )
  const ids = Object.fromEntries(books.map((book) => [book.title, book.id]))
  await ok(
    admin.from('reads').insert([
      {
        owner_id: user.id,
        book_id: ids['The Lantern Archive'],
        read_on: `${year}-02-11`,
        format: 'hardcover',
        rating: 4.5,
        notes: 'The lamplit archive felt like a room I had visited before.',
      },
      {
        owner_id: user.id,
        book_id: ids['The Sea Between Rooms'],
        read_on: `${year}-06-19`,
        format: 'audiobook',
        rating: 4,
        notes: null,
      },
      {
        owner_id: user.id,
        book_id: ids['A Map of Quiet Places'],
        read_on: `${year}-06-28`,
        format: 'paperback',
        rating: 5,
        notes: null,
      },
    ]),
    'reflect reads insert',
  )
  const trope = await okData(
    admin.from('tropes').select('id').is('owner_id', null).eq('name', 'Found Family').single(),
    'reflect trope lookup',
  )
  const mood = await okData(
    admin.from('moods').select('id').is('owner_id', null).eq('name', 'Hopeful').single(),
    'reflect mood lookup',
  )
  await ok(
    admin.from('book_tropes').insert(
      books.slice(0, 2).map((book) => ({
        owner_id: user.id,
        book_id: book.id,
        trope_id: trope.id,
        emphasis: 'present',
      })),
    ),
    'reflect trope assignments',
  )
  await ok(
    admin.from('book_moods').insert(
      books.slice(0, 2).map((book) => ({
        owner_id: user.id,
        book_id: book.id,
        mood_id: mood.id,
      })),
    ),
    'reflect mood assignments',
  )
  const reader = createClient(SUPABASE_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await reader.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No Reflect test session')
  await signIn(page, auth.data.session)
  return {
    year,
    cleanup: async () => {
      await ok(admin.auth.admin.deleteUser(user.id), 'reflect deleteUser')
    },
  }
}

test('Reflect turns persisted reading history into an explorable private retrospective', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000)
  const fixture = await setup(page)
  try {
    await page.goto('/stats')
    await expect(
      page.getByRole('heading', { name: `Your ${fixture.year}, in books.` }),
    ).toBeVisible()
    await expect(page.getByText('3 of 12 books')).toBeVisible()
    await expect(
      page
        .getByLabel('From your reading record')
        .getByText('The lamplit archive felt like a room I had visited before.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Fantasy 1 read/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Iona Vale 2 reads/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Found Family 2 reads/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /Hopeful 2 reads/i })).toBeVisible()

    await page.getByRole('button', { name: /Iona Vale 2 reads/i }).click()
    await expect(page.getByRole('dialog')).toContainText(
      'The voices you spent time with.: Iona Vale',
    )
    await page.getByRole('button', { name: /close/i }).click()

    await page.getByRole('button', { name: 'Open your retrospective' }).click()
    const retrospective = page.getByRole('dialog')
    await expect(retrospective).toContainText(`A private retrospective · ${fixture.year}`)
    await expect(retrospective).toContainText('Most-read voice')
    await expect(retrospective).toContainText('Iona Vale')
    await expect(retrospective).toContainText(
      'Reverie does not create a public score or share card',
    )
    await page.screenshot({
      path: testInfo.outputPath('reflect-desktop.png'),
      fullPage: true,
      animations: 'disabled',
    })
    await retrospective.getByRole('button', { name: 'Turn toward what’s next' }).click()
    await expect(page).toHaveURL(/\/planner$/)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/stats')
    await expect(
      page.getByRole('heading', { name: `Your ${fixture.year}, in books.` }),
    ).toBeVisible()
    const viewport = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1)
    await page.screenshot({
      path: testInfo.outputPath('reflect-mobile.png'),
      fullPage: true,
      animations: 'disabled',
    })
  } finally {
    await fixture.cleanup()
  }
})
