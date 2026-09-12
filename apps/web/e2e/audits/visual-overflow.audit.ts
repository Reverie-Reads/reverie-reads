import { configureReturningReader } from '../support/readerGuidance'
import { expect, test, type Page } from '../support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from '../support/authError'
import { keepOfflineCacheEmpty } from '../support/offlineCache'
import { ok, okUser } from '../support/ok'
import { SKIN_ORDER, type SkinId } from '@reverie/core'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * VISUAL-MISALIGNMENT AUDIT — horizontal overflow, clipped text, controls past their container.
 *
 * This is a DISCOVERY pass, not a gate. It records findings and exits 0. It lives behind
 * playwright.audit.config.ts (`.audit.ts` cannot match the main config's default testMatch), so it
 * never joins `pnpm e2e` — a green gate must keep meaning "the guards passed", not "the audit ran".
 *
 * ── THE TRIGGER ─────────────────────────────────────────────────────────────────────────────────
 * A zoomed phone screenshot of /shelves appeared to show a header row with text clipped at its
 * START ("nce ›" with nothing before it) and a tab pill leaking a sliver of color past its right
 * edge. A zoomed crop is not evidence, so this measures instead of guessing.
 *
 * ── THE ONE FORMULA THIS MUST NOT USE ───────────────────────────────────────────────────────────
 * `scrollWidth > window.innerWidth` is the intuitive page-overflow test and it is WRONG here, as
 * route-viewport.spec.ts already established against a live defect: Chromium's mobile emulation
 * ZOOMS OUT when a page overflows (honoring the meta viewport the way a phone does), so innerWidth
 * grows to meet scrollWidth — measured 1024 vs 1024 in the known-broken state — and the check
 * passes against the exact defect it exists to catch. `documentElement.clientWidth` holds the
 * device width in both states, so it is the stable side of the comparison. The zoom-out itself is
 * reported separately (`zoomed`) rather than being allowed to hide anything.
 *
 * ── WHY SKIN IS SWITCHED THROUGH THE PROFILE, NOT BY WRITING data-skin ──────────────────────────
 * Writing `documentElement.dataset.skin` would swap the CSS tokens and nothing else — and skin does
 * not stop at CSS here. ~20 components read `useStructure` / `useLabels` / `useVoice`, so a skin
 * changes which BONES a region has and WHAT WORDS it uses; per-skin copy has per-skin length, which
 * is half of what makes text overflow. Measuring an attribute-swapped page would measure a page
 * that never renders for a reader. So the skin goes through the profile (the a11y sweep's
 * mechanism) and the page reloads, and the applied skin is READ BACK before any measurement counts.
 *
 * ── FONTS ARE REAL HERE — as they now are suite-wide ────────────────────────────────────────────
 * This audit measures glyph widths, so it always demanded real faces (a fallback face is a textbook
 * proxy: a typeface the reader never sees). It used to opt out of the suite's Google Fonts stub for
 * that; the stub is gone with the fonts self-hosted (support/fixtures.ts), so real faces are simply
 * what every spec gets. The sweep still records which families actually loaded per skin
 * (`fontsLoaded`) so a broken local font path shows up as a caveat rather than quietly-wrong
 * numbers.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'visual-overflow-audit-e2e@reverie.local'
const PASSWORD = 'visual-overflow-audit-password'
const SHARE_CODE = 'OVERFLOWA'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = join(HERE, '..', '..')
const OUT_DIR = join(WEB_ROOT, 'audit-output', 'visual-overflow')

/** Phone widths bracket the trigger device; 768/1280 keep tablet and desktop honest. */
const WIDTHS = [375, 390, 412, 768, 1280] as const
const HEIGHT = 844
const MODES = ['light', 'dark'] as const

// ── route discovery ─────────────────────────────────────────────────────────────────────────────
/**
 * The route list is DERIVED from router.tsx, never hand-kept — a hand-kept copy is how coverage
 * silently shrinks (the a11y spec's fossil four-skin array is the precedent this avoids).
 *
 * Static parse rather than `import`: router.tsx pulls in every route module, which pulls React and
 * Vite-only asset imports that do not resolve under the test runner. Parsing gives the same answer
 * with no module graph. It FAILS LOUDLY if a route in `addChildren` has no resolvable `path:`, so
 * an unreadable route stops the sweep instead of quietly dropping out of it.
 */
function discoverRoutes(): { ident: string; path: string; file: string }[] {
  const routerSrc = readFileSync(join(WEB_ROOT, 'src', 'router.tsx'), 'utf8')
  const children = /addChildren\(\[([\s\S]*?)\]\)/.exec(routerSrc)
  if (!children?.[1]) throw new Error('audit: could not read addChildren([...]) from router.tsx')
  const idents = children[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const imports = new Map<string, string>()
  for (const m of routerSrc.matchAll(/import\s+\{\s*([^}]+?)\s*\}\s+from\s+'([^']+)'/g)) {
    const from = m[2]!
    for (const name of m[1]!.split(',').map((s) =>
      s
        .trim()
        .split(/\s+as\s+/)
        .pop()!
        .trim(),
    ))
      imports.set(name, from)
  }

  return idents.map((ident) => {
    const rel = imports.get(ident)
    if (!rel) throw new Error(`audit: no import found for route '${ident}' in router.tsx`)
    const file = join(WEB_ROOT, 'src', `${rel.replace(/^\.\//, '')}.tsx`)
    const src = readFileSync(file, 'utf8')
    const path = /^\s*path: '([^']*)'/m.exec(src)?.[1]
    if (path === undefined) throw new Error(`audit: no path: literal in ${file} (route '${ident}')`)
    return { ident, path, file }
  })
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
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
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'visual-overflow createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Overflow Audit', skin: 'tryst', mode: 'dark' }),
    'visual-overflow profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('visual-overflow', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
  return shared
}

/**
 * Content, not empty states — an empty screen cannot overflow, so a sweep of empty routes proves
 * nothing. Titles and author names are deliberately LONG: overflow is a function of the widest
 * unbreakable run of text, and short fixture strings are exactly how a real defect hides.
 */
async function seedFixtures(c: Client) {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'audit items delete')
    await ok(c.sb.from('book_moods').delete().eq('owner_id', c.uid), 'audit moods unlink')
    await ok(c.sb.from('books').delete().in('id', ids), 'audit books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'audit lists delete')
  await ok(c.sb.from('moods').delete().eq('owner_id', c.uid), 'audit moods delete')
  await ok(c.admin.from('clubs').delete().eq('created_by', c.uid), 'audit clubs delete')
  await ok(c.admin.from('shared_docs').delete().eq('key', SHARE_CODE), 'audit shared delete')

  const seriesName = 'The Insufferably Long Chronicles of Overflow'
  const rows = Array.from({ length: 30 }, (_, i) => ({
    owner_id: c.uid,
    title:
      i === 0
        ? 'A Thoroughly Unreasonable and Deliberately Overlong Title That Will Not Wrap Politely'
        : `Overflow Probe ${String(i + 1).padStart(2, '0')} — A Subtitle of Some Length`,
    author_first: 'Wilhelmina',
    author_last: 'Featherstonehaugh-Marchbanks',
    genre: 'fantasy',
    status: i < 6 ? 'ongoing' : 'standalone',
    series: i < 6 ? seriesName : null,
    position: i < 6 ? i + 1 : null,
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }))
  const { error } = await c.sb.from('books').insert(rows)
  if (error) throw new Error(`audit seed failed: ${JSON.stringify(error)}`)
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid).order('title')
  const bookIds = ((books as { id: string }[]) ?? []).map((b) => b.id)

  const { data: list } = await c.sb
    .from('lists')
    .insert({
      owner_id: c.uid,
      name: 'An Extravagantly Named Shelf for Overflow Measurement',
      kind: 'collection',
      sort_order: 1,
    })
    .select('id')
    .single()
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
    'audit list_items insert',
  )
  // A second, TBR-kind shelf so /shelves renders both tabs with real rows behind each — the tab
  // pill in the trigger screenshot only exists when both kinds are present.
  await ok(
    c.sb.from('lists').insert({
      owner_id: c.uid,
      name: 'To Be Read Eventually, Perhaps',
      kind: 'tbr',
      sort_order: 2,
    }),
    'audit tbr list insert',
  )

  const { data: mood } = await c.sb
    .from('moods')
    .insert({ owner_id: c.uid, name: 'Overflow Probe Mood' })
    .select('id')
    .single()
  const moodId = (mood as { id: string }).id
  await ok(
    c.sb
      .from('book_moods')
      .insert(bookIds.slice(0, 3).map((id) => ({ book_id: id, mood_id: moodId, owner_id: c.uid }))),
    'audit book_moods insert',
  )

  const { data: clubRow } = await c.admin
    .from('clubs')
    .insert({
      title: 'The Overflow Book Club of Extremely Long Naming',
      unit_type: 'chapter',
      unit_count: 30,
      created_by: c.uid,
    })
    .select('id')
    .single()
  const clubId = (clubRow as { id: string }).id
  await ok(
    c.admin
      .from('club_members')
      .insert({ club_id: clubId, user_id: c.uid, display_name: 'Overflow Probe', progress: 3 }),
    'audit club_members insert',
  )

  await ok(
    c.admin.from('shared_docs').insert({
      key: SHARE_CODE,
      value: {
        type: 'list',
        kind: 'list',
        name: 'A Shared List With A Name Of Considerable Length',
        items: [
          {
            id: bookIds[0]!,
            title: 'A Thoroughly Unreasonable and Deliberately Overlong Title',
            author: 'Wilhelmina Featherstonehaugh-Marchbanks',
            cover: '',
            by: 'W',
          },
        ],
        updatedAt: 1735689600000,
      },
    }),
    'audit shared_docs insert',
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
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers', 'taste', 'geo'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: { items: [] } }))
}

// ── the in-page probe ───────────────────────────────────────────────────────────────────────────
type Finding = {
  kind: 'page-overflow' | 'zoomed' | 'bleed' | 'hard-clip' | 'past-clipper' | 'left-escape'
  sel: string
  detail: string
  text: string
  over: number
}

/**
 * Runs in the page.
 *
 * ── THE RULE THAT MAKES THIS USABLE: MEASURE AGAINST THE NEAREST CLIPPING ANCESTOR ──────────────
 * The obvious probe — "flag any element whose scrollWidth exceeds its clientWidth" — was written
 * first and measured on /shelves: 5,000+ hits, essentially all of them noise. The reason is
 * structural, not a tuning problem. A `<span>` inside a `truncate` parent is SUPPOSED to be wider
 * than its box; the parent clips it and the reader sees an ellipsis. Every child inside SpineShelf
 * is supposed to be wider than the viewport; the shelf scrolls. Flagging those reports the
 * mechanism as the bug.
 *
 * What a reader can actually SEE is overflow that escapes every clipper between the element and the
 * screen. So each element is measured against its nearest ancestor whose `overflow-x` is not
 * `visible` (falling back to the viewport). Content that stays inside that box is invisible and
 * therefore not a finding, however far past its own edges it runs. This is the difference between
 * asserting the defect and asserting a proxy that happens to correlate with it.
 *
 * Two more exclusions, both earned by the same first run:
 *  · ROTATED / VERTICAL TEXT — spine labels are `writing-mode: vertical-*` or rotated. Their
 *    scrollWidth is measured along an axis that is not the one the reader sees, so the numbers are
 *    meaningless rather than merely noisy.
 *  · ABSOLUTE / FIXED elements for the off-screen check — the ambient sky is `inset-x-[-20%]` on
 *    purpose. A decoration deliberately larger than its frame is not a misalignment.
 *
 * Categories, kept apart because the FIX differs:
 *  page-overflow  the document is wider than the screen — the reader can pan sideways.
 *  zoomed         the emulator zoomed out to fit an overflowing page (see the header note).
 *  bleed          content escaping past its nearest clipper — paints over whatever is beside it.
 *                 The "sliver past the pill's edge" shape.
 *  hard-clip      a box that clips with content wider than itself AND no ellipsis — text simply
 *                 vanishes with nothing to signal it. `text-overflow: ellipsis` is EXCLUDED: that
 *                 is deliberate truncation with an affordance.
 *  past-clipper   the BOX itself sits past its clipper's right edge, whether or not its own content
 *                 overflows. A fixed-size control in a row that ran out of room reports no
 *                 self-overflow at all, so `bleed` cannot see it.
 *  left-escape    content starting LEFT of the box that clips it — cut at the START. Ordinary
 *                 truncation never does this, which makes it the specific signature of the trigger
 *                 screenshot's "nce ›".
 */
function probeSource() {
  const docEl = document.documentElement
  const vw = docEl.clientWidth
  const out: {
    kind: string
    sel: string
    detail: string
    text: string
    over: number
  }[] = []

  const sel = (el: Element): string => {
    const tag = el.tagName.toLowerCase()
    const id = el.id ? `#${el.id}` : ''
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 4).join('.')
        : ''
    const tid = el.getAttribute('data-testid')
    return `${tag}${id}${cls}${tid ? `[data-testid=${tid}]` : ''}`
  }
  const textOf = (el: Element): string =>
    ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)

  if (docEl.scrollWidth > vw + 1)
    out.push({
      kind: 'page-overflow',
      sel: 'html',
      detail: `scrollWidth ${docEl.scrollWidth} vs clientWidth ${vw}`,
      text: '',
      over: docEl.scrollWidth - vw,
    })
  if (window.innerWidth > vw + 1)
    out.push({
      kind: 'zoomed',
      sel: 'html',
      detail: `innerWidth ${window.innerWidth} vs clientWidth ${vw}`,
      text: '',
      over: window.innerWidth - vw,
    })

  const scrolls = (o: string) => o === 'auto' || o === 'scroll'
  const clips = (o: string) => o === 'hidden' || o === 'clip'

  /** Text laid out on an axis the reader does not read horizontally — spine labels. */
  const sideways = (cs: CSSStyleDeclaration): boolean =>
    cs.writingMode !== 'horizontal-tb' ||
    (cs.transform !== 'none' && /matrix\(\s*-?0?\.?\d*\s*,\s*-?[1-9]/.test(cs.transform))

  /**
   * The box that decides what is VISIBLE: the nearest ancestor that does not let content through,
   * or the viewport. Returns its edges plus whether it scrolls (a scroller's content is reachable,
   * so escaping content there is not lost — merely off-view until scrolled).
   */
  const clipperOf = (el: HTMLElement) => {
    let a: HTMLElement | null = el.parentElement
    while (a && a !== docEl) {
      const acs = getComputedStyle(a)
      if (scrolls(acs.overflowX) || clips(acs.overflowX)) {
        const ar = a.getBoundingClientRect()
        return {
          left: ar.left,
          right: ar.right,
          sel: sel(a),
          scrollable: scrolls(acs.overflowX),
          scrollLeft: a.scrollLeft,
        }
      }
      a = a.parentElement
    }
    return { left: 0, right: vw, sel: 'viewport', scrollable: false, scrollLeft: 0 }
  }

  for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    const cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue
    // Inline boxes report client/scrollWidth of 0 — they have no content box to measure. Skipping
    // them is not a coverage loss: their text overflows through the BLOCK that contains them, which
    // is measured.
    if (cs.display === 'inline') continue
    if (sideways(cs)) continue
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue

    const ox = cs.overflowX
    const overSelf = el.scrollWidth - el.clientWidth
    const clip = clipperOf(el)

    if (el.clientWidth > 0 && overSelf > 1 && !scrolls(ox)) {
      if (clips(ox)) {
        // Content is being CUT. Intentional when there is an ellipsis to say so; a silent
        // disappearance when there is not.
        //
        // TWO ways to have an ellipsis, and testing only the first is what produced this audit's
        // one false finding. `text-overflow: ellipsis` is the single-line mechanism. `-webkit-line
        // -clamp` is the multi-line one, and it renders its own ellipsis while leaving
        // `text-overflow` at its initial `clip` — so a clamped element reads as "cut, no ellipsis"
        // to a `textOverflow !== 'ellipsis'` test even though the reader is plainly signalled.
        // That is how finding 4 (`/club/:id`, 3px) got filed as a defect: measured on the live
        // page, the element had `-webkit-line-clamp: 3`, `text-overflow: clip`, and a real
        // scrollHeight of 96 against a clientHeight of 41 — genuinely truncated, genuinely
        // ellipsised, and the residual 3px was the italic tail of the last glyph hanging past the
        // box. Padding cannot absorb that (measured invariant at 3px for padding 0em, 0.6em and
        // 1.5em — scrollWidth tracks clientWidth exactly), because the overhang sits outside the
        // padding box, not inside it.
        const clamped = cs.webkitLineClamp !== 'none' && cs.webkitLineClamp !== ''
        if (cs.textOverflow !== 'ellipsis' && !clamped)
          out.push({
            kind: 'hard-clip',
            sel: sel(el),
            detail: `content ${el.scrollWidth} cut to ${el.clientWidth} (overflow-x: ${ox}, no ellipsis)`,
            text: textOf(el),
            over: overSelf,
          })
      } else {
        // Content escapes this box — but only counts if it also escapes whatever clips this box.
        // Inside a `truncate` parent or a horizontal scroller, this is the mechanism working.
        const contentRight = r.right + overSelf
        const past = contentRight - clip.right
        if (past > 1 && !clip.scrollable)
          out.push({
            kind: 'bleed',
            sel: sel(el),
            detail: `content reaches ${Math.round(contentRight)}, past its clipper <${clip.sel}> right edge ${Math.round(clip.right)}`,
            text: textOf(el),
            over: Math.round(past),
          })
      }
    }

    // The BOX itself pushed past its clipper, independent of whether its own content overflows.
    // This is the tab-pill shape: a control of fixed size in a row that ran out of room does not
    // report any self-overflow at all — its right edge is simply outside the box that clips it, and
    // a sliver of it paints where it should not. `bleed` above cannot see this case, which is why
    // it is measured separately rather than folded in.
    if (cs.position === 'static' && !clip.scrollable) {
      const past = r.right - clip.right
      if (past > 1)
        out.push({
          kind: 'past-clipper',
          sel: sel(el),
          detail: `box right edge ${Math.round(r.right)} past its clipper <${clip.sel}> right edge ${Math.round(clip.right)}`,
          text: textOf(el),
          over: Math.round(past),
        })
    }

    // Content cut at the START. Positioned elements are exempt: a decoration deliberately wider
    // than its frame (the ambient sky is inset-x-[-20%]) is not a misalignment.
    if (cs.position === 'static' && !clip.scrollable && clip.scrollLeft <= 1) {
      const before = clip.left - r.left
      if (before > 1)
        out.push({
          kind: 'left-escape',
          sel: sel(el),
          detail: `left edge ${Math.round(r.left)} starts before its clipper <${clip.sel}> left edge ${Math.round(clip.left)}`,
          text: textOf(el),
          over: Math.round(before),
        })
    }
  }
  return out
}

/** What actually rendered — read back, never assumed. */
function stateSource() {
  const d = document.documentElement
  const fam = (v: string) => (v.split(',')[0] ?? '').replace(/['"]/g, '').trim()
  const cs = getComputedStyle(d)
  const display = fam(cs.getPropertyValue('--font-display'))
  const body = fam(cs.getPropertyValue('--font-sans'))
  return {
    skin: d.dataset.skin ?? '',
    mode: d.dataset.mode ?? '',
    display,
    body,
    fontsLoaded:
      (display ? document.fonts.check(`16px "${display}"`) : true) &&
      (body ? document.fonts.check(`16px "${body}"`) : true),
  }
}

// ── the sweep ───────────────────────────────────────────────────────────────────────────────────
type Row = {
  route: string
  skin: string
  mode: string
  width: number
  findings: Finding[]
  fontsLoaded: boolean
}

test('visual overflow audit — sweep and report', async ({ page }) => {
  const c = await client()
  const fx = await seedFixtures(c)
  await stub(page)
  await signIn(page, c.session)

  const discovered = discoverRoutes()
  const params: Record<string, string> = {
    $listId: fx.listId,
    $bookId: fx.bookId,
    $moodId: fx.moodId,
    $clubId: fx.clubId,
    $code: SHARE_CODE,
    $seriesName: encodeURIComponent(fx.seriesName),
  }
  // /tropes/$tropeId has no seedable id — resolve it from the index the way a reader would, below.
  const routes: string[] = []
  const deferred: string[] = []
  for (const r of discovered) {
    const url = '/' + r.path.replace(/^\//, '')
    if (r.path === '$tropeId' || url.includes('$tropeId')) {
      deferred.push(url)
      continue
    }
    const resolved = url.replace(/\$[A-Za-z]+/g, (m) => params[m] ?? m)
    if (resolved.includes('$'))
      throw new Error(
        `audit: route ${url} has an unfixtured param — coverage would silently shrink`,
      )
    routes.push(resolved)
  }
  // Resolve the trope route from a real link; if the link dries up the sweep FAILS rather than
  // quietly covering one route fewer.
  if (deferred.length) {
    await page.setViewportSize({ width: 1280, height: HEIGHT })
    await page.goto('/tropes')
    await page.waitForTimeout(900)
    const href = await page.locator('a[href^="/tropes/"]').first().getAttribute('href')
    expect(
      href,
      'a trope link must exist on /tropes — coverage would silently shrink',
    ).not.toBeNull()
    routes.push(href!)
  }

  const rows: Row[] = []
  const shots = new Map<string, string>()
  mkdirSync(OUT_DIR, { recursive: true })

  async function measure(route: string, skin: string, mode: string, width: number) {
    await page.setViewportSize({ width, height: HEIGHT })
    await page.goto(route)
    await page.waitForTimeout(900) // async content (queries, covers) can change layout width
    const st = await page.evaluate(stateSource)
    // A measurement taken under the WRONG skin is worse than no measurement — it would be filed
    // against a combination that was never on screen. Refuse it loudly instead.
    if (st.skin !== skin || st.mode !== mode)
      throw new Error(
        `audit: asked for ${skin}/${mode} but the page rendered ${st.skin}/${st.mode} at ${route}`,
      )
    const findings = (await page.evaluate(probeSource)) as Finding[]
    rows.push({ route, skin, mode, width, findings, fontsLoaded: st.fontsLoaded })

    // One screenshot per unique (kind, selector) signature — enough to see it, not a flood.
    for (const f of findings) {
      const sig = `${f.kind}|${f.sel}`
      if (shots.has(sig)) continue
      const name = `${f.kind}--${skin}-${mode}-${width}--${route.replace(/[^\w]+/g, '_').slice(0, 40)}.png`
      await page.screenshot({ path: join(OUT_DIR, name), fullPage: false })
      shots.set(sig, name)
    }
  }

  async function setSkin(skin: string, mode: string) {
    await ok(
      c.admin.from('profiles').update({ skin, mode }).eq('id', c.uid),
      'audit profiles skin update',
    )
  }

  // ── STAGE A — broad. Every route x every width, in TWO skin/modes ────────────────────────────
  // tryst/dark is the default and the baseline the existing guards use. aphelion/dark is the
  // deliberate second: it is one of the three skins with `--control-transform: uppercase`, and
  // uppercase is materially wider than title case in the same box, so it is where a control-sized
  // overflow shows up first. Two passes, not eighteen, because 27 routes x 5 widths x 18 combos is
  // ~2400 navigations and hours of wall clock; Stage B spends the skin axis only where it pays.
  const stageA: [string, string][] = [
    ['tryst', 'dark'],
    ['aphelion', 'dark'],
  ]
  // Debugging affordance only — `AUDIT_ONLY=/shelves,/library` trims the route list so the harness
  // itself can be exercised in a minute instead of ten. Any use of it is printed, because a trimmed
  // sweep that looked like a full one would be the same lie the cap below refuses to tell.
  const only = (process.env.AUDIT_ONLY ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sweepRoutes = only.length ? routes.filter((r) => only.some((o) => r.startsWith(o))) : routes
  if (only.length)
    console.log(
      `audit: AUDIT_ONLY set — sweeping ${sweepRoutes.length}/${routes.length} routes. THIS IS A PARTIAL RUN.`,
    )
  for (const [skin, mode] of stageA) {
    await setSkin(skin, mode)
    for (const width of WIDTHS)
      for (const route of sweepRoutes) await measure(route, skin, mode, width)
  }

  // ── STAGE B — deep. All 18 skin x mode combos, narrowed to where it matters ───────────────────
  // Targets: every (route, width) Stage A flagged, PLUS /shelves at the three phone widths
  // unconditionally — /shelves is the trigger, so it gets the full skin axis whether or not Stage A
  // found anything there. A clean Stage A on /shelves is a real result, but only after all 18.
  const worst = new Map<string, number>()
  for (const r of rows) {
    const k = `${r.route}|${r.width}`
    worst.set(k, Math.max(worst.get(k) ?? 0, ...r.findings.map((f) => f.over), 0))
  }
  const pinned = [375, 390, 412].map((w) => `/shelves|${w}`)
  const ranked = [...worst]
    .filter(([k, v]) => v > 0 && !pinned.includes(k))
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k)

  // A CAP, DECLARED. Stage B is (16 combos x targets) navigations, so an unbounded target list is
  // an hour of wall clock that nobody reads the tail of. The cap is ranked by worst overflow, so
  // what survives is the biggest boxes, not the first alphabetically — and what gets dropped is
  // COUNTED AND PRINTED. A silent truncation here would make a partial sweep read as a full one,
  // which is the failure this audit exists to avoid, not commit.
  const STAGE_B_CAP = Number(process.env.AUDIT_STAGE_B_CAP ?? 20)
  const kept = [...pinned, ...ranked.slice(0, Math.max(0, STAGE_B_CAP - pinned.length))]
  const dropped = ranked.length - (kept.length - pinned.length)
  if (dropped > 0)
    console.log(
      `audit: stage B cap ${STAGE_B_CAP} — DROPPED ${dropped} flagged (route,width) target(s) from the deep pass. ` +
        `They keep their Stage A findings; only their other 16 skin/mode combos went unmeasured: ` +
        ranked.slice(kept.length - pinned.length).join(', '),
    )
  const targets = kept.map((k) => {
    const [route, width] = k.split('|')
    return { route: route!, width: Number(width) }
  })

  const allCombos: [SkinId, string][] = SKIN_ORDER.flatMap((s) =>
    MODES.map((m): [SkinId, string] => [s, m]),
  )
  const stageBCombos = allCombos.filter(
    ([s, m]) => !stageA.some(([as, am]) => as === s && am === m),
  )
  console.log(
    `audit: stage B — ${stageBCombos.length} skin/mode combos x ${targets.length} (route,width) targets`,
  )
  for (const [skin, mode] of stageBCombos) {
    await setSkin(skin, mode)
    for (const t of targets) await measure(t.route, skin, mode, t.width)
  }

  // ── report ───────────────────────────────────────────────────────────────────────────────────
  await setSkin('tryst', 'dark')

  const hits = rows.filter((r) => r.findings.length)
  const byKind = new Map<string, Row[]>()
  for (const r of hits)
    for (const k of new Set(r.findings.map((f) => f.kind)))
      byKind.set(k, [...(byKind.get(k) ?? []), r])

  const fontMisses = rows.filter((r) => !r.fontsLoaded)
  const lines: string[] = [
    '# Visual overflow audit',
    '',
    `- measurements: **${rows.length}**  ·  with findings: **${hits.length}**`,
    `- routes swept: ${sweepRoutes.length}/${routes.length}  ·  widths: ${WIDTHS.join(', ')}`,
    `- stage A: ${stageA.map((s) => s.join('/')).join(', ')} — every route x every width`,
    `- stage B: remaining ${stageBCombos.length} skin/mode combos x ${targets.length} (route,width) targets`,
    dropped > 0
      ? `- **NOT measured**: ${dropped} flagged (route,width) target(s) exceeded the Stage B cap of ${STAGE_B_CAP} and were swept in Stage A's 2 combos only, not all 18: ${ranked.slice(kept.length - pinned.length).join(', ')}`
      : '- stage B covered every flagged (route,width) — nothing dropped to the cap',
    only.length ? `- **PARTIAL RUN** — AUDIT_ONLY=${only.join(',')}` : '',
    `- real webfonts: ${rows.length - fontMisses.length}/${rows.length} measurements had both faces loaded`,
    '',
  ]
  for (const [kind, rs] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
    lines.push(`## ${kind} — ${rs.length} measurement(s)`, '')
    const uniq = new Map<string, { f: Finding; where: string[] }>()
    for (const r of rs)
      for (const f of r.findings.filter((x) => x.kind === kind)) {
        const e = uniq.get(f.sel) ?? { f, where: [] }
        e.where.push(`${r.route} ${r.skin}/${r.mode} @${r.width}`)
        if (f.over > e.f.over) e.f = f
        uniq.set(f.sel, e)
      }
    for (const [s, e] of [...uniq].sort((a, b) => b[1].f.over - a[1].f.over).slice(0, 25)) {
      lines.push(`- \`${s}\` — worst ${e.f.over}px — ${e.f.detail}`)
      if (e.f.text) lines.push(`  - text: “${e.f.text}”`)
      lines.push(`  - ${e.where.length} combo(s), e.g. ${e.where.slice(0, 4).join(' · ')}`)
      const shot = shots.get(`${kind}|${s}`)
      if (shot) lines.push(`  - screenshot: \`${shot}\``)
    }
    lines.push('')
  }
  if (!hits.length) lines.push('No findings in any measured combination.', '')

  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  writeFileSync(join(OUT_DIR, 'findings.json'), JSON.stringify({ rows: hits }, null, 2))
  console.log(lines.join('\n'))
  console.log(`audit: wrote ${join(OUT_DIR, 'report.md')}`)
})
