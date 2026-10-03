import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { clearAllOfflineCaches, evictOtherReaders } from '../lib/offlineCache'
import { storedSession } from '../lib/storedSession'
import { signOutLocally } from '../lib/offlineSignOut'
import { readableAuthError } from './errors'

/** A refresh that failed because the network did, not because the credential is bad. auth-js
 *  preserves the stored session in this case and clears it in the other, so this is the signal
 *  that decides whether a null result means "signed out" or "cannot reach the server". */
const isNetworkAuthFailure = (error: unknown): boolean =>
  !!error &&
  typeof error === 'object' &&
  (error as { name?: string }).name === 'AuthRetryableFetchError'

/** OAuth providers the auth screen offers. Inert until the owner provisions client id/secret in
 *  Supabase auth settings (see SOCIAL_AUTH_ENABLED). */
export type OAuthProvider = 'google' | 'apple'

interface AuthValue {
  session: Session | null
  loading: boolean
  signOut: () => Promise<void>
  /** Email + password sign-in. Resolves with a human-readable error string, or null on success. */
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>
  /**
   * Email + password sign-up. With email confirmation on (H3), this creates an unconfirmed user and
   * sends a verification link; `needsVerification` is true and no session is established until the
   * link is opened. On a project without confirmation it returns a session immediately.
   */
  signUpWithPassword: (
    email: string,
    password: string,
  ) => Promise<{ error: string | null; needsVerification: boolean }>
  /** Start an OAuth redirect flow. Errors back to the caller (e.g. provider not configured). */
  signInWithProvider: (provider: OAuthProvider) => Promise<{ error: string | null }>
}

const noop = async () => ({ error: null })

const AuthContext = createContext<AuthValue>({
  session: null,
  loading: true,
  signOut: async () => {},
  signInWithPassword: noop,
  signUpWithPassword: async () => ({ error: null, needsVerification: false }),
  signInWithProvider: noop,
})

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: ReactNode }) {
  // Seeded SYNCHRONOUSLY from the persisted session. Boot no longer waits on a network round-trip
  // to decide who the reader is: the answer is already in localStorage. This is the whole
  // no-boot-gate fix — a bounded race or a timeout would still have made every offline launch
  // wait, and waiting was never the point. With a stored session we render immediately and let the
  // refresh land later; with none, getSession() answers without touching the network anyway.
  const [session, setSession] = useState<Session | null>(() => storedSession())
  const [loading, setLoading] = useState(() => storedSession() === null)
  // Available because AuthProvider sits INSIDE PersistQueryClientProvider, which renders the
  // QueryClientProvider. No re-ordering needed to reach it.
  const queryClient = useQueryClient()

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        // The error used to be dropped on the floor, and that was the defect. Offline with an
        // expired access token, getSession resolves {session: null, error: AuthRetryableFetchError}
        // after ~25s of bounded retries — auth-js having deliberately KEPT the session in storage.
        // Taking that null at face value replaced the reader's library with the signed-out
        // marketing page, which then crashed on a lazy chunk it could not fetch.
        if (data.session) setSession(data.session)
        else if (!isNetworkAuthFailure(error)) setSession(null)
        // else: keep the session seeded from storage. A genuinely rejected refresh token is NOT
        // retryable, and auth-js has already wiped storage and emitted SIGNED_OUT by that point,
        // so this branch cannot strand a signed-out reader in a stale library.
        setLoading(false)
      })
      .catch(() => setLoading(false))
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      // NOT `setSession(next)`. auth-js emits INITIAL_SESSION as soon as a listener attaches, with
      // whatever its own load resolved — and offline with an expired token that is `null`, both on
      // the success path and in its catch (which emits INITIAL_SESSION null explicitly). Taking
      // that at face value wiped the session seeded from storage and dropped the reader back on the
      // landing ~25s in. Caught by the manual offline condition, not by the unit guards.
      //
      // Storage is the source of truth for "is there a session at all": a null from an event only
      // means signed out when the stored session is gone too. SIGNED_OUT below is the explicit
      // signal, and auth-js removes storage before it fires.
      setSession(next ?? storedSession())
      // The event used to be ignored entirely (`_event`). It is the hook that makes sign-out
      // actually forget: nothing else cleared either cache, so the reader's library outlived their
      // session in BOTH places.
      //
      // Both clears are required and neither is sufficient. queryClient.clear() handles the
      // same-page-load case — sign out, sign in as someone else, no reload — where the in-memory
      // cache still holds the previous reader's queries under unscoped keys like ['books'].
      // clearAllOfflineCaches() handles the next boot, where the IndexedDB mirror would otherwise
      // be restored. Measured before this fix: user B saw 286 of user A's books in both paths, and
      // it never self-corrected.
      //
      // Order matters only for tidiness: clearing the client first fires the persist subscription,
      // and by then auth-js has already removed the stored session, so the scoped persister has no
      // id and writes nothing. The table clear that follows would sweep such a row regardless.
      if (event === 'SIGNED_OUT') {
        setSession(null)
        queryClient.clear()
        void clearAllOfflineCaches()
      }
      // Arriving on a shared device, leave nobody else's library behind you. Sign-out already
      // clears the table, but the previous reader may simply have closed the tab.
      if (event === 'SIGNED_IN' && next?.user?.id) void evictOtherReaders(next.user.id)
    })
    return () => sub.subscription.unsubscribe()
  }, [queryClient])

  const value: AuthValue = {
    session,
    loading,
    signOut: async () => {
      // Capture the access token BEFORE anything clears — it is the only credential that can revoke
      // the server session, and it is never written anywhere. In memory or nowhere.
      const accessToken = session?.access_token ?? null
      const { error } = await supabase.auth.signOut()
      if (!error) return // normal path: auth-js removed the session and SIGNED_OUT does the rest

      if (!isNetworkAuthFailure(error)) return // a real server refusal — surfacing it is honest
      // Offline. Sign out on THIS DEVICE anyway: stop the refresh ticker so nothing resurrects the
      // session, drop the stored key, then do by hand what SIGNED_OUT would have done.
      await signOutLocally(accessToken)
      queryClient.clear()
      await clearAllOfflineCaches()
      setSession(null)
    },
    signInWithPassword: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      return { error: error ? readableAuthError(error) : null }
    },
    signUpWithPassword: async (email, password) => {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/welcome` },
      })
      if (error) return { error: readableAuthError(error), needsVerification: false }
      // No session back => email confirmation is required before sign-in (H3).
      return { error: null, needsVerification: !data.session }
    },
    signInWithProvider: async (provider) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      })
      return { error: error ? readableAuthError(error) : null }
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
