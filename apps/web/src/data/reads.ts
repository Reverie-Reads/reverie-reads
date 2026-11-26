import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReadEntry } from '@reverie/core'
import { supabase } from '../lib/supabase'
import { pageAll } from './paging'
import { toReadRecord, type ReadRecord } from './mappers'
import type { ReadRow } from './types'

export const readsKey = (bookId: string) => ['reads', bookId] as const
export const allReadsKey = ['reads', 'all'] as const

export interface AllReadRow {
  id: string
  book_id: string
  read_on: string | null
  format: string | null
  rating: number | null
  notes: string | null
}

/** Every read across the user's library — for the calendar and stats. */
export function useAllReads() {
  return useQuery({
    queryKey: allReadsKey,
    queryFn: async (): Promise<AllReadRow[]> => {
      // Every read in the account, rereads included — it feeds the calendar and stats, where a
      // truncated answer reads as a year with fewer books in it rather than as an error.
      return await pageAll<AllReadRow>('reads', (from, to) =>
        supabase
          .from('reads')
          .select('id, book_id, read_on, format, rating, notes', { count: 'exact' })
          // Same total order as useReads below, for the same reason: the calendar/stats consumers
          // get a deterministic sequence instead of whatever Postgres returned this time. `id` is
          // appended because neither of the other two is unique, and paging needs a total order.
          .order('read_on', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .order('id')
          .range(from, to),
      )
    },
  })
}

/** The reread log for one book (newest first). */
export function useReads(bookId: string) {
  return useQuery({
    queryKey: readsKey(bookId),
    queryFn: async (): Promise<ReadRecord[]> => {
      const { data, error } = await supabase
        .from('reads')
        .select('*')
        .eq('book_id', bookId)
        // Total order, though latestRatingByFormat no longer depends on it (it is order-total
        // itself) — series.ts's rule: the fetch order is an optimization and a stable display
        // order for the log, never a correctness dependency in a different package. nullsFirst
        // false because desc would otherwise put UNDATED reads first (Postgres default).
        .order('read_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data as ReadRow[]).map(toReadRecord)
    },
    enabled: !!bookId,
  })
}

/** Optimistically append a reread-log entry. */
export function useSaveReadEntry(bookId: string, readId?: string) {
  const qc = useQueryClient()
  const key = readsKey(bookId)
  return useMutation({
    meta: { action: 'The read log' },
    mutationFn: async (entry: ReadEntry): Promise<void> => {
      const { data: auth } = await supabase.auth.getUser()
      const ownerId = auth.user?.id
      if (!ownerId) throw new Error('Not signed in')
      const values = {
        // Existing log fields remain writable while the web and database releases roll out.
        // An editor must still be able to clear previously saved optional values.
        ...(readId || entry.startedOn ? { started_on: entry.startedOn || null } : {}),
        ...(readId || entry.physicalRating ? { physical_rating: entry.physicalRating || null } : {}),
        ...(readId || entry.audioRating ? { audio_rating: entry.audioRating || null } : {}),
        read_on: entry.date || null,
        format: entry.format || null,
        rating: entry.rating || null,
        notes: entry.notes || null,
      }
      const { error } = readId
        ? await supabase.from('reads').update(values).eq('id', readId).eq('book_id', bookId).eq('owner_id', ownerId).select('id').single()
        : await supabase.from('reads').insert({ ...values, book_id: bookId, owner_id: ownerId })
      if (error) throw error
    },
    onMutate: async (entry) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ReadRecord[]>(key)
      qc.setQueryData<ReadRecord[]>(key, (old) => readId ? old?.map((read) => read.id === readId ? { ...read, ...entry } : read) : [{ id: `temp-${entry.date}`, ...entry }, ...(old ?? [])])
      return { previous }
    },
    onError: (_err, _entry, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: allReadsKey }),
    ]),
  })
}

/** Optimistically remove a reread-log entry by id. */
export function useDeleteRead(bookId: string) {
  const qc = useQueryClient()
  const key = readsKey(bookId)
  return useMutation({
    meta: { action: 'The read log' },
    mutationFn: async (readId: string): Promise<void> => {
      const { error } = await supabase.from('reads').delete().eq('id', readId)
      if (error) throw error
    },
    onMutate: async (readId) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<ReadRecord[]>(key)
      qc.setQueryData<ReadRecord[]>(key, (old) => old?.filter((r) => r.id !== readId))
      return { previous }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous)
    },
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: key }),
      qc.invalidateQueries({ queryKey: allReadsKey }),
    ]),
  })
}
