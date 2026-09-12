import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { ok, okData, okUser } from './support/ok'

// A shelf that EXISTS must never be reported gone because this client is holding a cache that
// predates it (ShelfRoute + useConfirmedLookup).
//
// The persisted query cache makes a stale absence durable rather than momentary: `hydrate()`
// preserves `dataUpdatedAt`, so a snapshot written seconds ago is inside the 30s `staleTime` and
// therefore FRESH. Fresh data does not refetch on mount and `refetchOnWindowFocus` is off, so
// `(lists ?? []).find(...)` returns undefined forever and the route used to render "That shelf
// isn't here anymore" permanently. Reachable in production by any out-of-band write — a second
// device, or an app update reloading onto a snapshot taken moments earlier.
//
// This spec DELIBERATELY DOES NOT call keepOfflineCacheEmpty. Every other spec does, which is what
// stops them tripping over this accidentally (that idiom fix is what closed the state-pills flake);
// here the persisted cache is the subject, so it has to be allowed to exist. The poisoned snapshot
// is then asserted directly out of IndexedDB before the behaviour is tested — a precondition this
// spec proves rather than assumes, so it can never pass by failing to set itself up.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'shelf-stale-cache-e2e@reverie.local'
const PASSWORD = 'shelf-stale-cache-e2e-password'
const BOOK_TITLE = 'Stale Cache Probe'

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
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'shelf-stale-cache createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Stale Cache', skin: 'tryst', mode: 'dark' }),
    'shelf-stale-cache profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('shelf-stale-cache', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

/** One book, no shelves — so the cache the app persists at boot holds an EMPTY lists query. */
async function reset(c: Client): Promise<void> {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'stale-cache list_items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'stale-cache books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'stale-cache lists delete')
  await ok(
    c.sb.from('books').insert({
      owner_id: c.uid,
      title: BOOK_TITLE,
      author_first: 'Nell',
      author_last: 'Marrow',
      genre: 'fantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
    }),
    'stale-cache books insert',
  )
}

// NOTE: no keepOfflineCacheEmpty — see the header. This is the one spec that wants the cache.
async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
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

/** Row count of the persisted `["lists"]` query, or null when no snapshot has been written yet. */
async function persistedListsCount(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const req = indexedDB.open('reverie-offline')
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!db.objectStoreNames.contains('cache')) {
      db.close()
      return null
    }
    const rows = await new Promise<{ client: unknown }[]>((resolve, reject) => {
      const r = db.transaction('cache').objectStore('cache').getAll()
      r.onsuccess = () => resolve(r.result as { client: unknown }[])
      r.onerror = () => reject(r.error)
    })
    db.close()
    const row = rows[0]
    if (!row) return null
    const state = (
      row.client as {
        clientState: { queries: { queryKey: unknown[]; state: { data: unknown } }[] }
      }
    ).clientState
    const lists = state.queries.find((q) => JSON.stringify(q.queryKey) === '["lists"]')
    if (!lists) return null
    return Array.isArray(lists.state.data) ? lists.state.data.length : null
  })
}

test('a shelf created after the cache was written still opens', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await client()
  await reset(c)
  await stub(page)
  await signIn(page, c.session)

  // PRECONDITION, asserted rather than assumed: the app has persisted a snapshot whose `lists`
  // query is empty. Polled, so this waits for the persister rather than guessing at a delay — and
  // if it never happens the test fails here instead of passing for the wrong reason.
  await expect.poll(async () => await persistedListsCount(page), { timeout: 20_000 }).toBe(0)

  // Now the shelf appears out of band — exactly what a second device, or this spec's own API
  // client, does. Nothing tells this browser.
  const list = await okData(
    c.sb
      .from('lists')
      .insert({ owner_id: c.uid, name: 'Late Shelf', kind: 'collection', sort_order: 1 })
      .select('id')
      .single(),
    'stale-cache lists insert',
  )
  const listId = (list as { id: string }).id
  const book = await okData(
    c.sb.from('books').select('id').eq('owner_id', c.uid).eq('title', BOOK_TITLE).single(),
    'stale-cache book select',
  )
  await ok(
    c.sb.from('list_items').insert({
      list_id: listId,
      book_id: (book as { id: string }).id,
      owner_id: c.uid,
      position: 1,
    }),
    'stale-cache list_items insert',
  )

  // A full navigation, so the restore path runs and hands the route a fresh-but-empty lists query.
  await page.goto(`/shelf/${listId}`)

  // The shelf must open. Without the confirmed-absence guard the route reads `undefined` from the
  // restored cache, renders the terminal not-found, and never refetches — this is the assertion
  // that fails against the old ShelfRoute.
  await expect(page.getByRole('heading', { name: 'Late Shelf' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('That shelf isn’t here anymore.')).toHaveCount(0)
})

test('a shelf that genuinely does not exist still reports itself gone', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await client()
  await reset(c)
  await stub(page)
  await signIn(page, c.session)

  // The other half of the guard, and the one that would catch it hanging on "loading" forever.
  // Termination rests on `isFetchedAfterMount` being derived from `dataUpdateCount`, which
  // query-core increments on every successful fetch even when the data is unchanged — so one
  // refetch of a still-empty list is enough to turn the hypothesis into a conclusion.
  await page.goto('/shelf/00000000-0000-0000-0000-000000000000')

  await expect(page.getByText('That shelf isn’t here anymore.')).toBeVisible({ timeout: 20_000 })
})
