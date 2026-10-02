import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from './support/fixtures'
import { localAdminKey } from './support/localSupabase'
import { configureReturningReader } from './support/readerGuidance'
import { keepOfflineCacheEmpty } from './support/offlineCache'

const endpoint = 'http://127.0.0.1:55321'
const anon =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

test.use({ viewport: { width: 844, height: 390 }, hasTouch: true, reducedMotion: 'reduce' })

// A real personal record and live reading chapter, rather than the visual lab. Nonzero CSS
// insets simulate the geometry contract; a native notch/share sheet still needs a device check.
test('the reading coach and its actions stay inside landscape safe areas without changing the book', async ({
  page,
}) => {
  const admin = createClient(endpoint, localAdminKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `safe-tour-${randomUUID()}@reverie.local`
  const password = 'Safe-tour-local-6217'
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (created.error || !created.data.user) throw created.error ?? new Error('No local test reader')
  const uid = created.data.user.id
  try {
    const reader = createClient(endpoint, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const auth = await reader.auth.signInWithPassword({ email, password })
    if (auth.error || !auth.data.session) throw auth.error ?? new Error('No local test session')
    await configureReturningReader(auth.data.session.access_token)
    const inserted = await reader
      .from('books')
      .insert({
        owner_id: uid,
        title: 'Landscape reading journey',
        read_status: 'Reading',
        progress: 19,
      })
      .select('id,read_status,progress')
      .single()
    if (inserted.error) throw inserted.error
    await keepOfflineCacheEmpty(page)
    for (const name of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
      await page.route(`**/functions/v1/${name}**`, (route) => route.fulfill({ json: {} }))
    const { access_token, refresh_token } = auth.data.session
    await page.goto(
      `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
    )
    await page.getByRole('button', { name: /enter your library/i }).click()
    await page.goto(`/book/${inserted.data.id}`)
    await expect(
      page.getByRole('heading', { name: 'Landscape reading journey', exact: true }),
    ).toBeVisible()
    await page.addStyleTag({
      content:
        ':root { --safe-top: 0px; --safe-right: 47px; --safe-bottom: 21px; --safe-left: 47px; }',
    })
    await page.getByRole('button', { name: 'Guide my reading', exact: true }).click()
    const coach = page.getByRole('complementary', { name: 'Live walkthrough' })
    await expect(coach).toBeVisible()
    await expect(coach).toHaveAttribute('data-inline', 'false')
    const inside = async () => {
      const box = await coach.boundingBox()
      return (
        !!box && box.x >= 47 && box.x + box.width <= 798 && box.y >= 0 && box.y + box.height <= 370
      )
    }
    await expect.poll(inside).toBe(true)
    const end = coach.getByRole('button', { name: 'End live walkthrough', exact: true })
    await end.scrollIntoViewIfNeeded()
    const action = await end.boundingBox()
    expect(action).not.toBeNull()
    expect(action!.x).toBeGreaterThanOrEqual(47)
    expect(action!.x + action!.width).toBeLessThanOrEqual(798)
    expect(action!.y).toBeGreaterThanOrEqual(0)
    expect(action!.y + action!.height).toBeLessThanOrEqual(370)
    const after = await reader
      .from('books')
      .select('id,read_status,progress')
      .eq('id', inserted.data.id)
      .single()
    if (after.error) throw after.error
    expect(after.data).toEqual(inserted.data)
    await page.screenshot({ path: test.info().outputPath('reading-coach-landscape.png') })
  } finally {
    const removed = await admin.auth.admin.deleteUser(uid)
    expect(removed.error, 'Local test reader cleanup').toBeNull()
  }
})
