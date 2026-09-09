import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { expect, test, type Page } from './support/fixtures'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'personal-library-sync-e2e@reverie.local'
const PASSWORD = 'personal-library-sync-e2e-password'

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
  let uid = data?.users?.find((user) => user.email === EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'personal-library-sync createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Library Sync', skin: 'folio', mode: 'light' }),
    'personal-library-sync profile upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: signedIn, error } = await sb.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  })
  if (error || !signedIn.session)
    throw new Error(authFailure('personal-library-sync', EMAIL, error))
  shared = { sb, session: signedIn.session, uid: signedIn.session.user.id }
  return shared
}

async function reset(c: Client): Promise<void> {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((book) => book.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'sync list_items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'sync books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'sync lists delete')
}

async function stub(page: Page): Promise<void> {
  for (const path of ['search', 'enrich', 'embed', 'releases', 'series', 'covers']) {
    await page.route(`**/functions/v1/${path}**`, (route) => route.fulfill({ json: {} }))
  }
  await page.route('**/books/v1/volumes**', (route) => route.fulfill({ json: { items: [] } }))
}

/**
 * Wait for the server's successful reply to the private topic join. Watching the actual WebSocket
 * avoids sleeping past a race: an out-of-band write before this frame would correctly be absent
 * from the live stream and could make the spec pass or fail based on machine speed.
 */
function waitForLibrarySubscription(page: Page, uid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) reject(new Error('The app did not join its private library channel'))
    }, 20_000)
    page.on('websocket', (socket) => {
      socket.on('framereceived', ({ payload }) => {
        const frame = payload.toString()
        if (
          !settled &&
          frame.includes(`realtime:library:${uid}`) &&
          frame.includes('phx_reply') &&
          frame.includes('"status":"ok"')
        ) {
          settled = true
          clearTimeout(timer)
          resolve()
        }
      })
    })
  })
}

async function signIn(page: Page, c: Client): Promise<void> {
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  await page.goto(
    `/#access_token=${c.session.access_token}&refresh_token=${c.session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

test('books and shelves refresh after another client changes them', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await client()
  await reset(c)
  await stub(page)
  const subscribed = waitForLibrarySubscription(page, c.uid)
  await signIn(page, c)
  await subscribed

  const librarySubscribed = waitForLibrarySubscription(page, c.uid)
  await page.goto('/library')
  await librarySubscribed
  await expect(page.getByRole('heading', { name: 'My library' })).toBeVisible()

  const inserted = await okData(
    c.sb
      .from('books')
      .insert({
        owner_id: c.uid,
        title: 'Across the Open Tabs',
        author_first: 'Mira',
        author_last: 'Vale',
        genre: 'literary',
        status: 'standalone',
        ownership: 'owned',
        borrowed: false,
        wishlist: false,
      })
      .select('id')
      .single(),
    'personal-library-sync book insert',
  )
  const bookId = (inserted as { id: string }).id

  await expect(page.getByRole('button', { name: 'Open Across the Open Tabs' })).toBeVisible({
    timeout: 20_000,
  })

  await ok(
    c.sb.from('books').update({ title: 'Across Every Device' }).eq('id', bookId),
    'personal-library-sync book update',
  )
  await expect(page.getByRole('button', { name: 'Open Across Every Device' })).toBeVisible({
    timeout: 20_000,
  })

  const shelvesSubscribed = waitForLibrarySubscription(page, c.uid)
  await page.goto('/shelves')
  await shelvesSubscribed
  await expect(page.getByRole('heading', { name: 'Shelves', exact: true })).toBeVisible()
  const list = await okData(
    c.sb
      .from('lists')
      .insert({ owner_id: c.uid, name: 'Made Elsewhere', kind: 'tbr', sort_order: 1000 })
      .select('id')
      .single(),
    'personal-library-sync list insert',
  )
  const listId = (list as { id: string }).id
  await expect(page.getByRole('heading', { name: 'Made Elsewhere' })).toBeVisible({
    timeout: 20_000,
  })

  await ok(c.sb.from('lists').delete().eq('id', listId), 'personal-library-sync list delete')
  await expect(page.getByRole('heading', { name: 'Made Elsewhere' })).toHaveCount(0, {
    timeout: 20_000,
  })

  const finalLibrarySubscribed = waitForLibrarySubscription(page, c.uid)
  await page.goto('/library')
  await finalLibrarySubscribed
  await ok(c.sb.from('books').delete().eq('id', bookId), 'personal-library-sync book delete')
  await expect(page.getByRole('button', { name: 'Open Across Every Device' })).toHaveCount(0, {
    timeout: 20_000,
  })
})
