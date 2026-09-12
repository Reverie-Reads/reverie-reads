import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

// Phase 2B's structured membership acceptance story. These tests use the same authenticated RPCs
// as the product and assert the consequences, not merely the click: primary and secondary are
// independent memberships, removal never guesses a replacement, and a reader can deliberately
// select which confirmed membership supplies the compatibility fields on books.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const TEST_EMAIL = 'series-membership-e2e@reverie.local'
const TEST_PASSWORD = 'series-membership-e2e-password'
const PRIMARY = 'Primary Cycle'
const SECONDARY = 'Connected Cycle'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
  session: { access_token: string; refresh_token: string }
  uid: string
}

let shared: Client | null = null

async function client(): Promise<Client> {
  if (shared) return shared
  // Keep the test's long-lived account deterministic; all book/series mutations below use the
  // signed-in reader client, never the service role.
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((user) => user.email === TEST_EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          email_confirm: true,
        }),
        'series-membership createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Series Membership E2E', skin: 'tryst', mode: 'system' }),
    'series-membership profile upsert',
  )

  const sb = createClient(SUPABASE_URL, ANON)
  const { data: signedIn, error } = await sb.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error || !signedIn.session)
    throw new Error(authFailure('series-membership', TEST_EMAIL, error))
  shared = { sb, session: signedIn.session, uid: signedIn.session.user.id }
  return shared
}

async function reset(c: Client): Promise<void> {
  const { data: seriesRows } = await c.sb.from('series').select('id').eq('owner_id', c.uid)
  const seriesIds = ((seriesRows ?? []) as { id: string }[]).map((row) => row.id)
  if (seriesIds.length)
    await ok(
      c.sb.from('series_entries').delete().in('series_id', seriesIds),
      'series-membership entries delete',
    )
  await ok(c.sb.from('books').delete().eq('owner_id', c.uid), 'series-membership books delete')
  await ok(c.sb.from('series').delete().eq('owner_id', c.uid), 'series-membership series delete')
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'series-membership lists delete')
}

async function signIn(page: Page, session: Client['session']): Promise<void> {
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

async function stubBackends(page: Page): Promise<void> {
  for (const endpoint of ['search', 'enrich', 'embed', 'releases', 'covers'])
    await page.route(`**/functions/v1/${endpoint}**`, (route) => route.fulfill({ json: {} }))
  await page.route('**/functions/v1/series**', (route) =>
    route.fulfill({
      json: {
        sourceRef: 'phase-2b-e2e',
        entries: [{ position: 1, title: 'Bridge Book', author: 'Nell Marrow' }],
      },
    }),
  )
  await page.route('**/books/v1/volumes**', (route) => route.fulfill({ json: { items: [] } }))
}

type Seed = {
  bookId: string
  primaryEntryId: string
  secondaryEntryId: string
}

const readerClaim = (source: string) => ({
  origin: 'reader',
  source,
  at: new Date().toISOString(),
})

async function seedMemberships(c: Client): Promise<Seed> {
  const book = await okData(
    c.sb
      .from('books')
      .insert({
        owner_id: c.uid,
        title: 'Bridge Book',
        author_first: 'Nell',
        author_last: 'Marrow',
        series: PRIMARY,
        series_claim: readerClaim('e2e_fixture'),
        position: 1,
        status: 'ongoing',
        genre: 'fantasy',
        ownership: 'owned',
        cover_url: '/landing-covers/everflame.jpg',
      })
      .select('id')
      .single(),
    'series-membership primary book insert',
  )
  const bookId = (book as { id: string }).id
  const primary = await okData(
    c.sb
      .from('series_entries')
      .select('id')
      .eq('book_id', bookId)
      .eq('is_primary', true)
      .is('removed_at', null)
      .single(),
    'series-membership primary entry read',
  )
  const secondarySeries = await okData(
    c.sb.from('series').insert({ owner_id: c.uid, name: SECONDARY }).select('id').single(),
    'series-membership secondary series insert',
  )
  const secondaryEntryId = await okData(
    c.sb.rpc('set_book_series_membership', {
      p_book: bookId,
      p_series: (secondarySeries as { id: string }).id,
      p_series_name: SECONDARY,
      p_position: 2,
      p_length: null,
      p_make_primary: false,
      p_membership_claim: readerClaim('e2e_secondary'),
      p_position_claim: readerClaim('e2e_order'),
    }),
    'series-membership secondary membership insert',
  )
  return {
    bookId,
    primaryEntryId: (primary as { id: string }).id,
    secondaryEntryId: secondaryEntryId as string,
  }
}

async function entryState(c: Client, id: string) {
  return (await c.sb.from('series_entries').select('is_primary, removed_at').eq('id', id).single())
    .data as { is_primary: boolean; removed_at: string | null }
}

async function primaryProjection(c: Client, bookId: string): Promise<string | null> {
  return (
    (await c.sb.from('books').select('series').eq('id', bookId).single()).data as {
      series: string | null
    }
  ).series
}

async function openSeries(page: Page, name: string): Promise<void> {
  await page.goto(`/series/${encodeURIComponent(name)}`)
  await expect(page.locator('ol li').filter({ hasText: 'Bridge Book' })).toBeVisible({
    timeout: 20_000,
  })
}

async function removeVisibleMembership(page: Page): Promise<void> {
  await page
    .locator('ol li')
    .filter({ hasText: 'Bridge Book' })
    .getByRole('button', { name: /Remove Bridge Book from the series/i })
    .click()
  const dialog = page.getByRole('dialog', { name: /Remove from this series/i })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: /^Remove$/ }).click()
}

async function recordWrites(page: Page, action: () => Promise<void>): Promise<string[]> {
  const writes: string[] = []
  const listener = (request: { method: () => string; url: () => string }) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/rest/v1/'))
      writes.push(`${request.method()} ${pathname.replace('/rest/v1/', '')}`)
  }
  page.on('request', listener)
  try {
    await action()
  } finally {
    page.off('request', listener)
  }
  return writes
}

test('primary removal is one atomic call, clears the projection, and does not promote secondary', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const seed = await seedMemberships(c)
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await openSeries(page, PRIMARY)

    const writes = await recordWrites(page, async () => {
      await removeVisibleMembership(page)
      await expect
        .poll(async () => (await entryState(c, seed.primaryEntryId)).removed_at, {
          timeout: 15_000,
        })
        .not.toBeNull()
    })

    expect(writes.filter((write) => write === 'POST rpc/remove_series_membership')).toHaveLength(1)
    expect(writes.filter((write) => write.startsWith('PATCH books'))).toEqual([])
    expect(writes.filter((write) => write.startsWith('PATCH series_entries'))).toEqual([])
    expect(await primaryProjection(c, seed.bookId)).toBeNull()
    expect(await entryState(c, seed.secondaryEntryId)).toEqual({
      is_primary: false,
      removed_at: null,
    })

    await page.getByRole('button', { name: /Fetch series data/i }).click()
    await expect(page.getByText('Already up to date.', { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    expect((await entryState(c, seed.primaryEntryId)).removed_at).not.toBeNull()
  } finally {
    await reset(c)
  }
})

test('secondary removal leaves the primary membership and projection unchanged', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const seed = await seedMemberships(c)
  await stubBackends(page)
  try {
    await signIn(page, c.session)
    await openSeries(page, SECONDARY)
    await expect(page.getByText('Also in this series', { exact: true })).toBeVisible()
    await removeVisibleMembership(page)

    await expect
      .poll(async () => (await entryState(c, seed.secondaryEntryId)).removed_at, {
        timeout: 15_000,
      })
      .not.toBeNull()
    expect(await primaryProjection(c, seed.bookId)).toBe(PRIMARY)
    expect(await entryState(c, seed.primaryEntryId)).toEqual({
      is_primary: true,
      removed_at: null,
    })
  } finally {
    await reset(c)
  }
})

test('a secondary membership can become primary on mobile without horizontal overflow', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await reset(c)
  const seed = await seedMemberships(c)
  await stubBackends(page)
  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await signIn(page, c.session)
    await openSeries(page, SECONDARY)
    await page
      .locator('ol li')
      .filter({ hasText: 'Bridge Book' })
      .getByRole('button', { name: 'Make primary' })
      .click()

    await expect
      .poll(async () => primaryProjection(c, seed.bookId), { timeout: 15_000 })
      .toBe(SECONDARY)
    expect(await entryState(c, seed.secondaryEntryId)).toEqual({
      is_primary: true,
      removed_at: null,
    })
    expect(await entryState(c, seed.primaryEntryId)).toEqual({
      is_primary: false,
      removed_at: null,
    })

    await page.goto(`/book/${seed.bookId}`)
    await expect(page.getByText(SECONDARY, { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(`Also in ${PRIMARY}`, { exact: true })).toBeVisible({
      timeout: 20_000,
    })
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  } finally {
    await reset(c)
  }
})
