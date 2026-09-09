/* Reverie service worker — offline app shell, nothing clever.
 *
 * Strategy per request class:
 *   - navigations        → network-first, falling back to the cached shell ('/'). The shell is
 *     never served cache-first, so a deploy is picked up on the next online visit.
 *   - same-origin /assets/ → cache-first. Vite content-hashes these, so a cached copy is
 *     immutable by construction; new builds reference new URLs.
 *   - everything else    → untouched. Supabase/API traffic must NEVER be cached here — stale
 *     library data is worse than no offline support.
 *
 * Bump CACHE when the precache list or strategies change; activate sweeps old versions.
 */
const CACHE = 'reverie-shell-v2'
const SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
]

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
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
          const copy = res.clone()
          void caches.open(CACHE).then((cache) => cache.put('/', copy))
          return res
        })
        .catch(() => caches.match('/')),
    )
    return
  }

  if (url.origin === self.location.origin && url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              void caches.open(CACHE).then((cache) => cache.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})
