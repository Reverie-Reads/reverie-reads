import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

// A book page should load without complaining.
//
// It didn't: JustFinishedSheet renders on every route and asked for trope suggestions before it had
// a book, passing ''. PostgREST rejected `book_id=eq.` as an invalid uuid, so every single page load
// produced a 400 and a console error. Harmless in effect, but it trains you to ignore the console,
// which is where the next real failure will appear.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
// PER-PROJECT ISOLATION. `rest` and `mobile` run this file concurrently, and both raced one shared
// account: each calls listUsers(), each sees no such user, each calls createUser(), and the loser
// gets `422 email_exists` before a single assertion runs. It only fires when the account does not
// already exist, which is why it looked intermittent — a warm database hides it. Same fix as
// scroll-restoration and the search-param specs.
const PROJECT = (): string => test.info().project.name
const EMAIL = () => `console-clean-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'console-clean-e2e-password'

type Client = {
  sb: SupabaseClient
  session: { access_token: string; refresh_token: string }
  uid: string
}

async function client(): Promise<Client> {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL())?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL(), password: PASSWORD, email_confirm: true }),
        'console-clean auth createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Console Clean', skin: 'tryst', mode: 'system' }),
    'console-clean profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('console-clean', EMAIL(), error))
  return { sb, session: s.session, uid: s.session.user.id }
}

async function reset(c: Client) {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await c.sb.from('books').delete().in('id', ids)
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

test('a book page loads with no failed data requests and no console errors', async ({ page }) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  // No cover_url on purpose: a hotlink to a host that isn't there would log its own resource error
  // and tell us nothing about the app. The placeholder path exercises the same page.
  const data = await okData(
    c.sb
      .from('books')
      .insert({
        owner_id: c.uid,
        title: 'Console Probe',
        author_first: 'Nell',
        author_last: 'Marrow',
        genre: 'fantasy',
        ownership: 'owned',
        status: 'standalone',
      })
      .select('id')
      .single(),
    'console-clean books insert',
  )
  const id = (data as { id: string }).id

  const badResponses: string[] = []
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('response', (r) => {
    const u = r.url()
    if ((u.includes('/rest/v1/') || u.includes('/functions/v1/')) && r.status() >= 400) {
      badResponses.push(`${r.status()} ${r.request().method()} ${u.split('/v1/')[1]?.slice(0, 90)}`)
    }
  })
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200))
  })
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 200)))

  // Edge functions the page may reach for are stubbed — this is about OUR requests, not upstream.
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))

  try {
    await signIn(page, c.session)
    await page.goto(`/book/${id}`)
    await expect(page.getByRole('heading', { name: 'Console Probe' })).toBeVisible({
      timeout: 20_000,
    })
    await page.waitForTimeout(3000) // let the deferred queries (suggestions, strips) settle

    expect(badResponses, `failed data requests: ${JSON.stringify(badResponses, null, 2)}`).toEqual(
      [],
    )
    expect(pageErrors, `uncaught errors: ${JSON.stringify(pageErrors, null, 2)}`).toEqual([])
    expect(consoleErrors, `console errors: ${JSON.stringify(consoleErrors, null, 2)}`).toEqual([])
  } finally {
    await reset(c)
  }
})
