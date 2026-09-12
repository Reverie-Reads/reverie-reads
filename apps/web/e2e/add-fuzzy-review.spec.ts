import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

/**
 * A FUZZY match on single-Add asks, it does not silently insert a second row.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 * `AddForm.save()` called `intake(book, 'add')`. In `decideIntake`, `fuzzyMode` is consulted on the
 * LAST line — after `none`, the `always_merge`/`keep_separate` verdicts and the strong-match branch
 * have each already returned — so `'add'` meant exactly one thing: a fuzzy match falls through to a
 * silent insert. Adding "Ember and Ash" beside an existing "Ember and Ash: A Novel" by the same
 * author quietly produced a duplicate.
 *
 * The review UI for this exact decision already existed and was already wired (`setDup`, and the
 * `dup && …` block that offers Merge into it / Keep both). It was simply unreachable from
 * single-Add. Import and bulk already ask.
 *
 * ── WHY THE ASSERTION IS ON THE ROW COUNT AS WELL AS THE PROMPT ─────────────────────────────────
 * The prompt appearing is not the whole contract — the point is that nothing was written while the
 * reader decides. Asserting only the prompt would pass a build that showed the prompt AND inserted.
 * So both: the prompt is visible, and the library still holds exactly one row.
 *
 * ── WHAT MAKES THE FIXTURE FUZZY RATHER THAN STRONG ─────────────────────────────────────────────
 * `matchBook` reaches its fuzzy branch only when the normalized title+author key does NOT match but
 * the same author has a title equal after the subtitle is dropped. So the existing row carries a
 * subtitle and the incoming one does not, with the same author surname. Titles avoid hyphens on
 * purpose: `fuzzyTitle` strips from the first `:`/`–`/`—`/`-`, so "Salt-Kissed" would truncate to
 * "Salt" and the pair would match for a reason other than the one under test.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `add-fuzzy-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'add-fuzzy-e2e-password'

/** Existing row carries the subtitle; the incoming one will not. Same surname, no hyphens. */
const EXISTING_TITLE = 'Ember and Ash: A Novel'
const INCOMING_TITLE = 'Ember and Ash'
const SURNAME = 'Marrow'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  session: { access_token: string; refresh_token: string }
  uid: string
}
const shared = new Map<string, Client>()

async function client(): Promise<Client> {
  const cached = shared.get(PROJECT())
  if (cached) return cached
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL())?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL(), password: PASSWORD, email_confirm: true }),
        'add-fuzzy createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Add Fuzzy', skin: 'tryst', mode: 'dark' }),
    'add-fuzzy profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('add-fuzzy', EMAIL(), error))
  const c = { sb, session: s.session, uid: s.session.user.id }
  shared.set(PROJECT(), c)
  return c
}

async function reset(c: Client) {
  const { data } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((data as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await ok(c.sb.from('books').delete().in('id', ids), 'add-fuzzy books delete')
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

/** Fill the manual Add form with a title and one contributor surname, then submit. */
async function addManually(page: Page, title: string, surname: string) {
  await page.goto('/add')
  await page.getByRole('button', { name: /^Add manually$/i }).click()
  const t = page.getByPlaceholder('Title', { exact: true })
  await expect(t).toBeVisible({ timeout: 10_000 })
  await t.fill(title)
  await page.getByRole('button', { name: /Add contributor/i }).click()
  await page.getByLabel('Contributor 1 name').fill(surname)
  await page.getByRole('button', { name: /^Add to my library$/ }).click()
}

test('a fuzzy match on single-Add asks instead of inserting a duplicate', async ({ page }) => {
  const c = await client()
  await stub(page)
  await reset(c)

  await ok(
    c.sb.from('books').insert({
      owner_id: c.uid,
      title: EXISTING_TITLE,
      author_first: 'Nell',
      author_last: SURNAME,
      genre: 'fantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
    }),
    'add-fuzzy seed existing',
  )

  await signIn(page, c.session)
  await addManually(page, INCOMING_TITLE, SURNAME)

  // The prompt the review path exists to show.
  await expect(
    page.getByText(/You may already have/i),
    'a fuzzy match went straight to an insert instead of asking — the review UI exists and was ' +
      'unreachable from single-Add',
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Merge into it/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Keep both/i })).toBeVisible()

  // And nothing was written while the reader decides. Polled, because the insert this guards
  // against would land asynchronously — asserting once immediately could pass before it happened.
  await expect
    .poll(
      async () => ((await c.sb.from('books').select('id').eq('owner_id', c.uid)).data ?? []).length,
      {
        message: 'a second row was created despite the review prompt being shown',
        timeout: 8000,
      },
    )
    .toBe(1)
})

/**
 * The other half of the contract, and the reason this file does not just assert "a prompt appears":
 * an EXACT title+author match is a STRONG match, which `decideIntake` resolves on the line above
 * fuzzyMode. It must keep folding into the existing row rather than newly asking — otherwise the
 * fix would have quietly turned every re-add into a question.
 */
test('an exact re-add still merges silently — the strong path is untouched', async ({ page }) => {
  const c = await client()
  await stub(page)
  await reset(c)

  await ok(
    c.sb.from('books').insert({
      owner_id: c.uid,
      title: INCOMING_TITLE,
      author_first: 'Nell',
      author_last: SURNAME,
      genre: 'fantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
    }),
    'add-fuzzy seed exact',
  )

  await signIn(page, c.session)
  await addManually(page, INCOMING_TITLE, SURNAME)

  await expect
    .poll(
      async () => ((await c.sb.from('books').select('id').eq('owner_id', c.uid)).data ?? []).length,
      {
        message: 'an exact re-add should fold into the existing row, not duplicate',
        timeout: 15_000,
      },
    )
    .toBe(1)
})
