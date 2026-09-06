import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { SKINS } from '@reverie/core'
import { useAuth, type OAuthProvider } from './AuthProvider'
import { supabase } from '../lib/supabase'
import { Wordmark } from './Wordmark'
import { Surface } from '../components/Surface'
import { clearGuestHandoff, loadGuestHandoff, summarizeGuestHandoff } from './landing/guest/handoff'

/** Social sign-in is wired but inert until the owner provisions Google/Apple client id + secret in
 *  Supabase auth settings. Flip VITE_SOCIAL_AUTH_ENABLED=true after provisioning. Password is the
 *  immediately-functional + e2e-testable path. */
const SOCIAL_AUTH_ENABLED = import.meta.env.VITE_SOCIAL_AUTH_ENABLED === 'true'

type Mode = 'signin' | 'signup' | 'forgot'
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Password requirements mirror config.toml (min length 8 + lower_upper_letters_digits).
const reqs = (pw: string) => [
  { label: 'At least 8 characters', ok: pw.length >= 8 },
  { label: 'A number', ok: /\d/.test(pw) },
  { label: 'An uppercase letter', ok: /[A-Z]/.test(pw) },
]

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] uppercase tracking-[0.16em] text-muted">
        {label}
      </span>
      {children}
    </label>
  )
}

const inputClass =
  'skin-field h-11 w-full border border-line px-3.5 text-[15px] text-ink outline-none focus:border-[color:var(--gold)]'
const inputStyle = { background: 'var(--field)' } as const

export function AuthScreen() {
  const { signInWithPassword, signUpWithPassword, signInWithProvider } = useAuth()
  const search = useRouterState({
    select: (s) => s.location.search as { mode?: Mode; guest?: boolean },
  })
  const [mode, setMode] = useState<Mode>(search.mode === 'signup' ? 'signup' : 'signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<'verify' | 'reset-sent' | null>(null)
  const [guestHandoff, setGuestHandoff] = useState(() => loadGuestHandoff())
  const guestSummary = guestHandoff ? summarizeGuestHandoff(guestHandoff) : null

  const emailValid = EMAIL_RE.test(email)
  const pwStrong = reqs(password).every((r) => r.ok)
  const canSubmit =
    mode === 'forgot'
      ? emailValid
      : mode === 'signup'
        ? emailValid && pwStrong
        : emailValid && password.length > 0

  function go(next: Mode) {
    setMode(next)
    setError(null)
    setNotice(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    if (mode === 'signin') {
      const { error } = await signInWithPassword(email, password)
      if (error) setError(error)
      // success → a session arrives; the root layout swaps to the app.
    } else if (mode === 'signup') {
      const { error, needsVerification } = await signUpWithPassword(email, password)
      if (error) setError(error)
      else if (needsVerification) setNotice('verify')
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/welcome`,
      })
      if (error) setError(error.message)
      else setNotice('reset-sent')
    }
    setBusy(false)
  }

  async function oauth(provider: OAuthProvider) {
    if (!SOCIAL_AUTH_ENABLED || busy) return
    setBusy(true)
    const { error } = await signInWithProvider(provider)
    if (error) {
      setError(error)
      setBusy(false)
    }
    // success → a redirect leaves the page.
  }

  // Post-action confirmation (verify-email / reset-sent) replaces the form.
  if (notice) {
    const verify = notice === 'verify'
    return (
      <Shell>
        <div className="text-center">
          <span aria-hidden className="text-[34px]">
            ✉️
          </span>
          <h1 className="mt-3 text-[26px] leading-[1.2] text-ink" style={displayFont}>
            Check your inbox
          </h1>
          <p className="mt-3 text-[14px] leading-relaxed text-muted">
            {verify ? 'We sent a verification link to ' : 'If an account exists for '}
            <span className="text-ink">{email}</span>
            {verify
              ? '. Open it to finish setting up — verification is required before your first sign-in.'
              : ', a reset link is on its way.'}
          </p>
          {verify && guestSummary && (
            <p className="mt-3 text-[14px] leading-relaxed text-ink">
              Your {guestSummary.books}-book guest library will stay in this browser while you
              verify your email.
            </p>
          )}
          <button
            type="button"
            onClick={() => go('signin')}
            className="mt-6 text-[14px] font-semibold"
            style={{ color: 'var(--gold)' }}
          >
            Back to log in
          </button>
        </div>
      </Shell>
    )
  }

  const title =
    mode === 'signup'
      ? 'Create your account'
      : mode === 'forgot'
        ? 'Reset your password'
        : 'Welcome back'
  const sub =
    mode === 'signup'
      ? 'Make a little room for your books. Your library starts here.'
      : mode === 'forgot'
        ? 'Enter your email and we’ll send a link to set a new one.'
        : 'Your shelves are just as you left them.'

  return (
    <Shell>
      <h1 className="text-[27px] leading-[1.2] text-ink" style={displayFont}>
        {title}
      </h1>
      <p className="mt-2 text-[14px] text-muted">{sub}</p>

      {guestHandoff && guestSummary && (
        <Surface tone="field" radius="card" pad={0} className="mt-5 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-ink">Your guest library is waiting</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-muted">
                {guestSummary.books} books · {guestSummary.completedReads} finished reads ·{' '}
                {SKINS[guestHandoff.skin].label} room
              </p>
            </div>
            <button
              type="button"
              className="min-h-11 shrink-0 text-[12px] font-semibold text-muted underline underline-offset-4"
              onClick={() => {
                clearGuestHandoff()
                setGuestHandoff(null)
              }}
            >
              Let it go
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            It is stored only in this browser. After you sign in, you’ll review it before anything
            is added to your account.
          </p>
        </Surface>
      )}

      <form onSubmit={submit} className="mt-6 flex flex-col gap-3.5" noValidate>
        <Field label="Email">
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
            style={inputStyle}
          />
        </Field>

        {mode !== 'forgot' && (
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="password"
                className="text-[12px] uppercase tracking-[0.16em] text-muted"
              >
                Password
              </label>
              {mode === 'signin' && (
                <button
                  type="button"
                  onClick={() => go('forgot')}
                  className="text-[11px] font-semibold"
                  style={{ color: 'var(--gold)' }}
                >
                  Forgot password?
                </button>
              )}
            </div>
            <div className="relative">
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                required
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Create a password' : 'Your password'}
                className={`${inputClass} pr-11`}
                style={inputStyle}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-lg text-[14px] text-muted hover:text-ink"
              >
                {showPw ? '🙈' : '👁'}
              </button>
            </div>
          </div>
        )}

        {mode === 'signup' && (
          <ul className="-mt-1 flex flex-col gap-1">
            {reqs(password).map((r) => (
              <li
                key={r.label}
                className="flex items-center gap-2 text-[12px]"
                style={{ color: r.ok ? 'var(--ok)' : 'var(--muted)' }}
              >
                <span aria-hidden>{r.ok ? '✓' : '○'}</span>
                {r.label}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-[13px]" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit || busy}
          className="skin-control mt-1 flex h-12 items-center justify-center text-[15px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--gold)', color: 'var(--on-primary)' }}
        >
          {busy
            ? 'One moment…'
            : mode === 'signup'
              ? 'Create account'
              : mode === 'forgot'
                ? 'Send reset link'
                : 'Log in'}
        </button>
      </form>

      {mode !== 'forgot' && (
        <>
          <div
            className="my-5 flex items-center gap-3 text-[12px]"
            style={{ color: 'var(--faint)' }}
          >
            <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
            or continue with
            <span className="h-px flex-1" style={{ background: 'var(--line)' }} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(['google', 'apple'] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => void oauth(p)}
                disabled={!SOCIAL_AUTH_ENABLED || busy}
                aria-disabled={!SOCIAL_AUTH_ENABLED}
                title={SOCIAL_AUTH_ENABLED ? undefined : 'Coming soon'}
                className="skin-control flex h-11 items-center justify-center gap-2 border border-line text-[14px] font-semibold text-ink disabled:opacity-45"
                style={{ background: 'var(--field)' }}
              >
                <span
                  aria-hidden
                  style={p === 'google' ? { fontFamily: 'var(--font-display)' } : undefined}
                >
                  {p === 'google' ? 'G' : ''}
                </span>
                {p === 'google' ? 'Google' : 'Apple'}
              </button>
            ))}
          </div>
          {!SOCIAL_AUTH_ENABLED && (
            <p className="mt-2 text-center text-[11.5px]" style={{ color: 'var(--faint)' }}>
              Social sign-in is coming soon.
            </p>
          )}
        </>
      )}

      <p className="mt-6 text-center text-[13.5px] text-muted">
        {mode === 'signup' ? (
          <>
            Already have an account?{' '}
            <button
              type="button"
              onClick={() => go('signin')}
              className="font-semibold"
              style={{ color: 'var(--gold)' }}
            >
              Log in
            </button>
          </>
        ) : mode === 'forgot' ? (
          <>
            Remembered it?{' '}
            <button
              type="button"
              onClick={() => go('signin')}
              className="font-semibold"
              style={{ color: 'var(--gold)' }}
            >
              Back to log in
            </button>
          </>
        ) : (
          <>
            New to the night shelf?{' '}
            <button
              type="button"
              onClick={() => go('signup')}
              className="font-semibold"
              style={{ color: 'var(--gold)' }}
            >
              Create an account
            </button>
          </>
        )}
      </p>
    </Shell>
  )
}

const displayFont = { fontFamily: 'var(--font-display)', fontWeight: 600 } as const

/** Split-screen: the brand pane (desktop only) + the form card. A back-to-home link keeps the front
 *  door reversible. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[1000px] items-center px-6">
      <div className="grid w-full items-center gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <aside className="hidden md:block">
          <Link to="/" className="inline-block">
            <Wordmark />
          </Link>
          <h2
            className="mt-8 max-w-[14ch] text-balance text-[44px] leading-[1.04] text-ink"
            style={displayFont}
          >
            A reading life,{' '}
            <span className="italic" style={{ color: 'var(--gold)' }}>
              beautifully kept.
            </span>
          </h2>
          <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-muted">
            Everything you’ve read, everything you mean to — gathered under one quiet night sky.
          </p>
          <p className="mt-6 flex items-center gap-1.5 text-[13px] text-muted">
            <span aria-hidden>🔒</span> Your library is private by default.
          </p>
        </aside>

        <Surface tone="card" radius="panel" pad={0} raised className="w-full p-7">
          <Link to="/" className="mb-6 inline-block md:hidden">
            <Wordmark />
          </Link>
          {children}
        </Surface>
      </div>
    </main>
  )
}
