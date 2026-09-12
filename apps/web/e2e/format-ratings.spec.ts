import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

/**
 * PER-FORMAT RATING + REVIEW, in a real browser against real rows.
 *
 * `latestRatingByFormat` had 10 unit tests and NO end-to-end coverage — the rule was proven, the
 * wiring from `reads` through the mapper to the rendered row was not. This closes that: the whole
 * path, from three inserted `reads` rows to what a reader sees on the book screen.
 *
 * ── WHY THE FIXTURE HAS A LOSING AUDIOBOOK READ ─────────────────────────────────────────────────
 * Two formats would prove the row renders. Three reads — two of them the same format — prove the
 * PICK: the older Audiobook read carries a different rating AND a different note, so a build that
 * showed the wrong read, or paired one read's stars with another read's words, fails here rather
 * than passing with plausible-looking output. That pairing is the thing this feature adds, so it
 * is the thing asserted.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `format-ratings-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'format-ratings-e2e-password'

const TITLE = 'The Salt Harbour'
const AUDIO_NOTE = 'the second narrator carried it'
const PAPER_NOTE = 'read it in two sittings'
const STALE_NOTE = 'first narrator grated on me'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
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
        'format-ratings createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Formats', skin: 'tryst', mode: 'dark' }),
    'format-ratings profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('format-ratings', EMAIL(), error))
  return { sb, session: s.session, uid: s.session.user.id }
}

async function seed(c: Client): Promise<string> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('reads').delete().in('book_id', ids), 'format-ratings reads delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'format-ratings books delete')
  }
  const { data: book } = await c.sb
    .from('books')
    .insert({
      owner_id: c.uid,
      title: TITLE,
      author_first: 'Nell',
      author_last: 'Marrow',
      genre: 'fantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
    })
    .select('id')
    .single()
  const bookId = (book as { id: string }).id

  // Every row carries every column the batch uses: PostgREST builds ONE insert whose column list
  // is the UNION of all rows' keys, so a key omitted by one row arrives as an explicit NULL.
  await ok(
    c.sb.from('reads').insert([
      {
        book_id: bookId,
        owner_id: c.uid,
        read_on: '2026-01-10',
        format: 'Audiobook',
        rating: 3,
        notes: STALE_NOTE,
      },
      {
        book_id: bookId,
        owner_id: c.uid,
        read_on: '2026-06-01',
        format: 'Audiobook',
        rating: 5,
        notes: AUDIO_NOTE,
      },
      {
        book_id: bookId,
        owner_id: c.uid,
        read_on: '2026-03-05',
        format: 'Paperback',
        rating: 4,
        notes: PAPER_NOTE,
      },
    ]),
    'format-ratings reads insert',
  )
  return bookId
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

test('two rated formats each show their own stars and their own review', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await client()
  await stub(page)
  const bookId = await seed(c)
  await signIn(page, c.session)
  await page.goto(`/book/${bookId}`)

  const row = page.getByTestId('format-ratings')
  await expect(
    row,
    'the per-format row never rendered for a book with two rated formats',
  ).toBeVisible({
    timeout: 30_000,
  })

  // ── the winning read per format, by its RENDERED star label ──
  // Read-only Stars expose `role="img"` with `aria-label="Rated N stars of 5"`, so this asserts
  // what a reader (and a screen reader) actually gets, not a prop.
  const audio = page.getByTestId('format-rating-Audiobook')
  const paper = page.getByTestId('format-rating-Paperback')
  await expect(audio.getByRole('img')).toHaveAttribute('aria-label', 'Rated 5 stars of 5')
  await expect(paper.getByRole('img')).toHaveAttribute('aria-label', 'Rated 4 stars of 5')

  // ── the review beside those stars, from the SAME read ──
  await expect(page.getByTestId('format-review-Audiobook')).toHaveText(AUDIO_NOTE)
  await expect(page.getByTestId('format-review-Paperback')).toHaveText(PAPER_NOTE)

  // The older Audiobook read lost on both halves. Its note must not appear in the per-format row —
  // scoped to the row, because the reread log further down the page legitimately still shows it.
  await expect(row).not.toContainText(STALE_NOTE)
})

test('a single rated format shows no per-format row at all', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await client()
  await stub(page)
  const bookId = await seed(c)
  // Drop the Paperback read, leaving only Audiobook rated.
  await ok(
    c.sb.from('reads').delete().eq('book_id', bookId).eq('format', 'Paperback'),
    'format-ratings drop paperback',
  )
  await signIn(page, c.session)
  await page.goto(`/book/${bookId}`)

  // Anchor first, so the absence below is a real absence and not an unrendered page.
  await expect(page.getByRole('heading', { name: TITLE })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('format-ratings')).toHaveCount(0)
})
