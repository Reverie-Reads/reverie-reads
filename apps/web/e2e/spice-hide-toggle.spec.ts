import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okData, okUser } from './support/ok'

/**
 * The hide-spice toggle, asserted at what a reader SEES — and at the state hiding leaves behind.
 *
 * The core suite proves `withIntensityHidden` clears a live filter; it cannot prove the app wires
 * it up. The property that needs a browser is the third one below: a level selected BEFORE hiding
 * must stop constraining the grid, because the chip that would clear it is no longer on screen. A
 * toggle that renders correctly while the grid stays filtered passes every unit test in the repo.
 *
 *   · visible by default — the mark is on the card, the filter group is in the panel
 *   · hiding removes the mark and the group
 *   · a filter set BEFORE hiding stops filtering — the un-spicy book returns to the grid
 *   · nothing is deleted — books.intensity still carries the level, so unhiding restores it
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'

const PROJECT = (): string => test.info().project.name
const EMAIL = () => `spice-hide-${PROJECT()}-e2e@reverie.local`
const PASSWORD = 'spice-hide-e2e-password'

const SPICY = 'Ember and Ash'
const PLAIN = 'Quiet Harbour'

test.describe.configure({ mode: 'serial' })

type Client = {
  sb: SupabaseClient
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
  let uid = data?.users?.find((u) => u.email === EMAIL())?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL(), password: PASSWORD, email_confirm: true }),
        'spice-hide createUser',
      )
    ).id
  await ok(
    admin.from('profiles').upsert({
      id: uid,
      display_name: 'Spice Hide',
      skin: 'tryst',
      mode: 'dark',
      hide_intensity: false,
    }),
    'spice-hide profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({
    email: EMAIL(),
    password: PASSWORD,
  })
  if (error || !s.session) throw new Error(authFailure('spice-hide', EMAIL(), error))
  shared = { sb, session: s.session, uid: s.session.user.id }
  return shared
}

/** Two books, IDENTICAL key sets — a bulk insert's column list is the union of every row's keys. */
async function reset(c: Client): Promise<void> {
  const { data: books } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((books as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'spice-hide list_items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'spice-hide books delete')
  }
  await ok(
    c.sb.from('profiles').update({ hide_intensity: false }).eq('id', c.uid),
    'spice-hide profile reset',
  )
  const row = {
    owner_id: c.uid,
    author_first: 'Nell',
    author_last: 'Marrow',
    genre: 'fantasy',
    status: 'standalone',
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }
  await ok(
    c.sb.from('books').insert([
      { ...row, title: SPICY, intensity: 4 },
      { ...row, title: PLAIN, intensity: 0 },
    ]),
    'spice-hide seed',
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
  await page.route('**/books/v1/volumes**', (r) => r.fulfill({ json: {} }))
}

test('hiding spice removes the mark and the filter, and neutralizes a filter set before hiding', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const c = await client()
  await stub(page)
  await reset(c)
  await signIn(page, c.session)

  // ── visible by default ───────────────────────────────────────────────────────────────────────
  await page.goto('/library')
  await expect(page.getByRole('button', { name: `Open ${SPICY}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[title="Spice 4/5"]').first()).toBeVisible()

  // ── a filter set BEFORE hiding — the state that must not survive ─────────────────────────────
  await page.getByRole('button', { name: /^Filters/ }).click()
  const filterDialog = page.getByRole('dialog', { name: 'Library filters' })
  await filterDialog.getByLabel('Spice 4').first().click()
  await expect(page.getByRole('button', { name: `Open ${PLAIN}` })).toBeHidden({ timeout: 15_000 })

  // ── hide it, and wait for the WRITE, not the checkbox ────────────────────────────────────────
  await page.goto('/settings')
  const toggle = page.getByRole('checkbox', { name: /hide spice/i })
  await expect(toggle).toBeVisible({ timeout: 30_000 })
  // click(), not check(): the checkbox is CONTROLLED by the profile query, so its DOM state flips
  // only after the mutation round-trips. check() asserts an immediate flip and fails on the round
  // trip; the poll below is the real assertion anyway — it reads the write, not the widget.
  await toggle.click()
  await expect
    .poll(
      async () =>
        (
          (await okData(
            c.sb.from('profiles').select('hide_intensity').eq('id', c.uid).single(),
            'spice-hide flag read',
          )) as { hide_intensity: boolean }
        ).hide_intensity,
      { timeout: 30_000 },
    )
    .toBe(true)

  // ── mark gone, group gone, and the stale filter no longer constrains ─────────────────────────
  await page.goto('/library')
  await expect(page.getByRole('button', { name: `Open ${SPICY}` })).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('[title="Spice 4/5"]')).toHaveCount(0)
  // THE POINT: the level-4 filter selected earlier is neutralized, so the plain book is back.
  await expect(page.getByRole('button', { name: `Open ${PLAIN}` })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /^Filters/ }).click()
  await expect(
    page.getByRole('dialog', { name: 'Library filters' }).getByLabel('Spice 4'),
  ).toHaveCount(0)

  // ── nothing deleted: the stored level survives, so unhiding restores it ──────────────────────
  const rows = (await okData(
    c.sb.from('books').select('title, intensity').eq('owner_id', c.uid),
    'spice-hide intensity read',
  )) as { title: string; intensity: number }[]
  expect(rows.find((r) => r.title === SPICY)?.intensity).toBe(4)
})
