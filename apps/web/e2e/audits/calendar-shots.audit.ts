import { configureReturningReader } from '../support/readerGuidance'
import { expect, test, type Page } from '@playwright/test'
import { authFailure } from '../support/authError'
import { keepOfflineCacheEmpty } from '../support/offlineCache'
import { okUser } from '../support/ok'
import { createClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * CALENDAR SPARSE PASS — review screenshots. Not a guard: this asserts almost nothing and exists
 * to produce PNGs a human decides from. `.audit.ts` keeps it out of `pnpm e2e`.
 *
 * ── WHY THE CLOCK IS PINNED ─────────────────────────────────────────────────────────────────────
 * `Calendar` derives BOTH the month it opens on and the --gold "today" ring from `new Date()`. An
 * unpinned run therefore moves the ring between shots and re-shoots a different month next week,
 * so a before/after pair taken minutes apart would not be comparing the same thing.
 *
 * ── WHY REDUCED MOTION ──────────────────────────────────────────────────────────────────────────
 * The ambient sky drifts and twinkles. Two shots of an identical tree would differ, and that noise
 * reads as a rendering difference in a contact sheet where the reader is looking for exactly that.
 *
 * SYNTHETIC DATA ONLY — every row here is fabricated in a throwaway account. The owner's real
 * library has almost no dated reads, which is why the dense cases have to be invented at all.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const EMAIL = 'calendar-shots-audit@reverie.local'
const PASSWORD = 'calendar-shots-audit-password'

/** Mid-month, a Wednesday: the ring lands inside the grid rather than on an edge. */
const PINNED = '2026-04-15T12:00:00'
/** March 2026 starts on a SUNDAY — no leading blanks. */
const PINNED_SUNDAY_START = '2026-03-18T12:00:00'
/** August 2026 starts on a SATURDAY with 31 days — forces SIX rows. */
const PINNED_SIX_ROWS = '2026-08-19T12:00:00'

const OUT = join(process.cwd(), 'audit-output', 'calendar-shots')
const TAG = process.env.RV_SHOT_TAG ?? 'branch'

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let uid = ''
let session: { access_token: string; refresh_token: string }

test.use({ reducedMotion: 'reduce' })

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  uid = data?.users?.find((u) => u.email === EMAIL)?.id ?? ''
  if (!uid) {
    // okUser, not `.data.user!` — a non-null assertion on a failed call throws a bare TypeError at
    // the READ rather than naming the call that failed, which in a shoot script means a confusing
    // crash instead of "createUser failed".
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'calendar-shots createUser',
      )
    ).id
  }
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('calendar-shots', EMAIL, error))
  session = s.session
})

/** Wipe and re-seed. `reads` carry dates (the pink dots); `plan_*` carry the violet ones. */
async function seed(spec: {
  reads?: { day: number; count: number }[]
  plans?: { day: number; count: number }[]
  month?: { y: number; m: number }
}) {
  const { y, m } = spec.month ?? { y: 2026, m: 4 }
  const { data: old } = await admin.from('books').select('id').eq('owner_id', uid)
  const ids = ((old as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await admin.from('reads').delete().in('book_id', ids)
    await admin.from('books').delete().in('id', ids)
  }
  const books: Record<string, unknown>[] = []
  const total =
    (spec.reads ?? []).reduce((a, r) => a + r.count, 0) +
    (spec.plans ?? []).reduce((a, r) => a + r.count, 0)
  for (let i = 0; i < Math.max(total, 1); i++)
    books.push({
      owner_id: uid,
      title: `Fabricated Title ${i + 1}`,
      author_first: 'Synthetic',
      author_last: 'Fixture',
      genre: 'fantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
      plan_y: null,
      plan_m: null,
      plan_d: null,
    })
  const { data: made } = await admin.from('books').insert(books).select('id')
  const bookIds = ((made as { id: string }[]) ?? []).map((b) => b.id)

  let cursor = 0
  const reads: Record<string, unknown>[] = []
  for (const r of spec.reads ?? [])
    for (let k = 0; k < r.count; k++) {
      reads.push({
        book_id: bookIds[cursor++ % bookIds.length],
        owner_id: uid,
        read_on: `${y}-${String(m).padStart(2, '0')}-${String(r.day).padStart(2, '0')}`,
        format: 'Paperback',
        rating: 4,
        notes: '',
      })
    }
  if (reads.length) await admin.from('reads').insert(reads)

  for (const p of spec.plans ?? [])
    for (let k = 0; k < p.count; k++) {
      const id = bookIds[cursor++ % bookIds.length]
      await admin.from('books').update({ plan_y: y, plan_m: m, plan_d: p.day }).eq('id', id)
    }
}

async function setSkin(skin: string, mode: string) {
  await admin.from('profiles').upsert({ id: uid, display_name: 'Shots', skin, mode })
}

async function openPlanner(page: Page, pinned = PINNED) {
  // WITHOUT THIS, A RE-OPEN SHOWS THE PREVIOUS SEED. The query cache is mirrored into IndexedDB
  // and restored on load, so navigating again inside one test re-renders the data the LAST seed
  // produced. That is exactly how E2 shipped as a copy of E1's sparse month while its filename
  // claimed dense — the seed had changed in the database and the screen had not.
  await keepOfflineCacheEmpty(page)
  // Clock first: the app reads `new Date()` during render, so pinning after navigation is too late.
  await page.clock.setFixedTime(new Date(pinned))
  await configureReturningReader(session.access_token)
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await page.goto('/planner?tab=calendar')
  await expect(page.getByRole('heading', { name: 'Keep your reading life close.' })).toBeVisible({
    timeout: 20_000,
  })
  await page.waitForTimeout(900) // let the (reduced-motion) sky settle before the shutter
}

/**
 * ASSERT THE THING ITSELF, AT THE SHUTTER.
 *
 * Every shot declares which days it expects to be marked, and this reads them back off the page
 * before capturing. That is the guard; the md5 check below is not.
 *
 * The md5 check cannot do this job and it is worth saying why, because it LOOKED like it could:
 * the ambient star field is randomised per render, so two captures of the identical screen differ
 * by a few bytes anyway. Every PNG is therefore byte-distinct no matter what was seeded, and the
 * duplicate check passes unconditionally — it proves two files are not identical, never that they
 * show different content, which is the only thing it was added for. Planting a duplicate proved it
 * FIRES; it did not prove it fires on THIS defect. A dense shot whose grid holds three marks now
 * fails here, at capture time, and no amount of sky noise can satisfy it.
 */
async function shot(page: Page, name: string, expectMarkedDays: number[]) {
  // SCOPED TO THE BRANCH, and the scoping is a real limitation rather than a convenience: the
  // before-shots are captured from `main`, whose day cells predate the aria-label this reads, so
  // the assertion cannot see them and correctly refused to shoot them. Those three reference
  // images are therefore UNGUARDED — they come from a tree nobody is changing, and their only job
  // is to sit beside the after-shots. Every shot of the branch, which is what this PR changes, is
  // checked.
  if (TAG !== 'branch') {
    await page.screenshot({ path: join(OUT, `${name}--${TAG}.png`), fullPage: true })
    return
  }
  const labels = await page
    .locator('.plan-calendar-grid button.has-entry')
    .evaluateAll((els) =>
      els.map((e) =>
        Number((e.getAttribute('aria-label') ?? '').match(/^\S+\s(\d{1,2}),/)?.[1] ?? 0),
      ),
    )
  const got = [...new Set(labels.filter(Boolean))].sort((a, b) => a - b)
  const want = [...expectMarkedDays].sort((a, b) => a - b)
  expect(
    got,
    `${name}: the page shows marks on [${got}] but this shot was seeded for [${want}]. The screen ` +
      `is not showing what the filename claims — do not publish this image.`,
  ).toEqual(want)
  await page.screenshot({ path: join(OUT, `${name}--${TAG}.png`), fullPage: true })
}

/** A tight crop of ONE cell — at 390px a 1.5px dot is unreviewable in a full-page PNG. */
async function cellShot(page: Page, day: number, name: string, padY = 18) {
  // MONTHS is MONTH_ABBR — "Apr", not "April". The first version of this selector spelled the month
  // out and matched nothing, and its `div:text-is` fallback stopped matching once the numeral moved
  // inside a <span>; both branches then burned the full 30s locator timeout per crop, which read as
  // the whole shoot hanging. Match on the DAY portion of the label, which no month spelling affects.
  const cell = page.locator(`.plan-calendar-grid button[aria-label*=" ${day},"]`).first()
  await cell.waitFor({ state: 'visible', timeout: 5_000 })
  await cell.scrollIntoViewIfNeeded()
  const box = await cell.boundingBox()
  if (!box) throw new Error(`cellShot: no cell found for day ${day} (${name})`)
  const pad = 18
  // padY is separate because a cell that OVERFLOWS is taller than its box: the cap case renders
  // 12 dots plus "+n", which grows the cell past `box.height`. The first version of this crop used
  // one symmetric pad and cut the "+28" clean off — the shot whose entire job was proving the
  // overflow degrades gracefully was the one shot that did not show it. Extra vertical room also
  // proves the taller row is not colliding with the week below.
  await page.screenshot({
    path: join(OUT, `${name}--${TAG}.png`),
    clip: {
      x: Math.max(0, box.x - pad),
      y: Math.max(0, box.y - pad),
      width: box.width + pad * 2,
      height: box.height + pad + padY,
    },
  })
}

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 900 }

// ── A. does it still read as a calendar ────────────────────────────────────────────────────────
for (const [skin, mode] of [
  ['tryst', 'dark'],
  ['bloom', 'light'],
] as const) {
  test(`A-empty-${skin}-${mode}`, async ({ page }) => {
    await setSkin(skin, mode)
    await seed({})
    await page.setViewportSize(PHONE)
    await openPlanner(page)
    await shot(page, `A1-empty-390-${skin}-${mode}-2026-04-15`, [])
  })

  test(`A-sparse-${skin}-${mode}`, async ({ page }) => {
    await setSkin(skin, mode)
    await seed({
      reads: [
        { day: 3, count: 1 },
        { day: 11, count: 2 },
      ],
      plans: [{ day: 22, count: 1 }],
    })
    await page.setViewportSize(PHONE)
    await openPlanner(page)
    await shot(page, `A2-sparse-390-${skin}-${mode}-2026-04-15`, [3, 11, 22])
  })

  test(`A-dense-${skin}-${mode}`, async ({ page }) => {
    await setSkin(skin, mode)
    const days = [1, 2, 4, 5, 7, 9, 10, 13, 15, 17, 19, 21, 24, 27, 29]
    await seed({ reads: days.map((d) => ({ day: d, count: (d % 3) + 1 })) })
    await page.setViewportSize(PHONE)
    await openPlanner(page)
    await shot(
      page,
      `A3-dense-390-${skin}-${mode}-2026-04-15`,
      [1, 2, 4, 5, 7, 9, 10, 13, 15, 17, 19, 21, 24, 27, 29],
    )
  })
}

// ── C. the measured extremes ───────────────────────────────────────────────────────────────────
for (const [skin, mode] of [
  ['bloom', 'light'],
  ['folio', 'dark'],
  ['hearth', 'dark'],
  ['tryst', 'dark'],
  ['hearth', 'light'],
] as const) {
  test(`C-extremes-${skin}-${mode}`, async ({ page }) => {
    await setSkin(skin, mode)
    // Marks ON the pinned day, so one crop shows the today ring AND both dot colours together.
    await seed({
      reads: [
        { day: 15, count: 2 },
        { day: 8, count: 1 },
      ],
      plans: [{ day: 15, count: 1 }],
    })
    await page.setViewportSize(PHONE)
    await openPlanner(page)
    await shot(page, `C-grid-390-${skin}-${mode}-2026-04-15`, [8, 15])
    await cellShot(page, 15, `C-cell-today+dots-${skin}-${mode}-2026-04-15`)
  })
}

// ── D. layout edges ────────────────────────────────────────────────────────────────────────────
test('D1-six-rows-saturday-start', async ({ page }) => {
  await setSkin('tryst', 'dark')
  await seed({
    month: { y: 2026, m: 8 },
    reads: [
      { day: 2, count: 1 },
      { day: 29, count: 2 },
    ],
  })
  await page.setViewportSize(PHONE)
  await openPlanner(page, PINNED_SIX_ROWS)
  await shot(page, 'D1-six-rows-aug2026-saturday-start-390-tryst-dark-2026-08-19', [2, 29])
})

test('D2-sunday-start-no-leading-blanks', async ({ page }) => {
  await setSkin('tryst', 'dark')
  await seed({
    month: { y: 2026, m: 3 },
    reads: [
      { day: 1, count: 1 },
      { day: 18, count: 1 },
    ],
  })
  await page.setViewportSize(PHONE)
  await openPlanner(page, PINNED_SUNDAY_START)
  await shot(page, 'D2-sunday-start-mar2026-390-tryst-dark-2026-03-18', [1, 18])
})

test('D3-both-dot-kinds-on-one-day', async ({ page }) => {
  await setSkin('tryst', 'dark')
  await seed({ reads: [{ day: 9, count: 2 }], plans: [{ day: 9, count: 2 }] })
  await page.setViewportSize(PHONE)
  await openPlanner(page)
  await shot(page, 'D3-both-kinds-grid-390-tryst-dark-2026-04-15', [9])
  await cellShot(page, 9, 'D3-both-kinds-cell-390-tryst-dark-2026-04-15')
})

test('D4-cap-fires-40-events', async ({ page }) => {
  await setSkin('tryst', 'dark')
  // 40 on one day: the cap should render 12 dots then "+28" rather than bleeding out of the cell.
  await seed({ reads: [{ day: 9, count: 40 }] })
  await page.setViewportSize(PHONE)
  await openPlanner(page)
  await shot(page, 'D4-cap-grid-390-tryst-dark-2026-04-15', [9])
  await cellShot(page, 9, 'D4-cap-cell-12dots-plus28-390-tryst-dark-2026-04-15', 72)
})

// ── E. desktop ─────────────────────────────────────────────────────────────────────────────────
test('E-desktop-sparse-and-dense', async ({ page }) => {
  await setSkin('tryst', 'dark')
  await seed({
    reads: [
      { day: 3, count: 1 },
      { day: 11, count: 2 },
    ],
    plans: [{ day: 22, count: 1 }],
  })
  await page.setViewportSize(DESKTOP)
  await openPlanner(page)
  await shot(page, 'E1-sparse-1280-tryst-dark-2026-04-15', [3, 11, 22])

  // A FULL re-open, not page.reload(): the first version reloaded and re-shot, and the two
  // desktop PNGs came out byte-identical (same MD5) — one datapoint wearing two filenames. The
  // seed below is also materially denser than E1's three marks, so the two shots cannot look the
  // same even if something upstream caches.
  const days = [1, 2, 4, 5, 7, 9, 10, 13, 15, 17, 19, 21, 24, 27, 29]
  await seed({
    reads: days.map((d) => ({ day: d, count: (d % 3) + 1 })),
    plans: [
      { day: 6, count: 2 },
      { day: 20, count: 1 },
    ],
  })
  await openPlanner(page)
  await shot(
    page,
    'E2-dense-1280-tryst-dark-2026-04-15',
    [1, 2, 4, 5, 6, 7, 9, 10, 13, 15, 17, 19, 20, 21, 24, 27, 29],
  )
})

/**
 * THE HARNESS MUST BE ABLE TO DETECT ITS OWN FAILURE.
 *
 * E1 and E2 once came out byte-identical — same MD5 — so section E had one datapoint wearing two
 * filenames, and nothing said so. A screenshot harness that can silently write the same image
 * twice is an instrument with unknown error characteristics: every shot it emits is then only as
 * trustworthy as the assumption that it shot what the filename claims.
 *
 * Two PNGs SHOULD never match here: every shot differs in skin, mode, seed, viewport or crop.
 * A collision therefore means a shot did not re-render — a missed navigation, a stale seed, a
 * reload that returned cache — and it is a defect in the evidence, not a cosmetic duplicate.
 * Runs last, and fails loudly rather than warning.
 */
test('no two screenshots are byte-identical', async () => {
  const seen = new Map<string, string>()
  const dupes: string[] = []
  for (const f of readdirSync(OUT).filter((n) => n.endsWith('.png'))) {
    const sum = createHash('md5')
      .update(readFileSync(join(OUT, f)))
      .digest('hex')
    const prior = seen.get(sum)
    if (prior) dupes.push(`${prior}  ==  ${f}  (md5 ${sum})`)
    else seen.set(sum, f)
  }
  expect(
    dupes,
    `these screenshots are byte-identical, so at least one did not re-render what its name ` +
      `claims:\n  ${dupes.join('\n  ')}`,
  ).toEqual([])
})
