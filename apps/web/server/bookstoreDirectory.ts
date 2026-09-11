const ALLOWED_RADII = new Set([16_000, 40_000, 80_000])
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const DEFAULT_ENDPOINT = 'https://overpass-api.de/api/interpreter'

export interface BookstoreDirectoryQuery {
  lat: number
  lng: number
  radius: number
}

export interface BookstoreDirectoryPayload {
  elements: unknown[]
}

export class BookstoreDirectoryInputError extends Error {}

function oneQueryValue(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BookstoreDirectoryInputError(`Invalid ${name}`)
  }
  return value
}

function canonicalCoordinate(
  value: unknown,
  name: 'lat' | 'lng',
  min: number,
  max: number,
): number {
  const raw = oneQueryValue(value, name)
  const parsed = Number(raw)
  // Two decimal places are part of the API contract. Besides avoiding needless precision for a
  // nearby search, this makes equivalent requests share one CDN key instead of letting arbitrary
  // coordinate spellings create unbounded cache variants.
  if (!Number.isFinite(parsed) || parsed < min || parsed > max || parsed.toFixed(2) !== raw) {
    throw new BookstoreDirectoryInputError(`Invalid ${name}`)
  }
  return parsed
}

/** Accept only the three reader-facing radii and canonical, area-level coordinates. */
export function parseBookstoreDirectoryQuery(
  query: Record<string, unknown>,
): BookstoreDirectoryQuery {
  const lat = canonicalCoordinate(query.lat, 'lat', -90, 90)
  const lng = canonicalCoordinate(query.lng, 'lng', -180, 180)
  const rawRadius = oneQueryValue(query.radius, 'radius')
  const radius = Number(rawRadius)
  if (!/^\d+$/.test(rawRadius) || !ALLOWED_RADII.has(radius)) {
    throw new BookstoreDirectoryInputError('Invalid radius')
  }
  return { lat, lng, radius }
}

/** A fixed Overpass query, never a caller-supplied query proxy. */
export function buildBookstoreOverpassQuery(input: BookstoreDirectoryQuery): string {
  return `[out:json][timeout:20][maxsize:${MAX_RESPONSE_BYTES}];nwr["shop"="books"](around:${input.radius},${input.lat.toFixed(2)},${input.lng.toFixed(2)});out center 1000;`
}

function endpointsFromEnvironment(): string[] {
  const configured = process.env.BOOKSTORE_OVERPASS_ENDPOINTS ?? DEFAULT_ENDPOINT
  return configured
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => {
      try {
        return new URL(entry).protocol === 'https:'
      } catch {
        return false
      }
    })
}

function responseIsPayload(value: unknown): value is BookstoreDirectoryPayload {
  return Boolean(
    value && typeof value === 'object' && Array.isArray((value as { elements?: unknown }).elements),
  )
}

export async function fetchBookstoreDirectory(
  input: BookstoreDirectoryQuery,
  options: {
    fetchImpl?: typeof fetch
    endpoints?: string[]
    timeoutMs?: number
  } = {},
): Promise<BookstoreDirectoryPayload> {
  const fetchImpl = options.fetchImpl ?? fetch
  const endpoints = options.endpoints ?? endpointsFromEnvironment()
  if (endpoints.length === 0) throw new Error('No bookstore directory endpoint configured')

  const body = new URLSearchParams({ data: buildBookstoreOverpassQuery(input) }).toString()
  let lastError: unknown = new Error('Bookstore directory unavailable')
  for (const endpoint of endpoints) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        signal: AbortSignal.timeout(options.timeoutMs ?? 9_000),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: 'https://reveriereads.app/indie',
          'User-Agent': 'Reverie/1.0 (indie bookstore finder; https://reveriereads.app)',
        },
        body,
      })
      if (!response.ok) throw new Error(`Bookstore directory returned ${response.status}`)
      const declaredSize = Number(response.headers.get('content-length') ?? 0)
      if (declaredSize > MAX_RESPONSE_BYTES)
        throw new Error('Bookstore directory response too large')
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
        throw new Error('Bookstore directory response too large')
      }
      const payload: unknown = JSON.parse(text)
      if (!responseIsPayload(payload)) throw new Error('Bookstore directory response was malformed')
      return payload
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
