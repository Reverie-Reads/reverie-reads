import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { setErrorReporter, consoleReporter } from '@reverie/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { intakeLookupDiagnostics as diagnostics } from '../lib/intakeLookupDiagnostics'
import { IntakeLookupDiagnosticsControl } from '../components/IntakeLookupDiagnosticsControl'

// Phase 2 guards for fix/offline-session, driven off a stubbed auth client that can hang, fail
// retryably, or reject outright — the three things a real refresh does and the app has to tell
// apart. Assertions are on what renders, because the defect was never visible in the store: the
// session sat in localStorage the whole time while the reader was shown the signed-out page.

let emitAuth: ((event: AuthChangeEvent, session: Session | null) => void) | null = null
let getSessionImpl: () => Promise<{
  data: { session: Session | null }
  error?: unknown
}> = async () => ({
  data: { session: null },
})
let signOutImpl: () => Promise<{ error: unknown }> = async () => ({ error: null })
const calls: string[] = []

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => getSessionImpl(),
      signOut: () => {
        calls.push('signOut')
        return signOutImpl()
      },
      stopAutoRefresh: async () => {
        calls.push('stopAutoRefresh')
      },
      onAuthStateChange: (cb: (e: AuthChangeEvent, s: Session | null) => void) => {
        emitAuth = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  },
}))

const { AuthProvider, useAuth } = await import('./AuthProvider')
const { createDexiePersister, clearAllOfflineCaches, evictOtherReaders } =
  await import('../lib/offlineCache')
const { readStoredSession, resetUnreadableReportForTests } = await import('../lib/storedSession')

const AUTH_KEY = 'sb-127-auth-token'
const SESSION_A = {
  access_token: 'token-a',
  refresh_token: 'r-a',
  user: { id: 'user-a' },
} as unknown as Session
const retryable = Object.assign(new Error('Failed to fetch'), {
  name: 'AuthRetryableFetchError',
  status: 0,
})
const rejected = Object.assign(new Error('Invalid Refresh Token'), {
  name: 'AuthApiError',
  status: 400,
})

const storeSession = (s: Session) => localStorage.setItem(AUTH_KEY, JSON.stringify(s))
const authKeyPresent = () => localStorage.getItem(AUTH_KEY) != null

/** Mirrors RootRoute: the library exists only while there is a session. */
function Shell() {
  const { session, loading } = useAuth()
  if (loading) return <p>Turning the page…</p>
  return session ? <p>your library</p> : <p>signed out</p>
}

const renderApp = (client = new QueryClient()) =>
  render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </QueryClientProvider>,
  )

async function rowIds(): Promise<string[]> {
  const { default: Dexie } = await import('dexie')
  const db = new Dexie('reverie-offline')
  db.version(1).stores({ cache: 'id' })
  const all = (await db.table('cache').toArray()) as { id: string }[]
  db.close()
  return all.map((r) => r.id).sort()
}

beforeEach(async () => {
  diagnostics.reset()
  await clearAllOfflineCaches()
  localStorage.clear()
  sessionStorage.clear()
  calls.length = 0
  emitAuth = null
  resetUnreadableReportForTests()
  getSessionImpl = async () => ({ data: { session: null } })
  signOutImpl = async () => ({ error: null })
})
afterEach(() => setErrorReporter(consoleReporter))

describe('boot never waits on the network to know who the reader is', () => {
  it('renders the library IMMEDIATELY from the stored session while the refresh hangs', async () => {
    storeSession(SESSION_A)
    getSessionImpl = () => new Promise(() => {}) // never resolves — the offline case

    renderApp()

    // No waiting: the very first paint is the library, not the loading line.
    expect(screen.getByText('your library')).toBeInTheDocument()
    expect(screen.queryByText('Turning the page…')).not.toBeInTheDocument()
  })

  it('keeps the reader signed in when the refresh fails because the NETWORK did', async () => {
    storeSession(SESSION_A)
    getSessionImpl = async () => ({ data: { session: null }, error: retryable })

    renderApp()
    await waitFor(() => expect(screen.getByText('your library')).toBeInTheDocument())

    // The exact regression: a null session with a retryable error must not be read as "signed out".
    expect(screen.queryByText('signed out')).not.toBeInTheDocument()
    expect(authKeyPresent()).toBe(true)
  })

  it('signs the reader OUT when the refresh token is genuinely rejected', async () => {
    storeSession(SESSION_A)
    getSessionImpl = async () => ({ data: { session: null }, error: rejected })

    renderApp()
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument())
    expect(screen.queryByText('your library')).not.toBeInTheDocument()
  })

  it('clears the mirror when auth-js reports the session gone', async () => {
    storeSession(SESSION_A)
    await createDexiePersister().persistClient({
      timestamp: 1,
      buster: 'b',
      clientState: { mutations: [], queries: [] },
    })
    expect(await rowIds()).toEqual(['react-query:user-a'])

    renderApp()
    await waitFor(() => expect(emitAuth).not.toBeNull())
    localStorage.removeItem(AUTH_KEY) // auth-js removes storage before it emits
    await act(async () => emitAuth!('SIGNED_OUT', null))

    await waitFor(async () => expect(await rowIds()).toEqual([]))
    expect(screen.getByText('signed out')).toBeInTheDocument()
  })
})

describe('signing out with no connectivity', () => {
  function SignOutButton() {
    const { signOut } = useAuth()
    return (
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    )
  }
  const renderWithButton = (client = new QueryClient()) =>
    render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Shell />
          <SignOutButton />
        </AuthProvider>
      </QueryClientProvider>,
    )

  it('signs out on THIS device, stopping the refresh ticker before dropping the key', async () => {
    storeSession(SESSION_A)
    getSessionImpl = async () => ({ data: { session: SESSION_A } })
    signOutImpl = async () => ({ error: retryable }) // offline: the server was never reached
    await createDexiePersister().persistClient({
      timestamp: 1,
      buster: 'b',
      clientState: { mutations: [], queries: [] },
    })

    renderWithButton()
    await waitFor(() => expect(screen.getByText('your library')).toBeInTheDocument())
    await act(async () => {
      screen.getByRole('button', { name: 'Sign out' }).click()
    })

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument())
    expect(authKeyPresent()).toBe(false)
    expect(await rowIds()).toEqual([])

    // ORDER IS THE FIX. Removing the key while the ticker still runs leaves auth-js holding the
    // session in memory, free to refresh and re-persist on reconnect — signing the reader back in
    // on a device they believe they left.
    expect(calls).toEqual(['signOut', 'stopAutoRefresh'])
  })

  it('leaves an honest one-shot notice that does not overclaim', async () => {
    const { takeLocalSignOutNotice } = await import('../lib/offlineSignOut')
    storeSession(SESSION_A)
    getSessionImpl = async () => ({ data: { session: SESSION_A } })
    signOutImpl = async () => ({ error: retryable })

    renderWithButton()
    await waitFor(() => expect(screen.getByText('your library')).toBeInTheDocument())
    await act(async () => {
      screen.getByRole('button', { name: 'Sign out' }).click()
    })
    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument())

    expect(takeLocalSignOutNotice()).toBe(true)
    expect(takeLocalSignOutNotice()).toBe(false) // one-shot
  })

  it('does NOT sign out locally when the server refuses for a real reason', async () => {
    storeSession(SESSION_A)
    getSessionImpl = async () => ({ data: { session: SESSION_A } })
    signOutImpl = async () => ({ error: rejected }) // a server answer, not a network failure

    renderWithButton()
    await waitFor(() => expect(screen.getByText('your library')).toBeInTheDocument())
    await act(async () => {
      screen.getByRole('button', { name: 'Sign out' }).click()
    })

    expect(calls).toEqual(['signOut']) // no local teardown, no ticker stop
    expect(authKeyPresent()).toBe(true)
  })
})

describe('arriving on a shared device', () => {
  it('evicts every other reader’s row on SIGNED_IN', async () => {
    storeSession({ ...SESSION_A, user: { id: 'user-a' } } as Session)
    await createDexiePersister().persistClient({
      timestamp: 1,
      buster: 'b',
      clientState: { mutations: [], queries: [] },
    })
    storeSession({ ...SESSION_A, user: { id: 'user-b' } } as Session)
    await createDexiePersister().persistClient({
      timestamp: 1,
      buster: 'b',
      clientState: { mutations: [], queries: [] },
    })
    expect(await rowIds()).toEqual(['react-query:user-a', 'react-query:user-b'])

    await evictOtherReaders('user-b')
    expect(await rowIds()).toEqual(['react-query:user-b'])
  })

  it('runs that eviction from the SIGNED_IN event', async () => {
    storeSession({ ...SESSION_A, user: { id: 'user-a' } } as Session)
    await createDexiePersister().persistClient({
      timestamp: 1,
      buster: 'b',
      clientState: { mutations: [], queries: [] },
    })

    renderApp()
    await waitFor(() => expect(emitAuth).not.toBeNull())
    storeSession({ ...SESSION_A, user: { id: 'user-b' } } as Session)
    await act(async () => emitAuth!('SIGNED_IN', { user: { id: 'user-b' } } as Session))

    await waitFor(async () => expect(await rowIds()).toEqual([]))
  })
})

describe('an unreadable auth key is reported, not swallowed', () => {
  it('separates “no key” from “key present but unparseable”, and reports only the latter once', () => {
    const messages: string[] = []
    setErrorReporter({ captureError: () => {}, captureMessage: (m) => messages.push(m) })

    expect(readStoredSession()).toEqual({ kind: 'none' })
    expect(messages).toEqual([]) // signed out is not an incident

    localStorage.setItem(AUTH_KEY, 'base64-a-format-we-cannot-parse')
    expect(readStoredSession().kind).toBe('unreadable')
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatch(/not JSON/)

    // A shape change (no user.id) is the other way this goes wrong, and it must not re-report.
    localStorage.setItem(AUTH_KEY, JSON.stringify({ access_token: 'x' }))
    expect(readStoredSession().kind).toBe('unreadable')
    expect(messages).toHaveLength(1) // once per load — a broken format must not burn the quota
  })
})

describe('a null session from an EVENT is not a sign-out', () => {
  // auth-js emits INITIAL_SESSION with null as soon as a listener attaches if its own load failed —
  // which offline is exactly what happens. Blindly trusting it dropped the reader on the landing
  // ~25s into an offline launch. The manual condition caught this; these guard it.
  it('ignores an INITIAL_SESSION null while the stored session is still there', async () => {
    storeSession(SESSION_A)
    getSessionImpl = () => new Promise(() => {})

    renderApp()
    expect(screen.getByText('your library')).toBeInTheDocument()
    await waitFor(() => expect(emitAuth).not.toBeNull())

    await act(async () => emitAuth!('INITIAL_SESSION', null))
    expect(screen.getByText('your library')).toBeInTheDocument()
    expect(screen.queryByText('signed out')).not.toBeInTheDocument()
  })

  it('honours a null once the stored session is genuinely gone', async () => {
    storeSession(SESSION_A)
    getSessionImpl = () => new Promise(() => {})

    renderApp()
    await waitFor(() => expect(emitAuth).not.toBeNull())
    localStorage.removeItem(AUTH_KEY)
    await act(async () => emitAuth!('INITIAL_SESSION', null))

    await waitFor(() => expect(screen.getByText('signed out')).toBeInTheDocument())
  })
})

describe('optional Add diagnostics follow the actual authenticated account', () => {
  it('discards counts and pending completions before a different account renders, while refresh preserves them', async () => {
    storeSession(SESSION_A)
    getSessionImpl = () => new Promise(() => {})
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <IntakeLookupDiagnosticsControl />
        </AuthProvider>
      </QueryClientProvider>,
    )
    await act(async () => {
      screen.getByRole('button', { name: 'Start diagnostic session' }).click()
    })
    let old!: ReturnType<typeof diagnostics.begin>
    act(() => {
      old = diagnostics.begin('isbn')
    })
    await act(async () => emitAuth!('TOKEN_REFRESHED', SESSION_A))
    expect(screen.getByRole('status')).toHaveTextContent('1 of 20 attempts; 1 pending.')
    await act(async () =>
      emitAuth!('SIGNED_IN', { ...SESSION_A, user: { id: 'another-reader' } } as Session),
    )
    expect(screen.getByRole('status')).toHaveTextContent('Diagnostics are off. 0 of 20 attempts')
    act(() => {
      diagnostics.start()
      old({ result: 'candidates', edition: 'exact', candidatesWithoutAuthor: false })
    })
    expect(diagnostics.getSnapshot().attempted).toBe(0)
    await act(async () => emitAuth!('SIGNED_OUT', null))
    expect(screen.getByRole('status')).toHaveTextContent('Diagnostics are off. 0 of 20 attempts')
    expect(JSON.stringify(diagnostics.export())).not.toContain('another-reader')
  })
})
