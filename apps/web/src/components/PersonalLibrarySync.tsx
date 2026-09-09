import { useEffect } from 'react'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { ALL_LIBRARY_KEYS, libraryKeysForTable } from './librarySyncQueries'

/**
 * Database Broadcast is deliberately an invalidation signal, not a second copy of library data.
 * The payload names only the changed table and operation; every actual row is fetched through the
 * normal RLS-checked query before it can reach the cache.
 */
type LibraryChange = {
  table?: string
  operation?: string
}

const REFRESH_AFTER_QUIET_MS = 160

/**
 * Keep one reader's open app in step with their other tabs and devices.
 *
 * One private channel replaces four Postgres Changes subscriptions. That matters for both privacy
 * and delete correctness: Postgres Changes cannot safely apply owner filters to RLS-protected
 * DELETE payloads, while the database broadcast is addressed to a topic only that owner may join.
 * A short trailing debounce turns a large import's row-by-row signals into one refresh per cache
 * family after the writes quiet down.
 */
export function PersonalLibrarySync({ readerId }: { readerId: string }) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!readerId) return

    let cancelled = false
    let timer: number | null = null
    let channel: ReturnType<typeof supabase.channel> | null = null
    const pending = new Map<string, QueryKey>()

    const flush = () => {
      timer = null
      const keys = [...pending.values()]
      pending.clear()
      for (const queryKey of keys) void qc.invalidateQueries({ queryKey })
    }

    const schedule = (keys: readonly QueryKey[]) => {
      if (!keys.length) return
      for (const key of keys) pending.set(JSON.stringify(key), key)
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(flush, REFRESH_AFTER_QUIET_MS)
    }

    void supabase.realtime
      .setAuth()
      .then(() => {
        if (cancelled) return
        channel = supabase
          .channel(`library:${readerId}`, { config: { private: true } })
          .on('broadcast', { event: 'library_changed' }, (message) => {
            const change = message.payload as LibraryChange | undefined
            schedule(libraryKeysForTable(change?.table))
          })
          .subscribe((status) => {
            // Close the fetch/subscribe race and refresh any IndexedDB snapshot as soon as the live
            // channel is ready. Ordinary query fetching still owns the data when Realtime is down.
            if (status === 'SUBSCRIBED') schedule(ALL_LIBRARY_KEYS)
          })
      })
      .catch(() => {
        // Realtime is an acceleration layer. Normal reads, writes, cache recovery, and visible
        // mutation errors remain the source of truth if a socket cannot be established.
      })

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      pending.clear()
      if (channel) void supabase.removeChannel(channel)
    }
  }, [qc, readerId])

  return null
}
