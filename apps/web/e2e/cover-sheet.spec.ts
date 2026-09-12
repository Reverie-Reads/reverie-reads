import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import AxeBuilder from '@axe-core/playwright'
import { expectResolvedMode } from './support/mode'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

// Cover system e2e (docs/archive/task-cover-system.md): the sheet's four paths against a STUBBED covers
// Edge Function (deterministic, offline-safe), the lazy backfill, the edition-details sync, the
// graceful non-image failure, and the placeholder's "add a cover" affordance. The REAL ingest
// pipeline (magick-wasm normalize → Storage) is exercised against the deployed function in the
// golden-rule eyeball, and the camera path on a real phone — this spec covers the app wiring.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
// A dedicated user, not the seeded dev account. Every test here builds and tears down its own
// fixture book, so an empty library is all it ever needed; sharing dev@reverie.local only meant
// racing a11y's eight profile skin/mode flips per run.
const EMAIL = 'cover-sheet-e2e@reverie.local'
const PASSWORD = 'cover-sheet-e2e-password'

// Stub asset per path, so every assertion can tell WHICH ingest produced the cover.
const STUB = {
  backfill: '/landing-covers/everflame.jpg',
  edition: '/landing-covers/king-of-wrath.jpg',
  upload: '/landing-covers/never-king.jpg',
  pasted: '/landing-covers/mile-high.jpg',
} as const

// A real jacket image from the repo — the upload/camera file (both paths share the file-input →
// crop → ingest mechanics; a real photo-sized image exercises the cover-fit + zoom math).
const UPLOAD_FILE = 'public/landing-covers/acotar.jpg'

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  const { access_token, refresh_token } = session
  // This user's library holds only whatever fixture the current test inserted, and HomeRoute sends
  // a reader with no books and no onboarding flag to /onboarding, which renders no <nav>. Fixtures
  // happen to be inserted before this runs today, but set the flag explicitly rather than let the
  // assertion below depend on that ordering.
  await keepOfflineCacheEmpty(page)
  await configureReturningReader(access_token)
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

async function ensureUser(): Promise<void> {
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
        'cover-sheet createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      // mode PINNED, not 'system': this spec runs an axe contrast scan, and 'system' resolves through
      // prefers-color-scheme at runtime — so the scan would be asserted against whichever surface the
      // environment produced. Observed on PR #252's gate as a real flake (color-contrast failed one
      // run, passed the next, no code change). 'dark' matches the convention across this suite's
      // other axe/colour specs and the app's own fallback when no light preference matches.
      .upsert({ id: uid, display_name: 'Cover Sheet E2E', skin: 'tryst', mode: 'dark' }),
    'cover-sheet profiles upsert',
  )
}

// One signed-in client per test, shared by fixtures + the page hand-off — the local GoTrue
// sign_in_sign_ups budget is per-IP, and the fullyParallel suite spends it fast.
async function devClient() {
  await ensureUser()
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !data.session) throw new Error(authFailure('cover-sheet', EMAIL, error))
  return { sb, session: data.session, uid: data.session.user.id }
}
type DevClient = Awaited<ReturnType<typeof devClient>>

// Each test owns a DISTINCT fixture title (never share/wipe across parallel tests). Pre-clean
// handles a crashed prior run of the SAME test only.
async function insertFixture(c: DevClient, title: string, coverUrl?: string): Promise<string> {
  await ok(c.sb.from('books').delete().eq('title', title), 'cover-sheet books delete')
  const r = await okData(
    c.sb
      .from('books')
      // ownership:'owned' matters. Possession defaults to no claim at all, and the Library grid shows
      // the DEFAULT library — what you have in hand or have any reading history with
      // (inDefaultLibrary) — so a bare fixture is deliberately hidden and never renders a card.
      // The placeholder-affordance test needs a book that is actually in the library.
      .insert({
        owner_id: c.uid,
        title,
        ownership: 'owned',
        ...(coverUrl ? { cover_url: coverUrl } : {}),
      })
      .select('id')
      .single(),
    'cover-sheet books insert',
  )
  return r.id
}

const removeFixture = (c: DevClient, title: string) =>
  c.sb.from('books').delete().eq('title', title)

/** Stub the covers Edge Function: editions list + per-path ingest responses + a non-image failure. */
async function stubCoversFunction(page: Page) {
  await page.route('**/functions/v1/covers**', async (route) => {
    const req = route.request()
    const contentType = req.headers()['content-type'] ?? ''
    if (contentType.includes('multipart/form-data')) {
      // camera/upload ingest (post-crop file)
      return route.fulfill({
        json: { cover: STUB.upload, thumb: STUB.upload, color: '#8a2f52', sourceUrl: null },
      })
    }
    const body = req.postDataJSON() as { action?: string; url?: string }
    if (body.action === 'editions') {
      return route.fulfill({
        json: {
          editions: [
            {
              source: 'hardcover',
              cover: STUB.edition,
              isbn13: '9781668001226',
              format: 'Hardcover',
              year: 2022,
              publisher: 'Bloom Books',
              pages: 368,
            },
            {
              source: 'google',
              cover: STUB.pasted,
              isbn13: '9780593598424',
              year: 2023,
              publisher: 'Berkley',
            },
          ],
        },
      })
    }
    const url = body.url ?? ''
    if (url.includes('not-an-image'))
      return route.fulfill({ status: 415, json: { error: 'not_an_image' } })
    if (url.includes('covers.openlibrary.org'))
      return route.fulfill({
        json: { cover: STUB.backfill, thumb: STUB.backfill, color: '#2f5a8a', sourceUrl: url },
      })
    if (url === STUB.edition)
      return route.fulfill({
        json: { cover: STUB.edition, thumb: STUB.edition, color: '#5a2f3a', sourceUrl: url },
      })
    return route.fulfill({
      json: { cover: STUB.pasted, thumb: STUB.pasted, color: '#3a5a2f', sourceUrl: url },
    })
  })
  // Background functions must never stall the run.
  await page.route('**/functions/v1/embed**', (route) =>
    route.fulfill({ json: { embedded: 0, remaining: 0, hits: [] } }),
  )
  await page.route('**/functions/v1/releases**', (route) =>
    route.fulfill({ json: { authors: {}, pending: [], hits: [] } }),
  )
  // Trusted provider backfill and browser-only arbitrary-link validation each receive real bytes.
  await page.route('https://covers.openlibrary.org/**', (route) =>
    route.fulfill({ path: 'public/landing-covers/acotar.jpg' }),
  )
  await page.route('**/covers.example/**', (route) => {
    if (route.request().url().includes('not-an-image')) {
      return route.fulfill({ contentType: 'text/plain', body: 'not an image' })
    }
    return route.fulfill({ path: 'public/landing-covers/acotar.jpg' })
  })
}

test('cover sheet: backfill, editions pick + detail sync, URL paste, non-image failure, upload crop', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const TITLE = 'Cover Sheet Hotlinked'
  const dev = await devClient()
  const hotlinkedId = await insertFixture(
    dev,
    TITLE,
    'https://covers.openlibrary.org/b/id/999999-L.jpg',
  )
  await stubCoversFunction(page)
  try {
    await signIn(page, dev.session)

    // ── lazy backfill: the hotlinked book's detail view moves the cover into storage ──
    await page.goto(`/book/${hotlinkedId}`)
    const detailCover = page
      .getByRole('button', { name: /change cover|add a cover/i })
      .locator('img')
    await expect(detailCover).toHaveAttribute('src', new RegExp(STUB.backfill), { timeout: 15_000 })

    // ── the cover is the door: tap it → the sheet ──
    await page.getByRole('button', { name: 'Change cover' }).click()
    const sheet = page.getByRole('dialog', { name: 'Cover' })
    await expect(sheet).toBeVisible()

    // editions present WITH context (format · year · publisher), not a bare image wall
    await expect(sheet.getByText('Hardcover · 2022')).toBeVisible()
    await expect(sheet.getByText(/Bloom Books/)).toBeVisible()

    // axe on the open sheet (both entry surfaces share this dialog)
    await expectResolvedMode(page, 'dark', 'cover-sheet open dialog')
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      serious,
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => String(n.target)).join(', ')}`).join('\n'),
    ).toHaveLength(0)

    // ── pick the Hardcover edition → new cover + the OPTIONAL details sync offer ──
    await sheet.getByRole('button', { name: /Hardcover · 2022/ }).click()
    await expect(sheet.getByText('Cover updated.')).toBeVisible({ timeout: 15_000 })
    await expect(detailCover).toHaveAttribute('src', new RegExp(STUB.edition))
    const sync = sheet.getByRole('button', { name: /Also update edition details/ })
    await expect(sync).toBeVisible() // offered, not forced
    await sync.click()
    await expect(sheet).not.toBeVisible()
    await expect(page.getByText(/📅 2022/)).toBeVisible() // the synced pub year lands on the detail pills

    // ── pasted URL path: non-image fails gracefully, then a good link lands ──
    await page.getByRole('button', { name: 'Change cover' }).click()
    await sheet.getByLabel('Direct image URL').fill('https://covers.example/not-an-image')
    await sheet.getByRole('button', { name: 'Use' }).click()
    await expect(sheet.getByRole('alert')).toContainText(/doesn’t point to an image/i)
    await expect(sheet).toBeVisible() // still open — the reader can correct the link

    await sheet.getByLabel('Direct image URL').fill('https://covers.example/pasted.jpg')
    await sheet.getByRole('button', { name: 'Use' }).click()
    await expect(sheet).not.toBeVisible({ timeout: 15_000 })
    await expect(detailCover).toHaveAttribute('src', /covers\.example\/pasted\.jpg/)

    // ── upload path (same mechanics as camera): file → 2:3 crop → save ──
    await page.getByRole('button', { name: 'Change cover' }).click()
    await page.locator('input[type="file"]:not([capture])').setInputFiles(UPLOAD_FILE)
    const cropDialog = page.getByRole('dialog', { name: 'Crop your cover' })
    await expect(cropDialog).toBeVisible()
    await expect(cropDialog.getByLabel(/Zoom/)).toBeEnabled({ timeout: 10_000 })
    await cropDialog.getByRole('button', { name: 'Save cover' }).click()
    await expect(cropDialog).not.toBeVisible({ timeout: 15_000 })
    await expect(detailCover).toHaveAttribute('src', new RegExp(STUB.upload))
  } finally {
    await removeFixture(dev, TITLE)
  }
})

test('placeholder affordance: the coverless grid card quietly invites "add a cover" → the sheet', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const TITLE = 'Cover Sheet Coverless'
  const dev = await devClient()
  await insertFixture(dev, TITLE)
  await stubCoversFunction(page)
  try {
    await signIn(page, dev.session)
    await page.goto('/library')
    const add = page.getByRole('button', { name: 'Add a cover for Cover Sheet Coverless' })
    await add.scrollIntoViewIfNeeded()
    await add.click()
    await expect(page.getByRole('dialog', { name: 'Cover' })).toBeVisible()
    // the coverless book has no ISBN — the sheet still stands, inviting the reader's own copy
    await expect(page.getByRole('button', { name: 'Upload an image' })).toBeVisible()
  } finally {
    await removeFixture(dev, TITLE)
  }
})

test('personal Cover Studio separates unresolved art from an intentional room placeholder', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const MISSING = 'Cover Studio Missing'
  const PLACEHOLDER = 'Cover Studio Placeholder'
  const UNCERTAIN = 'Cover Studio Uncertain'
  const dev = await devClient()
  await page.setViewportSize({ width: 390, height: 844 })
  for (const title of [MISSING, PLACEHOLDER, UNCERTAIN]) {
    await removeFixture(dev, title)
  }
  const inserted = await okData(
    dev.sb
      .from('books')
      .insert([
        {
          owner_id: dev.uid,
          title: MISSING,
          ownership: 'owned',
          cover_user_chosen: false,
        },
        {
          owner_id: dev.uid,
          title: PLACEHOLDER,
          ownership: 'owned',
          cover_user_chosen: true,
        },
        {
          owner_id: dev.uid,
          title: UNCERTAIN,
          ownership: 'owned',
          cover_url: STUB.pasted,
          cover_thumb_url: STUB.pasted,
          cover_source: 'google',
          cover_source_url: 'https://books.google.com/books/content?id=cover-studio-test',
          cover_confidence: 'low',
          cover_user_chosen: false,
        },
      ])
      .select('id,title'),
    'cover-studio books insert',
  )
  const missingId = inserted.find((row) => row.title === MISSING)?.id
  if (!missingId) throw new Error('cover-studio missing fixture id')
  await stubCoversFunction(page)
  try {
    await signIn(page, dev.session)
    await page.goto('/covers')
    await expect(page.getByRole('heading', { name: 'Cover Studio' })).toBeVisible()
    const queue = page.getByRole('list', { name: 'Personal cover queue' })
    const missingLink = queue.getByRole('link', { name: new RegExp(MISSING) })
    await expect(missingLink).toBeVisible()
    await expect(queue.getByRole('link', { name: new RegExp(UNCERTAIN) })).toBeVisible()
    await expect(queue.getByText(PLACEHOLDER)).toHaveCount(0)

    await missingLink.click()
    await expect(page.getByRole('heading', { name: MISSING })).toBeVisible()
    await page.getByRole('button', { name: 'Use this room’s placeholder' }).click()
    await expect(page.getByRole('status')).toContainText('placeholder is now your cover choice')

    const stored = await okData(
      dev.sb
        .from('books')
        .select('cover_url,cover_thumb_url,cover_source,cover_confidence,cover_user_chosen')
        .eq('id', missingId)
        .single(),
      'cover-studio chosen placeholder readback',
    )
    expect(stored).toEqual({
      cover_url: null,
      cover_thumb_url: null,
      cover_source: null,
      cover_confidence: null,
      cover_user_chosen: true,
    })

    const recordLink = page.getByRole('link', { name: 'Open the complete book record' })
    const mobileDock = page.locator('nav.rv-mobile-dock')
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(recordLink).toBeVisible()
    await expect(mobileDock).toBeVisible()
    const recordBox = await recordLink.boundingBox()
    const dockBox = await mobileDock.boundingBox()
    if (!recordBox || !dockBox)
      throw new Error('cover-studio mobile reachability boxes are missing')
    expect(recordBox.y + recordBox.height).toBeLessThanOrEqual(dockBox.y)

    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
    expect(
      serious,
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => String(n.target)).join(', ')}`).join('\n'),
    ).toHaveLength(0)
  } finally {
    for (const title of [MISSING, PLACEHOLDER, UNCERTAIN]) {
      await removeFixture(dev, title)
    }
  }
})
