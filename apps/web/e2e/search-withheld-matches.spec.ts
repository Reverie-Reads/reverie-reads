import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { SKIN_ORDER } from '@reverie/core'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// Library search must SAY when it withheld a match.
//
// The defect this guards is not the filtering. matchesFilters applies the inDefaultLibrary scope
// gate before the text filter, deliberately, and that stays. The defect was the silence: type a
// wishlist-only book's exact full title and the grid comes back empty with nothing on screen
// admitting a match was held back. The only escape is the ⊹ Show wishlist chip, whose label never
// suggests it governs search results.
//
// Runs in the MAIN e2e job because what needs a browser is that the line actually RENDERS with the
// right number and that "show" reveals the book — the count itself is proven as a pure function in
// packages/core (hiddenMatchCount), which is where the arithmetic claim belongs.
//
// Located by data-testid throughout. The notice's own text carries the count and the reveal
// control's label is the thing under test, so locating by either would be keyed to exactly what a
// mutation would change — a guard that reports "fine" against the broken build.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'search-withheld-e2e@reverie.local'
const PASSWORD = 'search-withheld-e2e-password'

// The seeded repro from the usability assessment: unowned, not borrowed, wishlist, no reads. Out of
// the default library on every count, so an exact-title query on it is the silent case.
const WISHED_TITLE = 'Withheld Probe'
// In the default library. Its exact title is the control query that must hide nothing.
const PRESENT_TITLE = 'Present Probe'

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
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'search-withheld createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Search Withheld E2E', skin: 'tryst', mode: 'dark' }),
    'search-withheld profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('search-withheld', EMAIL, error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

/** Exactly two books: one the scope gate withholds, one it admits. */
async function seedFixtures(c: Client): Promise<void> {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(
      c.sb.from('list_items').delete().in('book_id', ids),
      'search-withheld list_items delete',
    )
    await ok(c.sb.from('books').delete().in('id', ids), 'search-withheld books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'search-withheld lists delete')

  // Every row carries EVERY possession column, defaults included. PostgREST sends one INSERT whose
  // column list is the UNION of all rows' keys, so a key one row omits arrives as an explicit NULL
  // rather than the column default — and the NOT NULL then rejects the whole batch, naming the
  // constraint rather than the omission.
  const base = {
    owner_id: c.uid,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'unset',
  }
  const { error: insertError } = await c.sb.from('books').insert([
    {
      ...base,
      title: WISHED_TITLE,
      ownership: 'unowned',
      borrowed: false,
      wishlist: true,
      read_status: 'unset',
    },
    {
      ...base,
      title: PRESENT_TITLE,
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'unset',
    },
  ])
  // Never swallowed: a failed insert would read as an empty grid, which is indistinguishable from
  // the very defect under test and would send the next reader hunting in the wrong file.
  if (insertError) throw new Error(`search-withheld seed failed: ${JSON.stringify(insertError)}`)
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

const notice = (page: Page) => page.getByTestId('search-hidden-notice')
const reveal = (page: Page) => page.getByTestId('search-hidden-reveal')
const searchBox = (page: Page) => page.getByRole('searchbox', { name: 'Search your library' })
const cardFor = (page: Page, title: string) => page.getByRole('button', { name: `Open ${title}` })

/** Type a query — and DELIBERATELY LEAVE THE BOX FOCUSED.
 *
 *  This helper used to call `blur()` after filling, on the diagnosis that SearchResultsPanel
 *  occludes the withheld line and the click fails on intercepted pointer events. Re-measured, that
 *  is not what happens: `document.elementFromPoint` at the reveal button's centre returns the
 *  BUTTON, so nothing is intercepting. The real mechanism is that mousedown blurs the input, the
 *  panel unmounts mid-press, the button is re-laid-out from under the pointer, and mouseup lands on
 *  nothing — native listeners recorded `pointerdown` and `mousedown` and then neither `mouseup` nor
 *  `click`.
 *
 *  That distinction is the whole point of removing the blur. Blurring first made the test green
 *  while leaving the defect in the product, because it skipped the only path this feature exists
 *  for: type a query, read the line, press "show" — with the box still focused, which is where a
 *  reader's hands actually are. The control now carries `onMouseDown={e => e.preventDefault()}`,
 *  which keeps focus and therefore keeps the layout still.
 *
 *  Keeping the note that IS still true: dismiss with blur(), never Escape. Chromium's native
 *  handling of `<input type="search">` CLEARS the field on Escape before the app's own onKeyDown
 *  runs, so `q` becomes '', the count legitimately drops to 0, and the line correctly does not
 *  render — a green-looking absence caused entirely by the harness. */
async function search(page: Page, q: string) {
  await searchBox(page).fill(q)
}

/** Force the profile's skin for the next load. Same mechanism a11y.spec uses — the app's skin-sync
 *  reads the profile, so this must be written BEFORE signIn, not after. */
async function setProfileSkin(skin: string) {
  const c = await client()
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await ok(
    admin.from('profiles').update({ skin, mode: 'dark' }).eq('id', c.uid),
    `search-withheld set skin ${skin}`,
  )
}

async function openLibrary(page: Page, skin?: string) {
  const c = await client()
  await seedFixtures(c)
  if (skin) await setProfileSkin(skin)
  await stub(page)
  await signIn(page, c.session)
  await page.goto('/library')
  // Anchor on the in-scope book before anything else, so a slow query can never make a missing
  // line look like a passing test.
  await expect(cardFor(page, PRESENT_TITLE)).toBeVisible({ timeout: 20_000 })
}

test('an exact-title query on a withheld book says so, with a real count, and reveals it', async ({
  page,
}) => {
  await openLibrary(page)

  // The repro. Before this branch: an empty grid and silence.
  await search(page, WISHED_TITLE)

  // The line first — it is also the anchor that proves the filtered render has settled, so the
  // absence asserted on the next line cannot be "the grid had not updated yet".
  //
  // useInnerText, not textContent: the count is what a reader reads off the screen, and a skin is
  // free to set a text-transform that never touches the DOM node's text.
  await expect(notice(page)).toBeVisible()
  await expect(notice(page)).toHaveText(/^1 match hidden by filters\s*—\s*show$/, {
    useInnerText: true,
  })
  await expect(cardFor(page, WISHED_TITLE)).toHaveCount(0)

  // "— show" reveals them.
  await reveal(page).click()
  await expect(cardFor(page, WISHED_TITLE)).toBeVisible()

  // …and the line retires itself once there is nothing left withheld. It never becomes "0 hidden".
  await expect(notice(page)).toHaveCount(0)
})

test('the reveal drives the ⊹ Show wishlist chip itself, not a second switch beside it', async ({
  page,
}) => {
  // Beyond the literal ask, and the reason it is here: parallel state is the failure mode this
  // design was chosen to avoid. If "show" set its own flag, the chip would still read as off while
  // wishlist books were on screen, and toggling the chip would then fight the line.
  await openLibrary(page)
  await search(page, WISHED_TITLE)
  await expect(notice(page)).toBeVisible()

  // Viewport-agnostic: at ≥lg the filter panel is the docked left column and its toggle is
  // lg:hidden; at 390 (layout-sweep-390 sweeps this file by default) the toggle is the only way in.
  const toggle = page.getByRole('button', { name: /^Filters/ })
  if (await toggle.isVisible()) await toggle.click()

  const chip = page.getByRole('button', { name: '⊹ Show wishlist' })
  await expect(chip).toHaveAttribute('aria-pressed', 'false')

  await reveal(page).click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
})

test('a query that hides nothing shows no line at all', async ({ page }) => {
  await openLibrary(page)

  // The absence is asserted only AFTER the line has been seen to render in this very page — so a
  // component that silently failed to mount, or a testid that never resolves, cannot pass as
  // "nothing was hidden". This is the whole reason the withheld query runs first here.
  await search(page, WISHED_TITLE)
  await expect(notice(page)).toBeVisible()

  await search(page, PRESENT_TITLE)
  await expect(cardFor(page, PRESENT_TITLE)).toBeVisible()
  await expect(notice(page)).toHaveCount(0)

  // And the resting grid, with no query at all, is not annotated either.
  await search(page, '')
  await expect(cardFor(page, PRESENT_TITLE)).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
})

/*
 * ── The one-axis blindness #311's port declared, now closed ─────────────────────────────────────
 * #311 ported these measurements from dd7e287 and said plainly what they could not see: the loop
 * parameterised VIEWPORT ONLY, with the skin pinned to `tryst` by this file's fixture — and tryst
 * is the single skin whose `.skin-plate` stops option A changing anything. Its note ended "the
 * separate fixture task does NOT collapse into them." This is that task, and the note was right:
 * applying option A left the tryst-pinned version green while the notice was covered in the other
 * eight skins. The loop below now parameterises BOTH axes, keyed off SKIN_ORDER.
 */
/** The search panel must not cover the line, MEASURED, in every skin, in the case that matters.
 *
 *  WHY GEOMETRY. "Is it visible" is the wrong question and `toBeVisible()` answers only that one —
 *  it does not consider occlusion, so a line buried under an overlay passes it. This feature exists
 *  to tell a reader about a match they do not know exists; a line they must first know to uncover is
 *  no feature at all.
 *
 *  WHY EVERY SKIN, keyed off SKIN_ORDER rather than a local list. The first version of this guard
 *  seeded one skin — tryst — and that made it blind to the exact change it was written to catch.
 *  Turning the panel into a real overlay requires TWO edits (Frame's hardcoded `relative`, and
 *  `.skin-plate { position: relative }` in skin-kit.css), because `.skin-plate` rides only on
 *  Frame's `gilt-plate` branch, which only tryst uses. Do the Frame half alone and tryst is the ONE
 *  skin that does not move — so a tryst-seeded guard reports green while the notice is covered in
 *  the other eight. Measured: 0.00px overlap in tryst, 18.75px in aphelion, same build.
 *
 *  The axis is really the FRAME VARIANT (each skin maps to exactly one), and skin is how a test can
 *  select one. Registry-keyed means a tenth skin is covered the day it is added rather than the day
 *  someone remembers this file.
 *
 *  NOT VACUOUS, three ways. A panel that failed to render would trivially overlap nothing; a skin
 *  that failed to apply would silently re-measure tryst nine times — which is the original bug
 *  wearing a loop. So each case asserts the skin actually took, the panel exists, and the panel
 *  holds the withheld book, before it asserts anything about overlap. */
for (const skin of SKIN_ORDER) {
  for (const [label, width, height] of [
    ['desktop', 1280, 720],
    ['phone', 390, 844],
  ] as const) {
    test(`the search panel does not cover the line — ${skin} at ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await openLibrary(page, skin)

      // The skin REALLY applied. Without this the loop is nine reruns of whatever skin the profile
      // happened to hold — a blind spot with more tests in front of it.
      await expect(page.locator('html')).toHaveAttribute('data-skin', skin)

      await search(page, WISHED_TITLE)
      await expect(notice(page)).toBeVisible()

      const geo = await page.evaluate(() => {
        const n = document.querySelector('[data-testid="search-hidden-notice"]')
        const input = document.querySelector('input[type="search"]')
        const panel = input?.parentElement?.querySelector(':scope > *:not(input)')
        if (!n || !panel) return null
        const a = n.getBoundingClientRect()
        const b = panel.getBoundingClientRect()
        return {
          panelText: (panel as HTMLElement).innerText,
          position: getComputedStyle(panel).position,
          overlapY: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)),
          overlapX: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)),
        }
      })

      expect(geo, 'no search panel rendered — the overlap check would be vacuous').not.toBeNull()
      expect(geo!.panelText).toContain(WISHED_TITLE)

      // Overlapping columns are expected and fine; overlapping ROWS are the failure.
      expect(geo!.overlapX).toBeGreaterThan(0)
      expect(
        geo!.overlapY,
        `the search panel (position: ${geo!.position}) covers the withheld-matches line by ${geo!.overlapY}px in ${skin} at ${label} — move the line below the panel's reach, or keep the panel in flow`,
      ).toBe(0)
    })
  }
}
