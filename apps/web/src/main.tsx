// First import on purpose: captures the auth-callback hash (email confirm / recovery) before
// supabase-js strips it from the URL.
import './lib/authCallback'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from '@tanstack/react-router'
import { defaultShouldDehydrateQuery, MutationCache, QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { AuthProvider } from './auth/AuthProvider'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initErrorMonitoring } from './lib/sentry'
import { BUILD_ID, installPreloadErrorReload } from './lib/updates'
import {
  createDexiePersister,
  evictLegacyOfflineCache,
  isOfflinePersistableQueryKey,
} from './lib/offlineCache'
import { reportWriteError } from './lib/writeErrors'
import { router } from './router'
import './styles/tokens.css'
import './styles/globals.css'
import './styles/skin-kit.css'

initErrorMonitoring()
installPreloadErrorReload()

// One-time sweep of the pre-scoping cache row. Before the persister was scoped per reader, every
// library was written to a single unscoped key; a reader who never signs out again would keep a full
// copy of theirs in IndexedDB forever, orphaned and unreadable. Fire-and-forget — nothing waits on
// it, and it is a no-op once swept.
void evictLegacyOfflineCache()

// Offline app shell + installability (public/sw.js). Prod only — a SW in dev serves stale
// modules and fights Vite's HMR. Registration failing is fine; the app works without it.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // The build id in the script URL makes the browser re-check the worker on every deploy, so a new
    // build reliably triggers the SW `updatefound` signal the update watch listens for.
    void navigator.serviceWorker.register(`/sw.js?v=${BUILD_ID}`).catch(() => {})
  })
}

const WEEK = 1000 * 60 * 60 * 24 * 7

// gcTime must outlast maxAge so cached queries survive to be persisted/restored offline.
const queryClient = new QueryClient({
  // Every failed write reports here. Wiring it at the cache rather than in each hook means the
  // WHOLE data layer is covered by construction — a new mutation can't forget to handle failure,
  // which is how a rejected save came to look exactly like a successful one. Individual hooks keep
  // their own onError for the optimistic rollback; this only adds the telling.
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => reportWriteError(error, mutation.options.meta),
  }),
  defaultOptions: {
    queries: { gcTime: WEEK, staleTime: 1000 * 30, retry: 1, refetchOnWindowFocus: false },
  },
})

const persister = createDexiePersister()

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <PersistQueryClientProvider
        client={queryClient}
        // buster = the build id: every deploy discards the persisted query cache on load, so a
        // client that updates after a DB migration can never restore a stale query SHAPE (the
        // motivating failure). Ties cache lifetime to the deploy, automatically — no manual bump.
        persistOptions={{
          persister,
          maxAge: WEEK,
          buster: BUILD_ID,
          dehydrateOptions: {
            // The series shelf is NOT mirrored offline. Its query reconciles the library into
            // series_entries — it WRITES on every run — so a restored copy is a snapshot of a
            // derived view that can't refresh itself offline anyway. Persisting it also meant a
            // freshly edited position repainted the OLD badges on load, because staleTime kept the
            // restored copy "fresh" long enough to render. Let the page open on its loading line
            // and show what the reader just typed.
            // Defers to TanStack's own default for everything else, so this stays correct if the
            // library's notion of "worth persisting" changes. (#78 had to inline the predicate —
            // react-query and react-query-persist-client resolved two different query-core builds,
            // so the helper's Query type didn't match this parameter's. #80 collapsed them to one.)
            // Household is deliberately different from the personal offline library: each response
            // includes another account's curated rows, so it remains network-only and never rests
            // in IndexedDB. The in-memory keys still include the signed-in reader id, and sign-out
            // clears the QueryClient as it already does for every personal query.
            shouldDehydrateQuery: (q) =>
              defaultShouldDehydrateQuery(q) && isOfflinePersistableQueryKey(q.queryKey),
          },
        }}
        onSuccess={() => {
          // Flush any writes that were queued while offline.
          void queryClient.resumePausedMutations()
        }}
      >
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </PersistQueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)
