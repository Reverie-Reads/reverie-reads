import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useSkin } from '../skin/useSkin'
import { useProfile, useUpdateProfile } from '../data/profile'
import {
  geocodePlace,
  loadLocation,
  requestGeolocation,
  reverseGeocode,
  saveLocation,
  type ResolvedLocation,
} from '../lib/location'
import { findBookstores, type Store } from '../lib/overpass'
import { formatHours12 } from '@reverie/core'
import { Surface } from '../components/Surface'

const miles = (km: number) => `${(km * 0.621371).toFixed(1)} mi`
const SEARCH_RADII = [
  { meters: 16000, label: '10 miles' },
  { meters: 40000, label: '25 miles' },
  { meters: 80000, label: '50 miles' },
] as const

// Map tiles are served from CARTO's CDN (dark or light to match the current room mode) — the
// policy-respecting path for tiles (a CDN, not our origin). The throttled API calls (Overpass +
// Nominatim) are proxied + cached through the `geo` Edge Function; tiles stay on the CDN. Owner
// action at production volume: a tile plan / self-hosted tiles (free CARTO basemaps are light-use).
const TILES = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
}
const TILE_ATTR = '&copy; OpenStreetMap contributors &copy; CARTO'

// Escape untrusted store text (OSM/Overpass names + addresses) before it goes into a popup's HTML.
const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )

// Thin Leaflet-API map (no react-leaflet — its wrapper is Hippocratic-2.1; core leaflet is BSD-2).
// One map instance for the component's life; small effects keep tiles (mode), view (loc), and markers
// (loc + stores) in sync, mirroring what react-leaflet's keyed <MapContainer>/<TileLayer>/<CircleMarker>
// did. Cleanup calls map.remove() on unmount.
function StoreMap({ loc, stores }: { loc: ResolvedLocation; stores: Store[] }) {
  const mode = useSkin((s) => s.resolvedMode)
  const elRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const markersRef = useRef<L.LayerGroup | null>(null)

  // Create the map once (per mount); the effects below keep it in sync. leaflet needs a sized
  // container — the wrapper's h-80 provides it. map.remove() tears down panes + listeners on unmount.
  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const map = L.map(elRef.current, {
      center: [loc.lat, loc.lng],
      zoom: 12,
      scrollWheelZoom: false,
    })
    mapRef.current = map
    markersRef.current = L.layerGroup().addTo(map)
    return () => {
      map.remove()
      mapRef.current = null
      tileRef.current = null
      markersRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once; view/tiles/markers effects sync updates
  }, [])

  // Tiles — swap the CARTO layer when the skin mode flips (was: <TileLayer key={mode}>).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    tileRef.current?.remove()
    tileRef.current = L.tileLayer(TILES[mode], { attribution: TILE_ATTR }).addTo(map)
  }, [mode])

  // View — recenter when the resolved location changes (was: <MapContainer key={loc}>).
  useEffect(() => {
    mapRef.current?.setView([loc.lat, loc.lng], 12)
  }, [loc.lat, loc.lng])

  // Markers — the "you are here" dot + one per store, rebuilt when loc or the store list changes.
  useEffect(() => {
    const group = markersRef.current
    if (!group) return
    group.clearLayers()
    L.circleMarker([loc.lat, loc.lng], {
      radius: 7,
      color: '#f0b14e',
      fillColor: '#f0b14e',
      fillOpacity: 0.9,
    })
      .bindPopup('You are here')
      .addTo(group)
    for (const s of stores) {
      L.circleMarker([s.lat, s.lng], {
        radius: 6,
        color: '#cf2f66',
        fillColor: '#cf2f66',
        fillOpacity: 0.85,
      })
        .bindPopup(`<b>${esc(s.name)}</b>${s.address ? `<div>${esc(s.address)}</div>` : ''}`)
        .addTo(group)
    }
  }, [loc.lat, loc.lng, stores])

  return (
    <div
      role="region"
      aria-label="Map of nearby independent bookstores"
      className="h-80 overflow-hidden rounded-2xl border border-line"
    >
      <div ref={elRef} style={{ height: '100%', width: '100%' }} />
    </div>
  )
}

/** Never dead-end: when there's no nearby data (no results, non-US gap, or an Overpass hiccup),
 *  point to the indies' online storefronts. Consistent with the no-live-inventory banner. */
function ShopOnlineFallback() {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <a
        href="https://bookshop.org/pages/bookstores"
        target="_blank"
        rel="noreferrer"
        className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        style={{ background: 'var(--field)' }}
      >
        Find a Bookshop.org bookstore ↗
      </a>
      <a
        href="https://libro.fm"
        target="_blank"
        rel="noreferrer"
        className="skin-control border border-line px-4 py-2 text-[13px] font-semibold text-ink"
        style={{ background: 'var(--field)' }}
      >
        Audiobooks · Libro.fm ↗
      </a>
    </div>
  )
}

function StoreList({
  stores,
  origin,
  defaultId,
  onSetDefault,
}: {
  stores: Store[]
  origin: ResolvedLocation
  defaultId: string | null
  onSetDefault: (s: Store | null) => void
}) {
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {stores.map((s) => {
        const isDefault = s.id === defaultId
        return (
          <Surface as="li" key={s.id} tone="card" radius="card" pad={2}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-semibold text-ink">
                {isDefault && <span title="Your store">✓ </span>}
                {s.name}
              </span>
              <span className="flex-none text-[12px] text-muted">{miles(s.distanceKm)}</span>
            </div>
            {s.address && <div className="mt-0.5 text-[13px] text-muted">{s.address}</div>}
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px]">
              {/* 12-hour at the render site, not in the Store shape: `hours` stays the verbatim
                  OSM tag so the parser and its tests keep speaking OSM, and only the reader-facing
                  string is localised. */}
              {s.hours && <span className="text-muted">🕑 {formatHours12(s.hours)}</span>}
              {s.phone && (
                <a href={`tel:${s.phone}`} className="text-primary">
                  {s.phone}
                </a>
              )}
              {s.website && (
                <a href={s.website} target="_blank" rel="noreferrer" className="text-primary">
                  Website ↗
                </a>
              )}
              <a
                href={`https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${origin.lat}%2C${origin.lng}%3B${s.lat}%2C${s.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-primary"
              >
                Directions ↗
              </a>
              <button
                type="button"
                onClick={() => onSetDefault(isDefault ? null : s)}
                className="skin-control ml-auto border border-line px-2.5 py-1 text-[12px] font-semibold text-ink"
                style={{ background: 'var(--field)' }}
              >
                {isDefault ? 'Remove as my store' : 'Set as my store'}
              </button>
            </div>
          </Surface>
        )
      })}
    </ul>
  )
}

export default function IndieScreen() {
  const [loc, setLoc] = useState<ResolvedLocation | null>(() => loadLocation())
  const [query, setQuery] = useState('')
  const [radius, setRadius] = useState(40000)
  const [showMap, setShowMap] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: profile } = useProfile()
  const updateProfile = useUpdateProfile()
  const defaultStore = profile?.defaultStore ?? null

  const setDefault = (s: Store | null) =>
    updateProfile.mutate({
      defaultStore: s ? { id: s.id, name: s.name, website: s.website } : null,
    })

  const stores = useQuery({
    queryKey: ['bookstores', loc?.lat, loc?.lng, radius],
    queryFn: async () => (loc ? findBookstores(loc.lat, loc.lng, radius) : []),
    enabled: !!loc,
    staleTime: 1000 * 60 * 30,
  })

  const apply = (resolved: ResolvedLocation) => {
    setLoc(resolved)
    setShowMap(false)
    saveLocation(resolved)
  }

  async function detectLocation() {
    setBusy(true)
    setError(null)
    const pos = await requestGeolocation()
    if (!pos) {
      setBusy(false)
      setError('Location access was declined or unavailable — enter a ZIP or city below.')
      return
    }
    apply({ ...pos, label: await reverseGeocode(pos.lat, pos.lng) })
    setBusy(false)
  }

  async function findByQuery() {
    if (!query.trim()) return
    setBusy(true)
    setError(null)
    const resolved = await geocodePlace(query)
    setBusy(false)
    if (!resolved) {
      setError('Couldn’t find that place — try a ZIP code or “City, State”.')
      return
    }
    apply(resolved)
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h1
        className="text-[22px] italic text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
      >
        Indie bookstores near you
      </h1>
      <Surface tone="card" radius="card" pad={2} className="mt-3 text-[13px] text-muted">
        📚 Discover &amp; support independent bookstores. This is discovery and support — not live
        inventory; we won’t promise “in stock near you.”
      </Surface>

      <div className="mt-4 grid gap-3">
        <button
          type="button"
          onClick={() => void detectLocation()}
          disabled={busy}
          className="skin-control h-11 px-5 text-[14px] font-semibold disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          📍 Use my location
        </button>
        <div className="flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[12.5px] text-muted">or search a place</span>
          <span className="h-px flex-1 bg-line" />
        </div>
        <form
          className="flex min-w-0 items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void findByQuery()
          }}
        >
          <label className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink">
            ZIP code, city, or neighborhood
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="For example, Redmond, Oregon"
              className="skin-field mt-1 h-11 w-full min-w-0 border border-line px-4 text-[14px] text-ink outline-none"
              style={{ background: 'var(--field)' }}
            />
          </label>
          <button
            type="submit"
            disabled={busy || !query.trim()}
            className="skin-control h-11 shrink-0 border border-line px-5 text-[14px] font-semibold text-ink disabled:opacity-50"
            style={{ background: 'var(--card)' }}
          >
            {busy ? 'Finding…' : 'Find'}
          </button>
        </form>
      </div>

      {error && (
        <p role="status" className="mt-3 text-[13px] text-primary">
          {error}
        </p>
      )}

      {!loc ? (
        <Surface tone="bare" radius="card" pad={5} className="mt-6 text-center">
          <p className="text-[14px] text-muted">
            Set a location to find nearby independent bookstores — or shop indies online:
          </p>
          <div className="flex justify-center">
            <ShopOnlineFallback />
          </div>
        </Surface>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-[13.5px] text-ink">
            Near <span className="font-semibold">{loc.label}</span>{' '}
            <button
              type="button"
              onClick={() => {
                setLoc(null)
                saveLocation(null)
              }}
              className="text-[12.5px] text-primary"
            >
              change
            </button>
          </p>

          <fieldset className="mb-4">
            <legend className="mb-2 text-[12.5px] font-semibold text-ink">Search distance</legend>
            <div className="flex flex-wrap gap-2">
              {SEARCH_RADII.map((option) => (
                <button
                  key={option.meters}
                  type="button"
                  aria-pressed={radius === option.meters}
                  onClick={() => {
                    setRadius(option.meters)
                    setShowMap(false)
                  }}
                  className="skin-control min-h-11 border border-line px-4 text-[12.5px] font-semibold text-ink"
                  style={{
                    background: radius === option.meters ? 'var(--chip)' : 'var(--field)',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          {stores.isLoading && (
            <p className="py-8 text-center text-[14px] text-muted">Finding nearby bookshops…</p>
          )}
          {stores.isError && (
            <Surface tone="bare" radius="card" pad={5} className="text-center">
              <p className="text-[14px] text-muted">
                The bookstore directory couldn’t answer just now. Your location is still here.
              </p>
              <button
                type="button"
                onClick={() => void stores.refetch()}
                className="skin-control skin-btn-primary mt-4 min-h-11 px-5 text-[13px] font-semibold"
              >
                Try the directory again
              </button>
              <div className="flex justify-center">
                <ShopOnlineFallback />
              </div>
            </Surface>
          )}
          {stores.data && stores.data.length > 0 && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[12.5px] text-muted" aria-live="polite">
                  {stores.data.length} independent {stores.data.length === 1 ? 'shop' : 'shops'}{' '}
                  nearby
                  {' · '}chains excluded
                  {defaultStore ? ` · your store: ${defaultStore.name}` : ''}
                </p>
                <button
                  type="button"
                  aria-expanded={showMap}
                  onClick={() => setShowMap((shown) => !shown)}
                  className="skin-control min-h-11 border border-line px-4 text-[12.5px] font-semibold text-ink"
                  style={{ background: 'var(--field)' }}
                >
                  {showMap ? 'Hide map' : 'Show map'}
                </button>
              </div>
              {showMap ? (
                <div className="mt-3">
                  <StoreMap loc={loc} stores={stores.data} />
                </div>
              ) : null}
              <StoreList
                stores={stores.data}
                origin={loc}
                defaultId={defaultStore?.id ?? null}
                onSetDefault={setDefault}
              />
              <p className="mt-4 text-[11.5px] text-muted">
                Listings and location data ©{' '}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-line underline-offset-2"
                >
                  OpenStreetMap contributors
                </a>
                .
              </p>
            </>
          )}
          {stores.data && stores.data.length === 0 && (
            <Surface tone="bare" radius="card" pad={5} className="mt-4 text-center">
              <p className="text-[14px] text-muted">
                No independent bookstores were listed within {miles(radius / 1000)}. Map coverage is
                uneven, and some shops are missing.
              </p>
              {radius < 80000 ? (
                <button
                  type="button"
                  onClick={() => setRadius(radius === 16000 ? 40000 : 80000)}
                  className="skin-control skin-btn-primary mt-4 min-h-11 px-5 text-[13px] font-semibold"
                >
                  Search farther
                </button>
              ) : null}
              <div className="flex justify-center">
                <ShopOnlineFallback />
              </div>
            </Surface>
          )}
        </div>
      )}
    </section>
  )
}
