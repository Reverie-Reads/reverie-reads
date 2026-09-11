// Nearby indie-bookstore discovery. A fixed same-origin route makes the primary Overpass call from
// the web runtime and shares rounded-area results through the CDN. The existing `geo` Edge Function
// remains a second execution path and durable-cache fallback. Browsers never hit Overpass directly.
// Raw elements come back; pure parse/chain-exclusion/distance logic lives in @reverie/core.

import { parseStores, type OverpassEl, type Store } from '@reverie/core'
import { supabase } from './supabase'

export type { Store } from '@reverie/core'

/** Find independent bookstores near a point (chains excluded, distance-sorted). Throws on a proxy
 *  failure so the caller can show its degraded state. */
export async function findBookstores(
  lat: number,
  lng: number,
  radiusMeters = 40000,
): Promise<Store[]> {
  const params = new URLSearchParams({
    lat: lat.toFixed(2),
    lng: lng.toFixed(2),
    radius: String(radiusMeters),
  })
  try {
    const response = await fetch(`/api/bookstores?${params.toString()}`)
    if (!response.ok) throw new Error('Bookstore web directory unavailable')
    const envelope = (await response.json()) as {
      payload?: { elements?: OverpassEl[] } | null
    } | null
    if (!envelope?.payload) throw new Error('Bookstore web directory returned no response')
    return parseStores(envelope.payload.elements ?? [], lat, lng)
  } catch {
    // The Supabase path has a longer-lived shared cache and may remain available when the web
    // runtime or its network path is degraded. Let its final failure reach the screen's retry UI.
  }

  const { data, error } = await supabase.functions.invoke('geo', {
    body: { op: 'stores', lat, lng, radius: radiusMeters },
  })
  if (error) throw error
  const envelope = data as { error?: string; payload?: { elements?: OverpassEl[] } | null } | null
  if (envelope?.error || !envelope?.payload) {
    throw new Error(envelope?.error || 'Bookstore directory returned no response')
  }
  const payload = envelope.payload
  return parseStores(payload?.elements ?? [], lat, lng)
}
