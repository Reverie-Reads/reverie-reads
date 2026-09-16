// The ONLY module that imports the Sentry SDK (Phase 7 H4). Everything else calls captureError /
// captureMessage from @reverie/core; this adapter registers Sentry as the backend when a DSN is
// configured, so swapping providers is a one-file change. Sentry is dynamically imported so it is a
// separate chunk loaded only when monitoring is on (keeps the main bundle lean).

import { captureError, setErrorReporter } from '@reverie/core'

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined
const RELEASE = import.meta.env.VITE_RELEASE as string | undefined

const BOT = /bot|crawl|spider|headless|lighthouse|preview|slurp|monitor/i

/** Route uncaught browser errors through the core wrapper (used only when Sentry isn't active). */
function installManualHandlers(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (e) =>
    captureError(e.error ?? e.message, { kind: 'window.onerror' }),
  )
  window.addEventListener('unhandledrejection', (e) =>
    captureError(e.reason, { kind: 'unhandledrejection' }),
  )
}

/**
 * Initialize error monitoring. With VITE_SENTRY_DSN set, captures route to Sentry — quota-safe:
 * NO performance traces (tracesSampleRate 0) and inbound filtering of extension/bot/localhost noise
 * to protect the free 5K/mo tier. Without a DSN, the core console reporter + manual handlers apply.
 */
export function initErrorMonitoring(): void {
  if (!DSN) {
    installManualHandlers()
    return
  }
  void import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        release: RELEASE,
        environment: import.meta.env.VITE_SENTRY_ENVIRONMENT,
        tracesSampleRate: 0, // no performance traces — protect the free quota
        sampleRate: 1,
        ignoreErrors: [
          'ResizeObserver loop limit exceeded',
          'ResizeObserver loop completed with undelivered notifications',
          'Non-Error promise rejection captured',
        ],
        denyUrls: [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /extensions\//i],
        beforeSend(event) {
          // Drop bot traffic and local development noise before it spends quota.
          const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
          if (BOT.test(ua)) return null
          const host = typeof location !== 'undefined' ? location.hostname : ''
          if (host === 'localhost' || host === '127.0.0.1') return null
          return event
        },
      })
      // Sentry's own integrations capture uncaught/unhandled globals; explicit captures route here.
      setErrorReporter({
        captureError: (e, ctx) =>
          Sentry.captureException(e instanceof Error ? e : new Error(String(e)), { extra: ctx }),
        captureMessage: (m, ctx) => Sentry.captureMessage(m, { extra: ctx }),
      })
    })
    .catch(() => {
      // SDK failed to load — fall back to console reporter + manual global handlers.
      installManualHandlers()
    })
}
