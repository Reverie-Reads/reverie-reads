import { useState } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { Landing } from './Landing'
import { AuthScreen } from './AuthScreen'
import { BrandAtmosphere } from './BrandAtmosphere'
import { takeLocalSignOutNotice } from '../lib/offlineSignOut'

/** The unauthenticated front door, scoped to Reverie's genre-neutral library brand.
 *  Routes by path: /auth → the auth screen, anything else → the public landing. App routes aren't
 *  reachable while signed out — the root layout renders this in place of the app outlet. */
export function UnauthShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  // Read once on mount, and it clears itself — a sign-out that only reached this device says so.
  const [localOnly] = useState(takeLocalSignOutNotice)
  return (
    <div className="gold-brand">
      {pathname.startsWith('/auth') && <BrandAtmosphere />}
      {/* Held to the copy standard: it must not imply the reader is signed out anywhere but here.
          They were offline, so the server was never told; other devices are untouched.

          One nuance, considered rather than missed: if this tab stays open and connectivity
          returns, the queued logout in offlineSignOut fires from the in-memory token and DOES end
          other sessions. So "stay signed in" is true at the moment this renders, and may later be
          superseded by the app's own action. The alternative — hedging it up front — would be
          false in the common case, where the tab is closed and nothing is ever sent. A line that
          is true when read beats one that is vague about both outcomes. */}
      {localOnly && (
        <p
          role="status"
          className="relative z-[1] px-6 py-3 text-center text-[13px]"
          style={{ background: 'var(--card)', color: 'var(--muted)' }}
        >
          Signed out on this device. You were offline, so any other devices stay signed in.
        </p>
      )}
      {pathname.startsWith('/auth') ? <AuthScreen /> : <Landing />}
    </div>
  )
}
