import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  parseDiscoverySession,
  visibleDiscoverySession,
  type DiscoverySession,
} from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'

export const discoverySessionKey = (ownerId: string, id: string) =>
  ['discovery-session', ownerId, id] as const
export const savedDiscoveriesKey = (ownerId: string) => ['discovery-saved', ownerId] as const

export async function fetchSavedDiscoveries(
  ownerId: string,
  signal?: AbortSignal,
): Promise<DiscoverySession[]> {
  let query = supabase
    .from('discovery_sessions')
    .select('document')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (signal) query = query.abortSignal(signal)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => {
    const session = parseDiscoverySession(row.document)
    if (!session)
      throw new Error('A saved shortlist could not be read. Your saved data has not changed.')
    return session
  })
}

export function useSavedDiscoveries() {
  const { session } = useAuth()
  const ownerId = session?.user.id ?? ''
  return useQuery({
    queryKey: savedDiscoveriesKey(ownerId),
    queryFn: ({ signal }) => fetchSavedDiscoveries(ownerId, signal),
    enabled: !!ownerId,
    staleTime: 60_000,
    retry: false,
  })
}

export function useSaveDiscovery() {
  const { session } = useAuth()
  const ownerId = session?.user.id ?? ''
  const client = useQueryClient()
  return useMutation({
    networkMode: 'always', // Fail immediately offline; never enqueue a save for a later account/session.
    mutationFn: async (value: DiscoverySession) => {
      if (!navigator.onLine)
        throw new Error('Reconnect to save this shortlist. It is still here on this device.')
      const { data } = await supabase.auth.getUser()
      if (!ownerId || data.user?.id !== ownerId)
        throw new Error('Your account changed. Reopen Discover before saving.')
      const document = parseDiscoverySession(visibleDiscoverySession(value))
      if (!document?.picks.length)
        throw new Error('Keep at least one book before saving this shortlist.')
      const { error } = await supabase
        .from('discovery_sessions')
        .upsert({ owner_id: ownerId, id: document.id, document }, { onConflict: 'owner_id,id' })
      if (error) throw error
      return document
    },
    onSuccess: (document) => {
      // Do not repopulate another reader's cache if sign-out completed while the write was in flight.
      if (client.getQueryState(discoverySessionKey(ownerId, document.id)))
        client.setQueryData(discoverySessionKey(ownerId, document.id), document)
      void client.invalidateQueries({ queryKey: savedDiscoveriesKey(ownerId) })
    },
  })
}

export function useRemoveDiscovery() {
  const { session } = useAuth()
  const ownerId = session?.user.id ?? ''
  const client = useQueryClient()
  return useMutation({
    networkMode: 'always', // Fail immediately offline; never enqueue a save for a later account/session.
    mutationFn: async (id: string) => {
      if (!navigator.onLine) throw new Error('Reconnect to remove a saved shortlist.')
      const { data } = await supabase.auth.getUser()
      if (!ownerId || data.user?.id !== ownerId)
        throw new Error('Your account changed. Reopen Discover before removing a shortlist.')
      const { error } = await supabase
        .from('discovery_sessions')
        .delete()
        .eq('owner_id', ownerId)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: savedDiscoveriesKey(ownerId) })
    },
  })
}
