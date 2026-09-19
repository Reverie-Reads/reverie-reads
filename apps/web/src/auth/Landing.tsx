import { Suspense, lazy, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { APP_NAME, type SkinId, type ResolvedMode } from '@reverie/core'
import { ChunkBoundary } from '../components/ChunkBoundary'
import { GuestLibrary } from './landing/guest/GuestLibrary'
import { GuestLibraryProvider } from './landing/guest/GuestLibraryProvider'
import { ReadingRoomPreview, RoomCaption } from './landing/ReadingRoomPreview'
import { MidnihtWordmark } from './landing/MidnihtWordmark'
import { MidnihtStars } from './landing/MidnihtStars'
import '../styles/midniht.css'

const LandingBelowFold = lazy(() => import('./landing/below-fold'))
const NAV = [
  ['Your library', '#try-next-read'],
  ['How it works', '#how-it-works'],
  ['Rooms', '#skins'],
] as const

function Nav({
  mode,
  onModeChange,
}: {
  mode: ResolvedMode
  onModeChange: (mode: ResolvedMode) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <nav aria-label="Landing" className="midniht-nav">
      <div className="midniht-wrap midniht-nav-row">
        <Link to="/" aria-label={`${APP_NAME} home`}>
          <MidnihtWordmark />
        </Link>
        <div className="midniht-desktop-links">
          {NAV.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </div>
        <div className="midniht-nav-actions">
          <div className="midniht-theme" role="group" aria-label="Landing color theme">
            {(['light', 'dark'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-label={value === 'light' ? 'Light mode' : 'Dark mode'}
                aria-pressed={mode === value}
                onClick={() => onModeChange(value)}
              >
                {value === 'light' ? (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M20 14A8.5 8.5 0 0 1 10 4a8.5 8.5 0 1 0 10 10Z" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          <Link to="/auth" search={{ mode: 'signin' }} className="midniht-nav-signin">
            Log in
          </Link>
          <button
            className="midniht-menu"
            type="button"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls="midniht-mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d={open ? 'M6 6l12 12M6 18L18 6' : 'M4 7h16M4 12h16M4 17h16'} />
            </svg>
          </button>
        </div>
      </div>
      {open && (
        <div id="midniht-mobile-nav" className="midniht-mobile-links midniht-wrap">
          {NAV.map(([label, href]) => (
            <a key={href} href={href} onClick={() => setOpen(false)}>
              {label}
            </a>
          ))}
          <Link to="/auth" search={{ mode: 'signin' }}>
            Log in
          </Link>
          <Link to="/auth" search={{ mode: 'signup' }}>
            Start your library
          </Link>
        </div>
      )}
    </nav>
  )
}

/** Midniht's public identity is independent of the reader's saved room and mode. */
export function Landing() {
  const [skin, setSkin] = useState<SkinId>('folio')
  const [roomMode, setRoomMode] = useState<ResolvedMode>('light')
  const [mode, setMode] = useState<ResolvedMode>('dark')
  return (
    <GuestLibraryProvider>
      <main className="midniht-landing relative z-[1]" data-midniht-mode={mode}>
        <a className="midniht-skip" href="#midniht-content">
          Skip to content
        </a>
        <Nav mode={mode} onModeChange={setMode} />
        <header id="midniht-content" className="midniht-hero midniht-wrap" tabIndex={-1}>
          <MidnihtStars mode={mode} />
          <div className="midniht-hero-copy">
            <p className="midniht-eyebrow">A place for your reading life</p>
            <h1 data-testid="landing-display-heading">
              The quiet place
              <br />
              your stories
              <br />
              <em>return to.</em>
            </h1>
            <p className="midniht-intro">
              A personal library for the books, moods,
              <br className="midniht-desktop-break" /> and memories you carry.
            </p>
            <div className="midniht-hero-actions">
              <Link to="/auth" search={{ mode: 'signup' }} className="midniht-primary">
                Start your library <span aria-hidden="true">↗</span>
              </Link>
              <a href="#try-next-read" className="midniht-text-link">
                Take a look inside <span aria-hidden="true">↓</span>
              </a>
            </div>
            <p className="midniht-invitation">Every shelf, a little more you.</p>
          </div>
          <figure className="midniht-hero-art">
            <div className="midniht-art-window">
              <img
                src="/midniht/reading-window.webp"
                width="540"
                height="412"
                fetchPriority="high"
                alt="A reader with short wavy hair, settled beside library shelves and a luminous moon."
              />
            </div>
            <figcaption>For the worlds you’re still carrying.</figcaption>
          </figure>
        </header>
        <section className="midniht-sample midniht-wrap" aria-labelledby="midniht-library-title">
          <div className="midniht-section-heading">
            <div>
              <p className="midniht-eyebrow">A glimpse inside</p>
              <h2 id="midniht-library-title">Make yourself at home.</h2>
            </div>
            <p>
              Try a sample library. Choose a book, follow a mood, or leave a note.
              <br />
              Nothing here changes a real account.
            </p>
          </div>
          <ReadingRoomPreview skin={skin} mode={roomMode} className="min-w-0 p-3 sm:p-6">
            <RoomCaption skin={skin} mode={roomMode} />
            <GuestLibrary compact skin={skin} mode={roomMode} />
          </ReadingRoomPreview>
        </section>
        <section className="midniht-promises midniht-wrap" aria-label="Your reading life">
          {[
            [
              '01 / Belong',
              'A library that feels like home.',
              'The books you own, the ones you borrow, and the ones you’re dreaming of. A personal space, in a room that feels like you.',
            ],
            [
              '02 / Wander',
              'Follow a feeling.',
              'Let a mood, a familiar favorite, or a spark of curiosity guide your next read. There’s room for every kind of reader.',
            ],
            [
              '03 / Remember',
              'Keep what stays with you.',
              'Leave a thought for your future self. Return to a favorite. Give your reading life somewhere to unfold.',
            ],
          ].map(([label, title, body]) => (
            <article key={label}>
              <p className="midniht-eyebrow">{label}</p>
              <h2>{title}</h2>
              <p>{body}</p>
            </article>
          ))}
        </section>
        <ChunkBoundary label="landing-below-fold">
          <Suspense
            fallback={
              <div className="py-24 text-center text-sm text-muted">
                Opening the rest of the library…
              </div>
            }
          >
            <LandingBelowFold
              skin={skin}
              mode={roomMode}
              onSkinChange={setSkin}
              onModeChange={setRoomMode}
            />
          </Suspense>
        </ChunkBoundary>
      </main>
    </GuestLibraryProvider>
  )
}
