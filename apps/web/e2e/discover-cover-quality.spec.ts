import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from './support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// EXPLICIT SEARCH COVER QUALITY (fix/discover-cover-quality; docs/audits/discover-cover-quality.md).
//
// The defect this guards against shipped green because the earlier verification asserted the SRC
// ATTRIBUTE — the zoom=2 rewrite was visible on every card while Google was serving a 300×48 scan
// strip or the "image not available" plate at 300×391 behind it, both at HTTP 200. Every
// assertion here therefore reads the RENDERED image: the naturalWidth/naturalHeight of what
// actually painted (or the placeholder's presence when nothing should paint). A test that checks
// the URL is the test that let this through.
//
// Four fixture volumes, one per audit class, served as exact-dimension stand-ins (flat-colour
// PNGs — the checks under test are dimensional, and Google's bytes stay out of the repo):
//   modern   — zoom=2 is a real 300×461 cover           → must PAINT AT 300×461 (stays upgraded)
//   oldscan  — zoom=2 is a 300×48 strip; zoom=1 is real → must paint the 128×188 zoom=1 cover
//   metaonly — zoom=2 is the 300×391 plate; zoom=1 real → must paint the 128×198 zoom=1 cover
//   noasset  — plate at BOTH zooms                      → must show CoverPlaceholder, no img
//
// The two-rung fallback under test is the existing candidate chain (coverCandidates: upgraded →
// zoom=1 original → placeholder); what this suite pins is the load-time verdict that drives it
// (isDegenerateGoogleCoverRender): the STRUCTURAL aspect test for strips, the enumerated plate
// sizes for plates. Mutants: removing the aspect test must fail ONLY the oldscan case (the plate
// list cannot mask it — strips are deliberately not enumerated); removing the zoom=1 rung must
// fail oldscan and metaonly (both collapse to the placeholder instead of their real covers).

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'discover-covers-e2e@reverie.local'
const PASSWORD = 'discover-covers-e2e-password'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'covers')
const px = (name: string) => readFileSync(join(FIXTURES, name))

const VOLUMES = {
  modern: 'FIXmodernAAA',
  oldscan: 'FIXoldscanAA',
  metaonly: 'FIXmetaonlyA',
  noasset: 'FIXnoassetAA',
} as const

const gUrl = (id: string) =>
  `https://books.google.com/books/content?id=${id}&printsec=frontcover&img=1&zoom=1&source=gbs_api`

/** What Google "serves" per volume per zoom — the audit's asset classes, dimensionally exact. */
const SERVED: Record<string, Record<string, string>> = {
  [VOLUMES.modern]: { '1': 'real-z1-meta-128x198.png', '2': 'real-z2-modern-300x461.png' },
  [VOLUMES.oldscan]: { '1': 'real-z1-scan-128x188.png', '2': 'strip-z2-300x48.png' },
  [VOLUMES.metaonly]: { '1': 'real-z1-meta-128x198.png', '2': 'plate-z2-300x391.png' },
  [VOLUMES.noasset]: { '1': 'plate-z1-128x170.png', '2': 'plate-z2-300x391.png' },
}

async function setup() {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'covers createUser',
      )
    ).id
  }
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Covers E2E', skin: 'tryst', mode: 'dark' }),
    'covers profile upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('covers', EMAIL, error))
  return s.session
}

async function openDiscover(page: Page) {
  const session = await setup()
  await keepOfflineCacheEmpty(page)
  await page.addInitScript(() => localStorage.setItem('reverie.onboarded', '1'))

  // Serve the fixture image the audit's asset classes dictate, by volume id + zoom.
  await page.route('**books.google.com/books/content**', (route) => {
    const u = new URL(route.request().url())
    const id = u.searchParams.get('id') ?? ''
    const zoom = u.searchParams.get('zoom') ?? '1'
    const file = SERVED[id]?.[zoom]
    if (!file) return route.fulfill({ status: 404, body: 'no fixture' })
    return route.fulfill({ body: px(file), contentType: 'image/png' })
  })

  // An explicit Google Books search payload: four hits, one per audit class, with covers at
  // zoom=1 exactly as the real provider payload carries them (the upgrade to zoom=2 happens in
  // the render chain). Google Books no longer powers ranked or guided Discover surfaces.
  await page.route('**/functions/v1/search**', (r) =>
    r.fulfill({
      json: {
        results: [
          {
            source: 'google',
            title: 'Modern Ebook',
            authors: ['A One'],
            cover: gUrl(VOLUMES.modern),
            isbn: '',
            year: '2025',
            sourceUrl: `https://books.google.com/books?id=${VOLUMES.modern}`,
          },
          {
            source: 'google',
            title: 'Old Scan',
            authors: ['A Two'],
            cover: gUrl(VOLUMES.oldscan),
            isbn: '',
            year: '1987',
            sourceUrl: `https://books.google.com/books?id=${VOLUMES.oldscan}`,
          },
          {
            source: 'google',
            title: 'Metadata Only',
            authors: ['A Three'],
            cover: gUrl(VOLUMES.metaonly),
            isbn: '',
            year: '2021',
            sourceUrl: `https://books.google.com/books?id=${VOLUMES.metaonly}`,
          },
          {
            source: 'google',
            title: 'No Asset',
            authors: ['A Four'],
            cover: gUrl(VOLUMES.noasset),
            isbn: '',
            year: '2020',
            sourceUrl: `https://books.google.com/books?id=${VOLUMES.noasset}`,
          },
        ],
      },
    }),
  )
  await page.route('**/functions/v1/releases**', (r) => r.fulfill({ json: { hits: [] } }))
  for (const p of ['enrich', 'embed', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))

  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await page.goto('/discover?browse=true')
  await page.getByLabel('Search the wider catalog').fill('cover quality fixtures')
  await expect(page.getByText('Modern Ebook')).toBeVisible({ timeout: 20_000 })
  // Let the fallback chain settle: a degenerate first candidate loads, gets rejected on load,
  // and the zoom=1 retry loads — two sequential image round-trips at most.
  await page.waitForTimeout(1500)
}

/** The PAINTED image state for the card containing `title` — dimensions of what actually
 *  rendered, not what was requested. */
async function paintedCover(page: Page, title: string) {
  return page
    .getByRole('button', { name: `View details for ${title}`, exact: true })
    .evaluate((card) => {
      // Scope the image query to the result's accessible preview control. The old release card used
      // an <article>; explicit search deliberately uses a button so opening details is one action.
      const coverBox = card.querySelector<HTMLElement>('[class*="aspect-"]') ?? null
      const img = coverBox?.querySelector('img') ?? null
      return {
        found: !!coverBox,
        hasImg: !!img,
        naturalW: img?.naturalWidth ?? 0,
        naturalH: img?.naturalHeight ?? 0,
        complete: img?.complete ?? false,
        src: img?.currentSrc?.slice(0, 140) ?? '',
      }
    })
}

test('rendered covers: upgraded where real, zoom=1 where degenerate, placeholder where nothing — asserted on painted pixels', async ({
  page,
}) => {
  test.setTimeout(120_000)
  await openDiscover(page)

  // modern ebook: the upgrade is the point — it must STAY upgraded (a fix that quietly stopped
  // upgrading would pass every fallback assertion below; this one pins the win).
  const modern = await paintedCover(page, 'Modern Ebook')
  expect(modern.found, 'modern: the card cover must exist').toBe(true)
  expect(modern.hasImg, 'modern: an image must paint').toBe(true)
  expect(
    [modern.naturalW, modern.naturalH],
    `modern must paint the UPGRADED 300×461 render (painted ${modern.naturalW}×${modern.naturalH}, src ${modern.src})`,
  ).toEqual([300, 461])

  // old-scan: zoom=2 serves a 300×48 strip — the structural aspect test must reject it and the
  // chain must recover the REAL zoom=1 cover, not paint the strip, not fall to the placeholder.
  const oldscan = await paintedCover(page, 'Old Scan')
  expect(oldscan.found, 'oldscan: the card cover must exist').toBe(true)
  expect(oldscan.hasImg, 'oldscan: an image must paint (the zoom=1 real cover)').toBe(true)
  expect(
    [oldscan.naturalW, oldscan.naturalH],
    `oldscan must paint the zoom=1 cover, not the strip (painted ${oldscan.naturalW}×${oldscan.naturalH}, src ${oldscan.src})`,
  ).toEqual([128, 188])

  // metadata-only (the Dracula case): zoom=2 serves the plate at 300×391 — the size the original
  // no-cover fix never knew. The enumerated plate list must reject it and recover zoom=1.
  const metaonly = await paintedCover(page, 'Metadata Only')
  expect(metaonly.found, 'metaonly: the card cover must exist').toBe(true)
  expect(metaonly.hasImg, 'metaonly: an image must paint (the zoom=1 real cover)').toBe(true)
  expect(
    [metaonly.naturalW, metaonly.naturalH],
    `metaonly must paint the zoom=1 cover, not the plate (painted ${metaonly.naturalW}×${metaonly.naturalH}, src ${metaonly.src})`,
  ).toEqual([128, 198])

  // no usable asset at either zoom: both rungs reject, the honest placeholder shows, and no
  // Google image remains painted in the card.
  const noasset = await paintedCover(page, 'No Asset')
  expect(noasset.found, 'noasset: the card cover must exist').toBe(true)
  expect(
    noasset.hasImg,
    `noasset must show CoverPlaceholder — no plate may remain painted (src ${noasset.src})`,
  ).toBe(false)
})
