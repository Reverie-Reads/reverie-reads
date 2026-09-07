// Cover system Edge Function (docs/archive/task-cover-system.md) — two actions, one durable pipeline:
//
//  · action:'editions' — alternates for the cover sheet's editions chooser. Hardcover editions
//    (backend token, GLOBAL 60 req/min budget via rate_limit_consume) + Google Books by ISBN falling
//    back to title+author (the referrer-restricted key). Cached per book in enrichment_cache under
//    an `editions:` key (7 days) so reopening the sheet costs zero external calls.
//
//  · action:'ingest' — every durable chosen cover flows through here (reviewed edition provider,
//    camera, upload): receive the bytes (multipart) or fetch an exact trusted origin (server-side,
//    no client CORS), validate magic bytes + a sane size cap, normalize to webp (max 1600px long edge)
//    plus a 720px card derivative, extract the dominant colour (spine tint), and store both in the public
//    'covers' bucket. Personal cover paths are u/{uid}/{bookId}/{rev}.webp; authenticated corpus
//    administrators and household owners for the exact work may instead use w/{workId}/{rev}.webp
//    so shared metadata never depends on a reader-owned object. The DB row is patched by the CLIENT
//    through its scoped RPC/mutation —
//    this function never writes books or works rows, so write authorization stays at the DB edge.
//
// Image work uses magick-wasm (the Supabase-documented wasm path): proper filtered resize, webp
// encode, and decode for jpeg/png/webp/gif/tiff inputs. No hotlinking survives ingest.

import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
  QuantizeSettings,
} from 'npm:@imagemagick/magick-wasm@0.0.35'
import { envInt, rateLimit, tooMany } from '../_shared/ratelimit.ts'
import { captureEdgeError, logEvent } from '../_shared/observe.ts'
import { Trace, wantsTrace } from '../_shared/trace.ts'
import {
  bestGoogleCoverLink,
  isGoogleContentCover,
  isGoogleNoCoverArt,
  upgradeCoverUrl,
} from '../_shared/coverUrl.ts'
import { olHeaders } from '../_shared/olIdentity.ts'
import {
  fetchPublicRemote,
  isTrustedCoverSourceUrl,
  UnsafeRemoteUrlError,
} from '../_shared/publicRemoteUrl.ts'
import {
  editionsCacheKey,
  hardcoverCoverBookId,
  matchesGoogleCover,
  uniqueCoverBookId,
} from './editionIdentity.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const dbHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  'Content-Type': 'application/json',
}

const GOOGLE_KEY = Deno.env.get('GOOGLE_BOOKS_KEY') ?? ''
const googleKey = () => (GOOGLE_KEY ? `&key=${encodeURIComponent(GOOGLE_KEY)}` : '')
// The key is referrer-restricted — send the app's Referer with keyed calls (the releases pattern).
const GOOGLE_REFERER = Deno.env.get('BOOKS_KEY_REFERER') ?? 'https://reveriereads.app/'
const googleHeaders = (): HeadersInit => (GOOGLE_KEY ? { Referer: GOOGLE_REFERER } : {})

const MAX_INPUT_BYTES = envInt('COVER_MAX_INPUT_BYTES', 8 * 1024 * 1024) // camera photos; crop already shrank most
const FULL_EDGE = 1600 // long-edge cap for the stored cover — headroom for high-DPR (2–3×) detail/flip
// A 390px phone renders two 144px-minimum cover columns at roughly 160–175 CSS px per cover. The
// old 300px asset fell below even DPR 2 there and was visibly soft. 720px covers the practical
// DPR 2–3 card range while keeping the 1600px full asset out of grids.
const THUMB_EDGE = 720 // long-edge cap for the responsive grid/spine card derivative
const EDITIONS_TTL_DAYS = 7

const cleanIsbn = (s: string) => (s || '').replace(/[^0-9Xx]/g, '').toUpperCase()

// ── magick-wasm init (once per isolate; the wasm ships inside the npm package) ──
let magickReady: Promise<void> | null = null
function ensureMagick(): Promise<void> {
  if (!magickReady) {
    magickReady = (async () => {
      const wasmUrl = new URL(
        'magick.wasm',
        import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.35'),
      )
      await initializeImageMagick(await Deno.readFile(wasmUrl))
    })()
  }
  return magickReady
}

// ── shared helpers ──

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })

/** The caller's user id from the (gateway-verified) JWT — used only to build the storage path. */
function jwtSub(req: Request): string | null {
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const part = token.split('.')[1]
    if (!part) return null
    let b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    while (b64.length % 4) b64 += '='
    const sub = (JSON.parse(atob(b64)) as { sub?: unknown }).sub
    return typeof sub === 'string' && sub ? sub : null
  } catch {
    return null
  }
}

/** Consume one unit of a GLOBAL upstream budget (e.g. Hardcover's 60 req/min) — not per-caller. */
async function globalBudget(name: string, max: number, windowSecs: number): Promise<boolean> {
  if (!DB_URL || !SERVICE) return true
  try {
    const r = await fetch(`${DB_URL}/rest/v1/rpc/rate_limit_consume`, {
      method: 'POST',
      headers: dbHeaders,
      body: JSON.stringify({ p_key: `${name}:global`, p_max: max, p_window_secs: windowSecs }),
    })
    if (!r.ok) return true // fail open, like the shared limiter
    return !!((await r.json()) as { allowed?: boolean }).allowed
  } catch {
    return true
  }
}

// ── image sniffing (magic bytes — never trust the extension or the reported content-type) ──

type Sniffed = { mime: string; ext: string }
function sniffImage(b: Uint8Array): Sniffed | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return { mime: 'image/jpeg', ext: 'jpg' }
  if (b.length > 7 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return { mime: 'image/png', ext: 'png' }
  if (b.length > 11 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50)
    return { mime: 'image/webp', ext: 'webp' }
  if (b.length > 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
    return { mime: 'image/gif', ext: 'gif' }
  if (
    b.length > 3 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00))
  )
    return { mime: 'image/tiff', ext: 'tif' }
  return null
}

// ── normalization: bytes → { full webp, thumb webp, dominant colour, dimensions } ──

interface Normalized {
  full: Uint8Array
  thumb: Uint8Array
  color: string | null
  width: number
  height: number
}

/** Resize (long edge cap), re-encode as webp, and read a dominant colour from a quantized copy. */
async function normalizeImage(bytes: Uint8Array, tr?: Trace): Promise<Normalized> {
  // magick-wasm init is ONCE PER ISOLATE. Timed separately because a cold isolate pays seconds here
  // and a warm one pays ~0 — and if Supabase's per-request CPU limit is killing isolates, this span
  // is non-zero on most requests instead of the first.
  await (tr ? tr.time('normalize.magickInit', () => ensureMagick()) : ensureMagick())

  const encode = (edge: number, quality: number): Uint8Array =>
    ImageMagick.read(bytes, (img) => {
      img.autoOrient() // camera EXIF rotation
      if (Math.max(img.width, img.height) > edge) {
        const g = new MagickGeometry(edge, edge) // fits within edge×edge, aspect preserved
        img.resize(g)
      }
      img.quality = quality
      img.strip() // EXIF/GPS never reaches the public bucket
      return img.write(MagickFormat.WebP, (d) => d.slice())
    })

  // FOUR FULL DECODES OF THE SAME BYTES, timed one by one. Each ImageMagick.read re-decodes from
  // scratch: full encode, thumb encode, a read whose only purpose is width/height, and the colour
  // pass. Three of the four are avoidable — this instrumentation is what will say whether that is
  // worth acting on or is noise against the network legs.
  const full = tr
    ? tr.sync('normalize.decode.full', () => encode(FULL_EDGE, 82))
    : encode(FULL_EDGE, 82)
  const thumb = tr
    ? tr.sync('normalize.decode.thumb', () => encode(THUMB_EDGE, 78))
    : encode(THUMB_EDGE, 78)

  const readDims = () =>
    ImageMagick.read(bytes, (img) => ({ width: img.width, height: img.height }))
  const { width, height } = tr ? tr.sync('normalize.decode.dims', readDims) : readDims()

  // Dominant colour: quantize a small copy to a handful of colours and score the histogram by
  // count × saturation, skipping near-white/near-black — the jacket's hue, not its margins.
  let color: string | null = null
  try {
    const readColor = () =>
      ImageMagick.read(bytes, (img) => {
        img.resize(new MagickGeometry(64, 64))
        const q = new QuantizeSettings()
        q.colors = 8
        img.quantize(q)
        let best: { score: number; hex: string } | null = null
        for (const [key, rawCount] of img.histogram()) {
          const count = Number(rawCount) // magick-wasm counts arrive as BigInt
          // histogram keys are colour strings (#RRGGBB or #RRGGBBAA at 8-bit depth)
          const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(key.trim())
          if (!m) continue
          const [r, g, b] = [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
          const mx = Math.max(r, g, b) / 255
          const mn = Math.min(r, g, b) / 255
          const sat = mx === 0 ? 0 : (mx - mn) / mx
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          if (lum > 0.94 || lum < 0.05) continue // margins/shadows
          const score = count * (0.35 + sat)
          if (!best || score > best.score)
            best = { score, hex: `#${m[1]}${m[2]}${m[3]}`.toLowerCase() }
        }
        return best?.hex ?? null
      })
    color = tr ? tr.sync('normalize.decode.color', readColor) : readColor()
  } catch (e) {
    logEvent('warn', 'covers', 'color_extract_failed', { err: String(e) })
    color = null // tint is a nicety — never fail ingest over it
  }

  return { full, thumb, color, width, height }
}

// ── storage ──

async function putObject(path: string, bytes: Uint8Array, contentType: string): Promise<boolean> {
  const r = await fetch(`${DB_URL}/storage/v1/object/covers/${path}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': contentType,
      'x-upsert': 'true',
    },
    body: bytes as BodyInit,
  })
  return r.ok
}

const publicUrl = (path: string): string => {
  const base = Deno.env.get('COVER_PUBLIC_URL') ?? DB_URL
  return `${base}/storage/v1/object/public/covers/${path}`
}

// ── action: ingest ──

interface IngestFields {
  bookId?: string
  /** Owner/admin durable corpus target. Exactly one of bookId/workId is accepted. */
  workId?: string
  /** Internal durable-run capability. Valid only with the service-role JWT and a running item. */
  sweepRunId?: string
  scope?: 'personal' | 'corpus'
  source: string
  sourceUrl?: string
  url?: string
}

async function canEditCorpusWork(req: Request, workId: string): Promise<boolean> {
  if (!DB_URL || !SERVICE) return false
  const authorization = req.headers.get('Authorization') ?? ''
  if (!authorization) return false
  try {
    const r = await fetch(`${DB_URL}/rest/v1/rpc/can_edit_corpus_work`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: authorization,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_work: workId }),
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch {
    return false
  }
}

async function corpusSweepActor(
  req: Request,
  runId: string,
  workId: string,
): Promise<string | null> {
  if (!DB_URL || !SERVICE) return null
  try {
    const r = await fetch(`${DB_URL}/rest/v1/rpc/service_authorize_corpus_sweep_work`, {
      method: 'POST',
      headers: {
        apikey: SERVICE,
        Authorization: req.headers.get('Authorization') ?? '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_run: runId, p_work: workId }),
    })
    if (!r.ok) return null
    const actor = await r.json()
    return typeof actor === 'string' && /^[0-9a-f-]{36}$/i.test(actor) ? actor : null
  } catch {
    return null
  }
}

/** Smallest edge a real cover can have. A 1x1 tracking/placeholder pixel is the artifact this
 *  excludes; the smallest genuine thumbnail any source serves is an order of magnitude above it. */
const MIN_COVER_EDGE_PX = 50

const SOURCES = new Set(['hardcover', 'google', 'openlibrary', 'upload', 'camera', 'url'])

// Sources whose bytes may be STORED (docs/reference/reverie-metadata-sourcing.md §Covers). Google Books is
// display-time only: its terms prohibit permanent copies and caching beyond the cache header, so a
// Google image may be hotlinked at display size but never ingested. This is the authoritative gate —
// the client refuses too, but the client is not the security boundary.
const INGESTIBLE_SOURCES = new Set(['hardcover', 'openlibrary', 'upload', 'camera', 'url'])

async function handleIngest(req: Request, callerId: string, tr: Trace): Promise<Response> {
  let uid = callerId
  let file: Uint8Array | null = null
  let fields: IngestFields
  // Multipart (camera/upload) never traces: it is a reader action, not the sweep.
  let tracing = false

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) {
      if (f.size > MAX_INPUT_BYTES)
        return json({ error: 'too_large', maxBytes: MAX_INPUT_BYTES }, 413)
      file = new Uint8Array(await f.arrayBuffer())
    }
    fields = {
      bookId: form.get('bookId') ? String(form.get('bookId')) : undefined,
      workId: form.get('workId') ? String(form.get('workId')) : undefined,
      scope: form.get('scope') === 'corpus' ? 'corpus' : 'personal',
      source: String(form.get('source') ?? ''),
      sourceUrl: form.get('sourceUrl') ? String(form.get('sourceUrl')) : undefined,
    }
  } else {
    const body = (await req.json()) as IngestFields & { action?: string }
    fields = body
    tracing = wantsTrace(body)
  }

  const corpusScope = fields.scope === 'corpus'
  const targetId = corpusScope ? fields.workId : fields.bookId
  if (!targetId || !/^[0-9a-f-]{16,64}$/i.test(targetId))
    return json({ error: corpusScope ? 'bad_work_id' : 'bad_book_id' }, 400)
  if ((corpusScope && fields.bookId) || (!corpusScope && fields.workId))
    return json({ error: 'ambiguous_target' }, 400)
  if (corpusScope) {
    if (fields.sweepRunId) {
      const actor = await corpusSweepActor(req, fields.sweepRunId, targetId)
      if (!actor) return json({ error: 'corpus_sweep_required' }, 403)
      uid = actor
    } else if (!(await canEditCorpusWork(req, targetId))) {
      return json({ error: 'corpus_editor_required' }, 403)
    }
  }
  if (!SOURCES.has(fields.source)) return json({ error: 'bad_source' }, 400)
  // Refuse to persist a display-only source, by label OR by host.
  if (!INGESTIBLE_SOURCES.has(fields.source)) {
    logEvent('info', 'covers', 'ingest_refused_display_only', { uid, source: fields.source })
    return json({ error: 'display_only_source' }, 422)
  }
  for (const candidate of [fields.url, fields.sourceUrl]) {
    if (candidate && isGoogleContentCover(candidate)) {
      logEvent('info', 'covers', 'ingest_refused_display_only', {
        uid,
        source: fields.source,
        host: 'google',
      })
      return json({ error: 'display_only_source' }, 422)
    }
  }

  // URL path: fetch server-side (direct image URLs only — a product page yields non-image bytes
  // and fails validation below; we deliberately do NOT scrape HTML for og:image).
  let sourceUrl = fields.sourceUrl
  let fetchedUrl: string | null = null // the server-fetched image URL (guards against a "no image" plate)
  if (!file) {
    const raw = (fields.url ?? '').trim()
    if (!/^https?:\/\//i.test(raw)) return json({ error: 'bad_url' }, 400)
    // Fetch the LARGEST the source offers (Google zoom=0, OL -L) so the stored asset isn't a 128px
    // thumbnail; record the upgraded URL as provenance so a re-sharpen never re-fetches the small one.
    const url = upgradeCoverUrl(raw, 'full')
    sourceUrl = sourceUrl ? upgradeCoverUrl(sourceUrl, 'full') : url
    let r: Response
    try {
      // olHeaders on EVERY source fetch, not just OL hosts: this URL is reader-supplied and can be
      // covers.openlibrary.org, and identifying our traffic to the other hosts costs nothing. One
      // anonymous OL request from this call site would re-classify the whole IP's tier.
      const fetched = await tr.time('covers.fetchSource', () =>
        fetchPublicRemote(
          url,
          { headers: olHeaders({ Accept: 'image/*' }) },
          {
            resolveDns: async (hostname, recordType) => {
              try {
                return await Deno.resolveDns(hostname, recordType)
              } catch (error) {
                // A legitimate hostname may publish only one address family. Absence of that DNS
                // record is an empty answer; resolver/transport failures still propagate closed.
                if (error instanceof Deno.errors.NotFound) return []
                throw error
              }
            },
            fetcher: (input, init) => fetch(input, init),
            isAllowedUrl: (candidate) =>
              isTrustedCoverSourceUrl(candidate, Deno.env.get('SUPABASE_URL')),
          },
        ),
      )
      r = fetched.response
      fetchedUrl = fetched.finalUrl
    } catch (error) {
      if (error instanceof UnsafeRemoteUrlError) {
        logEvent('warn', 'covers', 'ingest_refused_unsafe_url', {
          uid,
          source: fields.source,
          reason: error.reason,
        })
        return json({ error: 'unsafe_url', reason: error.reason }, 422)
      }
      return json({ error: 'fetch_failed' }, 422)
    }
    if (!r.ok) return json({ error: 'fetch_failed', status: r.status }, 422)
    // Redirects remain supported for ordinary provider/CDN URLs, but their terminal host is a new
    // validation boundary. A non-Google URL must not redirect Google Books bytes into permanent
    // personal or corpus Storage; reject before the response body is read.
    fetchedUrl ||= r.url || url
    if (isGoogleContentCover(fetchedUrl)) {
      logEvent('info', 'covers', 'ingest_refused_display_only', {
        uid,
        source: fields.source,
        host: 'google_redirect',
      })
      return json({ error: 'display_only_source' }, 422)
    }
    const len = Number(r.headers.get('content-length') ?? 0)
    if (len > MAX_INPUT_BYTES) return json({ error: 'too_large', maxBytes: MAX_INPUT_BYTES }, 413)
    const buf = new Uint8Array(await tr.time('covers.readBody', () => r.arrayBuffer()))
    if (buf.byteLength > MAX_INPUT_BYTES)
      return json({ error: 'too_large', maxBytes: MAX_INPUT_BYTES }, 413)
    file = buf
  }

  if (!file?.byteLength) return json({ error: 'empty' }, 400)
  const sniffed = sniffImage(file)
  if (!sniffed) return json({ error: 'not_an_image' }, 415)

  // A Workflow step can commit this upload and still lose its response. The run/work capability
  // is unique for this sweep item, so reuse it as the object revision; Storage upsert then turns a
  // retry into replacement of the same object instead of leaking a second timestamped object.
  const rev = fields.sweepRunId ? `sweep-${fields.sweepRunId}` : Date.now().toString(36)
  const base = corpusScope ? `w/${targetId}` : `u/${uid}/${targetId}`

  try {
    const n = await normalizeImage(file, tr)
    // A server-fetched Google URL that resolves to the source's fixed-size "image not available" plate
    // is NOT a cover — refuse to store it (a stored plate has no display fallback). Never applies to a
    // user upload/camera (multipart → file set, no fetchedUrl) or a real cover of any other size.
    // HOST-AGNOSTIC DIMENSION FLOOR. `isGoogleNoCoverArt` below only fires for Google hosts and only
    // at two exact sizes, so it cannot see any other source's "no cover" artifact. Open Library's is
    // a 43-byte 1x1 GIF89a served at HTTP 200 with no content-type — `sniffImage` accepts GIF, and
    // nothing here checked size, so it would normalize and store as a durable cover with no display
    // fallback. `?default=false` is the primary defence and turns that into a clean 404; this is the
    // backstop for when it is missing, and being host-agnostic it also covers whatever the next
    // source's placeholder turns out to be. No real cover is under 50px on either edge.
    if (n.width < MIN_COVER_EDGE_PX || n.height < MIN_COVER_EDGE_PX) {
      logEvent('info', 'covers', 'ingest_rejected_too_small', {
        uid,
        source: fields.source,
        w: n.width,
        h: n.height,
      })
      return json({ error: 'no_cover_available', reason: 'below_min_dimensions' }, 422)
    }
    if (fetchedUrl && isGoogleNoCoverArt(fetchedUrl, n.width, n.height)) {
      logEvent('info', 'covers', 'ingest_rejected_no_image', {
        uid,
        source: fields.source,
        w: n.width,
        h: n.height,
      })
      return json({ error: 'no_cover_available' }, 422)
    }
    const fullPath = `${base}/${rev}.webp`
    const thumbPath = `${base}/${rev}_t.webp`
    const okFull = await tr.time('covers.putFull', () => putObject(fullPath, n.full, 'image/webp'))
    const okThumb =
      okFull &&
      (await tr.time('covers.putThumb', () => putObject(thumbPath, n.thumb, 'image/webp')))
    if (!okFull) return json({ error: 'storage_failed' }, 502)
    logEvent('info', 'covers', 'ingest', {
      uid,
      source: fields.source,
      bytesIn: file.byteLength,
      bytesOut: n.full.byteLength,
      w: n.width,
      h: n.height,
    })
    return json({
      cover: publicUrl(fullPath),
      thumb: okThumb ? publicUrl(thumbPath) : publicUrl(fullPath),
      color: n.color,
      sourceUrl: sourceUrl ?? null,
      width: n.width,
      height: n.height,
      ...(tracing ? { _trace: { spans: tr.spans, totalMs: tr.totalMs() } } : {}),
    })
  } catch (e) {
    // Normalization failed (exotic/corrupt encoding) but the bytes ARE a sniffed image within the
    // cap — store the original as-is so the pick still lands durably; no thumb, no colour.
    captureEdgeError('covers', e, { stage: 'normalize', mime: sniffed.mime })
    const rawPath = `${base}/${rev}.${sniffed.ext}`
    const ok = await putObject(rawPath, file, sniffed.mime)
    if (!ok) return json({ error: 'storage_failed' }, 502)
    const url = publicUrl(rawPath)
    return json({
      cover: url,
      thumb: url,
      color: null,
      sourceUrl: sourceUrl ?? null,
      degraded: true,
    })
  }
}

// ── action: editions ──

interface EditionOption {
  source: 'hardcover' | 'google'
  cover: string
  isbn13?: string
  isbn10?: string
  format?: string
  year?: number
  publisher?: string
  pages?: number
  title?: string
}

interface EditionsInput {
  action: 'editions'
  isbn?: string
  title?: string
  author?: string
  refresh?: boolean
}

const hardcoverAuth = (): string | null => {
  const raw = (Deno.env.get('HARDCOVER_TOKEN') ?? '').trim()
  if (!raw) return null
  const t = raw.replace(/^Bearer\s+/i, '').trim()
  return t ? `Bearer ${t}` : null
}

async function hardcoverGql(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const auth = hardcoverAuth()
  if (!auth) return null
  // Global Hardcover budget: 60 req/min across ALL users (their documented cap).
  if (!(await globalBudget('hardcover', envInt('HARDCOVER_RATE_MAX', 60), 60))) return null
  const r = await fetch('https://api.hardcover.app/v1/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: JSON.stringify({ query, variables }),
  })
  if (!r.ok) return null
  return ((await r.json()) as { data?: unknown }).data ?? null
}

/** Reading a cover URL out of Hardcover's cached_image json (shape: { url, ... }) or image relation. */
function hcImageUrl(e: Record<string, unknown>): string {
  const cached = e.cached_image as { url?: unknown } | null | undefined
  if (cached && typeof cached.url === 'string') return cached.url
  const img = e.image as { url?: unknown } | null | undefined
  if (img && typeof img.url === 'string') return img.url
  return ''
}

const HC_EDITION_FIELDS = `
  id title isbn_13 isbn_10 pages release_year release_date edition_format physical_format
  cached_image image { url } publisher { name } reading_format { format } users_count`

/** Hardcover: exact ISBN or unambiguous title/author identity, then related editions. ≤3 calls. */
async function hardcoverEditions(input: EditionsInput): Promise<EditionOption[]> {
  if (!hardcoverAuth()) return []
  let bookId: number | null = null

  const isbn = cleanIsbn(input.isbn ?? '')
  if (isbn.length >= 10) {
    const d = (await hardcoverGql(
      `query($i:String!){ editions(where:{_or:[{isbn_13:{_eq:$i}},{isbn_10:{_eq:$i}}]}, distinct_on:book_id, order_by:{book_id:asc}, limit:2){ book_id } }`,
      { i: isbn },
    )) as { editions?: { book_id?: number }[] } | null
    const matches = d?.editions ?? []
    bookId = uniqueCoverBookId(matches.map((edition) => edition.book_id))
    if (matches.length && bookId == null) return [] // conflicting ISBN relationships need review
  }
  if (bookId == null && input.title && input.author) {
    const d = (await hardcoverGql(
      `query($q:String!){ search(query:$q, query_type:"Book", per_page:5){ results } }`,
      { q: [input.title, input.author].filter(Boolean).join(' ') },
    )) as { search?: { results?: { hits?: unknown } } } | null
    bookId = hardcoverCoverBookId(input, d?.search?.results?.hits)
  }
  if (bookId == null) return []

  const d = (await hardcoverGql(
    `query($b:Int!){ editions(where:{book_id:{_eq:$b}}, order_by:{users_count:desc_nulls_last}, limit:32){ ${HC_EDITION_FIELDS} } }`,
    { b: bookId },
  )) as { editions?: Record<string, unknown>[] } | null

  return (d?.editions ?? [])
    .map((e): EditionOption | null => {
      const cover = hcImageUrl(e)
      if (!cover) return null
      const rf = (e.reading_format as { format?: unknown } | null)?.format
      const format =
        (typeof e.edition_format === 'string' && e.edition_format) ||
        (typeof e.physical_format === 'string' && e.physical_format) ||
        (typeof rf === 'string' ? rf : undefined) ||
        undefined
      const year =
        typeof e.release_year === 'number'
          ? e.release_year
          : typeof e.release_date === 'string'
            ? Number(e.release_date.slice(0, 4)) || undefined
            : undefined
      return {
        source: 'hardcover',
        cover: cover.replace(/^http:/, 'https:'),
        isbn13: typeof e.isbn_13 === 'string' ? e.isbn_13 : undefined,
        isbn10: typeof e.isbn_10 === 'string' ? e.isbn_10 : undefined,
        format,
        year,
        publisher: (e.publisher as { name?: string } | null)?.name,
        pages: typeof e.pages === 'number' ? e.pages : undefined,
        title: typeof e.title === 'string' ? e.title : undefined,
      }
    })
    .filter((x): x is EditionOption => x !== null)
}

/** Google Books: by ISBN (the exact edition) UNIONED with title+author (the other editions —
 *  a by-ISBN query alone returns a single volume, which would leave the chooser one row deep
 *  whenever Hardcover is unavailable). ≤2 calls, cached per book with the rest. */
async function googleEditions(input: EditionsInput): Promise<EditionOption[]> {
  const isbn = cleanIsbn(input.isbn ?? '')
  const queries: string[] = []
  if (isbn.length >= 10) queries.push(`isbn:${isbn}`)
  if (input.title && input.author)
    queries.push(
      `intitle:${encodeURIComponent(`"${input.title}"`)}${input.author ? `+inauthor:${encodeURIComponent(`"${input.author}"`)}` : ''}`,
    )
  const items: { volumeInfo?: Record<string, unknown> }[] = []
  for (const q of queries) {
    const r = await fetch(
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=20&printType=books${googleKey()}`,
      {
        headers: googleHeaders(),
      },
    )
    if (!r.ok) continue
    const j = (await r.json()) as { items?: { volumeInfo?: Record<string, unknown> }[] }
    items.push(...(j.items ?? []))
  }
  const out: EditionOption[] = []
  for (const it of items) {
    const v = it.volumeInfo ?? {}
    if (!matchesGoogleCover(input, v)) continue
    const cover = bestGoogleCoverLink(v.imageLinks)
    if (!cover) continue
    const ids =
      (v.industryIdentifiers as { type?: string; identifier?: string }[] | undefined) ?? []
    const isbn13 = ids.find((i) => i.type === 'ISBN_13')?.identifier
    const isbn10 = ids.find((i) => i.type === 'ISBN_10')?.identifier
    const year =
      typeof v.publishedDate === 'string'
        ? Number(v.publishedDate.slice(0, 4)) || undefined
        : undefined
    out.push({
      source: 'google',
      cover,
      isbn13,
      isbn10,
      year,
      publisher: typeof v.publisher === 'string' ? v.publisher : undefined,
      pages: typeof v.pageCount === 'number' ? v.pageCount : undefined,
      title: typeof v.title === 'string' ? v.title : undefined,
    })
  }
  return out
}

async function readEditionsCache(key: string): Promise<EditionOption[] | null> {
  if (!DB_URL) return null
  try {
    const r = await fetch(
      `${DB_URL}/rest/v1/enrichment_cache?key=eq.${encodeURIComponent(key)}&select=record,fetched_at`,
      { headers: dbHeaders },
    )
    const rows = (await r.json()) as {
      record?: { editions?: EditionOption[] }
      fetched_at?: string
    }[]
    const row = rows?.[0]
    if (!row?.record?.editions || !row.fetched_at) return null
    if (Date.now() - Date.parse(row.fetched_at) > EDITIONS_TTL_DAYS * 86_400_000) return null
    return row.record.editions
  } catch {
    return null
  }
}

async function writeEditionsCache(key: string, editions: EditionOption[]): Promise<void> {
  if (!DB_URL) return
  try {
    await fetch(`${DB_URL}/rest/v1/enrichment_cache`, {
      method: 'POST',
      headers: { ...dbHeaders, Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        key,
        record: { editions },
        complete: true,
        fetched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
    })
  } catch {
    /* best-effort */
  }
}

async function handleEditions(input: EditionsInput): Promise<Response> {
  const key = editionsCacheKey(input)
  if (!input.refresh) {
    const cached = await readEditionsCache(key)
    if (cached) return json({ editions: cached, source: 'cache' })
  }

  const [hc, gb] = await Promise.all([
    hardcoverEditions(input).catch(() => [] as EditionOption[]),
    googleEditions(input).catch(() => [] as EditionOption[]),
  ])

  // Dedupe: Hardcover leads (richer edition context); Google fills in what Hardcover didn't carry.
  const seen = new Set<string>()
  const editions: EditionOption[] = []
  for (const e of [...hc, ...gb]) {
    const k = e.isbn13 || e.isbn10 || e.cover
    if (!k || seen.has(k)) continue
    seen.add(k)
    editions.push(e)
  }

  if (editions.length) await writeEditionsCache(key, editions)
  return json({ editions })
}

// ── entry ──

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const tr = new Trace()
  // Timed like enrich's: a DB round trip paid before any image work, on every ingest.
  const rl = await tr.time('covers.ratelimit', () =>
    rateLimit(req, 'covers', envInt('COVERS_RATE_MAX', 60), 60),
  )
  if (!rl.allowed) return tooMany(rl.retryAfter, cors)

  try {
    const contentType = req.headers.get('content-type') ?? ''
    const preview = contentType.includes('multipart/form-data')
      ? null
      : ((await req.clone().json()) as Partial<IngestFields> & { action?: string })
    const internalSweepIngest =
      preview?.action === 'ingest' &&
      preview.scope === 'corpus' &&
      typeof preview.sweepRunId === 'string' &&
      typeof preview.workId === 'string'
    const uid = jwtSub(req)
    // Supabase service-role JWTs do not necessarily carry a subject. The exact durable-run target
    // is still authorized inside handleIngest by a service-only RPC before any storage write.
    if (!uid && !internalSweepIngest) return json({ error: 'unauthorized' }, 401)
    const callerId = uid ?? 'corpus-sweep-service'

    if (contentType.includes('multipart/form-data')) return await handleIngest(req, callerId, tr)

    if (preview?.action === 'editions')
      return await handleEditions((await req.json()) as EditionsInput)
    if (preview?.action === 'ingest') return await handleIngest(req, callerId, tr)
    return json({ error: 'bad_action' }, 400)
  } catch (e) {
    captureEdgeError('covers', e)
    return json({ error: String(e) }, 400)
  }
})
