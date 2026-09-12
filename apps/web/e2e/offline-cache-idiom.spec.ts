import { configureReturningReader } from './support/readerGuidance'
import { expect, test, type Page } from './support/fixtures'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { authFailure } from './support/authError'
import { ok, okUser } from './support/ok'
import { keepOfflineCacheEmpty } from './support/offlineCache'

// `keepOfflineCacheEmpty` does what every spec's sign-in used to only appear to do.
//
// The old idiom — `await page.evaluate(() => indexedDB.deleteDatabase('reverie-offline'))` at the
// end of sign-in — deletes the database while the app is still running, and the persister writes on
// every query-cache event with no throttle. Any query still in flight re-creates the row a moment
// later, and the NEXT full navigation restores it. That is what made state-pills fail on two
// unrelated branches.
//
// The property under test is therefore not "the database is empty right now" — the app legitimately
// re-persists during the life of each document, so that would be false almost immediately and prove
// nothing. It is: **each new document starts from an empty cache**, no matter what the previous one
// wrote. Measured at boot by a second init script, which IndexedDB orders behind the delete the
// first one requested, so it observes exactly what the app's own `restoreClient` would.
//
// Deliberately independent of the ShelfRoute guard. That guard makes a poisoned cache RECOVERABLE,
// so with it in place no route-level assertion can distinguish the two idioms — reverting the idiom
// fix would leave every other spec green. This asserts the idiom directly, so it fails when the
// idiom regresses and not otherwise.

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'offline-idiom-e2e@reverie.local'
const PASSWORD = 'offline-idiom-e2e-password'

test.describe.configure({ mode: 'serial' })

type Client = { session: { access_token: string; refresh_token: string }; sb: SupabaseClient }
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
        'offline-idiom createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Offline Idiom', skin: 'tryst', mode: 'dark' }),
    'offline-idiom profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('offline-idiom', EMAIL, error))
  shared = { sb, session: s.session }
  return shared
}

/**
 * Record, at document start, how many rows the persisted cache holds — as the app's own restore
 * would see it. Installed AFTER keepOfflineCacheEmpty so IndexedDB's per-database ordering puts this
 * open behind that delete; a non-zero count therefore means a previous document's row survived.
 */
async function probeCacheAtBoot(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __rowsAtBoot: Promise<number> }).__rowsAtBoot = new Promise<number>(
      (resolve) => {
        const req = indexedDB.open('reverie-offline')
        req.onerror = () => resolve(-1)
        req.onsuccess = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('cache')) {
            db.close()
            resolve(0)
            return
          }
          const all = db.transaction('cache').objectStore('cache').getAll()
          all.onerror = () => {
            db.close()
            resolve(-1)
          }
          all.onsuccess = () => {
            db.close()
            resolve((all.result as unknown[]).length)
          }
        }
      },
    )
  })
}

const rowsAtBoot = (page: Page) =>
  page.evaluate(() => (window as unknown as { __rowsAtBoot: Promise<number> }).__rowsAtBoot)

test('every document boots from an empty offline cache, however much the last one persisted', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const c = await client()

  await keepOfflineCacheEmpty(page)
  await probeCacheAtBoot(page)

  await configureReturningReader(c.session.access_token)
  await page.goto(
    `/#access_token=${c.session.access_token}&refresh_token=${c.session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })

  // First document: nothing could have preceded it.
  expect(await rowsAtBoot(page), 'first document must boot with no persisted cache').toBe(0)

  // Let the app do exactly what the old idiom could not survive — persist a snapshot while running.
  await expect
    .poll(
      async () =>
        await page.evaluate(async () => {
          const req = indexedDB.open('reverie-offline')
          const db = await new Promise<IDBDatabase>((res, rej) => {
            req.onsuccess = () => res(req.result)
            req.onerror = () => rej(req.error)
          })
          if (!db.objectStoreNames.contains('cache')) {
            db.close()
            return 0
          }
          const all = await new Promise<unknown[]>((res, rej) => {
            const r = db.transaction('cache').objectStore('cache').getAll()
            r.onsuccess = () => res(r.result as unknown[])
            r.onerror = () => rej(r.error)
          })
          db.close()
          return all.length
        }),
      { timeout: 20_000 },
    )
    .toBeGreaterThan(0)

  // THE ASSERTION. A full navigation — the hop the old idiom left unguarded — and the next document
  // must still start clean. Under `page.evaluate`-after-load this is the row just written above.
  await page.goto('/library')
  expect(await rowsAtBoot(page), 'a persisted row must not survive into the next document').toBe(0)
})
