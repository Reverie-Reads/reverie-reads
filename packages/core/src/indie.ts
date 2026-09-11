// Indie-bookstore discovery — the PURE parsing for the OpenStreetMap Overpass results. The network
// call is proxied through the `geo` Edge Function (a contact User-Agent + server-side caching by
// rounded area, per OSM usage policy); this module turns the raw Overpass elements into Stores so
// the chain-exclusion + distance logic is unit-tested and runtime-agnostic.

export interface Store {
  id: string
  name: string
  lat: number
  lng: number
  address: string
  hours: string
  phone: string
  website: string
  distanceKm: number
}

export interface OverpassEl {
  type: string
  id: number
  lat?: number
  lon?: number
  center?: { lat: number; lon: number }
  tags?: Record<string, string>
}

// Heuristic chain-exclusion to bias toward independents. Not exhaustive — some indies may be
// missed and some chains may slip through; keep this list maintainable.
const CHAINS: RegExp[] = [
  /barnes\s*&?\s*noble/i,
  /books-?a-?million/i,
  /\bbam!?\b/i,
  /waterstones/i,
  /half\s*price\s*books/i,
  /\bfollett\b/i,
  /b\.?\s*dalton/i,
  /\bborders\b/i,
  /\bindigo\b/i,
  /\bchapters\b/i,
  /\bwhsmith\b/i,
  /\btarget\b/i,
  /\bwalmart\b/i,
  /\bcostco\b/i,
  /books\s*inc/i,
]
export const isChain = (name: string): boolean => CHAINS.some((re) => re.test(name))

/** OSM website tags are community-authored. Accept HTTP(S) only and repair the common bare-domain
 * shape; an arbitrary scheme must never become a clickable link. */
export function safeStoreWebsite(value: string | undefined): string {
  const raw = value?.trim()
  if (!raw) return ''
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  try {
    const parsed = new URL(candidate)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : ''
  } catch {
    return ''
  }
}

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/**
 * Rounded cache key for a nearby query — the grid cell + radius. ~2 decimals ≈ 1.1km cells, so
 * repeat searches from the same area share one cached Overpass response (the cost lever). The
 * client computes distances from the REAL point, so rounding the cache key doesn't blur results.
 */
export const geoCacheKey = (
  lat: number,
  lng: number,
  radiusMeters: number,
  precision = 2,
): string => `stores:${lat.toFixed(precision)},${lng.toFixed(precision)}:${radiusMeters}`

/** Turn raw Overpass elements into independent Stores, distance-sorted from (lat,lng). */
export function parseStores(elements: readonly OverpassEl[], lat: number, lng: number): Store[] {
  const stores: Store[] = []
  for (const el of elements ?? []) {
    const t = el.tags ?? {}
    const eLat = el.lat ?? el.center?.lat
    const eLng = el.lon ?? el.center?.lon
    if (
      eLat == null ||
      eLng == null ||
      !Number.isFinite(eLat) ||
      !Number.isFinite(eLng) ||
      eLat < -90 ||
      eLat > 90 ||
      eLng < -180 ||
      eLng > 180
    )
      continue
    const name = t.name ?? 'Unnamed bookshop'
    if (isChain(name)) continue
    const address = [
      t['addr:housenumber'],
      t['addr:street'],
      t['addr:city'],
      t['addr:state'],
      t['addr:postcode'],
    ]
      .filter(Boolean)
      .join(' ')
      .trim()
    stores.push({
      id: `${el.type}/${el.id}`,
      name,
      lat: eLat,
      lng: eLng,
      address,
      hours: t.opening_hours ?? '',
      phone: t.phone ?? t['contact:phone'] ?? '',
      website: safeStoreWebsite(t.website ?? t['contact:website']),
      distanceKm: haversineKm(lat, lng, eLat, eLng),
    })
  }
  const seen = new Set<string>()
  return stores
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .filter((store) => {
      const key = `${store.name.trim().toLocaleLowerCase()}|${store.lat.toFixed(3)}|${store.lng.toFixed(3)}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** OSM `opening_hours` times rendered 12-hour, everything else left exactly as written.
 *
 *  The value from OpenStreetMap is a mini-language, not a time: `Mo-Fr 10:00-19:00; Sa 11:00-17:00`,
 *  `24/7`, `Su off`, `PH 12:00-16:00`, sometimes a quoted comment. Reverie was rendering it raw
 *  (indie.ts passed `t.opening_hours` straight through and IndieScreen printed it), so a reader saw
 *  `19:00` where every other clock in their day says 7 PM.
 *
 *  So this rewrites TIME TOKENS ONLY and leaves the grammar untouched — day ranges, separators,
 *  `off`, `24/7`, comments all survive byte-for-byte. That is deliberately narrower than "parse
 *  opening_hours": a full parser is a known-hard problem with a spec of its own, and every part of
 *  it we do not need is a part that can be wrong.
 *
 *  The three cases that make this quietly wrong if fumbled, all covered by tests:
 *    · `00:00` is 12:00 AM, not 0:00 AM — hour 0 maps to 12.
 *    · `12:00` is 12:00 PM, not 12:00 AM — noon is PM, and `h % 12` alone turns it into 0.
 *    · `24:00` is OSM's legal end-of-day and means midnight; `Mo 09:00-24:00` must not render
 *      `12:00 PM`. It is normalised to `12:00 AM` like `00:00`.
 *  Minutes are preserved as written, so `17:30` is `5:30 PM`. Anything that is not `H:MM`/`HH:MM`
 *  is returned untouched rather than guessed at. */
export function formatHours12(hours: string): string {
  if (!hours) return ''
  return hours.replace(/\b(\d{1,2}):(\d{2})\b/g, (whole, h: string, m: string) => {
    const hour = Number(h)
    const min = Number(m)
    // Not a wall-clock time we recognise (a date fragment, a malformed tag) — leave it alone.
    if (!Number.isInteger(hour) || hour > 24 || min > 59) return whole
    // 24:00 is OSM's end-of-day midnight; fold it onto 00:00 before the AM/PM decision.
    const h24 = hour === 24 ? 0 : hour
    const suffix = h24 < 12 ? 'AM' : 'PM'
    // 0 -> 12 (midnight) and 12 -> 12 (noon); every other hour is h % 12.
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12
    return `${h12}:${m} ${suffix}`
  })
}
