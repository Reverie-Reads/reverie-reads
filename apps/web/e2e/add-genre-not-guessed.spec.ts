import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

/**
 * A book added WITHOUT the reader choosing a genre must save with no genre — not the skin's.
 *
 * ── THE CONTRACT, WHICH THE APP ALREADY WRITES DOWN ─────────────────────────────────────────────
 * `Book.genre` in packages/core/src/types.ts: "'' = not chosen yet — the edit form prompts, never
 * guesses." AddRoute did the opposite: it seeded `form.genre` from the ACTIVE SKIN's genre
 * association and saved that value whether or not the reader ever opened the picker. Scanning a
 * book in Aphelion stamped it `science fiction` / `Space Opera` — not because any catalogue said so,
 * but because Aphelion is the sci-fi room and Space Opera is that genre's first subgenre.
 *
 * A guessed value is indistinguishable from a chosen one once stored. That is what makes this worse
 * than a blank: the library, the filters and the taste model all read it as the reader's own answer.
 *
 * ── WHY THE ASSERTION IS ON THE DATABASE ROW ────────────────────────────────────────────────────
 * The defect is what gets STORED. Asserting on the form would pass against the broken build (the
 * picker legitimately shows the skin's genre first — that convenience is kept), and asserting on
 * the rendered book screen would only catch it if some surface happens to display genre. The row is
 * the thing.
 *
 * ── SKIN-INDEPENDENCE IS ITS OWN CASE ───────────────────────────────────────────────────────────
 * The second test adds the same way under a DIFFERENT skin. If any skin-derived value still leaked
 * into the save through another path, the two rows would disagree; both being empty is what proves
 * the picker's opening-category convenience stays in the UI where it belongs.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `add-genre-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'add-genre-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  admin: ReturnType<typeof createClient>
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
        'add-genre createUser',
      )
    ).id
  // Aphelion: the skin from the original report, whose association is science fiction.
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Add Genre', skin: 'aphelion', mode: 'dark' }),
    'add-genre profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('add-genre', EMAIL(), error))
  const c = { sb, admin, session: s.session, uid: s.session.user.id }
  shared.set(PROJECT(), c)
  return c
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

/** Everything external stubbed EMPTY, so no enrichment can supply a genre — any genre on the saved
 *  row therefore came from the app itself, which is exactly the value under test. */
async function stub(page: Page) {
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

/** Add one book through the manual fast path, touching NOTHING but the title. */
async function addBookTitled(page: Page, title: string) {
  await page.goto('/add')
  await page.getByRole('button', { name: /^Add manually$/i }).click()
  const t = page.getByPlaceholder('Title', { exact: true })
  await expect(t).toBeVisible({ timeout: 10_000 })
  await t.fill(title)
  await page.getByRole('button', { name: /^Add to my library$/ }).click()
  await expect(page.getByRole('button', { name: /^Add to my library$/ })).toBeHidden({
    timeout: 20_000,
  })
}

async function row(c: Client, title: string) {
  const { data } = await c.sb
    .from('books')
    .select('title, genre, subgenre, subgenres, genres')
    .eq('owner_id', c.uid)
    .eq('title', title)
    .maybeSingle()
  return data as {
    genre: string | null
    subgenre: string | null
    subgenres: string[] | null
    genres: string[] | null
  } | null
}

test('a book added without choosing a genre saves with none — not the skin’s', async ({ page }) => {
  const c = await client()
  await stub(page)
  await ok(
    c.admin.from('profiles').update({ skin: 'aphelion' }).eq('id', c.uid),
    'add-genre skin aphelion',
  )
  const TITLE = `Meat Bees ${PROJECT()}`
  await ok(
    c.sb.from('books').delete().eq('owner_id', c.uid).eq('title', TITLE),
    'add-genre cleanup',
  )
  await signIn(page, c.session)

  // The skin really is the sci-fi room — otherwise this test could pass without proving anything.
  //
  // toHaveAttribute, NOT `expect(await page.evaluate(...))`. The skin arrives in two stages:
  // useSkin.ts:21 paints from localStorage's `reverie.skin` for an instant first frame, then :86
  // reconciles from the PROFILE at sign-in. A one-shot evaluate is a snapshot with no retry, so it
  // races that reconciliation — and when it loses it reads the localStorage default and reports
  // `tryst`, which is a true statement about a frame nobody sees. toHaveAttribute polls, so it
  // waits for the settle it is actually asserting. Cost three unrelated gates on 2026-08-21.
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'aphelion')

  await addBookTitled(page, TITLE)

  const r = await row(c, TITLE)
  expect(r, `no row saved for "${TITLE}"`).not.toBeNull()
  expect(
    r!.genre ?? '',
    `genre was stamped from the active skin. The reader never opened the picker, so this is a guess ` +
      `stored as if it were their answer — types.ts: "'' = not chosen yet".`,
  ).toBe('')
  expect(r!.subgenre ?? '', 'subgenre was stamped from the skin genre’s first subgenre').toBe('')
  expect(r!.subgenres ?? [], 'subgenres carried the skin-derived default').toEqual([])
  expect(r!.genres ?? [], 'genres[] carried the skin-derived default').toEqual([])
})

test('the same add under a different skin stores the same nothing', async ({ page }) => {
  const c = await client()
  await stub(page)
  await ok(
    c.admin.from('profiles').update({ skin: 'grimoire' }).eq('id', c.uid),
    'add-genre skin grimoire',
  )
  const TITLE = `Meat Bees Redux ${PROJECT()}`
  await ok(
    c.sb.from('books').delete().eq('owner_id', c.uid).eq('title', TITLE),
    'add-genre cleanup',
  )
  await signIn(page, c.session)
  // Same two-stage race as the aphelion assertion above — this one never reported red, which is
  // exactly why it is fixed in the same pass: it is the identical snapshot against the identical
  // reconciliation, and "has not failed yet" is a statement about timing, not about safety.
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'grimoire')

  await addBookTitled(page, TITLE)

  const r = await row(c, TITLE)
  expect(r, `no row saved for "${TITLE}"`).not.toBeNull()
  // Grimoire's association is fantasy. If ANY skin-derived value still reached the save, this row
  // and the aphelion one above would differ; both empty is the proof they cannot.
  expect(r!.genre ?? '', 'grimoire’s genre leaked into the save').toBe('')
  expect(r!.subgenres ?? [], 'grimoire’s first subgenre leaked into the save').toEqual([])
})
