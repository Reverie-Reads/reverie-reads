import Dexie, { type Table } from 'dexie'
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import { storedUserId } from './storedSession'

interface CacheRow {
  id: string
  client: PersistedClient
}

/** IndexedDB-backed store for the offline cache (the design system's chosen Dexie layer). */
class ReverieCacheDB extends Dexie {
  cache!: Table<CacheRow, string>
  constructor() {
    super('reverie-offline')
    this.version(1).stores({ cache: 'id' })
  }
}

const db = new ReverieCacheDB()

/**
 * The pre-scoping row key. Every row used to be written here, with no user id in it, so on a shared
 * device the next reader to boot restored the previous reader's whole library — 286 of user A's
 * book cards rendering for user B, and staying there (the restored entry is fresh for `staleTime`,
 * and nothing afterwards triggers a refetch). Kept only so the boot sweep can delete it.
 */
const LEGACY_KEY = 'react-query'

/** One row per reader. */
const rowKey = (userId: string): string => `react-query:${userId}`

/**
 * Cross-account household responses never enter the offline mirror. Reader-scoped query keys keep
 * two signed-in users apart in memory, and AuthProvider clears that memory on sign-out; refusing to
 * dehydrate this namespace adds the stronger at-rest rule that another member's curated library is
 * not left in IndexedDB at all.
 *
 * Series remains excluded for its existing write-on-read/stale-shape reasons in main.tsx. Keeping
 * the key decision here makes the privacy boundary directly unit-testable without importing the
 * app entry point.
 */
export function isOfflinePersistableQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] !== 'series' &&
    queryKey[0] !== 'series-strip' &&
    queryKey[0] !== 'household' &&
    queryKey[0] !== 'catalog-cover-review'
  )
}

// Identity comes from storedSession.ts, which reads the persisted session synchronously and — since
// the offline-session work — also reports a PRESENT-but-unparseable auth key rather than silently
// treating it as signed out. Everything here still fails closed: no readable reader, no row.

/**
 * A TanStack Query persister backed by Dexie/IndexedDB — the local-first mirror. The query
 * cache (the user's library, lists, reads, clubs…) is written here on every change and
 * restored on load, so the app opens and reads while offline. Optimistic mutations made
 * offline pause and flush automatically on reconnect.
 *
 * Every entry point resolves the reader at CALL time rather than closing over an id, because one
 * persister instance is created at module scope and outlives any number of sign-ins.
 *
 * With no readable session every method is a no-op: restore resolves `undefined`, which is exactly
 * the first-visit path. Note the consequence — signing in does not retro-restore that reader's row
 * within the same page load, because the provider restores once on mount and never again. Their
 * queries simply fetch, and the row restores on the next boot. That is the price of scoping without
 * a boot gate, and it is the right side of the trade.
 */
export function createDexiePersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      const id = storedUserId()
      if (!id) return // never write an unscoped row — that is the bug this fixes
      await db.cache.put({ id: rowKey(id), client })
    },
    restoreClient: async () => {
      const id = storedUserId()
      if (!id) return undefined
      return (await db.cache.get(rowKey(id)))?.client
    },
    removeClient: async () => {
      const id = storedUserId()
      if (!id) return
      await db.cache.delete(rowKey(id))
    },
  }
}

/**
 * Drop the CURRENT reader's persisted query cache (used by the update-apply path). The buster
 * already discards it on the next new-build load, but clearing it BEFORE the reload guarantees the
 * reloaded client can't momentarily restore a stale, pre-migration query shape.
 *
 * Scoped, so `applyUpdate()` deletes the row the reloading client would actually restore rather
 * than a fixed key that no longer exists.
 */
export async function clearOfflineCache(): Promise<void> {
  const id = storedUserId()
  if (!id) return
  await db.cache.delete(rowKey(id))
}

/**
 * Leave nothing behind — the sign-out primitive. Clears the whole table rather than one row: at
 * sign-out the point is that no library data remains for the next reader, and a table clear also
 * sweeps the legacy unscoped row and any other reader's rows on a shared device.
 *
 * Deliberately NOT keyed to the current reader: auth-js removes the stored session before it emits
 * SIGNED_OUT, so by the time this runs there is no id left to scope by.
 */
export async function clearAllOfflineCaches(): Promise<void> {
  await db.cache.clear()
}

/**
 * Drop every row that is not this reader's — called on SIGNED_IN.
 *
 * Sign-out already clears the table, but sign-out is not guaranteed to have happened: the previous
 * reader may have closed the tab, or (before the offline sign-out fix) tried to sign out with no
 * connectivity and silently stayed signed in. Evicting on the way IN means a reader arriving on a
 * shared device leaves no one else's library behind them, whatever the previous reader did. Also
 * sweeps the pre-scoping row as a side effect.
 */
export async function evictOtherReaders(userId: string): Promise<void> {
  const mine = rowKey(userId)
  const keys = (await db.cache.toCollection().primaryKeys()) as string[]
  const others = keys.filter((k) => k !== mine)
  if (others.length) await db.cache.bulkDelete(others)
}

/**
 * One-time boot sweep of the pre-scoping row. A reader who never signs out again would otherwise
 * keep a full copy of their library under the unscoped key forever — orphaned, unreadable by the
 * scoped persister, and still sitting in IndexedDB. Cheap and idempotent; a no-op once swept.
 */
export async function evictLegacyOfflineCache(): Promise<void> {
  await db.cache.delete(LEGACY_KEY)
}
