import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// The shelf cases the seed and production cannot supply (docs/task-shelf-views.md).
//
// Every book here is hand-built, because each combination has ZERO instances in production and none
// arises from an organic path — so none of these bugs could surface on real data before a reader
// hit them:
//   · a DNF book WITH a logged read — the case that makes the !isDnf guard load-bearing
//   · owned + wanted, and owned + borrowed — the overlaps a flag model allows and an enum could not
//   · owned with no format flag — 98% of production, but 0% of the seed
//
// Plus the toggles themselves: both states, and that they survive a reload because they live on the
// profile rather than in this tab.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'shelf-views-e2e@reverie.local'
const PASSWORD = 'shelf-views-e2e-password'

const DNF_READ = 'Abandoned Mid Read'
const OWNED_WANTED = 'Owned And Wanted'
const OWNED_BORROWED = 'Owned And Borrowed'
const OWNED_UNMARKED = 'Owned No Format'
const OWNED_PAPERBACK = 'Owned In Paperback'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
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
        admin.auth.admin.createUser({
          email: EMAIL,
          password: PASSWORD,
          email_confirm: true,
        }),
        'shelf-views createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Shelf Views E2E', skin: 'tryst', mode: 'dark' }),
    'shelf-views profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('shelf-views', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

async function seedFixtures(c: Client): Promise<void> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('reads').delete().in('book_id', ids), 'shelf-views reads delete')
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'shelf-views list_items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'shelf-views books delete')
  }

  // EVERY row carries EVERY possession column. In a bulk insert PostgREST takes the union of all
  // rows' keys as the column set, so a key omitted from one row is sent as an explicit NULL — which
  // the NOT NULL columns reject, for the whole batch.
  const base = {
    owner_id: c.uid,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'unowned',
    borrowed: false,
    wishlist: false,
    read_status: 'unset',
    owned_physical: null as string | null,
    owned_ebook: false,
    owned_audiobook: false,
  }

  const { data: inserted, error } = await c.sb
    .from('books')
    .insert([
      { ...base, title: DNF_READ, read_status: 'DNF' },
      { ...base, title: OWNED_WANTED, ownership: 'owned', wishlist: true },
      { ...base, title: OWNED_BORROWED, ownership: 'owned', borrowed: true },
      { ...base, title: OWNED_UNMARKED, ownership: 'owned' },
      { ...base, title: OWNED_PAPERBACK, ownership: 'owned', owned_physical: 'paperback' },
    ])
    .select('id, title')
  if (error) throw new Error(`shelf-views seed failed: ${JSON.stringify(error)}`)

  // The logged read that makes DNF_READ dangerous: isBookRead() will now say true for it.
  const dnfId = ((inserted as { id: string; title: string }[]) ?? []).find(
    (b) => b.title === DNF_READ,
  )?.id
  expect(dnfId, 'DNF fixture must exist before its read can be logged').toBeTruthy()
  const { error: readError } = await c.sb
    .from('reads')
    .insert({ book_id: dnfId, owner_id: c.uid, read_on: '2026-01-01', format: '', rating: 0 })
  if (readError) throw new Error(`shelf-views read log failed: ${JSON.stringify(readError)}`)
}

async function setBreakdowns(c: Client, format: boolean, dnf: boolean): Promise<void> {
  const { error } = await c.sb
    .from('profiles')
    .update({ shelf_breakdown_format: format, shelf_breakdown_dnf: dnf })
    .eq('id', c.uid)
  if (error) throw new Error(`toggle update failed: ${JSON.stringify(error)}`)
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

/** The section container for a heading, so membership can be asserted per shelf rather than
 *  page-wide — a page-wide getByText would match any shelf and prove nothing about which.
 *  Three levels up: heading -> the header button that makes it navigate (shelf-header-links.spec.ts)
 *  -> the header row -> the section container holding this section's shelves. */
const sectionFor = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { name }).locator('xpath=../../..')

/** The books on a shelf, by the accessible names of its spines. */
async function spineTitles(scope: ReturnType<typeof sectionFor>): Promise<string[]> {
  return (await scope
    .locator('[data-spine]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))) as string[]
}

async function open(page: Page, format: boolean, dnf: boolean) {
  const c = await client()
  await seedFixtures(c)
  await setBreakdowns(c, format, dnf)
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/shelves')
  await page
    .getByRole('heading', { name: /^Owned/ })
    .first()
    .waitFor({ timeout: 20_000 })
}

test('with the split on, an abandoned book is on DNF and not on Read', async ({ page }) => {
  // SCOPE, stated because the obvious reading of this fixture is wrong. The book carries a logged
  // read, but this test does NOT prove the `!isDnf` guard: the books cache sets `reads: []`
  // (mappers.ts — reads load separately and are never merged into the list), so on this screen
  // isBookRead() reduces to readStatus === 'Read' and never sees the logged read at all. Removing
  // the guard leaves this test green.
  //
  // The guard is covered where it is reachable — packages/core/src/shelves.test.ts, against a Book
  // whose `reads` array is populated. What THIS test proves is the separation a reader can actually
  // see: an abandoned book files under DNF, and the Read shelf does not claim it.
  await open(page, false, true)

  // The DNF shelf renders, labelled, holding exactly our book.
  const dnfRow = page.getByText(/Did not finish\s*·\s*\d+/)
  await expect(dnfRow).toHaveText(/·\s*1$/, { timeout: 20_000 })
  const dnfTitles = await spineTitles(dnfRow.locator('xpath=..') as ReturnType<typeof sectionFor>)
  expect(dnfTitles.join(' | ')).toContain(DNF_READ)

  // No fixture is finished, so the split Read shelf is empty — and an empty shelf does not render.
  // Safe as a negative: the assertion above already waited for the section to paint.
  await expect(page.getByText(/^Read\s*·\s*\d+$/)).toHaveCount(0)

  // The section is still labelled "Read" and carries NO count, because it is split. If the section
  // wrongly reported itself unsplit it would render "Read · 1" — filing an abandoned book under
  // exactly the word the split exists to keep off it.
  await expect(page.getByRole('heading', { name: 'Read', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /^Read · / })).toHaveCount(0)
})

test('an owned + wanted book sits on both Owned and Wishlist', async ({ page }) => {
  await open(page, false, false)
  expect((await spineTitles(sectionFor(page, /^Owned/))).join(' | ')).toContain(OWNED_WANTED)
  expect((await spineTitles(sectionFor(page, /Wishlist/))).join(' | ')).toContain(OWNED_WANTED)
})

test('an owned + borrowed book sits on both Owned and Borrowed', async ({ page }) => {
  await open(page, false, false)
  expect((await spineTitles(sectionFor(page, /^Owned/))).join(' | ')).toContain(OWNED_BORROWED)
  expect((await spineTitles(sectionFor(page, /Borrowed/))).join(' | ')).toContain(OWNED_BORROWED)
})

test('with the format split on, an unmarked owned book is in the bucket and nowhere else', async ({
  page,
}) => {
  await open(page, true, false)

  // The bucket holds it…
  await expect(page.getByText(/Format not set\s*·\s*\d+/)).toBeVisible()
  const owned = sectionFor(page, /^Owned/)
  const all = (await spineTitles(owned)).join(' | ')
  expect(all).toContain(OWNED_UNMARKED)

  // …and no format shelf does. Physical exists (one fixture is a paperback), so this is a real
  // discrimination rather than an assertion against an absent shelf.
  await expect(page.getByText(/📖 Physical\s*·\s*\d+/)).toHaveText(/·\s*1$/)
  const physicalShelf = page.getByText(/📖 Physical\s*·\s*\d+/).locator('xpath=..')
  const physicalTitles = await spineTitles(physicalShelf as ReturnType<typeof sectionFor>)
  expect(physicalTitles.join(' | ')).toContain(OWNED_PAPERBACK)
  expect(physicalTitles.join(' | ')).not.toContain(OWNED_UNMARKED)
})

test('both toggles work in both states and survive a reload', async ({ page }) => {
  await open(page, false, false)

  // Off: one Owned shelf, one Read shelf, no split headings anywhere.
  await expect(page.getByText(/Format not set/)).toHaveCount(0)
  await expect(page.getByText(/Did not finish/)).toHaveCount(0)

  // Turn both on through the real controls.
  await page.getByRole('switch', { name: 'Split by format' }).click()
  await expect(page.getByText(/Format not set\s*·\s*\d+/)).toBeVisible({ timeout: 15_000 })
  await page.getByRole('switch', { name: 'Split out did not finish' }).click()
  await expect(page.getByText(/Did not finish\s*·\s*\d+/)).toBeVisible({ timeout: 15_000 })

  // Profile-synced, not local: a full reload drops every bit of in-tab state, so the split
  // surviving it is the evidence that the preference reached the profile.
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Split by format' })).toHaveAttribute(
    'aria-checked',
    'true',
    { timeout: 20_000 },
  )
  await expect(page.getByRole('switch', { name: 'Split out did not finish' })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await expect(page.getByText(/Format not set\s*·\s*\d+/)).toBeVisible()
  await expect(page.getByText(/Did not finish\s*·\s*\d+/)).toBeVisible()

  // …and back off again, so the test covers the return trip rather than a one-way latch.
  await page.getByRole('switch', { name: 'Split by format' }).click()
  await expect(page.getByText(/Format not set/)).toHaveCount(0, { timeout: 15_000 })
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Split by format' })).toHaveAttribute(
    'aria-checked',
    'false',
    { timeout: 20_000 },
  )
})
