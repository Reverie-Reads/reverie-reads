import { configureReturningReader } from './support/readerGuidance'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok } from './support/ok'

// Shelf membership against the REAL seeded library (docs/task-shelf-views.md).
//
// The method is the one this file has always used, and is why it earns its keep: expectations are
// derived from data/reader_seed.json (the reader-data half of the seed since the license split —
// this test only ever needed source/format/readStatus, all of which live there) by the documented
// rule, INDEPENDENTLY of the app, then compared with what a reader actually sees. The two sides
// agree only if the whole chain works — seed script → DB columns → row mapper → shelf predicates →
// the DOM. It exists because three empty shelves once shipped unnoticed, since no test had ever
// asked how many books were on one.
//
// The numbers moved in B2 because the shelves did. Owned is owned-only now (isOwnedBook, not
// isPossessed), so a borrowed ebook sits on Borrowed and NOT on Owned · Ebook — the inverse of what
// this file used to assert, and the assertion below inverts with it.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const DEV_EMAIL = 'shelf-membership-e2e@reverie.local'
const DEV_PASSWORD = 'shelf-membership-e2e-password'

test.describe.configure({ mode: 'serial' })

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

/** Give this spec's own user the full seeded library, through the one seeding implementation the
 *  repo has. Idempotent — a re-run replaces this user's books. */
function seedOwnLibrary(): void {
  execFileSync('node', ['scripts/seed-dev.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, DEV_EMAIL, DEV_PASSWORD },
    stdio: 'pipe',
  })
}

/**
 * What every shelf must hold, derived from the seed JSON by the rule the seed script documents:
 * `source` gives possession ('Owned' → owned, 'Borrowed' → borrowed) and `format` gives which
 * format that copy is. Computed from the raw data rather than imported from the app, so a
 * regression in the app's predicates cannot quietly move the expectation with it.
 */
function expected() {
  const seed = JSON.parse(
    readFileSync(new URL('../../../data/reader_seed.json', import.meta.url), 'utf8'),
  ) as { books?: unknown[] } | unknown[]
  const books = (Array.isArray(seed) ? seed : (seed.books ?? [])) as {
    source?: string
    format?: string
    readStatus?: string
  }[]
  const out = {
    owned: 0,
    borrowed: 0,
    readMixed: 0,
    readSplit: 0,
    dnf: 0,
    physical: 0,
    ebook: 0,
    audiobook: 0,
    unmarked: 0,
  }
  for (const b of books) {
    const f = (b.format ?? '').toLowerCase()
    if (b.source === 'Borrowed') out.borrowed++
    if (b.readStatus === 'Read') out.readSplit++
    if (b.readStatus === 'DNF') out.dnf++
    // OWNED-ONLY. A borrowed book's format belongs to Borrowed, not to a format shelf.
    if (b.source === 'Owned') {
      out.owned++
      if (/ebook|kindle/.test(f)) out.ebook++
      else if (/audio/.test(f)) out.audiobook++
      else out.physical++
    }
  }
  out.readMixed = out.readSplit + out.dnf
  // Every seeded owned book carries a format, so the unmarked bucket is empty here — which is why
  // shelf-views.spec.ts builds its own fixture for it rather than leaning on the seed.
  out.unmarked = out.owned - out.physical - out.ebook - out.audiobook
  return out
}

async function signIn(page: Page): Promise<void> {
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
  })
  if (error || !data.session) throw new Error(authFailure('shelf-membership', DEV_EMAIL, error))
  await keepOfflineCacheEmpty(page)
  await configureReturningReader(data.session.access_token)
  await page.goto(
    `/#access_token=${data.session.access_token}&refresh_token=${data.session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

async function stub(page: Page): Promise<void> {
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

/** Set the profile toggles directly, so a membership assertion is never at the mercy of a UI
 *  gesture. The gesture itself is tested in shelf-views.spec.ts, where it is the subject. */
async function setBreakdowns(format: boolean, dnf: boolean): Promise<void> {
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
  })
  if (error || !data.session)
    throw new Error(authFailure('shelf-membership toggles', DEV_EMAIL, error))
  const { error: updateError } = await sb
    .from('profiles')
    .update({ shelf_breakdown_format: format, shelf_breakdown_dnf: dnf })
    .eq('id', data.session.user.id)
  if (updateError) throw new Error(`toggle update failed: ${JSON.stringify(updateError)}`)
}

/** A section heading, e.g. "Owned · 213". A SPLIT section carries no count here — its shelves do. */
const sectionHeading = (page: Page, name: string | RegExp) => page.getByRole('heading', { name })

/** A split shelf's own heading row, e.g. "📖 Physical · 190". */
const shelfRow = (page: Page, label: string) => page.getByText(new RegExp(`${label}\\s*·\\s*\\d+`))

test('the default shelves hold what the seeded library puts on them', async ({ page }) => {
  const want = expected()
  expect(
    Math.min(want.owned, want.borrowed, want.readMixed),
    'the seed must populate Owned, Borrowed and Read or this test proves nothing',
  ).toBeGreaterThan(0)

  seedOwnLibrary()
  await setBreakdowns(false, false)
  await stub(page)
  await signIn(page)
  await page.goto('/shelves')

  await expect(sectionHeading(page, `Owned · ${want.owned}`)).toBeVisible({ timeout: 20_000 })
  await expect(sectionHeading(page, `⇄ Borrowed · ${want.borrowed}`)).toBeVisible()
  // Read holds abandoned books too while the DNF breakdown is off — 286 Read + 4 DNF.
  await expect(sectionHeading(page, `Read · ${want.readMixed}`)).toBeVisible()

  // The seed carries no wanting signal, so Wishlist has nothing and the whole section collapses —
  // where the old screen would have rendered an empty shelf with an invitation in it.
  await expect(sectionHeading(page, /Wishlist/)).toHaveCount(0)
})

test('the format breakdown splits Owned, and borrowed books stay out of it', async ({ page }) => {
  // The INVERTED assertion. Owned is owned-only now: the seed's 65 borrowed ebooks are on Borrowed,
  // and Owned · Ebook holds only the 3 books actually owned as ebooks. Before B2 this file asserted
  // the opposite — that a borrowed ebook DID land on the ebook shelf.
  const want = expected()
  seedOwnLibrary()
  await setBreakdowns(true, false)
  await stub(page)
  await signIn(page)
  await page.goto('/shelves')

  for (const [label, n] of [
    ['📖 Physical', want.physical],
    ['📱 Ebook', want.ebook],
    ['🎧 Audiobook', want.audiobook],
  ] as const) {
    await expect(shelfRow(page, label), `${label} readout`).toHaveText(new RegExp(`·\\s*${n}$`), {
      timeout: 20_000,
    })
  }

  // The split is a partition of the OWNED set: the shelves account for every owned book.
  expect(want.physical + want.ebook + want.audiobook + want.unmarked).toBe(want.owned)
  // Every seeded owned book has a format, so the unmarked bucket is empty and does not render.
  expect(want.unmarked).toBe(0)
  await expect(page.getByText(/Format not set/)).toHaveCount(0)

  // Borrowed keeps all 77 — none of them leaked onto a format shelf.
  await expect(sectionHeading(page, `⇄ Borrowed · ${want.borrowed}`)).toBeVisible()
})

test('the DNF breakdown splits Read without changing what counts as read', async ({ page }) => {
  const want = expected()
  seedOwnLibrary()
  await setBreakdowns(false, true)
  await stub(page)
  await signIn(page)
  await page.goto('/shelves')

  await expect(shelfRow(page, 'Read'), 'Read readout').toHaveText(
    new RegExp(`·\\s*${want.readSplit}$`),
    { timeout: 20_000 },
  )
  await expect(shelfRow(page, '⊘ Did not finish')).toHaveText(new RegExp(`·\\s*${want.dnf}$`))
  // Split Read + DNF equals mixed Read: nothing gained or lost, only separated.
  expect(want.readSplit + want.dnf).toBe(want.readMixed)
})

test('an abandoned book you never owned is still in the library', async ({ page }) => {
  // Unchanged from B1, and still the only fixture here that is NOT in hand: unowned, not borrowed,
  // not wanted, never finished. It reaches the library through hasReadingHistory alone.
  seedOwnLibrary()
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: DEV_EMAIL,
    password: DEV_PASSWORD,
  })
  if (error || !data.session) throw new Error(authFailure('shelf-membership dnf', DEV_EMAIL, error))
  const uid = data.session.user.id

  const title = 'Abandoned And Unowned'
  await ok(
    sb.from('books').delete().eq('owner_id', uid).eq('title', title),
    'shelf-membership books delete',
  )
  const { error: insertError } = await sb.from('books').insert({
    owner_id: uid,
    title,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'unowned',
    borrowed: false,
    wishlist: false,
    read_status: 'DNF',
  })
  expect(insertError, 'DNF fixture insert').toBeNull()

  await stub(page)
  await signIn(page)
  await page.goto('/library')

  await expect(page.getByRole('button', { name: `Open ${title}, did not finish` })).toBeVisible({
    timeout: 20_000,
  })

  await ok(
    sb.from('books').delete().eq('owner_id', uid).eq('title', title),
    'shelf-membership books delete',
  )
})
