import { configureReturningReader } from '../support/readerGuidance'
import { expect, test, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { authFailure } from '../support/authError'
import { keepOfflineCacheEmpty } from '../support/offlineCache'
import { okUser } from '../support/ok'

/** Book detail with BOTH level pills and a guide card open. Synthetic data only. */
const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'level-pills-audit@reverie.local'
const PASSWORD = 'level-pills-audit-password'
const OUT = join(process.cwd(), 'audit-output', 'level-pills')
const TAG = process.env.RV_SHOT_TAG ?? 'branch'

const admin = createClient(SUPABASE_URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
})
let uid = ''
let session: { access_token: string; refresh_token: string }
let bookId = ''

test.use({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })

test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  uid = data?.users?.find((u) => u.email === EMAIL)?.id ?? ''
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'level-pills createUser',
      )
    ).id
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('level-pills', EMAIL, error))
  session = s.session

  const { data: old } = await admin.from('books').select('id').eq('owner_id', uid)
  const ids = ((old as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) await admin.from('books').delete().in('id', ids)
  const { data: made } = await admin
    .from('books')
    .insert({
      owner_id: uid,
      title: 'A Fabricated Romantasy',
      author_first: 'Synthetic',
      author_last: 'Fixture',
      genre: 'romance',
      subgenre: 'Romantasy',
      status: 'standalone',
      ownership: 'owned',
      borrowed: false,
      wishlist: false,
      read_status: 'Read',
      intensity: 4,
      darkness: 3, // set explicitly: NULL across the real library, so a shot needs one fabricated
      pages: 412,
    })
    .select('id')
    .single()
  bookId = (made as { id: string }).id
})

async function open(page: Page, skin: string, mode: string) {
  await admin.from('profiles').upsert({ id: uid, display_name: 'Levels', skin, mode })
  await keepOfflineCacheEmpty(page)
  await configureReturningReader(session.access_token)
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await page.goto(`/book/${bookId}`)
  await expect(page.getByRole('heading', { name: 'A Fabricated Romantasy' })).toBeVisible({
    timeout: 20_000,
  })
  await page.waitForTimeout(700)
}

for (const [skin, mode] of [
  ['tryst', 'dark'],
  ['bloom', 'light'],
] as const) {
  test(`level pills — ${skin}/${mode}`, async ({ page }) => {
    await open(page, skin, mode)

    // BOTH pills present before anything is opened — the state a reader arrives at.
    const spice = page.getByRole('button', { name: /Spice 4 of 5/ })
    const dark = page.getByRole('button', { name: /Darkness 3 of 5/ })
    await expect(spice, 'the spice pill is missing').toBeVisible()
    await expect(dark, 'the darkness pill is missing — this is the new one').toBeVisible()
    await page.screenshot({
      path: join(OUT, `pills-closed-390-${skin}-${mode}--${TAG}.png`),
      fullPage: true,
    })

    await spice.click()
    await expect(page.getByRole('status')).toBeVisible()
    await page.screenshot({
      path: join(OUT, `guide-spice-390-${skin}-${mode}--${TAG}.png`),
      fullPage: true,
    })

    await dark.click()
    await expect(page.getByRole('status')).toBeVisible()
    await page.screenshot({
      path: join(OUT, `guide-darkness-390-${skin}-${mode}--${TAG}.png`),
      fullPage: true,
    })
  })
}
