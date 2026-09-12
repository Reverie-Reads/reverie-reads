import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import type { Route } from '@playwright/test'
import { TRYST_LABELS, workKeyOf } from '@reverie/core'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

/**
 * ADD-SEARCH TRIAGE — every catalog result says whether the reader already has it, whether the
 * corpus already describes it, or neither.
 *
 * THE ASSERTIONS ARE CONSEQUENCES, NEVER CLICKS. Playwright's `click()` passes its hit-target check
 * at mousedown and never re-checks mouseup, so a green click is evidence about this build and
 * nothing else. Every gesture here is asserted by what the reader ENDS UP WITH: the URL they land
 * on, the value in the form field, the label on the row.
 *
 * TEXT IS READ AS `innerText`, not `textContent`. `--control-transform: uppercase` in aphelion,
 * umbra and almanac leaves the DOM byte-identical while changing what a person sees, so a
 * textContent assertion would pass identically against a build that renders the wrong thing.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'add-triage-e2e@reverie.local'
const PASSWORD = 'add-triage-e2e-password'

// Owned and fresh share the query prefix. The corpus title deliberately does not, so its
// compatible exact-edition result must be joined by the second, ISBN-based lookup.
const TERM = 'Triage Probe'
const OWNED = `${TERM} Owned`
const CORPUS = 'canonical ember archive'
const CORPUS_CANONICAL = 'Canonical Ember Archive'
const FRESH = `${TERM} Fresh`
const CORPUS_FIRST_ISBN = '9780306406157'
const CORPUS_RESULT_ISBN = '9781649374042'

/**
 * WHY THE CORPUS FIXTURE IS NAMESPACED ON GENRE **AND** AUTHOR, NOT JUST ON TITLE.
 *
 * `works` is a SHARED table — it is the one book-describing table in the schema that is not
 * per-user — so a row this file inserts is visible to every other spec's reader, and the projects
 * run in parallel workers. `discover-corpus.spec.ts` browses `/discover?genre=mystery` and asserts
 * an EXACT count (`toHaveCount(25)`), and its text-filter test asserts an exact count for
 * `author_text ilike '%Vera Stone%'`. A fixture here sharing either value lands inside those
 * counts.
 *
 * That is not hypothetical — it is why this constant exists. The first draft of this file used
 * `genre: 'mystery'` and `Vera Stone`, and the full suite came back with
 * `discover-corpus` expecting 25 and receiving 26: one extra mystery work, inserted by this file,
 * in another worker, mid-assertion. Title-prefix cleanup does not help, because the collision is
 * on the columns the other spec COUNTS BY, not on the one this file deletes by.
 *
 * So: a genre no spec browses, an author no spec filters on, and a tag nothing else uses. Anything
 * added here later needs the same treatment.
 */
const CORPUS_GENRE = 'literary'
const CORPUS_AUTHOR = 'Quill Marrowbane'
const CORPUS_KEY = workKeyOf({ title: CORPUS_CANONICAL, last: CORPUS_AUTHOR })

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  admin: ReturnType<typeof createClient>
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
        'add-triage createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Triage E2E', skin: 'tryst', mode: 'dark' }),
    'add-triage profile',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('add-triage', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
  return shared
}

/** The reader owns one of the three, the corpus describes another, nothing describes the third. */
async function seed(c: Client): Promise<string> {
  await ok(c.admin.from('books').delete().eq('owner_id', c.uid), 'add-triage books cleanup')
  await ok(
    c.admin
      .from('works')
      .delete()
      .in('work_key', [CORPUS_KEY, 'canonicalemberarchive|canonicalember']),
    'add-triage works cleanup',
  )

  // EVERY ROW GETS EVERY COLUMN THE BATCH USES. PostgREST sends one INSERT for the whole array and
  // its column list is the UNION of every row's keys, so a row omitting a key the batch inserts
  // gets an explicit NULL — and a NOT NULL column then rejects the ENTIRE batch, naming the
  // constraint rather than the omission. One row here, but the rule is the rule.
  await ok(
    c.admin.from('works').insert([
      {
        work_key: CORPUS_KEY,
        // Title and full author agree with the selected edition. Neither contains the search
        // term, so the batched ISBN lookup still has to run after catalog results arrive.
        title: CORPUS_CANONICAL,
        contributors: [{ name: CORPUS_AUTHOR, role: 'author', position: 0 }],
        author_text: CORPUS_AUTHOR,
        // The matching edition is deliberately SECOND: clicking must preserve it rather than
        // replacing it with the work row's first ISBN.
        isbns: [CORPUS_FIRST_ISBN, CORPUS_RESULT_ISBN],
        series: 'The Triage Cycle',
        position: 3,
        // NAMESPACED ON EVERY AXIS THIS ROW IS COUNTABLE BY — see WHY, above the constants.
        genre: CORPUS_GENRE,
        tags: ['triage probe only'],
        cover_url: null,
        pub_y: 2021,
      },
    ]),
    'add-triage works seed',
  )

  const row = await okData(
    c.admin
      .from('books')
      .insert({
        owner_id: c.uid,
        title: OWNED,
        author_first: 'Nell',
        author_last: 'Marrow',
        genre: CORPUS_GENRE,
        status: 'standalone',
        ownership: 'owned',
        borrowed: false,
        wishlist: false,
        read_status: 'unset',
      })
      .select('id')
      .single(),
    'add-triage owned book seed',
  )
  return (row as { id: string }).id
}

/** The catalog answer, stubbed. Search requires a title; the cover may be absent because Reverie's
 *  designed placeholder is a valid presentation for a real catalog result. */
const RESULTS = [
  {
    source: 'hardcover',
    title: OWNED,
    authors: ['Nell Marrow'],
    cover: 'https://example.invalid/a.jpg',
    isbn: '',
    year: '2019',
  },
  {
    source: 'google',
    sourceUrl: 'https://books.google.com/books?id=triage-probe-corpus',
    title: CORPUS,
    // An explicit edition can carry this ISBN; a Hardcover work search cannot.
    authors: [CORPUS_AUTHOR],
    cover: 'https://example.invalid/b.jpg',
    isbn: CORPUS_RESULT_ISBN,
    year: '2021',
  },
  {
    source: 'google',
    title: FRESH,
    authors: ['Zed Quill'],
    cover: 'https://example.invalid/c.jpg',
    isbn: '',
    year: '2024',
    sourceUrl: 'https://books.google.com/books?id=triage-probe-fresh',
  },
]

async function stub(page: Page) {
  await page.route('**/functions/v1/search**', (r) => r.fulfill({ json: { results: RESULTS } }))
  for (const p of ['enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
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

const rows = (page: Page) => page.getByTestId('add-result')
const row = (page: Page, title: string) => rows(page).filter({ hasText: title })

/** What a READER sees on the row, not what the DOM stores — see the header on text-transform. */
const labelOf = (page: Page, title: string) =>
  row(page, title)
    .getByTestId('triage-label')
    .evaluate((el) => (el as HTMLElement).innerText.trim())

async function search(page: Page): Promise<string> {
  const c = await client()
  const bookId = await seed(c)
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/add')
  await page.getByLabel('Search for a book').fill(TERM)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(rows(page)).toHaveCount(3, { timeout: 20_000 })
  return bookId
}

test('each result says which of the three states it is in, in words', async ({ page }) => {
  await search(page)
  await expect.poll(() => labelOf(page, CORPUS), { timeout: 15_000 }).toBe('In the corpus')
  expect(await labelOf(page, OWNED)).toBe('In your library · also in the corpus')
  expect(await labelOf(page, FRESH)).toBe('New to your library')
  await expect(page.getByRole('heading', { name: 'Catalog matches' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Google Books search results' })).toBeVisible()
  await expect(page.getByTestId('google-books-attribution')).toHaveAttribute(
    'src',
    '/google-books-powered-by.png',
  )
  await expect(
    page.getByRole('link', { name: /View Triage Probe Fresh on Google Books/ }),
  ).toHaveAttribute('href', 'https://books.google.com/books?id=triage-probe-fresh')
})

test('"Open it" lands on the book the reader already has — not on a second copy of it', async ({
  page,
}) => {
  const bookId = await search(page)
  const open = row(page, OWNED).getByTestId('triage-open')
  // the control says what it does, as rendered
  expect(await open.evaluate((el) => (el as HTMLElement).innerText.trim())).toMatch(/^open it$/i)
  await open.click()
  // THE CONSEQUENCE: the reader is on that book's detail route, showing that book.
  await page.waitForURL(new RegExp(`/book/${bookId}$`), { timeout: 20_000 })
  await expect(page.getByRole('heading', { name: OWNED })).toBeVisible({ timeout: 20_000 })
})

test('a book already in the library offers no add gesture at all', async ({ page }) => {
  await search(page)
  // The whole row is the pick target for the other two states; for this one it is not a target,
  // and "Open it" is the only control on it.
  await expect(row(page, OWNED).locator('button')).toHaveCount(0)
  await expect(row(page, FRESH).locator('button')).toHaveCount(1)
  await expect(row(page, CORPUS).locator('button')).toHaveCount(1)
})

test('an exact edition lookup preserves corpus details and the matched ISBN', async ({ page }) => {
  const c = await client()
  await search(page)
  await expect.poll(() => labelOf(page, CORPUS), { timeout: 15_000 }).toBe('In the corpus')
  await row(page, CORPUS).locator('button').click()
  // THE CONSEQUENCE: the form carries the series, position and genre only the corpus row knows.
  // The catalog stub supplies none of them, so a green here cannot come from the search hit.
  await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue(CORPUS_CANONICAL, {
    timeout: 15_000,
  })
  await expect(page.getByPlaceholder('Series')).toHaveValue('The Triage Cycle')
  await expect(page.getByPlaceholder('Book #')).toHaveValue('3')
  // The genre select is labelled by the SKIN's vocabulary (`labels.genre`), not the word "Genre" —
  // in tryst, the skin this account is seeded with, it reads "Romance". Ask the registry rather than
  // hardcoding the string, so a vocabulary change moves this spec with it instead of breaking it.
  await expect(page.getByLabel(TRYST_LABELS.genre)).toHaveValue(CORPUS_GENRE)

  // ISBN is not a visible edit field on this compact form, so assert the click-to-prefill path at
  // its consequence: the saved book carries the SECOND, actually matched edition, never [0].
  await page.getByRole('button', { name: /^Add to my library$/ }).click()
  await expect
    .poll(async () => {
      const { data, error } = await c.admin
        .from('books')
        .select('isbn')
        .eq('owner_id', c.uid)
        .eq('title', CORPUS_CANONICAL)
        .maybeSingle()
      if (error) throw error
      return data?.isbn ?? ''
    })
    .toBe(CORPUS_RESULT_ISBN)
})

test('a conflicting ISBN result never replaces its identity with corpus details', async ({
  page,
}) => {
  const c = await client()
  await seed(c)
  await stub(page)
  const conflictingTitle = `${TERM} Conflicting edition`
  await page.route('**/functions/v1/search**', (r) =>
    r.fulfill({
      json: {
        results: [
          ...RESULTS,
          {
            source: 'google',
            title: conflictingTitle,
            authors: ['Another Writer'],
            isbn: CORPUS_RESULT_ISBN,
            cover: '',
            year: '',
            sourceUrl: 'https://books.google.com/books?id=triage-conflict',
          },
        ],
      },
    }),
  )
  await signIn(page, c.session)
  await page.goto('/add')
  await page.getByLabel('Search for a book').fill(TERM)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(rows(page)).toHaveCount(4)
  // The positive peer proves the shared ISBN response reached the UI before the negative check.
  await expect.poll(() => labelOf(page, CORPUS), { timeout: 15_000 }).toBe('In the corpus')
  expect(await labelOf(page, conflictingTitle)).toBe('New to your library')
  await row(page, conflictingTitle).locator('button').click()
  await expect(page.getByPlaceholder('Title', { exact: true })).toHaveValue(conflictingTitle)
  await expect(page.getByLabel('Contributor 1 name', { exact: true })).toHaveValue('Another Writer')
  await expect(page.getByPlaceholder('Series')).toHaveValue('')
  await expect(page.getByPlaceholder('Book #')).toHaveValue('')
})

test('classification does not block the results — labels arrive after the list does', async ({
  page,
}) => {
  const c = await client()
  await seed(c)
  await stub(page)

  // Hold the corpus query open. Deterministic rather than timing-based: the assertions below run
  // while the response is provably still outstanding, so "the list rendered first" is a fact about
  // ordering rather than a race the CI machine might lose.
  let release: () => void = () => {}
  const held = new Promise<void>((r) => {
    release = r
  })
  await page.route('**/rest/v1/works**', async (route: Route) => {
    await held
    await route.continue()
  })

  await signIn(page, c.session)
  await page.goto('/add')
  await page.getByLabel('Search for a book').fill(TERM)
  await page.getByRole('button', { name: 'Search', exact: true }).click()

  // Every hit is on screen with the corpus answer still outstanding — the claim under test.
  await expect(rows(page)).toHaveCount(3, { timeout: 20_000 })

  // And the LIBRARY half finishes while that response is STILL held, which is the other half of
  // "does not block": the two reads are independent, not chained.
  //
  // POLLED, NOT READ ONCE, and the difference is a real defect this spec had. `useBooks` is itself
  // a round trip; reading its label instantly asserts that an unrelated query has already resolved,
  // which is true most of the time and false under load. It failed exactly that way the first time
  // this file ran alongside another spec — 'New to your library', because `books` had not landed
  // yet. The product was right and the assertion was racing a query this test is not about.
  await expect.poll(() => labelOf(page, OWNED), { timeout: 20_000 }).toBe('In your library')

  // The corpus half is still unknown here (the route is held), so the row reads in the SAFE
  // direction — an extra add control — never the severe one, a withheld one.
  expect(await labelOf(page, CORPUS)).toBe('New to your library')

  release()
  await expect.poll(() => labelOf(page, CORPUS), { timeout: 20_000 }).toBe('In the corpus')
  expect(await labelOf(page, OWNED)).toBe('In your library · also in the corpus')
})
