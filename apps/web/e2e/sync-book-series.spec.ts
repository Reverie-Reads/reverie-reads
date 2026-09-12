import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// sync_book_series (20260817010000) — the last atomicity gap in the series write story.
//
// The book page's save used to run updateBook (writes books.series to the NEW name) then
// syncBookSeries (retires the OLD live slot, keyed off the client's CACHED book.series) as two
// separate, unguarded async calls. A failure between them left books.series already pointing at
// the new name with the OLD slot still live — and unlike remove_series_entry's defect, nothing
// revives-and-undoes this: there is no tombstone yet for reconciliation to act on, so the stale
// live entry just sits there, permanently, invisible to everything. Same discipline as
// series-removal-positions.spec.ts's S3b test: the half-committed state is built BY HAND, because
// the app can no longer produce it — that is the point — then the same transition is driven
// through the real UI to prove the atomic path never leaves it behind.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'sync-book-series-e2e@reverie.local'
const PASSWORD = 'sync-book-series-e2e-password'

const OLD_SAGA = 'Old Saga'
const NEW_SAGA = 'New Saga'

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
        'sync-book-series createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Sync Book Series E2E', skin: 'tryst', mode: 'system' }),
    'sync-book-series profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('sync-book-series', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

async function reset(c: Client) {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length)
    await ok(c.sb.from('books').delete().in('id', ids), 'sync-book-series books delete')
  const { data: ser } = await c.sb.from('series').select('id').eq('owner_id', c.uid)
  const sids = ((ser as { id: string }[]) ?? []).map((s) => s.id)
  if (sids.length)
    await ok(
      c.sb.from('series_entries').delete().in('series_id', sids),
      'sync-book-series entries delete',
    )
  await ok(c.sb.from('series').delete().eq('owner_id', c.uid), 'sync-book-series series delete')
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

/** One trusted book write atomically creates its series row and primary live entry. */
async function seedLinkedBook(
  c: Client,
  { series, title, position }: { series: string; title: string; position: number },
): Promise<{ bookId: string; seriesId: string; entryId: string }> {
  const { data: bRow } = await c.sb
    .from('books')
    .insert({
      owner_id: c.uid,
      title,
      author_first: 'Nell',
      author_last: 'Marrow',
      series,
      series_claim: { origin: 'reader', source: 'e2e_fixture' },
      position,
      status: 'ongoing',
      genre: 'fantasy',
      ownership: 'owned',
    })
    .select('id')
    .single()
  const bookId = (bRow as { id: string }).id
  const { data: sRow } = await c.sb
    .from('series')
    .select('id')
    .eq('owner_id', c.uid)
    .eq('name', series)
    .single()
  const seriesId = (sRow as { id: string }).id
  const { data: eRow } = await c.sb
    .from('series_entries')
    .select('id')
    .eq('series_id', seriesId)
    .eq('book_id', bookId)
    .is('removed_at', null)
    .single()
  return { bookId, seriesId, entryId: (eRow as { id: string }).id }
}

const bookSeries = async (c: Client, bookId: string) =>
  (
    (await c.sb.from('books').select('series').eq('id', bookId).single()).data as {
      series: string | null
    } | null
  )?.series ?? null

const openEdit = async (page: Page) => {
  await page.getByRole('button', { name: /^Edit details$/i }).click()
  const dlg = page.getByRole('dialog', { name: /Edit details/i })
  await expect(dlg).toBeVisible()
  return dlg
}

async function recordWrites(page: Page, action: () => Promise<void>): Promise<string[]> {
  const seen: string[] = []
  const onRequest = (r: { method: () => string; url: () => string }) => {
    const method = r.method()
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return
    const { pathname } = new URL(r.url())
    if (!pathname.startsWith('/rest/v1/')) return
    seen.push(`${method} ${pathname.replace('/rest/v1/', '')}`)
  }
  page.on('request', onRequest)
  try {
    await action()
  } finally {
    page.off('request', onRequest)
  }
  return seen
}

test('a book-page series reassign issues one atomic RPC, and only ONE (unrelated) books PATCH', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const { bookId } = await seedLinkedBook(c, {
    series: OLD_SAGA,
    title: 'Shape Probe',
    position: 2,
  })
  await stub(page)
  try {
    await signIn(page, c.session)
    await page.goto(`/book/${bookId}`)
    const dlg = await openEdit(page)
    await dlg.getByLabel('Series', { exact: true }).fill(NEW_SAGA)

    const writes = await recordWrites(page, async () => {
      await dlg.getByRole('button', { name: /^Save details$/i }).click()
      await dlg.getByRole('button', { name: /^Save and remove$/i }).click()
      await expect(dlg).toBeHidden({ timeout: 15_000 })
    })

    expect(writes.filter((w) => w === 'POST rpc/set_book_series_membership')).toHaveLength(1)
    // The one PATCH books that DOES fire is updateBook's own — title/isbn/pages/etc, unrelated to
    // series. The old two-write sequence's fingerprint was a SECOND, series-shaped write on top of
    // this one; the authority RPC folds that transition inside itself instead of issuing it here.
    expect(writes.filter((w) => w.startsWith('PATCH books'))).toHaveLength(1)
    expect(writes.filter((w) => w.startsWith('PATCH series_entries'))).toEqual([])

    expect(await bookSeries(c, bookId)).toBe(NEW_SAGA)
  } finally {
    await reset(c)
  }
})

test('opening an unreviewed series is read-only until the reader confirms membership', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  await stub(page)
  try {
    await signIn(page, c.session)
    const { data: sRow } = await c.sb
      .from('series')
      .insert({ owner_id: c.uid, name: OLD_SAGA })
      .select('id')
      .single()
    const seriesId = (sRow as { id: string }).id
    const { data: bRow } = await c.sb
      .from('books')
      .insert({ owner_id: c.uid, title: 'Historical Probe', series: OLD_SAGA, position: 2 })
      .select('id')
      .single()
    const bookId = (bRow as { id: string }).id
    const { data: eRow } = await c.sb
      .from('series_entries')
      .insert({
        series_id: seriesId,
        owner_id: c.uid,
        position: 2,
        title: 'Historical Probe',
        author: '',
        book_id: bookId,
      })
      .select('id')
      .single()
    const entryId = (eRow as { id: string }).id

    const writes = await recordWrites(page, async () => {
      await page.goto(`/series/${encodeURIComponent(OLD_SAGA)}`)
      await expect(page.getByText('Membership review', { exact: true })).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator('ol li')).toHaveCount(0)
    })
    expect(writes).toEqual([])

    const before = (
      await c.sb
        .from('series_entries')
        .select('membership_claim, is_primary')
        .eq('id', entryId)
        .single()
    ).data as { membership_claim: { origin: string }; is_primary: boolean }
    expect(before).toEqual({ membership_claim: { origin: 'unknown' }, is_primary: false })

    await page.getByRole('checkbox', { name: 'I reviewed every membership shown above.' }).check()
    await page.getByRole('button', { name: 'Confirm all 1 shown' }).click()
    await expect(page.locator('ol li').filter({ hasText: 'Historical Probe' })).toBeVisible({
      timeout: 20_000,
    })
    await expect
      .poll(async () => {
        const row = (
          await c.sb
            .from('series_entries')
            .select('membership_claim, is_primary')
            .eq('id', entryId)
            .single()
        ).data as { membership_claim: { source?: string }; is_primary: boolean }
        return { source: row.membership_claim.source, primary: row.is_primary }
      })
      .toEqual({ source: 'series_review', primary: true })
  } finally {
    await reset(c)
  }
})
