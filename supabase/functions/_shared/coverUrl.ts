// Cover-URL resolution upgrade — the Deno mirror of packages/core/src/covers.ts upgradeCoverUrl.
// External sources default to tiny images (Google `zoom=1` ≈ 128px, Open Library `-M`); this rewrites
// each source's size knob so a stored/hotlinked cover is large enough for high-DPR detail + flip
// surfaces. Kept dependency-free so every edge function can import it. Keep in sync with core.

const isStored = (url: string): boolean => url.includes('/storage/v1/object/public/covers/')

const GOOGLE_CONTENT_HOSTS = new Set(['books.google.com', 'books.googleusercontent.com'])
export function isGoogleContentCover(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      GOOGLE_CONTENT_HOSTS.has(parsed.hostname.toLowerCase()) &&
      (parsed.pathname === '/books/content' || parsed.pathname.startsWith('/books/content/'))
    )
  } catch {
    return false
  }
}

/**
 * Google Books answers a missing cover with a generic "image not available" plate at HTTP 200 — a
 * fixed-size asset (575×750 for zoom 0/2/3, 128×170 for zoom 1), byte-stable across book ids. Ingest
 * must NOT store it as a durable cover (a stored plate has no fallback). Detected by intrinsic size —
 * the same signature the client uses. Keep in sync with packages/core/src/covers.ts.
 */
const GOOGLE_NO_COVER_DIMS: ReadonlyArray<readonly [number, number]> = [
  [575, 750],
  [128, 170],
]
export function isGoogleNoCoverArt(url: string, width: number, height: number): boolean {
  return (
    isGoogleContentCover(url) && GOOGLE_NO_COVER_DIMS.some(([w, h]) => width === w && height === h)
  )
}

/** `size:'full'` = largest available (detail/flip); `'thumb'` = ~300px (light grid). Idempotent. */
export function upgradeCoverUrl(url: string, size: 'full' | 'thumb' = 'full'): string {
  if (!url || isStored(url)) return url

  if (isGoogleContentCover(url)) {
    let u = url
      .replace(/([?&])edge=curl(&|$)/i, (_m, p1: string, p2: string) => (p2 === '&' ? p1 : ''))
      .replace(/[?&]$/, '')
    const zoom = size === 'thumb' ? '2' : '0'
    u = /[?&]zoom=\d+/i.test(u)
      ? u.replace(/([?&]zoom=)\d+/i, `$1${zoom}`)
      : `${u}${u.includes('?') ? '&' : '?'}zoom=${zoom}`
    return u
  }

  const ol = /^(https?:\/\/covers\.openlibrary\.org\/b\/id\/\d+)-[SML](\.\w+)((?:[?#].*)?)$/i.exec(
    url,
  )
  if (ol) return `${ol[1]}-${size === 'thumb' ? 'M' : 'L'}${ol[2]}${ol[3]}`

  return url
}
