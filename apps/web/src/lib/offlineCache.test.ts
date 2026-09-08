import { beforeEach, describe, expect, it } from 'vitest'
import type { PersistedClient } from '@tanstack/react-query-persist-client'
import {
  clearAllOfflineCaches,
  clearOfflineCache,
  createDexiePersister,
  evictLegacyOfflineCache,
  evictOtherReaders,
  isOfflinePersistableQueryKey,
} from './offlineCache'
import { storedUserId } from './storedSession'

const client = (buster: string): PersistedClient => ({
  timestamp: 1,
  buster,
  clientState: { mutations: [], queries: [] },
})

// The persister derives this key exactly as supabase-js does, from VITE_SUPABASE_URL. The test env
// resolves that to the local stack (127.0.0.1), so the key is `sb-127-auth-token`.
const AUTH_KEY = 'sb-127-auth-token'
const signedInAs = (id: string) =>
  localStorage.setItem(AUTH_KEY, JSON.stringify({ access_token: 'x', user: { id } }))
const signedOut = () => localStorage.removeItem(AUTH_KEY)

/** Read the raw table, so tests can assert on what is actually on disk. */
async function rows(): Promise<string[]> {
  const { default: Dexie } = await import('dexie')
  const db = new Dexie('reverie-offline')
  db.version(1).stores({ cache: 'id' })
  const all = (await db.table('cache').toArray()) as { id: string }[]
  db.close()
  return all.map((r) => r.id).sort()
}

beforeEach(async () => {
  await clearAllOfflineCaches()
  signedOut()
})

describe('Dexie offline persister', () => {
  it('round-trips the query cache through IndexedDB and clears it', async () => {
    signedInAs('user-a')
    const persister = createDexiePersister()
    expect(await persister.restoreClient()).toBeUndefined()

    await persister.persistClient(client('v1'))
    const restored = await persister.restoreClient()
    expect(restored?.buster).toBe('v1')
    expect(restored?.timestamp).toBe(1)

    await persister.removeClient()
    expect(await persister.restoreClient()).toBeUndefined()
  })

  it('keeps a Soon plan and its intention inside the personal books mirror', async () => {
    signedInAs('user-a')
    const planned = client('plan-v1')
    planned.clientState.queries = [
      {
        queryKey: ['books'],
        queryHash: '["books"]',
        state: {
          data: [
            {
              id: 'book-1',
              title: 'A Book',
              plan: { y: null, m: null, d: null },
              planPosition: 1000,
              planIntention: 'For a quiet weekend.',
            },
          ],
          dataUpdateCount: 1,
          dataUpdatedAt: 1,
          error: null,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          status: 'success',
          fetchStatus: 'idle',
        },
      },
    ]
    const persister = createDexiePersister()
    await persister.persistClient(planned)

    const restored = await persister.restoreClient()
    expect(restored?.clientState.queries[0]?.state.data).toEqual([
      {
        id: 'book-1',
        title: 'A Book',
        plan: { y: null, m: null, d: null },
        planPosition: 1000,
        planIntention: 'For a quiet weekend.',
      },
    ])
  })
})

describe('query dehydration boundary', () => {
  it('never persists cross-account household responses', () => {
    expect(isOfflinePersistableQueryKey(['household', 'roster', 'reader-a'])).toBe(false)
    expect(isOfflinePersistableQueryKey(['household', 'books', 'reader-a'])).toBe(false)
  })

  it('keeps personal offline data eligible while retaining the series exclusions', () => {
    expect(isOfflinePersistableQueryKey(['books'])).toBe(true)
    expect(isOfflinePersistableQueryKey(['lists'])).toBe(true)
    expect(isOfflinePersistableQueryKey(['series'])).toBe(false)
    expect(isOfflinePersistableQueryKey(['series-strip', 'book-1'])).toBe(false)
  })
})

describe('the mirror is scoped per reader', () => {
  it('reads the signed-in user id synchronously from the stored session', () => {
    expect(storedUserId()).toBeNull()
    signedInAs('user-a')
    expect(storedUserId()).toBe('user-a')
  })

  it('writes one row per reader, and never hands one reader another’s cache', async () => {
    const persister = createDexiePersister()

    signedInAs('user-a')
    await persister.persistClient(client('A-LIBRARY'))

    // The same persister instance — it outlives sign-ins, so it must resolve the reader per call.
    signedInAs('user-b')
    expect(await persister.restoreClient()).toBeUndefined()

    await persister.persistClient(client('B-LIBRARY'))
    expect((await persister.restoreClient())?.buster).toBe('B-LIBRARY')

    signedInAs('user-a')
    expect((await persister.restoreClient())?.buster).toBe('A-LIBRARY')

    expect(await rows()).toEqual(['react-query:user-a', 'react-query:user-b'])
  })

  it('fails CLOSED when the session is unreadable — no row, rather than an unscoped one', async () => {
    const persister = createDexiePersister()

    signedOut()
    await persister.persistClient(client('should-not-persist'))
    expect(await rows()).toEqual([])
    expect(await persister.restoreClient()).toBeUndefined()

    // Malformed / future-encoded session payloads take the same path as signed-out.
    localStorage.setItem(AUTH_KEY, 'base64-something-we-cannot-parse')
    expect(storedUserId()).toBeNull()
    await persister.persistClient(client('still-should-not-persist'))
    expect(await rows()).toEqual([])

    // A session with no user id is equally unusable.
    localStorage.setItem(AUTH_KEY, JSON.stringify({ access_token: 'x' }))
    expect(storedUserId()).toBeNull()
    await persister.persistClient(client('nope'))
    expect(await rows()).toEqual([])
  })
})

describe('clearing primitives', () => {
  it('clearOfflineCache drops only the current reader’s row (the update-apply path)', async () => {
    const persister = createDexiePersister()
    signedInAs('user-a')
    await persister.persistClient(client('A'))
    signedInAs('user-b')
    await persister.persistClient(client('B'))

    // Still signed in as B — applyUpdate must delete the row the reloading client would restore.
    await clearOfflineCache()
    expect(await rows()).toEqual(['react-query:user-a'])
  })

  it('clearAllOfflineCaches leaves nothing behind, including other readers and the legacy row', async () => {
    const persister = createDexiePersister()
    signedInAs('user-a')
    await persister.persistClient(client('A'))
    signedInAs('user-b')
    await persister.persistClient(client('B'))
    await seedLegacyRow()
    expect((await rows()).length).toBe(3)

    // Sign-out runs AFTER auth-js has removed the session, so there is no id to scope by — which is
    // exactly why this clears the table rather than a row.
    signedOut()
    await clearAllOfflineCaches()
    expect(await rows()).toEqual([])
  })

  it('the boot sweep removes the pre-scoping row and leaves scoped rows alone', async () => {
    const persister = createDexiePersister()
    signedInAs('user-a')
    await persister.persistClient(client('A'))
    await seedLegacyRow()
    expect(await rows()).toEqual(['react-query', 'react-query:user-a'])

    await evictLegacyOfflineCache()
    expect(await rows()).toEqual(['react-query:user-a'])

    // Idempotent — a second boot is a no-op, not an error.
    await evictLegacyOfflineCache()
    expect(await rows()).toEqual(['react-query:user-a'])
  })
})

/** Write a row under the pre-scoping key, as a build from before this change would have. */
async function seedLegacyRow(): Promise<void> {
  const { default: Dexie } = await import('dexie')
  const db = new Dexie('reverie-offline')
  db.version(1).stores({ cache: 'id' })
  await db.table('cache').put({ id: 'react-query', client: client('LEGACY') })
  db.close()
}

describe('arriving reader evicts the others', () => {
  it('evictOtherReaders keeps only the signing-in reader’s row', async () => {
    const persister = createDexiePersister()
    signedInAs('user-a')
    await persister.persistClient(client('A'))
    signedInAs('user-b')
    await persister.persistClient(client('B'))
    await seedLegacyRow()

    await evictOtherReaders('user-b')
    expect(await rows()).toEqual(['react-query:user-b'])
  })
})
