import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

// Discover search e2e (docs/archive/task-discover-search.md): search field → results (deduped against the
// library, "On your shelf" for owned) → add owned / add-to-shelf unowned, and the shelf picker's
// "search everywhere" seam adding the same way. The `search` + `enrich` edge functions are STUBBED
// so the run is deterministic and offline; the real Hardcover+Google backend is exercised in the
// eyeball. A dedicated throwaway user keeps the seed + a11y sweep untouched.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const TEST_EMAIL = 'nogoogle-e2e@reverie.local'
const TEST_PASSWORD = 'discover-e2e-password'

test.describe.configure({ mode: 'serial' })

async function ensureUser(): Promise<void> {
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === TEST_EMAIL)?.id
  if (!uid) {
    uid = (
      await okUser(
        admin.auth.admin.createUser({
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
          email_confirm: true,
        }),
        'discover-search createUser',
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
      .upsert({ id: uid, display_name: 'Discover E2E', skin: 'tryst', mode: 'dark' }),
    'discover-search profiles upsert',
  )
}

type Client = {
  sb: SupabaseClient
  session: { access_token: string; refresh_token: string }
  uid: string
}

// One password sign-in for the whole file (the per-IP sign_in_sign_ups budget is shared with the
// heavy a11y sweep). The page-side hash sign-in doesn't count against it.
let shared: Client | null = null
async function client(): Promise<Client> {
  if (shared) return shared
  await ensureUser()
  const sb = createClient(SUPABASE_URL, ANON)
  const { data, error } = await sb.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  })
  if (error || !data.session) throw new Error(authFailure('discover-search', TEST_EMAIL, error))
  shared = { sb, session: data.session, uid: data.session.user.id }
  return shared
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

/**
 * THE GUARANTEE, asserted (fix/client-google-legs): the reader's browser never talks to a
 * third-party CATALOG. All three client-side Google Books legs were routed through Edge Functions;
 * Discover's was the one that fired on ROUTE MOUNT, with no action beyond navigating.
 *
 * This asserts the property at the only layer that can actually see it — real requests from a real
 * browser — rather than at the source level (the unit test does that) or the bundle level
 * (assert-dist-clean does that). A guarantee that isn't asserted degrades the first time someone
 * adds a fetch.
 *
 * Fonts are not in this spec's filter — they are self-hosted since #288 (same-origin, with their
 * own dist guard), so a font request could never legitimately match a third-party origin anyway.
 */
test('Discover mount makes no third-party catalog request', async ({ page }) => {
  test.setTimeout(120_000)
  const c = await client()
  await signIn(page, c.session)

  const thirdParty: string[] = []
  const releaseRequests: string[] = []
  page.on('request', (r) => {
    const u = r.url()
    // CATALOG endpoints only — the subject of this PR. Cover IMAGES (covers.openlibrary.org,
    // books.google.com/books/content) are a separate, standing app-wide leg with its own
    // handling (the suite-wide image stub exists because of it); the curated fn-down shelf
    // legitimately renders such covers, and this spec must not conflate an <img> load with a
    // catalog query. First draft used bare `openlibrary\.org` and tripped on exactly that.
    if (/www\.googleapis\.com\/books|openlibrary\.org\/search|api\.hardcover\.app/i.test(u))
      thirdParty.push(u)
    if (u.includes('/functions/v1/releases')) releaseRequests.push(u)
  })
  // Cover CDNs stubbed for determinism (offline CI), same as discover-curated.spec.ts.
  await page.route('**covers.openlibrary.org/**', (r) => r.fulfill({ status: 404, body: '' }))
  await page.route('**books.google.com/books/content**', (r) =>
    r.fulfill({ status: 404, body: '' }),
  )
  // Keep a failing route as a tripwire. Guided and genre Discover now use the reviewed local shelf
  // plus the shared catalog, so they should not invoke the former release-feed provider at all.
  await page.route('**/functions/v1/releases**', (r) => r.fulfill({ status: 500, json: {} }))

  await page.goto('/discover')
  await expect(page.getByRole('heading', { name: 'Find a book to get lost in.' })).toBeVisible({
    timeout: 20_000,
  })
  await page.waitForTimeout(3000) // Detect any request initiated by the guided entry screen.
  expect(thirdParty, 'The guided entry screen reached a third-party catalog.').toEqual([])

  // Choose a genre explicitly so the reviewed shelf renders; the former release-feed request must
  // remain absent here as well as on the guided entry screen.
  await page.goto('/discover?browse=true&genre=fantasy')
  await expect(
    page.getByRole('button', { name: 'View details for Fourth Wing', exact: true }).last(),
  ).toBeVisible()
  await page.waitForTimeout(3000) // Let any forbidden provider request initiate.

  expect(releaseRequests, 'Discover called the retired release-feed provider.').toEqual([])
  expect(
    thirdParty,
    'Discover reached a third-party catalog from the browser. Route it through an Edge Function — ' +
      'see lib/discover.ts for why mount-time requests are the indefensible shape.',
  ).toEqual([])
})
