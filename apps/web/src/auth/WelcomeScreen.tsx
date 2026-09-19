import { APP_NAME } from '@reverie/core'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { supabase } from '../lib/supabase'
import { authCallback } from '../lib/authCallback'
import { useAuth } from './AuthProvider'
import { Wordmark } from './Wordmark'
import { Surface } from '../components/Surface'

const displayFont = { fontFamily: 'var(--font-display)', fontWeight: 600 } as const

// Mirrors the sign-up requirements (config.toml: min length 8 + lower_upper_letters_digits).
const reqs = (pw: string) => [
  { label: 'At least 8 characters', ok: pw.length >= 8 },
  { label: 'A number', ok: /\d/.test(pw) },
  { label: 'An uppercase letter', ok: /[A-Z]/.test(pw) },
]

function Card({ children }: { children: ReactNode }) {
  return (
    <main className="relative z-[1] mx-auto flex min-h-dvh w-full max-w-[520px] items-center px-6">
      <Surface tone="card" radius="panel" pad={0} raised className="w-full p-7 text-center">
        <Link to="/" className="mb-6 inline-block">
          <Wordmark />
        </Link>
        {children}
      </Surface>
    </main>
  )
}

function EnterButton({ label = 'Enter your library' }: { label?: string }) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => void navigate({ to: '/', replace: true })}
      className="skin-control mt-6 flex h-12 w-full items-center justify-center text-[15px] font-semibold"
      style={{ background: 'var(--gold)', color: 'var(--on-primary)' }}
    >
      {label}
    </button>
  )
}

/** Set-a-new-password form for the recovery flow — the reset link signs the reader in and lands
 *  here; without this screen the link would go nowhere useful. */
function SetNewPassword() {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const strong = reqs(password).every((r) => r.ok)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!strong || busy) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    if (error) setError(error.message)
    else setDone(true)
    setBusy(false)
  }

  if (done) {
    return (
      <>
        <span aria-hidden className="block text-[34px]">
          🗝️
        </span>
        <h1 className="mt-3 text-[26px] italic leading-tight text-ink" style={displayFont}>
          Password updated
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          You’re signed in — your shelves are just as you left them.
        </p>
        <EnterButton />
      </>
    )
  }

  return (
    <>
      <h1 className="text-[26px] italic leading-tight text-ink" style={displayFont}>
        Set a new password
      </h1>
      <p className="mt-2 text-[14px] text-muted">
        Choose a new password to finish resetting your account.
      </p>
      <form onSubmit={submit} className="mt-5 flex flex-col gap-3 text-left" noValidate>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="skin-field h-11 w-full border border-line px-3.5 text-[15px] text-ink outline-none focus:border-[color:var(--gold)]"
          style={{ background: 'var(--field)' }}
        />
        <ul className="flex flex-col gap-1">
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
        {error && (
          <p role="alert" className="text-[13px]" style={{ color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={!strong || busy}
          className="skin-control mt-1 flex h-12 items-center justify-center text-[15px] font-semibold disabled:opacity-50"
          style={{ background: 'var(--gold)', color: 'var(--on-primary)' }}
        >
          {busy ? 'One moment…' : 'Save new password'}
        </button>
      </form>
    </>
  )
}

/**
 * `/welcome` — where Supabase's email links land (emailRedirectTo). Three arrivals:
 * a fresh confirmation (tokens in the hash → session appears → celebrate), a recovery link
 * (→ set-new-password form), or a dead link (`#error=…` → a calm explanation, not a raw error).
 */
export function WelcomeScreen() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [slow, setSlow] = useState(false)

  const failed = authCallback.error != null || authCallback.errorCode != null
  const recovery = authCallback.type === 'recovery' && !failed
  const confirming = !failed && !recovery && !session

  // Nothing to do here (no callback payload, no session) → the front door.
  useEffect(() => {
    if (!loading && !session && !authCallback.present) void navigate({ to: '/', replace: true })
  }, [loading, session, navigate])

  // Tokens can take a beat to process; past ~6s assume something's off and offer the exit.
  useEffect(() => {
    if (!confirming) return
    const t = setTimeout(() => setSlow(true), 6000)
    return () => clearTimeout(t)
  }, [confirming])

  if (failed) {
    const expired = authCallback.errorCode === 'otp_expired'
    return (
      <Card>
        <span aria-hidden className="block text-[34px]">
          🕯️
        </span>
        <h1 className="mt-3 text-[26px] italic leading-tight text-ink" style={displayFont}>
          That link didn’t work
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          {expired
            ? 'It has expired or was already used. If you just created your account, it may already be verified — try logging in.'
            : (authCallback.error ?? 'Something went wrong with this link. Try logging in.')}
        </p>
        <Link
          to="/auth"
          className="skin-control mt-6 flex h-12 w-full items-center justify-center text-[15px] font-semibold"
          style={{ background: 'var(--gold)', color: 'var(--on-primary)' }}
        >
          Log in
        </Link>
      </Card>
    )
  }

  if (recovery) {
    return (
      <Card>
        <SetNewPassword />
      </Card>
    )
  }

  if (session) {
    return (
      <Card>
        <span aria-hidden className="block text-[34px]">
          ✨
        </span>
        <h1 className="mt-3 text-[26px] italic leading-tight text-ink" style={displayFont}>
          You’re in
        </h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          Your email is confirmed and your account is ready. Welcome to {APP_NAME}.
        </p>
        <EnterButton />
      </Card>
    )
  }

  return (
    <Card>
      <span aria-hidden className="block text-[34px]">
        ✉️
      </span>
      <h1 className="mt-3 text-[26px] italic leading-tight text-ink" style={displayFont}>
        {slow ? 'Taking longer than expected' : 'Confirming…'}
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-muted">
        {slow
          ? 'Your account may already be confirmed — try logging in.'
          : 'One moment while we finish setting up your account.'}
      </p>
      {slow && (
        <Link
          to="/auth"
          className="skin-control mt-6 flex h-12 w-full items-center justify-center text-[15px] font-semibold"
          style={{ background: 'var(--gold)', color: 'var(--on-primary)' }}
        >
          Log in
        </Link>
      )}
    </Card>
  )
}
