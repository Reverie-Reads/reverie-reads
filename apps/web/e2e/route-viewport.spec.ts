import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// THE INVARIANT: the layout viewport equals the visual viewport on EVERY route — the page never
// grows wider than the screen. docs/audits/spine-shelf-gesture.md §3 found the defect this guards:
// `mx-auto max-w-*` on a child of the column-flex <main> disables flex stretch (auto cross-axis
// margins do that), so the section laid out at its CONTENT's width capped at 1024px instead of the
// viewport's — on /shelf/:id the shelf's own scroller ended up with a scroll range of ZERO at ≤~25
// books, the whole shelf pushed into page-level panning, and the last books were geometrically
// unreachable regardless of gesture. The fix is `w-full` beside every `mx-auto max-w-*`; this
// suite guards the OUTCOME (no route overflows the viewport), not the utility list, so a fifth
// route added without `w-full` — or any new wide-max-content child — fails here.
//
// Assertion shape, deliberately NOT `scrollWidth <= window.innerWidth`: Chromium's mobile
// emulation ZOOMS OUT when the page overflows (honoring the meta viewport the way a phone does),
// so innerWidth grows to match scrollWidth — measured 1024 vs 1024 in the known-broken state —
// and the obvious formula passes against the exact defect it exists to catch. `documentElement.
// clientWidth` stays at the device width in both states, so it is the stable side of the
// comparison; `innerWidth === clientWidth` is asserted too, which catches the zoom-out itself.
//
// What this CAN prove, per the audit's environment note: this defect is pure layout geometry,
// fully measurable headless — unlike the same audit's gesture questions. A route whose fixture
// content is narrower than the viewport is guarded only as a tripwire (the constraint pattern
// alone doesn't overflow without wide content), which is why /shelf/:id gets a 36-book shelf and
// /add gets a driven cover rail below: the two known wide-content states are exercised for real.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'route-viewport-e2e@reverie.local'
const PASSWORD = 'route-viewport-e2e-password'
const SHARE_CODE = 'WIDTHE2E'

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
        'route-viewport createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Route Viewport E2E', skin: 'tryst', mode: 'dark' }),
    'route-viewport profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('route-viewport', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
  return shared
}

/**
 * Fixtures for every param route, so the sweep visits the app with CONTENT rather than empty
 * states. Two routes needed special handling (named in the branch report):
 *  - /shelf/:id — unreachable from the dev seed (it has no `lists` rows) and the proven-harmful
 *    route: gets a 36-book shelf so SpineShelf's max-content genuinely exceeds a phone viewport.
 *  - /moods/:id — moods have no index route (they live behind book pages), so no link is
 *    discoverable: gets a personal mood row assigned to fixture books.
 */
async function seedFixtures(c: Client): Promise<{
  listId: string
  bookId: string
  moodId: string
  clubId: string
  seriesName: string
}> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'route-viewport items delete')
    await ok(c.sb.from('book_moods').delete().eq('owner_id', c.uid), 'route-viewport moods unlink')
    await ok(c.sb.from('books').delete().in('id', ids), 'route-viewport books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'route-viewport lists delete')
  await ok(c.sb.from('moods').delete().eq('owner_id', c.uid), 'route-viewport moods delete')
  await ok(c.admin.from('clubs').delete().eq('created_by', c.uid), 'route-viewport clubs delete')
  await ok(
    c.admin.from('shared_docs').delete().eq('key', SHARE_CODE),
    'route-viewport shared delete',
  )

  const seriesName = 'Width Probe Saga'
  // Every row carries every column the batch uses (PostgREST bulk inserts take the union of keys;
  // an omitted key becomes an explicit NULL that a NOT NULL column rejects for the whole batch).
  const rows = Array.from({ length: 36 }, (_, i) => ({
    owner_id: c.uid,
    title: `Width Probe ${String(i + 1).padStart(2, '0')}`,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: i < 6 ? 'ongoing' : 'standalone',
    series: i < 6 ? seriesName : null,
    position: i < 6 ? i + 1 : null,
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }))
  const { error: insertError } = await c.sb.from('books').insert(rows)
  if (insertError) throw new Error(`route-viewport seed failed: ${JSON.stringify(insertError)}`)
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid).order('title')
  const bookIds = ((books as { id: string }[]) ?? []).map((b) => b.id)

  const { data: list, error: listError } = await c.sb
    .from('lists')
    .insert({ owner_id: c.uid, name: 'Width Shelf', kind: 'collection', sort_order: 1 })
    .select('id')
    .single()
  if (listError || !list)
    throw new Error(`route-viewport list failed: ${JSON.stringify(listError)}`)
  const listId = (list as { id: string }).id
  await ok(
    c.sb.from('list_items').insert(
      bookIds.map((id, i) => ({
        list_id: listId,
        book_id: id,
        owner_id: c.uid,
        position: i + 1,
      })),
    ),
    'route-viewport list_items insert',
  )

  const { data: mood, error: moodError } = await c.sb
    .from('moods')
    .insert({ owner_id: c.uid, name: 'Width Probe Mood' })
    .select('id')
    .single()
  if (moodError || !mood)
    throw new Error(`route-viewport mood failed: ${JSON.stringify(moodError)}`)
  const moodId = (mood as { id: string }).id
  await ok(
    c.sb
      .from('book_moods')
      .insert(bookIds.slice(0, 3).map((id) => ({ book_id: id, mood_id: moodId, owner_id: c.uid }))),
    'route-viewport book_moods insert',
  )

  // LONG ON PURPOSE, and this fixture is the whole guard for /clubs. It used to read 'Width Probe
  // Club' — short enough that /clubs stayed inside a phone viewport no matter how its layout
  // behaved, so the route was swept and asserted while never once exercising the thing being
  // asserted. The visual-overflow audit found /clubs overflowing every phone width (scrollWidth 450
  // at 375) with a realistically-named club, and this spec was green throughout. That is exactly the
  // "guarded only as a tripwire" case this file's own header warns about, so the tripwire is now
  // armed: the name has to be long enough that a card which cannot shrink pushes the page wider.
  const { data: clubRow, error: clubError } = await c.admin
    .from('clubs')
    .insert({
      title: 'The Width Probe Read-Along Society of Extremely Long Naming',
      unit_type: 'chapter',
      unit_count: 30,
      created_by: c.uid,
    })
    .select('id')
    .single()
  if (clubError || !clubRow)
    throw new Error(`route-viewport club failed: ${JSON.stringify(clubError)}`)
  const clubId = (clubRow as { id: string }).id
  await ok(
    c.admin
      .from('club_members')
      .insert({ club_id: clubId, user_id: c.uid, display_name: 'Width Probe', progress: 3 }),
    'route-viewport club_members insert',
  )

  await ok(
    c.admin.from('shared_docs').insert({
      key: SHARE_CODE,
      value: {
        type: 'list',
        kind: 'list',
        name: 'Width Probe Shared',
        items: [
          { id: bookIds[0]!, title: 'Width Probe 01', author: 'Nell Marrow', cover: '', by: 'W' },
        ],
        updatedAt: 1735689600000,
      },
    }),
    'route-viewport shared_docs insert',
  )

  return { listId, bookId: bookIds[0]!, moodId, clubId, seriesName }
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
  for (const p of ['search', 'embed', 'releases', 'series', 'covers', 'taste', 'geo'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

/** The invariant, on whatever page is currently loaded.
 *
 *  Both checks carry a +1px tolerance as sub-pixel rounding headroom. No known overflow remains:
 *  an earlier +1 was excused as "DPR rounding" on /book/:id, and this guard's own first CI run
 *  falsified that — the same route overflowed 6px on the Linux runner's fonts, which is the
 *  signature of TEXT-sized layout, not rounding. The real cause was an 18th constraint site the
 *  routes-only blast-radius grep missed (BookDetailRoute lives in src/book/, not src/routes/),
 *  its content max-content sitting 0.7px past the viewport locally and 6px past it on CI. Fixed
 *  like the other 17; the tolerance stays only for genuine fractional-px measurement noise, and a
 *  real constraint regression blows hundreds of px past it on the fixtures below. */
async function assertNoViewportOverflow(page: Page, label: string) {
  const d = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    d.scrollWidth,
    `${label}: layout viewport (${d.scrollWidth}) must not exceed the screen (${d.clientWidth})`,
  ).toBeLessThanOrEqual(d.clientWidth + 1)
  expect(
    d.innerWidth,
    `${label}: emulator zoomed out (innerWidth ${d.innerWidth} vs clientWidth ${d.clientWidth}) — the page overflowed`,
  ).toBeLessThanOrEqual(d.clientWidth + 1)
}

test('the shell brand text remains fully visible', async ({ page }) => {
  const c = await client()
  await stub(page)
  await signIn(page, c.session)

  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const line = page.getByTestId('sidebar-chrome-line')
    await expect(line).toBeVisible()
    const box = await line.evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      textOverflow: getComputedStyle(el).textOverflow,
    }))
    expect(
      box.scrollWidth,
      'the desktop skin subtitle must not be cut horizontally',
    ).toBeLessThanOrEqual(box.clientWidth + 1)
    expect(
      box.scrollHeight,
      'the desktop skin subtitle must not be cut vertically',
    ).toBeLessThanOrEqual(box.clientHeight + 1)
    expect(
      box.textOverflow,
      'the desktop skin subtitle must not fall back to an ellipsis',
    ).not.toBe('ellipsis')
    return
  }

  const mobileLabels = [
    ['brand name', page.locator('.rv-mobile-wordmark')],
    ['page and skin context', page.getByTestId('mobile-chrome-context')],
  ] as const

  for (const [label, element] of mobileLabels) {
    await expect(element).toBeVisible()
    const box = await element.evaluate((el) => ({
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }))
    expect(box.scrollWidth, `the mobile ${label} must not be cut horizontally`).toBeLessThanOrEqual(
      box.clientWidth + 1,
    )
    expect(box.scrollHeight, `the mobile ${label} must not be cut vertically`).toBeLessThanOrEqual(
      box.clientHeight + 1,
    )
  }
})

test('every route lays out at the viewport — no page-level horizontal overflow', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const c = await client()
  const fx = await seedFixtures(c)
  await stub(page)
  await page.route('**/functions/v1/enrich**', (r) => r.fulfill({ json: { rateLimited: false } }))
  await signIn(page, c.session)

  const routes: [string, string][] = [
    ['/', 'home'],
    ['/library', 'library'],
    ['/covers', 'personal cover studio'],
    ['/shelves', 'shelves overview'],
    [`/shelf/${fx.listId}`, 'shelf detail (36-book fixture — the proven-harmful route)'],
    ['/planner', 'planner'],
    ['/planner?tab=calendar', 'planner calendar'],
    ['/stats', 'stats'],
    ['/match', 'match'],
    ['/discover', 'discover'],
    ['/add', 'add'],
    ['/settings', 'settings'],
    ['/clubs', 'clubs'],
    [`/club/${fx.clubId}`, 'club detail'],
    [`/list/${SHARE_CODE}`, 'shared list'],
    ['/indie', 'indie'],
    ['/skins', 'skin gallery'],
    ['/series', 'series index'],
    [`/series/${encodeURIComponent(fx.seriesName)}`, 'series detail'],
    ['/tropes', 'tropes index'],
    [`/moods/${fx.moodId}`, 'mood detail (personal-mood fixture — no index route links here)'],
    ['/review', 'review'],
    [`/book/${fx.bookId}`, 'book detail'],
    ['/lab/skins', 'lab skins'],
    ['/lab/structure', 'lab structure'],
    ['/welcome', 'welcome'],
    ['/onboarding', 'onboarding'],
  ]

  const visited: string[] = []
  for (const [route, label] of routes) {
    await page.goto(route)
    // Settle: routes render async content (queries, fonts, images) that can change layout width.
    await page.waitForTimeout(900)
    await assertNoViewportOverflow(page, `${route} (${label})`)
    visited.push(route)
  }
  // /tropes/:id has a real index to link from — resolve it the way a reader would. If the link
  // dries up, this FAILS rather than silently shrinking coverage.
  await page.goto('/tropes')
  await page.waitForTimeout(600)
  const tropeHref = await page.locator('a[href^="/tropes/"]').first().getAttribute('href')
  expect(
    tropeHref,
    'a trope link must exist on /tropes — coverage would silently shrink',
  ).not.toBeNull()
  await page.goto(tropeHref!)
  await page.waitForTimeout(900)
  await assertNoViewportOverflow(page, `${tropeHref} (trope detail)`)
  visited.push(tropeHref!)

  expect(visited.length, 'route coverage must not silently shrink').toBe(routes.length + 1)
})

test('the Add cover rail — the other wide-max-content state — stays inside the viewport', async ({
  page,
}) => {
  test.setTimeout(120_000)
  // AddRoute:415's pick-a-cover rail was "conditionally harmful by inspection" in the blast-radius
  // report; this DRIVES the state instead of reasoning about it. Enrich is stubbed to return 14
  // alternates (14 × 48px thumbs + gaps ≈ 770px of max-content — comfortably wider than a phone),
  // which is exactly the content that would have re-widened the page pre-fix. This is a synthetic
  // admitted-response layout stress case, not provider acquisition coverage: live enrichment
  // currently returns no alternates; restoring qualified alternate retrieval remains separate.
  const c = await client()
  await stub(page)
  await page.route('**/functions/v1/enrich**', (r) =>
    r.fulfill({
      json: {
        admissionVersion: 2,
        title: 'Width Probe Enriched',
        authors: ['Aster Writer'],
        author: 'Aster Writer',
        source: 'openlibrary',
        confidence: 'high',
        alternates: Array.from({ length: 14 }, (_, i) => ({
          cover: `https://covers.widthprobe.test/${i}.jpg`,
          source: 'openlibrary',
          isbn13: '',
          title: 'Width Probe Enriched',
          author: 'Aster Writer',
        })),
      },
    }),
  )
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.route('**covers.widthprobe.test**', (r) =>
    r.fulfill({ body: png, contentType: 'image/png' }),
  )
  await signIn(page, c.session)

  await page.goto('/add')
  await page.getByRole('button', { name: /^Add manually$/i }).click()
  await page.getByPlaceholder('Title', { exact: true }).fill('Width Probe Enriched')
  await page.getByLabel('Contributor 1 name', { exact: true }).fill('Aster Writer')
  await page.getByRole('button', { name: /Fetch details/i }).click()
  await expect(page.getByText('Pick a cover')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: /Use the openlibrary cover/i })).toHaveCount(14)
  await page.waitForTimeout(400)
  await assertNoViewportOverflow(page, '/add with the 14-cover rail driven')

  // …and the rail itself actually scrolls (its overflow engages against the section), which is
  // the user-visible half of the fix: pre-fix the section widened instead and the rail never
  // scrolled — the page did.
  const rail = page
    .getByRole('button', { name: /Use the openlibrary cover/i })
    .first()
    .locator('xpath=..')
  const railGeom = await rail.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(
    railGeom.scrollWidth,
    'the cover rail must OVERFLOW its box (scroll range > 0) rather than widening the page',
  ).toBeGreaterThan(railGeom.clientWidth)
})
