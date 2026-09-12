import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

/**
 * A placeholder plate's TITLE must never truncate WITHOUT an affordance.
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ────────────────────────────────────────────────────────────
 * The visual-overflow audit's finding 4 reported "/club/:id — a 3px hard clip on the club title, no
 * ellipsis". Measured against the live page, the "no ellipsis" half was wrong and the defect was
 * the audit's own classifier: the element carries `-webkit-line-clamp: 3`, which renders its own
 * ellipsis while leaving `text-overflow` at its initial `clip`. The audit tested only
 * `text-overflow === 'ellipsis'`, so a clamped element read as silently cut when it was plainly
 * signalled. (scrollHeight 96 vs clientHeight 41 — genuinely truncated, genuinely ellipsised.)
 *
 * The residual 3px is the italic tail of the last glyph hanging past the box, and it is NOT
 * fixable by padding: measured invariant at exactly 3px with padding 0em, 0.6em and 1.5em, because
 * scrollWidth tracks clientWidth as the box grows — the overhang sits outside the padding box.
 *
 * So this file does not assert `scrollWidth <= clientWidth`. That assertion can never pass here, and
 * shipping it would have meant a permanently red test dressed as a guard.
 *
 * ── WHAT IT DOES ASSERT ─────────────────────────────────────────────────────────────────────────
 * The invariant that actually protects the reader: if the title is truncated, it must carry the
 * clamp that draws the ellipsis. A future restyle that drops `-webkit-line-clamp` while keeping
 * `overflow: hidden` would cut the title with nothing to signal it — the real version of what
 * finding 4 described — and that is what fails here.
 *
 * Mutation-checked: deleting `WebkitLineClamp` from the cloth-boards plate turns this red.
 *
 * ── THE FIXTURE HAS TO BE ABLE TO FAIL ──────────────────────────────────────────────────────────
 * The title must actually overflow three lines in an 80px thumbnail, or the assertion is vacuous —
 * an untruncated title satisfies it trivially. Measured: 'Book Club' does not truncate;
 * 'The Overflow Book Club of Extremely Long Naming' truncates (scrollHeight 96 vs clientHeight 41).
 * The test asserts the fixture truncates BEFORE asserting anything about the affordance, so a
 * future fixture that stops reproducing fails loudly instead of passing empty.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

// Per-project users: `rest` and `mobile` run in parallel and each execute beforeAll, so a shared
// fixture account means two seeds interleave and one deletes the club the other is reading.
const PROJECT = (): string => test.info().project.name
const EMAIL = () => `placeholder-title-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'placeholder-title-e2e-password'

/** Measured to reproduce (3px over) on the unfixed build — see the header. */
const CLUB_TITLE = 'The Overflow Book Club of Extremely Long Naming'

/** A real corpus title that used to clip, then was allowed to split mid-word across two lines. */
const ONE_WORD_TITLE = 'Accumulation'
/** marrow is the skin whose plate is `box-lid`, the confirmed-broken variant. */
const CLIP_SKIN = 'marrow'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: ReturnType<typeof createClient>
  admin: ReturnType<typeof createClient>
  session: { access_token: string; refresh_token: string }
  uid: string
}
const shared = new Map<string, Client>()
const seededClubId = new Map<string, string>()

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
        'placeholder-title createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Placeholder Title', skin: 'tryst', mode: 'dark' }),
    'placeholder-title profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('placeholder-title', EMAIL(), error))
  const c = { sb, admin, session: s.session, uid: s.session.user.id }
  shared.set(PROJECT(), c)
  return c
}

/** A club with NO cover, so the plate renders — a club with a cover never reaches this code. */
async function seed(c: Client): Promise<void> {
  await ok(c.admin.from('clubs').delete().eq('created_by', c.uid), 'placeholder-title clubs delete')
  const { data: club, error } = await c.admin
    .from('clubs')
    .insert({ title: CLUB_TITLE, unit_type: 'chapter', unit_count: 30, created_by: c.uid })
    .select('id')
    .single()
  if (error || !club) throw new Error(`placeholder-title club failed: ${JSON.stringify(error)}`)
  const id = (club as { id: string }).id
  await ok(
    c.admin
      .from('club_members')
      .insert({ club_id: id, user_id: c.uid, display_name: 'Placeholder Title', progress: 3 }),
    'placeholder-title club_members insert',
  )
  seededClubId.set(PROJECT(), id)

  // A coverless BOOK, for the horizontal-clip case below. Coverless on purpose: a book with a cover
  // never reaches the placeholder at all.
  await ok(c.admin.from('books').delete().eq('owner_id', c.uid), 'placeholder-title books delete')
  await ok(
    c.admin.from('books').insert({
      owner_id: c.uid,
      title: ONE_WORD_TITLE,
      author_first: 'Aimee',
      author_last: 'Pokwatka',
      genre: 'literary',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'unset',
      cover_url: null,
    }),
    'placeholder-title books insert',
  )
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

/**
 * The plate's title span, located by its TEXT and by the plate's accessible name — deliberately NOT
 * by `-webkit-line-clamp`. Selecting on the clamp would make the guard unable to see the very
 * regression it exists for: remove the clamp and the selector matches nothing, which reads as "no
 * plate" rather than "the affordance is gone".
 */
async function measureTitle(page: Page, title: string) {
  return page.evaluate((t) => {
    const plate = document.querySelector<HTMLElement>(
      '[role="img"][aria-label*="placeholder cover"]',
    )
    if (!plate) return null
    const el = Array.from(plate.querySelectorAll<HTMLElement>('span')).find(
      (s) => (s.textContent ?? '').trim() === t,
    )
    if (!el) return null
    const cs = getComputedStyle(el)
    return {
      lineClamp: cs.webkitLineClamp,
      textOverflow: cs.textOverflow,
      overflowY: cs.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      truncated: el.scrollHeight > el.clientHeight + 1,
      fontStyle: cs.fontStyle,
      fontSize: cs.fontSize,
    }
  }, title)
}

test.beforeAll(async () => {
  const c = await client()
  await seed(c)
})

test('a truncated plate title always carries the clamp that draws its ellipsis', async ({
  page,
}) => {
  const c = await client()
  await stub(page)
  await signIn(page, c.session)

  for (const width of [375, 390, 412]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto(`/club/${seededClubId.get(PROJECT())!}`)
    await expect(page.getByRole('heading', { name: CLUB_TITLE })).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(600)

    const m = await measureTitle(page, CLUB_TITLE)
    expect(m, `@${width}: no plate title found — the guard measured nothing`).not.toBeNull()

    // FIRST: the fixture must actually reproduce the condition, or everything below is vacuous.
    expect(
      m!.truncated,
      `@${width}: the fixture title no longer overflows the plate (scrollHeight ${m!.scrollHeight} vs ` +
        `clientHeight ${m!.clientHeight}), so this test would pass without proving anything. Lengthen ` +
        `CLUB_TITLE until it truncates again.`,
    ).toBe(true)

    // THEN: truncation must be signalled. `-webkit-line-clamp` draws an ellipsis without ever
    // setting `text-overflow`, so either mechanism counts and neither alone is required.
    const clamped = m!.lineClamp !== 'none' && m!.lineClamp !== ''
    expect(
      clamped || m!.textOverflow === 'ellipsis',
      `@${width}: the plate title is truncated (scrollHeight ${m!.scrollHeight} vs clientHeight ` +
        `${m!.clientHeight}) with NO affordance — line-clamp is “${m!.lineClamp}” and text-overflow is ` +
        `“${m!.textOverflow}”, so text is being cut with nothing to tell the reader. One of the two ` +
        `must be present.`,
    ).toBe(true)
  }
})

/** Measure the visual title itself; the wrapper's accessible name intentionally stays complete. */
async function measureOneWordTitle(page: Page, title: string) {
  return page.evaluate((t) => {
    for (const plate of Array.from(
      document.querySelectorAll<HTMLElement>('[role="img"][aria-label*="placeholder cover"]'),
    )) {
      // the WIDE block only — the narrow block renders a monogram and never a title
      const wide = plate.querySelector<HTMLElement>('.ph-plate-wide') ?? plate
      const el = Array.from(wide.querySelectorAll<HTMLElement>('span')).find(
        (s) => (s.textContent ?? '').trim() === t,
      )
      if (!el || !el.clientWidth) continue
      const cs = getComputedStyle(el)
      const lineHeight = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25
      return {
        overflowX: el.scrollWidth - el.clientWidth,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        lines: Math.round(el.clientHeight / lineHeight),
        overflowWrap: cs.overflowWrap,
        whiteSpace: cs.whiteSpace,
        textOverflow: cs.textOverflow,
        fontSize: cs.fontSize,
      }
    }
    return null
  }, title)
}

test('a one-word placeholder title stays composed on Library and Discover', async ({ page }) => {
  const c = await client()
  await ok(
    c.admin.from('profiles').upsert({
      id: c.uid,
      display_name: 'Placeholder Title',
      skin: CLIP_SKIN,
      mode: 'dark',
    }),
    'placeholder-title skin swap',
  )
  await stub(page)
  await signIn(page, c.session)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const surface of ['library', 'discover'] as const) {
    await page.goto(surface === 'library' ? '/library' : '/discover?genre=literary')
    if (surface === 'discover') {
      await page.getByTestId('corpus-filter').fill(ONE_WORD_TITLE)
    }
    await expect(
      page
        .getByRole('img', {
          name: new RegExp(`${ONE_WORD_TITLE}.*placeholder cover`, 'i'),
        })
        .first(),
    ).toBeVisible({ timeout: 20_000 })
    await page.waitForTimeout(600)

    const m = await measureOneWordTitle(page, ONE_WORD_TITLE)
    expect(m, `${surface}: no plate title rendering "${ONE_WORD_TITLE}"`).not.toBeNull()
    expect(
      m!.lines,
      `${surface}: "${ONE_WORD_TITLE}" broke into ${m!.lines} lines at ${m!.fontSize}`,
    ).toBe(1)
    expect(m!.whiteSpace).toBe('nowrap')
    expect(m!.textOverflow).toBe('ellipsis')
    expect(
      m!.overflowX,
      `${surface}: the full title does not fit at ${m!.fontSize} (${m!.scrollWidth}px in a ` +
        `${m!.clientWidth}px title box), so the regular cover is already falling back to ellipsis`,
    ).toBeLessThanOrEqual(4)
  }
})
