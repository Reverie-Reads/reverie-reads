/* Midniht service worker — offline app shell, nothing clever.
 *
 * Strategy per request class:
 *   - navigations        → network-first, falling back to the cached shell ('/'). The shell is
 *     never served cache-first, so a deploy is picked up on the next online visit.
 *   - same-origin /assets/ → cache-first. Vite content-hashes these, so a cached copy is
 *     immutable by construction; new builds reference new URLs.
 *   - approved brand mark → cache-first, versioned with this shell cache, for offline navigation.
 *   - everything else    → untouched. Supabase/API traffic must NEVER be cached here — stale
 *     library data is worse than no offline support.
 *
 * Bump CACHE when the precache list or strategies change; activate sweeps old versions.
 */
const CACHE = 'midniht-shell-v4'
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/midniht/midniht-mark.svg',
]

// SPA fallbacks can return a 200 HTML document for a retired hashed asset. Never persist that
// document as executable code, and repair poisoned entries left by an older worker on read.
function validAsset(response, path) {
  if (!response || !response.ok) return false
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (/\.m?js$/.test(path)) return /^(application|text)\/(javascript|ecmascript)$/.test(type)
  if (/\.css$/.test(path)) return type === 'text/css'
  if (/\.svg$/.test(path)) return type === 'image/svg+xml'
  return type !== 'text/html'
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && /^(midniht|reverie)-shell-v\d+$/.test(k))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // keep the shell fresh for the next offline launch
          if (res.ok && res.headers.get('content-type')?.includes('text/html')) {
            const copy = res.clone()
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put('/', copy)))
          }
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') || url.pathname === '/midniht/midniht-mark.svg')
  ) {
    event.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(req)
        if (validAsset(hit, url.pathname)) return hit
        if (hit) await cache.delete(req)
        // Also bypass an HTTP-cache entry which may contain the same invalid SPA fallback.
        const res = await fetch(req, { cache: 'no-cache' })
        if (validAsset(res, url.pathname)) {
          event.waitUntil(cache.put(req, res.clone()))
        }
        return res
      }),
    )
  }
})
