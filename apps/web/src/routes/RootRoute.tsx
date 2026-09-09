import { useEffect, useState } from 'react'
import { Outlet, createRootRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { Sky } from '../components/Sky'
import { AppShell } from '../components/AppShell'
import { UpdateToast } from '../components/UpdateToast'
import { WriteErrorToast } from '../components/WriteErrorToast'
import { JustFinishedSheet } from '../components/JustFinishedSheet'
import { useAuth } from '../auth/AuthProvider'
import { UnauthShell } from '../auth/UnauthShell'
import { VerifyEmail } from '../auth/VerifyEmail'
import { ReadingRoomGate } from '../auth/ReadingRoomGate'
import { authCallback } from '../lib/authCallback'
import { useVoice } from '../skin/labels'
import { PersonalLibrarySync } from '../components/PersonalLibrarySync'

function RootLayout() {
  const { session, loading } = useAuth()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const voice = useVoice()

  // A page load carrying an auth-callback hash (email confirmation / recovery / expired link)
  // belongs on /welcome, wherever Supabase redirected it. One-shot state: only the arriving load
  // redirects; once there, normal navigation resumes.
  const [callbackPending, setCallbackPending] = useState(
    () => authCallback.present && pathname !== '/welcome',
  )
  useEffect(() => {
    if (callbackPending) {
      void navigate({ to: '/welcome', replace: true })
      setCallbackPending(false)
    }
  }, [callbackPending, navigate])

  // The skin-character lab (/lab/skins) renders OUTSIDE the auth gate so the Tryst-vs-Aphelion
  // side-by-side can be opened — and screenshotted headlessly — without a session. Synthetic content
  // only; each cell scopes its own data-skin/data-mode, so no global Sky is needed.
  if (pathname.startsWith('/lab/')) {
    return <Outlet />
  }
  // /welcome renders outside the auth gate (the visitor may not have a session yet) in the gold
  // master-brand scope, like the rest of the front door.
  if (pathname === '/welcome' || callbackPending) {
    return <div className="gold-brand">{callbackPending ? null : <Outlet />}</div>
  }
  // A session whose email isn't confirmed is gated out of the app (H3, defense in depth). Password
  // sign-up with confirmation on creates NO session until the link is opened, so that flow stays on
  // the unauthenticated shell (the auth screen shows "check your inbox"); this gate catches the
  // residual case of a session that exists but is unconfirmed (e.g. OAuth without a verified email).
  const verified =
    !!session?.user && (!!session.user.email_confirmed_at || !!session.user.confirmed_at)

  if (loading) {
    return (
      <div className="relative z-[1] flex min-h-dvh items-center justify-center text-muted">
        {voice.loading}
      </div>
    )
  }

  // Signed out → the gold master-brand front door (landing + auth). It paints its own night sky, so
  // no skin-themed Sky here; that keeps the door gold-on-night regardless of any persisted skin.
  if (!session) {
    return (
      <>
        <UnauthShell />
        <UpdateToast />
        <WriteErrorToast />
      </>
    )
  }

  // First-run onboarding renders full-screen (skin Sky behind, no app chrome) — it's its own
  // front door into the library, themed live in the skin the reader picks.
  const onboarding = pathname === '/onboarding'

  return (
    <ReadingRoomGate>
      <Sky />
      {verified && <PersonalLibrarySync readerId={session.user.id} />}
      {!verified ? (
        <VerifyEmail email={session.user.email} />
      ) : onboarding ? (
        <Outlet />
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
      <UpdateToast />
      <WriteErrorToast />
      <JustFinishedSheet />
    </ReadingRoomGate>
  )
}

export const rootRoute = createRootRoute({ component: RootLayout })
