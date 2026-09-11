// Geo proxy (Phase 7 H2). Routes the policy-bound OpenStreetMap calls — Overpass (nearby indie
// bookstores) and Nominatim (geocode / reverse-geocode) — through the server with a contact
// User-Agent (their usage policies REQUIRE identifying traffic) and a shared cache keyed by rounded
// area / normalized query, so repeat searches make zero upstream calls. Browsers never hit these
// services directly at scale. Raw upstream JSON is returned; the client parses it (packages/core
// indie.ts) and degrades gracefully on failure. Deno Edge Function.

import { envInt, rateLimit, tooMany } from '../_shared/ratelimit.ts'
import {
  classifyHttp,
  MAX_RETRY_AFTER_MS,
  retryAfterMs,
  SourceBodyError,
  SourceHttpError,
} from '../_shared/httpClassify.ts'
import { captureEdgeError } from '../_shared/observe.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// A contact User-Agent is mandatory under the OSM/Nominatim usage policy. The fallback must be a
// domain WE control — it used to be reverie.app, which is not ours, so our contact-of-record with
// Nominatim pointed at a stranger (the same defect class as the contact-less OL header fixed in
// #134: an identification claim that identifies nothing we answer for). GEO_CONTACT still
// overrides for a richer value (an email).
const CONTACT = Deno.env.get('GEO_CONTACT') ?? 'https://reveriereads.app'
const UA = `Reverie/1.0 (indie bookstore finder; ${CONTACT})`
// The former single upstream currently returns 406 to the production Edge region. Public
// Overpass instances are explicitly best-effort, so use the current global alternative first and
// keep a second sequential fallback. An owner can replace the list without a client release.
const OVERPASS = (
  Deno.env.get('OVERPASS_ENDPOINTS') ??
  'https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const NOMINATIM = 'https://nominatim.openstreetmap.org'

const DAY = 86_400_000
const TTL: Record<string, number> = { stores: 7 * DAY, geocode: 30 * DAY, reverse: 30 * DAY }
const MAX_STALE: Record<string, number> = {
  stores: 90 * DAY,
  geocode: 180 * DAY,
  reverse: 180 * DAY,
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const dbHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

interface GeoInput {
  op: 'stores' | 'geocode' | 'reverse'
  lat?: number
  lng?: number
  q?: string
  radius?: number
}

/**
 * One backoff retry, for TRANSIENT failures only.
 *
 * This used to retry a 429 after a flat 600ms, ignoring `Retry-After` entirely. Nominatim — the
 * upstream here — publishes an absolute 1 request/second policy, so a 600ms retry is below its
 * limit by construction: it could not succeed, and it spent a second request of a budget we had
 * already been told we were over. It also disagreed with `enrich`'s `fetchJson`, which throws on a
 * 429 immediately; two retry loops in one codebase contradicting each other about the same status
 * meant one of them was wrong by definition.
 *
 * Now: 5xx retries with backoff, a 429 honours `Retry-After` when the header is present and is
 * otherwise not retried at all, and no other 4xx is ever retried — no amount of waiting fixes a
 * 400 or a 403.
 */
async function fetchUpstream(url: string, init?: RequestInit): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response
    try {
      r = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(10_000),
        headers: {
          'User-Agent': UA,
          Referer: 'https://reveriereads.app/indie',
          Accept: 'application/json',
          ...(init?.headers ?? {}),
        },
      })
    } catch (error) {
      // A network timeout is an endpoint failure. Move to the next configured Overpass host;
      // retrying the same silent host doubles the reader's wait without new evidence.
      throw error
    }
    const disposition = classifyHttp(r.status)

    if (disposition === 'retry' && attempt === 0) {
      await new Promise((res) => setTimeout(res, 600))
      continue
    }
    if (disposition === 'rate_limited') {
      const wait = retryAfterMs(r.headers.get('retry-after'), Date.now())
      // Only retry when the upstream itself named a wait we can afford. No header means we have no
      // basis for a guess, and guessing is what made the old flat sleep useless.
      if (attempt === 0 && wait !== null && wait <= MAX_RETRY_AFTER_MS) {
        await new Promise((res) => setTimeout(res, wait))
        continue
      }
      throw new SourceHttpError(r.status, url, wait)
    }
    // Status before body, always: a non-OK response's body is never parsed.
    if (!r.ok) throw new SourceHttpError(r.status, url)
    try {
      return await r.json()
    } catch {
      throw new SourceBodyError(r.status, url)
    }
  }
  return null
}

function cacheKeyFor(input: GeoInput): string {
  if (input.op === 'geocode') return `geocode:${(input.q ?? '').trim().toLowerCase()}`
  if (input.op === 'reverse')
    return `reverse:${(input.lat ?? 0).toFixed(3)},${(input.lng ?? 0).toFixed(3)}`
  return `stores:${(input.lat ?? 0).toFixed(2)},${(input.lng ?? 0).toFixed(2)}:${input.radius ?? 40000}`
}

interface CachedPayload {
  payload: unknown
  fresh: boolean
}

async function readCache(key: string, op: string): Promise<CachedPayload | null> {
  if (!DB_URL) return null
  try {
    const r = await fetch(
      `${DB_URL}/rest/v1/geo_cache?key=eq.${encodeURIComponent(key)}&select=payload,fetched_at`,
      { headers: dbHeaders },
    )
    const rows = (await r.json()) as { payload: unknown; fetched_at: string }[]
    const row = rows?.[0]
    if (!row) return null
    const age = Date.now() - Date.parse(row.fetched_at)
    if (!Number.isFinite(age) || age > (MAX_STALE[op] ?? 90 * DAY)) return null
    return { payload: row.payload, fresh: age <= (TTL[op] ?? 7 * DAY) }
  } catch {
    return null
  }
}

async function writeCache(key: string, payload: unknown): Promise<void> {
  if (!DB_URL) return
  try {
    await fetch(`${DB_URL}/rest/v1/geo_cache`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ key, payload, fetched_at: new Date().toISOString() }),
    })
  } catch {
    /* caching is best-effort */
  }
}

async function fetchLive(input: GeoInput): Promise<unknown> {
  if (input.op === 'stores') {
    const around = `(around:${input.radius ?? 40000},${input.lat},${input.lng})`
    const query = `[out:json][timeout:20];nwr["shop"="books"]${around};out center;`
    let lastError: unknown = new Error('no Overpass endpoint configured')
    for (const endpoint of OVERPASS) {
      try {
        return await fetchUpstream(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
        })
      } catch (error) {
        lastError = error
      }
    }
    throw lastError
  }
  if (input.op === 'geocode') {
    return await fetchUpstream(
      `${NOMINATIM}/search?format=jsonv2&limit=1&q=${encodeURIComponent((input.q ?? '').trim())}`,
    )
  }
  // reverse
  return await fetchUpstream(`${NOMINATIM}/reverse?format=jsonv2&lat=${input.lat}&lon=${input.lng}`)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // Per-user/IP rate limit (interactive geocode/nearby — abusive bursts burn the OSM quota).
  const rl = await rateLimit(req, 'geo', envInt('GEO_RATE_MAX', 60), 60)
  if (!rl.allowed) return tooMany(rl.retryAfter, cors)
  try {
    const input = (await req.json()) as GeoInput | null
    if (!input || !['stores', 'geocode', 'reverse'].includes(input.op)) {
      return json({ error: 'bad op' }, 400)
    }
    if (input.op === 'geocode') {
      const query = input.q?.trim() ?? ''
      if (!query || query.length > 160) return json({ error: 'invalid place query' }, 400)
      input.q = query
    } else {
      if (
        !Number.isFinite(input.lat) ||
        !Number.isFinite(input.lng) ||
        input.lat! < -90 ||
        input.lat! > 90 ||
        input.lng! < -180 ||
        input.lng! > 180
      ) {
        return json({ error: 'invalid coordinates' }, 400)
      }
      if (input.op === 'stores') {
        input.radius = input.radius ?? 40000
        if (!Number.isInteger(input.radius) || input.radius < 5000 || input.radius > 80000) {
          return json({ error: 'invalid radius' }, 400)
        }
      }
    }

    const key = cacheKeyFor(input)
    const cached = await readCache(key, input.op)
    if (cached?.fresh) return json({ payload: cached.payload, source: 'cache' })

    try {
      const payload = await fetchLive(input)
      if (payload != null) await writeCache(key, payload)
      return json({ payload: payload ?? null, source: 'live' })
    } catch (error) {
      if (cached) {
        captureEdgeError('geo', error)
        return json({ payload: cached.payload, source: 'stale' })
      }
      throw error
    }
  } catch (e) {
    // Surface a clean failure; the client falls back to its degraded state (B4).
    captureEdgeError('geo', e)
    return json({ error: 'location provider unavailable', payload: null }, 502)
  }
})
