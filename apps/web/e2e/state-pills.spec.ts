import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

// Borrowed and DNF must be visible while browsing (docs/archive/task-state-pills.md).
//
// Before this branch: borrowed had a mark on cards only — translucent, measuring 1.1–2.7:1 against
// worst-case cover art — and DNF had nothing anywhere. Neither reached an accessible name; a grep
// for aria text mentioning borrow or DNF returned zero hits across the whole app. A reader browsing
// a shelf could not tell an abandoned book from a finished one, and that matters most where the
// shelf model puts DNF books on a shelf labelled "Read".
//
// This runs in the MAIN e2e job, not the a11y sweep, deliberately: axe cannot measure text over an
// image, so it would pass a pill nobody can read. Contrast is guarded in packages/core across all
// nine skins; what needs a browser is that the pills actually RENDER and that the state reaches the
// accessibility tree, which is what this asserts.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'state-pills-e2e@reverie.local'
const PASSWORD = 'state-pills-e2e-password'

const DNF_TITLE = 'Abandoned Probe'
const BORROWED_TITLE = 'Loaned Probe'
const PLAIN_TITLE = 'Finished Probe'

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
        'state-pills createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'State Pills E2E', skin: 'tryst', mode: 'dark' }),
    'state-pills profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('state-pills', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

/** Three books: abandoned-and-never-owned, borrowed, and an ordinary finished one as the control. */
async function seedFixtures(c: Client): Promise<void> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'state-pills list_items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'state-pills books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'state-pills lists delete')

  // Every row carries EVERY possession column, including the defaults. In a bulk insert PostgREST
  // takes the union of all rows' keys as the column set, so a key omitted from one row is sent as
  // an explicit NULL rather than falling back to the column default — which the stage-A NOT NULL
  // then rejects, correctly, for the whole batch. Spelling them out is the fix.
  const base = {
    owner_id: c.uid,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
  }
  const { error: insertError } = await c.sb.from('books').insert([
    // Not in hand and never finished — visible only through hasReadingHistory, and the exact book
    // that would sit unmarked on a Read-labelled shelf.
    {
      ...base,
      title: DNF_TITLE,
      ownership: 'unowned',
      borrowed: false,
      wishlist: false,
      read_status: 'DNF',
    },
    {
      ...base,
      title: BORROWED_TITLE,
      ownership: 'unowned',
      borrowed: true,
      wishlist: false,
      read_status: 'Read',
    },
    { ...base, title: PLAIN_TITLE, ownership: 'owned', read_status: 'Read' },
  ])
  // Never swallow this. A silent insert failure makes an absent pill look like a rendering bug and
  // sends the next reader hunting in the wrong file (docs/backlog/BACKLOG.md, swallowed Supabase errors).
  if (insertError) throw new Error(`state-pills seed failed: ${JSON.stringify(insertError)}`)
}

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

/** A book's card: the element wrapping its cover button, which is where the pills live. The name
 *  is matched by PREFIX so this works both before and after the accessible name gains its suffix. */
const cardOf = (page: Page, title: string) =>
  page.getByRole('button', { name: new RegExp(`^Open ${title}`) }).locator('xpath=..')

async function stub(page: Page) {
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

test('a DNF book and a borrowed book each wear their pill on the library grid', async ({
  page,
}) => {
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/library')

  // Wait for the grid to hold the control book before asserting on the others, so a slow query
  // cannot make an absent pill look like a passing test.
  await expect(page.getByRole('button', { name: `Open ${PLAIN_TITLE}` })).toBeVisible({
    timeout: 20_000,
  })

  // SCOPED to each book's own card. An unscoped getByText('DNF') matches the Library's read-status
  // FILTER CHIP, which exists whether or not any pill was ever rendered — a green test proving
  // nothing. The pills are aria-hidden (state is spoken through the card's name), so these are
  // DOM-text assertions; getByText does not consult the accessibility tree.
  await expect(cardOf(page, DNF_TITLE).getByText('DNF')).toBeVisible()
  await expect(cardOf(page, BORROWED_TITLE).getByText('Borrowed')).toBeVisible()

  // …and the finished control wears neither. Safe as a negative because the two assertions above
  // have already waited for the moment a pill would have appeared.
  await expect(cardOf(page, PLAIN_TITLE).getByText('DNF')).toHaveCount(0)
  await expect(cardOf(page, PLAIN_TITLE).getByText('Borrowed')).toHaveCount(0)
})

test('both states reach the accessible name of the card control', async ({ page }) => {
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/library')

  // getByRole resolves through the accessibility tree, so these pass only if the state is part of
  // the button's computed NAME — not merely present as sibling text nearby.
  await expect(page.getByRole('button', { name: `Open ${DNF_TITLE}, did not finish` })).toBeVisible(
    { timeout: 20_000 },
  )
  await expect(page.getByRole('button', { name: `Open ${BORROWED_TITLE}, borrowed` })).toBeVisible()

  // The control book gains nothing — the suffix is not appended unconditionally.
  await expect(page.getByRole('button', { name: `Open ${PLAIN_TITLE}` })).toBeVisible()
})

test('mood and trope cover grids show the same state pills as the Library', async ({ page }) => {
  const c = await client()
  await seedFixtures(c)
  await ok(c.sb.from('book_moods').delete().eq('owner_id', c.uid), 'state-pills moods unlink')
  await ok(c.sb.from('book_tropes').delete().eq('owner_id', c.uid), 'state-pills tropes unlink')
  await ok(c.sb.from('moods').delete().eq('owner_id', c.uid), 'state-pills moods delete')
  await ok(c.sb.from('tropes').delete().eq('owner_id', c.uid), 'state-pills tropes delete')

  const rows = await okData(
    c.sb.from('books').select('id, title').eq('owner_id', c.uid),
    'state-pills facet books',
  )
  const bookIds = (rows as { id: string; title: string }[]).map((row) => row.id)
  const mood = (await okData(
    c.sb.from('moods').insert({ owner_id: c.uid, name: 'State Marks Mood' }).select('id').single(),
    'state-pills mood insert',
  )) as { id: string }
  const trope = (await okData(
    c.sb
      .from('tropes')
      .insert({ owner_id: c.uid, name: 'State Marks Trope', facet: 'vibe' })
      .select('id')
      .single(),
    'state-pills trope insert',
  )) as { id: string }
  await ok(
    c.sb
      .from('book_moods')
      .insert(bookIds.map((bookId) => ({ book_id: bookId, mood_id: mood.id, owner_id: c.uid }))),
    'state-pills mood assignments',
  )
  await ok(
    c.sb.from('book_tropes').insert(
      bookIds.map((bookId) => ({
        book_id: bookId,
        trope_id: trope.id,
        owner_id: c.uid,
        emphasis: 'present',
      })),
    ),
    'state-pills trope assignments',
  )

  await stub(page)
  await signIn(page, c.session)

  for (const route of [`/moods/${mood.id}`, `/tropes/${trope.id}`]) {
    await page.goto(route)
    const dnf = page.getByRole('button', { name: `Open ${DNF_TITLE}, did not finish` })
    const borrowed = page.getByRole('button', {
      name: `Open ${BORROWED_TITLE}, read, borrowed`,
    })
    const read = page.getByRole('button', { name: `Open ${PLAIN_TITLE}, read` })
    await expect(dnf.getByText('DNF')).toBeVisible({ timeout: 20_000 })
    await expect(borrowed.getByText('Borrowed')).toBeVisible()
    await expect(borrowed.getByText('Read')).toBeVisible()
    await expect(read.getByText('Read')).toBeVisible()

    const width = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    expect(width.scroll).toBeLessThanOrEqual(width.client + 1)
  }
})

test('a spine shelf carries state in the accessible name — the surface that never has', async ({
  page,
}) => {
  // Beyond the literal e2e ask, because this is the surface B2 depends on: with the DNF breakdown
  // toggle off, an abandoned book sits on a Read-labelled shelf, and a 26px spine cannot hold a
  // text pill. If the name does not carry it, nothing does.
  const c = await client()
  await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)

  const list = await okData(
    c.sb
      .from('lists')
      .insert({ owner_id: c.uid, name: 'Pill Shelf', kind: 'collection', sort_order: 1 })
      .select('id')
      .single(),
    'state-pills lists insert',
  )
  const { data: books } = await c.sb
    .from('books')
    .select('id, title')
    .eq('owner_id', c.uid)
    .in('title', [DNF_TITLE, BORROWED_TITLE])
  const listId = (list as { id: string }).id
  await ok(
    c.sb.from('list_items').insert(
      ((books as { id: string; title: string }[]) ?? []).map((b, i) => ({
        list_id: listId,
        book_id: b.id,
        owner_id: c.uid,
        position: i + 1,
      })),
    ),
    'state-pills list_items insert',
  )

  await page.goto(`/shelf/${listId}`)
  // Spines read "Open …" once revealed and "Reveal …" otherwise; either way the state rides along.
  //
  // SCOPED to `[data-spine]` because this test's name is a promise about the SPINE surface. Since
  // the shared reveal band landed, the picked book also has a cover button in the band carrying the
  // same accessible name — a deliberate duplicate (the sticky-bar-repeats-the-CTA pattern), and the
  // reason an unscoped getByRole now resolves to two elements. Scoping asserts what the name says
  // rather than whichever control happens to be unique.
  await expect(
    page.locator(`[data-spine][aria-label*="${DNF_TITLE}, did not finish"]`),
  ).toBeVisible({ timeout: 20_000 })
  await expect(
    page.locator(`[data-spine][aria-label*="${BORROWED_TITLE}, borrowed"]`),
  ).toBeVisible()
})
