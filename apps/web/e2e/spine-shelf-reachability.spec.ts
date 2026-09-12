import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// REACHABILITY + INVARIANCE for the in-row magnification shelf, FIXED-WINDOW era
// (fix/spine-reveal-window).
//
// The failure history this suite guards, in one paragraph: the reveal's first mechanism (in-flow
// swap) mutated scrollWidth mid-gesture so momentum computed against a moving track; the second
// (absolute overlay) buried siblings' tap targets by construction; the third (shared sticky band)
// was rejected on device for divorcing the reveal from the shelf. The fourth — dock-style
// transform choreography with RESERVED SLACK — is sound, and its first form drove the wave with a
// TRAVELLING centre (the sliding anchor), which reached the terminals where there was no room and
// accreted a clamp (#146), a hard block (#147) and a hysteresis (#148) to behave there. The fifth
// form replaces the centre with a FIXED REVEAL WINDOW — one on-screen position books scroll
// through; magnification is a pure function of distance from it — and deletes all three
// compensators. Still only sound if two things hold forever: layout never moves (per-frame
// scrollWidth constancy, because in Blink/WebKit a transformed box crossing the END edge extends
// scrollable overflow, CSSWG #9458), and nothing is ever buried (displaced neighbours stay
// tappable where they visibly are). Those are exactly the assertions here.
//
// What is asserted, per shelf size {1, 2, 3, 6, 36}:
//   · PER-FRAME INVARIANCE (the load-bearing one): scrollWidth and scrollHeight sampled every
//     animation frame across a scripted end-to-end sweep AND a real-momentum CDP fling AND pick
//     transitions at both extremes — a single value each, to the pixel.
//   · SCROLL REACH: sweeping scrollLeft 0→max makes EVERY book the pick, and the exact extremes
//     pick the exact terminal books (the sliding anchor, carried through all three mechanisms).
//   · TAP REACH: every spine is hittable by REAL coordinate taps (which fail on a buried target —
//     dispatchEvent passes through occluders and proves nothing) and opens its own book.
//   · MAGNIFIED GEOMETRY: the picked spine's transformed box reaches cover scale; a spine far
//     from the anchor rests within ±1px of its natural width (density: the shelf still reads as
//     a shelf); the displaced immediate neighbour of a magnified pick is tappable and opens the
//     NEIGHBOUR.
//   · REDUCED MOTION: under prefers-reduced-motion the wave is binary — picked at full scale,
//     everything else exactly at rest.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'spine-reachability-e2e@reverie.local'
const PASSWORD = 'spine-reachability-e2e-password'
// Duplicated from SpineShelf deliberately — a silent change to the magnified size should fail here.
const MAG_W = 120
const MAG_H = 176

test.describe.configure({ mode: 'serial' })

type Ctx = {
  session: { access_token: string; refresh_token: string }
  shelves: { name: string; listId: string; count: number; bookIds: string[] }[]
}
let ctx: Ctx | null = null

async function setup(): Promise<Ctx> {
  if (ctx) return ctx
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'reachability createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Reachability E2E', skin: 'tryst', mode: 'dark' }),
    'reachability profiles upsert',
  )
  await ok(admin.from('list_items').delete().eq('owner_id', uid), 'reachability items delete')
  await ok(admin.from('lists').delete().eq('owner_id', uid), 'reachability lists delete')
  await ok(admin.from('books').delete().eq('owner_id', uid), 'reachability books delete')

  const rows = Array.from({ length: 36 }, (_, i) => ({
    owner_id: uid,
    title: `Reach Probe ${String(i + 1).padStart(2, '0')}`,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
    cover_url: `https://covers.reach.test/${i + 1}.jpg`,
  }))
  const { error: insertError } = await admin.from('books').insert(rows)
  if (insertError) throw new Error(`reachability seed failed: ${JSON.stringify(insertError)}`)
  const { data: books } = await admin.from('books').select('id').eq('owner_id', uid).order('title')
  const ids = (books as { id: string }[]).map((b) => b.id)

  const shelves: Ctx['shelves'] = []
  let sort = 0
  for (const count of [1, 2, 3, 6, 36]) {
    const name = `Reach ${count}`
    const { data: list, error: listError } = await admin
      .from('lists')
      .insert({ owner_id: uid, name, kind: 'collection', sort_order: ++sort })
      .select('id')
      .single()
    if (listError || !list) throw new Error(`reachability list: ${JSON.stringify(listError)}`)
    const listId = (list as { id: string }).id
    const bookIds = ids.slice(0, count)
    await ok(
      admin.from('list_items').insert(
        bookIds.map((id, i) => ({
          list_id: listId,
          book_id: id,
          owner_id: uid,
          position: i + 1,
        })),
      ),
      'reachability list_items insert',
    )
    shelves.push({ name, listId, count, bookIds })
  }
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('reachability', EMAIL, error))
  ctx = { session: s.session, shelves }
  return ctx
}

async function signInOnce(page: Page) {
  const c = await setup()
  await keepOfflineCacheEmpty(page)
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await page.route('**covers.reach.test**', (r) =>
    r.fulfill({ body: png, contentType: 'image/png' }),
  )
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await configureReturningReader(c.session.access_token)
  await page.goto(
    `/#access_token=${c.session.access_token}&refresh_token=${c.session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

async function gotoShelf(page: Page, listId: string, count: number) {
  await page.goto(`/shelf/${listId}`)
  await expect(page.locator('[data-spine]')).toHaveCount(count, { timeout: 20_000 })
  await page.waitForTimeout(500)
  // Park the cursor off the shelf: a hover PINS the pick (onPointerEnter, mouse), by design for
  // real mouse users, and Playwright's click leaves the mouse where it last clicked.
  await page.mouse.move(2, 2)
  await page.waitForTimeout(120)
}

const track = (page: Page) =>
  page
    .locator('[data-spine]')
    .first()
    .locator('xpath=ancestor::div[contains(@class,"overflow-x-auto")]')

const pickedId = (page: Page) => page.locator('[data-spine-picked]').getAttribute('data-spine')

/** Arm a per-animation-frame sampler of the track's scrollWidth/scrollHeight. */
async function armSampler(page: Page) {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('div')].find(
      (d) => getComputedStyle(d).overflowX === 'auto' && d.querySelector('[data-spine]'),
    )!
    const w = window as unknown as { __frames: [number, number][]; __stop: boolean }
    w.__frames = []
    w.__stop = false
    const tick = () => {
      if (w.__stop) return
      w.__frames.push([el.scrollWidth, el.scrollHeight])
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

async function harvestSampler(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __frames: [number, number][]; __stop: boolean }
    w.__stop = true
    return {
      frames: w.__frames.length,
      widths: [...new Set(w.__frames.map((f) => f[0]))],
      heights: [...new Set(w.__frames.map((f) => f[1]))],
    }
  })
}

test('per-frame invariance: scrollWidth and scrollHeight never move — sweep, fling, extremes', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await setup()
  const big = c.shelves.find((s) => s.count === 36)!
  await signInOnce(page)
  await gotoShelf(page, big.listId, 36)

  // Scripted end-to-end sweep and back, sampling every frame. The magnification wave crosses
  // every slot boundary twice; any transformed box escaping the reserved slack shows up as a
  // second width value.
  await armSampler(page)
  await track(page).evaluate(async (el) => {
    const max = el.scrollWidth - el.clientWidth
    for (let x = 0; x <= max; x += 6) {
      el.scrollLeft = x
      await new Promise((r) => requestAnimationFrame(r))
    }
    for (let x = max; x >= 0; x -= 6) {
      el.scrollLeft = x
      await new Promise((r) => requestAnimationFrame(r))
    }
  })
  const sweep = await harvestSampler(page)
  expect(sweep.frames).toBeGreaterThan(100)
  expect(sweep.widths, `sweep widths: ${sweep.widths.join()}`).toHaveLength(1)
  expect(sweep.heights, `sweep heights: ${sweep.heights.join()}`).toHaveLength(1)

  // A real-momentum fling (the gesture-audit method): CDP synthesizes the touch drag and the
  // compositor continues with momentum. This is the exact gesture class the first mechanism broke.
  const y = await track(page).evaluate((el) => {
    const r = el.getBoundingClientRect()
    return Math.round(r.y + r.height / 2)
  })
  const cdp = await page.context().newCDPSession(page)
  await armSampler(page)
  await cdp.send('Input.synthesizeScrollGesture', {
    x: 200,
    y,
    xDistance: -300,
    yDistance: 0,
    speed: 2500,
    preventFling: false,
    gestureSourceType: 'touch',
  })
  await page.waitForTimeout(1500)
  await cdp.send('Input.synthesizeScrollGesture', {
    x: 200,
    y,
    xDistance: 300,
    yDistance: 0,
    speed: 2500,
    preventFling: false,
    gestureSourceType: 'touch',
  })
  await page.waitForTimeout(1500)
  const fling = await harvestSampler(page)
  expect(fling.frames).toBeGreaterThan(50)
  expect(fling.widths, `fling widths: ${fling.widths.join()}`).toHaveLength(1)
  expect(fling.widths[0], 'fling and sweep must see the same track').toBe(sweep.widths[0])

  // Pick transitions at both extremes — where the magnified boxes press hardest on the edges.
  await armSampler(page)
  await track(page).evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[0])
  await track(page).evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[35])
  const extremes = await harvestSampler(page)
  expect(extremes.widths, `extreme widths: ${extremes.widths.join()}`).toHaveLength(1)

  // BOTH magnified terminals must sit fully INSIDE the track's box — the slack absorbing them is
  // the mechanism, this is the observable, and it is asserted SYMMETRICALLY. The first version of
  // this assertion measured only the RIGHT terminal, which is exactly how the left terminal
  // shipped able to clip on device (fix/spine-magnify-tracking): the START edge trims overhang
  // instead of extending scrollWidth, so the invariance sampler is structurally blind there and
  // only a direct geometric check can see it.
  await track(page).evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[0])
  await page.waitForTimeout(300) // let the settle animation finish before measuring
  const leftOverhang = await track(page).evaluate((el) => {
    const first = el.querySelector<HTMLElement>('[data-spine]')!
    return Math.round(first.getBoundingClientRect().left - el.getBoundingClientRect().left)
  })
  expect(
    leftOverhang,
    'magnified LEFT terminal must not cross the start edge',
  ).toBeGreaterThanOrEqual(0)
  await track(page).evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[35])
  await page.waitForTimeout(300)
  const rightOverhang = await track(page).evaluate((el) => {
    const spines = el.querySelectorAll<HTMLElement>('[data-spine]')
    const last = spines[spines.length - 1]!
    return Math.round(last.getBoundingClientRect().right - el.getBoundingClientRect().right)
  })
  expect(rightOverhang, 'magnified RIGHT terminal must not cross the end edge').toBeLessThanOrEqual(
    0,
  )
})

test('scroll reach: sweeping picks EVERY book, and the extremes pick the terminals', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await setup()
  const big = c.shelves.find((s) => s.count === 36)!
  await signInOnce(page)
  await gotoShelf(page, big.listId, 36)

  await track(page).evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[0])
  await track(page).evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[35])

  const seen = await track(page).evaluate(async (el) => {
    const out = new Set<string>()
    const max = el.scrollWidth - el.clientWidth
    const steps = 120
    for (let i = 0; i <= steps; i++) {
      el.scrollLeft = Math.round((max * i) / steps)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const id = el.querySelector<HTMLElement>('[data-spine-picked]')?.dataset.spine
      if (id) out.add(id)
    }
    return [...out]
  })
  const missing = big.bookIds.filter((id) => !seen.includes(id))
  expect(missing, `books never scroll-picked (count ${missing.length})`).toEqual([])

  // The scroll-picked terminal book OPENS from its magnified state — reach means picked AND
  // openable. The picked button IS the tap target now (one element per book).
  await track(page).evaluate((el) => (el.scrollLeft = el.scrollWidth))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[35])
  const indicator = page.locator('[data-spine-shelf] [data-spine-position]')
  await expect(indicator).toHaveAttribute('data-spine-position', '35')
  const markerEndDelta = await indicator.evaluate((bar) => {
    const marker = bar.querySelector<HTMLElement>('[data-spine-marker]')!
    const barBox = bar.getBoundingClientRect()
    const markerBox = marker.getBoundingClientRect()
    return Math.abs(markerBox.left + markerBox.width / 2 - barBox.right)
  })
  expect(markerEndDelta, 'last-book marker must land on the end of its track').toBeLessThanOrEqual(
    1,
  )

  // The visible marker doubles as an accessible range scrubber. Its own terminal key must drive
  // the shelf to the same last book; testing scrollLeft alone would miss a disconnected control.
  await track(page).evaluate((el) => (el.scrollLeft = 0))
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[0])
  await page.getByRole('slider', { name: 'Browse books by position' }).press('End')
  await expect.poll(async () => pickedId(page)).toBe(big.bookIds[35])
  await expect(indicator).toHaveAttribute('data-spine-position', '35')

  // `scrollToIndex` intentionally publishes the requested book immediately, then smoothly moves
  // the reveal window to it. Wait on the physical terminal as well as the React selection before
  // activating: a generic `[data-spine-picked]` locator can otherwise re-resolve to an interim
  // book while Playwright waits for the transforming button to become stable.
  await expect
    .poll(() =>
      track(page).evaluate(
        (el) => Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) <= 2,
      ),
    )
    .toBe(true)
  const terminal = page.locator(`[data-spine="${big.bookIds[35]}"]`)
  await expect(terminal).toHaveAttribute('data-spine-picked', '')
  await terminal.click({ timeout: 5_000 })
  await expect(page).toHaveURL(new RegExp(`/book/${big.bookIds[35]}`))
})

test('tap reach: on every tiny shelf, EVERY spine is hittable and its book opens', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await setup()
  await signInOnce(page)

  // Real coordinate taps/clicks hit-test like a finger: a buried spine throws on interception,
  // which is exactly the reachability failure this exists to catch (and exactly what the
  // wrapper-transform draft of this mechanism DID fail before the transform moved to the button —
  // the button's reported box disagreed with its visuals, and the runner aimed at a spot the
  // magnified neighbour painted over). Short timeouts keep a mutant run's failure fast.
  const hasTouch = !!test.info().project.use.hasTouch
  for (const shelf of c.shelves.filter((s) => s.count <= 6)) {
    for (const bookId of shelf.bookIds) {
      await gotoShelf(page, shelf.listId, shelf.count)
      const spine = page.locator(`[data-spine="${bookId}"]`)
      if (hasTouch) await spine.tap({ timeout: 5_000 })
      else await spine.click({ timeout: 5_000 })
      await page.waitForTimeout(200)
      if (!/\/book\//.test(page.url())) {
        await expect.poll(async () => pickedId(page)).toBe(bookId)
        // Second activation of the SAME element opens — one element per book again.
        if (hasTouch) await spine.tap({ timeout: 5_000 })
        else await spine.click({ timeout: 5_000 })
      }
      await expect(page).toHaveURL(new RegExp(`/book/${bookId}`), { timeout: 10_000 })
    }
  }
})

test('magnified geometry: cover scale at the pick, rest density elsewhere, neighbours tappable', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await setup()
  const big = c.shelves.find((s) => s.count === 36)!
  await signInOnce(page)
  await gotoShelf(page, big.listId, 36)

  // Anchor mid-track so the wave is fully interior.
  await track(page).evaluate((el) => {
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2)
  })
  await page.waitForTimeout(400)
  const geom = await track(page).evaluate((el) => {
    const picked = el.querySelector<HTMLElement>('[data-spine-picked]')!
    const spines = [...el.querySelectorAll<HTMLElement>('[data-spine]')]
    const iPicked = spines.indexOf(picked)
    const far = spines[iPicked >= 18 ? iPicked - 10 : iPicked + 10]!
    const neighbour = spines[iPicked + 1] ?? spines[iPicked - 1]!
    const trackRect = el.getBoundingClientRect()
    // visual-vs-natural centre shift of the two immediate neighbours, sign included
    const shift = (sp: HTMLElement) => {
      const r = sp.getBoundingClientRect()
      const visualCentre = r.left + r.width / 2
      const naturalCentre = trackRect.left - el.scrollLeft + sp.offsetLeft + sp.offsetWidth / 2
      return Math.round(visualCentre - naturalCentre)
    }
    return {
      pickedVisualW: Math.round(picked.getBoundingClientRect().width),
      farVisualW: far.getBoundingClientRect().width,
      farNaturalW: far.offsetWidth,
      neighbourId: neighbour.dataset.spine!,
      leftShift: iPicked > 0 ? shift(spines[iPicked - 1]!) : null,
      rightShift: iPicked < spines.length - 1 ? shift(spines[iPicked + 1]!) : null,
    }
  })
  // The picked spine reaches cover scale (rounding tolerance 2px)…
  expect(
    Math.abs(geom.pickedVisualW - MAG_W),
    `picked width ${geom.pickedVisualW}`,
  ).toBeLessThanOrEqual(2)
  // …a spine 10 slots away rests at natural width ±1px (density holds)…
  expect(
    Math.abs(geom.farVisualW - geom.farNaturalW),
    `rest width ${geom.farVisualW} vs natural ${geom.farNaturalW}`,
  ).toBeLessThanOrEqual(1)
  // …displacement SPLITS around the pick: the left neighbour moves LEFT and the right neighbour
  // moves RIGHT. This is asserted directly rather than via scrollWidth because the reserved slack
  // is deliberately generous (96px) — generous enough that even a fully one-sided push can hide
  // inside it, which a mutant run proved: naive rightward displacement SURVIVED the invariance
  // assertion. Symmetry is the property; this is its direct observation.
  expect(geom.leftShift, `left neighbour shift ${geom.leftShift}`).toBeLessThanOrEqual(-4)
  expect(geom.rightShift, `right neighbour shift ${geom.rightShift}`).toBeGreaterThanOrEqual(4)
  // The discriminator is SHARE, not pixel symmetry: hash-varied spine widths make the halves
  // genuinely unequal (clean ratios observed across projects/seeds: 0.58, 0.29, 0.24), but under
  // a correct split BOTH sides carry a real fraction of the displacement, while the
  // naive-rightward-push mutant sends ~93% one way (measured ratios 0.076-0.09). The 0.15 bound
  // sits between the two regimes with margin on both sides.
  const lo = Math.min(Math.abs(geom.leftShift!), Math.abs(geom.rightShift!))
  const hi = Math.max(Math.abs(geom.leftShift!), Math.abs(geom.rightShift!))
  expect(
    lo / hi,
    `displacement must SPLIT to both sides (left ${geom.leftShift}, right ${geom.rightShift})`,
  ).toBeGreaterThanOrEqual(0.15)

  // …and the displaced immediate neighbour is tappable where it visibly is, opening the NEIGHBOUR
  // (displacement, not burial — the defect class of mechanism two).
  const neighbourId = geom.neighbourId
  const spine = page.locator(`[data-spine="${neighbourId}"]`)
  await spine.click({ timeout: 5_000 })
  await page.waitForTimeout(200)
  if (!/\/book\//.test(page.url())) {
    await expect.poll(async () => pickedId(page)).toBe(neighbourId)
    await spine.click({ timeout: 5_000 })
  }
  await expect(page).toHaveURL(new RegExp(`/book/${neighbourId}`), { timeout: 10_000 })
})

test('reduced motion: the wave is binary — picked at full scale, the rest exactly at rest', async ({
  page,
}) => {
  const c = await setup()
  const big = c.shelves.find((s) => s.count === 36)!
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signInOnce(page)
  await gotoShelf(page, big.listId, 36)
  await track(page).evaluate((el) => {
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2)
  })
  await page.waitForTimeout(400)
  const state = await track(page).evaluate((el) => {
    const picked = el.querySelector<HTMLElement>('[data-spine-picked]')!
    const spines = [...el.querySelectorAll<HTMLElement>('[data-spine]')]
    const iPicked = spines.indexOf(picked)
    const neighbour = spines[iPicked + 1] ?? spines[iPicked - 1]!
    return {
      pickedW: Math.round(picked.getBoundingClientRect().width),
      neighbourVisualW: neighbour.getBoundingClientRect().width,
      neighbourNaturalW: neighbour.offsetWidth,
    }
  })
  expect(Math.abs(state.pickedW - MAG_W)).toBeLessThanOrEqual(2)
  // The IMMEDIATE neighbour — mid-wave under normal motion — must be exactly at rest.
  expect(Math.abs(state.neighbourVisualW - state.neighbourNaturalW)).toBeLessThanOrEqual(1)
})

test('cover aspect: the rendered cover box keeps the cover ratio at every visible wave position', async ({
  page,
}) => {
  // fix/spine-magnify-geometry, defect 1. The button's scale is non-uniform by necessity (spine
  // ratio → cover ratio), and the first implementation let the cover inherit it: every visible
  // wave position except exactly t=1 rendered the bitmap squat (measured 0.45 vs 0.68 intrinsic
  // mid-glide) with object-cover then cropping mid-image into the wrong-ratio box. The invariant:
  // the cover's rendered box holds the 120:176 cover ratio within 1% WHENEVER it is visible —
  // rest, mid-glide, settled — because object-cover renders the bitmap undistorted exactly when
  // its box is at the intended ratio.
  test.setTimeout(120_000)
  const c = await setup()
  const big = c.shelves.find((s) => s.count === 36)!
  await signInOnce(page)
  await gotoShelf(page, big.listId, 36)
  const INTRINSIC = MAG_W / MAG_H

  // Settled at an interior pick: exactly full cover size, exact ratio.
  await track(page).evaluate((el) => {
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2)
  })
  await page.waitForTimeout(450)
  const settled = await track(page).evaluate((el) => {
    const cover = el.querySelector<HTMLElement>('[data-spine-picked] [data-mag-cover]')!
    const r = cover.getBoundingClientRect()
    return { w: r.width, h: r.height, opacity: getComputedStyle(cover).opacity }
  })
  expect(Number(settled.opacity)).toBeGreaterThan(0.95)
  expect(Math.abs(settled.w - MAG_W), `settled cover width ${settled.w}`).toBeLessThanOrEqual(2)
  expect(Math.abs(settled.h - MAG_H), `settled cover height ${settled.h}`).toBeLessThanOrEqual(2)

  // Mid-glide: every cover that is at all visible, on every sampled frame of a scripted drag.
  const glide = await track(page).evaluate(async (el) => {
    const ratios: number[] = []
    const max = el.scrollWidth - el.clientWidth
    for (let x = Math.round(max * 0.25); x <= Math.round(max * 0.6); x += 6) {
      el.scrollLeft = x
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      for (const cov of el.querySelectorAll<HTMLElement>('[data-mag-cover]')) {
        if (parseFloat(getComputedStyle(cov).opacity) > 0.05) {
          const r2 = cov.getBoundingClientRect()
          if (r2.height > 0) ratios.push(r2.width / r2.height)
        }
      }
    }
    return { n: ratios.length, min: Math.min(...ratios), max: Math.max(...ratios) }
  })
  expect(glide.n).toBeGreaterThan(30)
  expect(
    Math.abs(glide.min / INTRINSIC - 1),
    `squattest mid-glide cover ratio ${glide.min.toFixed(4)} vs intrinsic ${INTRINSIC.toFixed(4)}`,
  ).toBeLessThanOrEqual(0.01)
  expect(
    Math.abs(glide.max / INTRINSIC - 1),
    `stretchiest mid-glide cover ratio ${glide.max.toFixed(4)} vs intrinsic ${INTRINSIC.toFixed(4)}`,
  ).toBeLessThanOrEqual(0.01)

  // Settled after a POINTER pick (the other settle path): same exact box. Wait for scroll
  // QUIESCENCE first — the settle-glide's smooth tail can still be moving boxes on a slow
  // runner, and a hover landing on drifting geometry can re-target the intent timer to whatever
  // slid under the cursor (the CI-only failure that added this wait).
  await track(page).evaluate(async (el) => {
    // First outlast the idle window (140ms) plus glide start — a short stability check can pass
    // entirely INSIDE the pre-settle gap and declare calm right before the glide moves the pick
    // (the 1-in-6 local flake that hardened this: the pick shifted onto the about-to-be-tapped
    // target and the tap OPENED it instead of picking it).
    await new Promise((r) => setTimeout(r, 400))
    let last = el.scrollLeft
    let stable = 0
    const t0 = performance.now()
    while (performance.now() - t0 < 4000) {
      await new Promise((r) => requestAnimationFrame(r))
      if (el.scrollLeft === last) {
        if (++stable >= 15) return
      } else {
        stable = 0
      }
      last = el.scrollLeft
    }
  })
  const targetId = await track(page).evaluate((el) => {
    const spines = [...el.querySelectorAll<HTMLElement>('[data-spine]')]
    const picked = el.querySelector<HTMLElement>('[data-spine-picked]')!
    const i = spines.indexOf(picked)
    return spines[i >= 18 ? i - 3 : i + 3]!.dataset.spine!
  })
  const spine = page.locator(`[data-spine="${targetId}"]`)
  if (test.info().project.use.hasTouch) await spine.tap({ timeout: 5_000 })
  else await spine.hover({ timeout: 5_000 })
  await page.waitForTimeout(450)
  await expect.poll(async () => pickedId(page)).toBe(targetId)
  const tapped = await track(page).evaluate((el) => {
    const cover = el.querySelector<HTMLElement>('[data-spine-picked] [data-mag-cover]')!
    const r = cover.getBoundingClientRect()
    return { w: r.width, h: r.height }
  })
  expect(Math.abs(tapped.w - MAG_W), `pointer-picked cover width ${tapped.w}`).toBeLessThanOrEqual(
    2,
  )
  expect(Math.abs(tapped.h - MAG_H), `pointer-picked cover height ${tapped.h}`).toBeLessThanOrEqual(
    2,
  )
})

test('containment: the revealed box stays inside the track — horizontally AND vertically', async ({
  page,
}) => {
  // fix/spine-reveal-window. Horizontal: the window sits MAG_W/2 + ring inside the viewport by
  // the slack arithmetic, so the revealed box is fully visible BY CONSTRUCTION — this assertion
  // is the proof the construction holds, in VIEWPORT space (gBCR against the track's client
  // rect), at rest and on every sampled mid-glide frame.
  //
  // Vertical — and the green-while-broken lesson this clause exists to record: EVERY invariance
  // assertion in this arc measured scrollWidth only. Nothing ever asserted the vertical box,
  // which is exactly how vertical clipping shipped green — the 1- and 2-book fixtures clipped
  // 11px and 8px of revealed cover + ring at rest, at the track's top clip edge, from the day
  // the in-row reveal merged. The track now reserves REVEAL_HEADROOM as a minHeight floor; this
  // asserts the revealed box's top edge INCLUDING its ring sits inside the track's box, same
  // viewport space, rest and mid-glide, on EVERY fixture.
  test.setTimeout(180_000)
  const c = await setup()
  await signInOnce(page)
  const TOL = 1.5 // sub-pixel transform rounding
  const RING = 2
  // Duplicated from SpineShelf deliberately (matching MAG_W/MAG_H above): a silent shrink of the
  // reserved headroom should fail here.
  const REVEAL_HEADROOM = 186 // MAG_H(176) + LIFT(8) + RING_W(2)
  const TRACK_PAD_BOTTOM = 16 // pb-4
  const REORDER_ROW_H = 17 // arrows row; /shelf/:id always passes onReorder

  for (const shelf of c.shelves) {
    await gotoShelf(page, shelf.listId, shelf.count)
    // STRUCTURAL floor, seed-independent: the gBCR cover-top clauses below only catch a shrunk
    // headroom when the seed happens to deal a spine short enough to expose it — fixture spine
    // heights hash from server-generated UUIDs, so they vary per DB seed. On the seed this arc
    // shipped against, the 1-book fixture's spine alone exceeded the floor and the
    // headroom-removal mutant PASSED — the exact "green by luck" failure this suite's own
    // comments keep warning about, caught only because a later re-verification pass happened to
    // land on a different seed.
    //
    // A first draft of this clause asserted the track's RENDERED clientHeight against the floor
    // — still seed-dependent, one level removed: clientHeight only falls short of the floor
    // when minHeight is both absent AND content alone doesn't happen to reach it, so the mutant
    // passed on this test run's mobile worker (mobile and rest each call setup() independently,
    // in separate processes, so they seed different random book UUIDs and can land on different
    // spine heights within the SAME run) while correctly failing on rest. Reading the authored
    // CSS property directly instead of the ambient rendered size decouples the assertion from
    // content entirely — it is the reservation existing, not a height that happened to suffice.
    const minH = await track(page).evaluate((el) => parseFloat(getComputedStyle(el).minHeight))
    expect(
      minH,
      `${shelf.count}-book: track minHeight (CSS) is ${minH}, short of the reserved headroom floor`,
    ).toBeGreaterThanOrEqual(REVEAL_HEADROOM + TRACK_PAD_BOTTOM + REORDER_ROW_H)
    const maxScroll = await track(page).evaluate((el) => el.scrollWidth - el.clientWidth)
    const restOffsets = [...new Set([0, Math.round(maxScroll / 2), maxScroll])]
    for (const x of restOffsets) {
      await track(page).evaluate((el, sl) => (el.scrollLeft = sl), x)
      await page.waitForTimeout(600) // past the idle timeout + the settle-scroll's smooth glide
      const box = await track(page).evaluate((el) => {
        const picked = el.querySelector<HTMLElement>('[data-spine-picked]')!
        const pr = picked.getBoundingClientRect()
        const cover = picked.querySelector<HTMLElement>('[data-mag-cover]')!
        const cr = cover.getBoundingClientRect()
        const tr = el.getBoundingClientRect()
        return {
          left: pr.left - tr.left,
          right: pr.right - tr.right,
          coverTop: cr.top - tr.top,
        }
      })
      expect(
        box.left,
        `${shelf.count}-book at rest scrollLeft ${x}: box left ${box.left.toFixed(1)}px past the visible left edge`,
      ).toBeGreaterThanOrEqual(-TOL)
      expect(
        box.right,
        `${shelf.count}-book at rest scrollLeft ${x}: box right ${box.right.toFixed(1)}px past the visible right edge`,
      ).toBeLessThanOrEqual(TOL)
      expect(
        box.coverTop - RING,
        `${shelf.count}-book at rest scrollLeft ${x}: cover top incl. ring ${(box.coverTop - RING).toFixed(1)}px above the track's top edge`,
      ).toBeGreaterThanOrEqual(-TOL)
    }
  }

  // Mid-glide on the big fixture, through both terminal regions and the middle: on every sampled
  // frame the MOST-magnified box stays inside the track, both axes.
  const big = c.shelves.find((s) => s.count === 36)!
  await gotoShelf(page, big.listId, 36)
  const glide = await track(page).evaluate(
    async (el, { tol, ring }) => {
      const violations: string[] = []
      let n = 0
      const max = el.scrollWidth - el.clientWidth
      const ranges: [number, number][] = [
        [0, Math.min(240, max)],
        [Math.max(0, Math.round(max / 2) - 120), Math.min(max, Math.round(max / 2) + 120)],
        [Math.max(0, max - 240), max],
      ]
      for (const [from, to] of ranges) {
        for (let x = from; x <= to; x += 6) {
          el.scrollLeft = x
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
          const tr = el.getBoundingClientRect()
          let bestSlot: HTMLElement | null = null
          let bestExcess = 2
          for (const s of el.querySelectorAll<HTMLElement>('[data-spine]')) {
            const excess = s.getBoundingClientRect().width - s.offsetWidth
            if (excess > bestExcess) {
              bestExcess = excess
              bestSlot = s
            }
          }
          if (!bestSlot) continue
          n++
          const r = bestSlot.getBoundingClientRect()
          const cover = bestSlot.querySelector<HTMLElement>('[data-mag-cover]')!
          const cr = cover.getBoundingClientRect()
          if (r.left - tr.left < -tol)
            violations.push(`x=${x} left ${(r.left - tr.left).toFixed(1)}`)
          if (r.right - tr.right > tol)
            violations.push(`x=${x} right ${(r.right - tr.right).toFixed(1)}`)
          if (cr.top - ring - tr.top < -tol)
            violations.push(`x=${x} top ${(cr.top - ring - tr.top).toFixed(1)}`)
        }
      }
      return { n, violations }
    },
    { tol: TOL, ring: RING },
  )
  expect(glide.n).toBeGreaterThan(60)
  expect(
    glide.violations,
    `mid-glide revealed box left the track (${glide.violations.length} frames)`,
  ).toEqual([])
})

test('tracking: in motion the wave glides with the WINDOW, never stepping', async ({ page }) => {
  // Retargeted from the travelling-anchor era (fix/spine-magnify-tracking): the wave's centroid
  // must stay within a tight band of the window's content position (scrollLeft + windowW) on
  // every sampled mid-motion frame. With a fixed window this is near-tautological — the scroll
  // rAF writes the wave at exactly that position — so what this actually guards is the WRITE
  // PATH staying same-frame and single-regime: any second regime, easing, or per-slot stepping
  // reintroduced between scroll and wave shows up as deviation. The 12px bound is far below half
  // a slot pitch (16-27px), so per-slot stepping cannot pass it.
  test.setTimeout(120_000)
  const c = await setup()
  const big = c.shelves.find((s) => s.count === 36)!
  await signInOnce(page)
  await gotoShelf(page, big.listId, 36)

  const result = await track(page).evaluate(async (el) => {
    const spines = [...el.querySelectorAll<HTMLElement>('[data-spine]')]
    const first = spines[0]!
    const windowW = first.offsetLeft + first.offsetWidth / 2
    const devs: number[] = []
    const max = el.scrollWidth - el.clientWidth
    let prev = performance.now()
    for (let x = Math.round(max * 0.2); x <= Math.round(max * 0.8); x += 5) {
      el.scrollLeft = x
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const now = performance.now()
      const stalled = now - prev > 100
      prev = now
      if (stalled) continue
      const expected = el.scrollLeft + windowW
      let num = 0
      let den = 0
      for (const s of spines) {
        const excess = s.getBoundingClientRect().width - s.offsetWidth
        if (excess > 2) {
          num += excess * (s.offsetLeft + s.offsetWidth / 2)
          den += excess
        }
      }
      if (den > 0) devs.push(Math.abs(num / den - expected))
    }
    devs.sort((a, b) => a - b)
    return {
      n: devs.length,
      p50: Math.round(devs[Math.floor(devs.length * 0.5)]!),
      max: Math.round(devs[devs.length - 1]!),
    }
  })
  expect(result.n).toBeGreaterThan(50)
  expect(
    result.max,
    `wave centroid must track the window while in motion (p50 ${result.p50}px, max ${result.max}px)`,
  ).toBeLessThanOrEqual(12)
})

test('occupancy: every book reaches full magnification at its own window position', async ({
  page,
}) => {
  // fix/spine-reveal-window. The window's contract: at scrollLeft 0 the FIRST book is revealed;
  // at max, the LAST; and every book between is fully revealed at exactly
  // scrollLeft = (its centre − windowW) — magnification is a pure function of scroll position,
  // and this asserts the function, book by book, on the layout the reader actually gets. This is
  // the reachability descendant of docs/audits/spine-overlay-clamp.md §4's dead zone (first/last
  // ~3 books never scroll-pickable under a fixed viewport-CENTRE anchor): the window solves the
  // same problem with slack arithmetic instead of a progress mapping, and this test is what the
  // travelling-centre mutant must fail.
  test.setTimeout(120_000)
  const c = await setup()
  const big = c.shelves.find((s) => s.count === 36)!
  await signInOnce(page)
  await gotoShelf(page, big.listId, 36)

  const result = await track(page).evaluate(async (el, magW) => {
    const spines = [...el.querySelectorAll<HTMLElement>('[data-spine]')]
    const first = spines[0]!
    const windowW = first.offsetLeft + first.offsetWidth / 2
    const max = el.scrollWidth - el.clientWidth
    const misses: string[] = []
    for (let i = 0; i < spines.length; i++) {
      const s = spines[i]!
      const target = Math.min(max, Math.max(0, s.offsetLeft + s.offsetWidth / 2 - windowW))
      el.scrollLeft = target
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      const picked = el.querySelector<HTMLElement>('[data-spine-picked]')
      const w = s.getBoundingClientRect().width
      if (picked !== s) misses.push(`book ${i}: picked ${picked?.dataset.spine} not this one`)
      else if (Math.abs(w - magW) > 2)
        misses.push(`book ${i}: width ${w.toFixed(1)} at its window position`)
    }
    // the exact extremes seat the exact terminals
    el.scrollLeft = 0
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    if (el.querySelector('[data-spine-picked]') !== spines[0])
      misses.push('scrollLeft 0 did not reveal the first book')
    el.scrollLeft = max
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    if (el.querySelector('[data-spine-picked]') !== spines[spines.length - 1])
      misses.push('scrollLeft max did not reveal the last book')
    return { n: spines.length, misses }
  }, MAG_W)
  expect(result.n).toBe(36)
  expect(result.misses, `occupancy misses (${result.misses.length})`).toEqual([])
})

test('terminal rest: first book at 0, last at max, fully visible, zero neighbour overlap — every fixture', async ({
  page,
}) => {
  // fix/spine-reveal-window. The travelling centre needed #147's hard block to shove terminal
  // overflow back on-screen, and the block's shove was what overlapped the pick into its
  // neighbour (~60px, the accepted trade of that era). The window has room on both sides by the
  // slack arithmetic, the block is DELETED, and overlap is zero by construction — displacement
  // always splits AWAY from the revealed book. This asserts that construction at both terminals
  // of every fixture: right book picked, box fully inside the viewport, zero intersection with
  // either neighbour. The trailing-slack mutant (slack below the window's requirement) must fail
  // the at-max clause — the last book stops short of the window and is never revealed.
  test.setTimeout(180_000)
  const c = await setup()
  await signInOnce(page)

  for (const shelf of c.shelves) {
    await gotoShelf(page, shelf.listId, shelf.count)
    for (const end of ['start', 'end'] as const) {
      const r = await track(page).evaluate(async (el, whichEnd) => {
        const wait = (ms: number) => new Promise((res) => setTimeout(res, ms))
        const max = el.scrollWidth - el.clientWidth
        el.scrollLeft = whichEnd === 'start' ? 0 : max
        await wait(600) // idle + settle-scroll glide
        const spines = [...el.querySelectorAll<HTMLElement>('[data-spine]')]
        const picked = el.querySelector<HTMLElement>('[data-spine-picked]')!
        const idx = spines.indexOf(picked)
        const pr = picked.getBoundingClientRect()
        const tr = el.getBoundingClientRect()
        const overlapWith = (nb: HTMLElement | undefined) => {
          if (!nb) return 0
          const nr = nb.getBoundingClientRect()
          return Math.max(0, Math.min(pr.right, nr.right) - Math.max(pr.left, nr.left))
        }
        return {
          idx,
          expectedIdx: whichEnd === 'start' ? 0 : spines.length - 1,
          left: pr.left - tr.left,
          right: pr.right - tr.right,
          overlapLeft: overlapWith(spines[idx - 1]),
          overlapRight: overlapWith(spines[idx + 1]),
        }
      }, end)
      expect(r.idx, `${shelf.count}-book at ${end}: wrong book seated in the window`).toBe(
        r.expectedIdx,
      )
      expect(
        r.left,
        `${shelf.count}-book at ${end}: box left ${r.left.toFixed(1)}`,
      ).toBeGreaterThanOrEqual(-1.5)
      expect(
        r.right,
        `${shelf.count}-book at ${end}: box right ${r.right.toFixed(1)}`,
      ).toBeLessThanOrEqual(1.5)
      expect(
        r.overlapLeft,
        `${shelf.count}-book at ${end}: overlaps left neighbour ${r.overlapLeft.toFixed(1)}px`,
      ).toBeLessThanOrEqual(0.5)
      expect(
        r.overlapRight,
        `${shelf.count}-book at ${end}: overlaps right neighbour ${r.overlapRight.toFixed(1)}px`,
      ).toBeLessThanOrEqual(0.5)
    }
  }
})

// polish/spine-pick-feel. The full 9×2 legibility sweep lives in
// packages/core/src/spinePickRing.contrast.test.ts (keyed off the SKINS registry); the two tests
// below spot-check that the REPRESENTATIVE cases actually reach the DOM as the right material:
// aphelion/dark uses its own --ornament-frame (translucent, clears 3:1 on its own), tryst/dark
// falls back to solid --primary (--ornament-frame alone measures 1.86:1 there — illegible). Each
// gets its own list (and its own fresh `page`, per Playwright's default) — a single test signing
// in twice on ONE page hit exactly the class of bug this suite exists to catch: the second
// `page.goto` of a hash-only auth URL to an already-loaded SPA is a same-document navigation the
// app's mount-time hash handler never re-fires for, so the second sign-in silently never took.
type RingCtx = { uid: string; listId: string }
let ringCtx: RingCtx | null = null
async function setupRing(): Promise<RingCtx> {
  if (ringCtx) return ringCtx
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const EMAIL2 = 'spine-ring-e2e@reverie.local'
  const PASSWORD2 = 'spine-ring-e2e-password'
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL2)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL2, password: PASSWORD2, email_confirm: true }),
        'ring createUser',
      )
    ).id
  }
  await ok(admin.from('list_items').delete().eq('owner_id', uid), 'ring items delete')
  await ok(admin.from('lists').delete().eq('owner_id', uid), 'ring lists delete')
  await ok(admin.from('books').delete().eq('owner_id', uid), 'ring books delete')
  const rows = Array.from({ length: 2 }, (_, i) => ({
    owner_id: uid,
    title: `Ring Probe ${i + 1}`,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
    cover_url: `https://covers.reach.test/ring-${i + 1}.jpg`,
  }))
  const { error: insertError } = await admin.from('books').insert(rows)
  if (insertError) throw new Error(`ring seed failed: ${JSON.stringify(insertError)}`)
  const { data: books } = await admin.from('books').select('id').eq('owner_id', uid).order('title')
  const bookIds = (books as { id: string }[]).map((b) => b.id)
  const { data: list, error: listError } = await admin
    .from('lists')
    .insert({ owner_id: uid, name: 'Ring Probe', kind: 'collection', sort_order: 1 })
    .select('id')
    .single()
  if (listError || !list) throw new Error(`ring list: ${JSON.stringify(listError)}`)
  const listId = (list as { id: string }).id
  await ok(
    admin
      .from('list_items')
      .insert(
        bookIds.map((id, i) => ({ list_id: listId, book_id: id, owner_id: uid, position: i + 1 })),
      ),
    'ring list_items insert',
  )
  ringCtx = { uid, listId }
  return ringCtx
}

async function readRingRgb(page: Page, skin: string, mode: string) {
  const { uid, listId } = await setupRing()
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  await ok(
    admin.from('profiles').upsert({ id: uid, display_name: 'Ring E2E', skin, mode }),
    `ring profile upsert (${skin}/${mode})`,
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: 'spine-ring-e2e@reverie.local',
    password: 'spine-ring-e2e-password',
  })
  if (error || !s.session)
    throw new Error(authFailure('ring', 'spine-ring-e2e@reverie.local', error))

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
  await keepOfflineCacheEmpty(page)
  await page.route('**covers.reach.test**', (r) =>
    r.fulfill({ body: png, contentType: 'image/png' }),
  )
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await configureReturningReader(s.session.access_token)
  await page.goto(
    `/#access_token=${s.session.access_token}&refresh_token=${s.session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await page.goto(`/shelf/${listId}`)
  await expect(page.locator('[data-spine]')).toHaveCount(2, { timeout: 20_000 })
  await page.waitForTimeout(500)
  await page.mouse.move(2, 2)
  await page.waitForTimeout(120)
  await track(page).evaluate((el) => {
    el.scrollLeft = Math.round((el.scrollWidth - el.clientWidth) / 2)
  })
  await page.waitForTimeout(500) // past idle + settle
  return track(page).evaluate(() => {
    const cover = document.querySelector<HTMLElement>('[data-spine-picked] [data-mag-cover]')!
    const boxShadow = getComputedStyle(cover).boxShadow
    // Chromium serialises the same colour as `color(srgb r g b / a)` or `rgba(r, g, b, a)`
    // depending on context — parse both so the assertion holds across projects.
    const wide = boxShadow.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/)
    if (wide) {
      return {
        r: Math.round(Number(wide[1]) * 255),
        g: Math.round(Number(wide[2]) * 255),
        b: Math.round(Number(wide[3]) * 255),
        a: wide[4] != null ? Number(wide[4]) : 1,
        raw: boxShadow,
      }
    }
    const std = boxShadow.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
    if (std) {
      return {
        r: Number(std[1]),
        g: Number(std[2]),
        b: Number(std[3]),
        a: std[4] != null ? Number(std[4]) : 1,
        raw: boxShadow,
      }
    }
    return { r: -1, g: -1, b: -1, a: -1, raw: boxShadow }
  })
}

test('picked-cover ring: aphelion/dark uses its own --ornament-frame (55% of --primary, translucent)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const aphelion = await readRingRgb(page, 'aphelion', 'dark')
  expect(aphelion.raw, 'aphelion/dark ring').toContain('2px')
  expect(Math.abs(aphelion.r - 79)).toBeLessThanOrEqual(2)
  expect(Math.abs(aphelion.g - 209)).toBeLessThanOrEqual(2)
  expect(Math.abs(aphelion.b - 224)).toBeLessThanOrEqual(2)
  expect(Math.abs(aphelion.a - 0.55)).toBeLessThanOrEqual(0.02)
})

test('picked-cover ring: tryst/dark falls back to solid --primary (--ornament-frame alone is 1.86:1 there)', async ({
  page,
}) => {
  test.setTimeout(60_000)
  const tryst = await readRingRgb(page, 'tryst', 'dark')
  expect(tryst.raw, 'tryst/dark ring').toContain('2px')
  expect(Math.abs(tryst.r - 224)).toBeLessThanOrEqual(2)
  expect(Math.abs(tryst.g - 81)).toBeLessThanOrEqual(2)
  expect(Math.abs(tryst.b - 125)).toBeLessThanOrEqual(2)
  expect(tryst.a).toBeGreaterThanOrEqual(0.98) // solid, not translucent
})
