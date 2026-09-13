import { Link } from '@tanstack/react-router'
import { GUIDE_CHAPTERS } from '../guidance/model'
import { BrandAtmosphere } from './BrandAtmosphere'
import { Wordmark } from './Wordmark'

/** A public, account-independent reference. Account choices live in Settings. */
export function PublicGuide() {
  return (
    <>
      <BrandAtmosphere />
      <div className="relative z-[1] min-h-dvh">
        <a href="#library-guide" className="sr-only focus:not-sr-only focus:block focus:p-4">
          Skip to the guide
        </a>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
            <Link to="/" aria-label="Reverie home">
              <Wordmark />
            </Link>
            <Link
              to="/library"
              className="inline-flex min-h-11 items-center text-[14px] text-ink underline underline-offset-4"
            >
              Open your library
            </Link>
          </div>
        </header>
        <main id="library-guide" className="mx-auto max-w-6xl px-6 py-12 sm:py-20">
          <p className="text-[12px] font-semibold uppercase tracking-[0.18em] text-[color:var(--eyebrow)]">
            Make yourself at home
          </p>
          <h1
            className="mt-4 text-[clamp(38px,6vw,64px)] leading-[1.15] text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Your library guide
          </h1>
          <p className="mt-5 max-w-2xl text-[17px] leading-relaxed text-muted">
            Start with a few books. Come back to these notes whenever you want to try something new.
            For a walkthrough inside your own library, open Walkthroughs and guidance in Settings.
          </p>
          <div className="mt-12 grid items-start gap-12 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-16">
            <nav aria-label="Guide chapters" className="border-y border-line py-3">
              {GUIDE_CHAPTERS.map((chapter) => (
                <a
                  key={chapter.id}
                  href={`#${chapter.id}`}
                  className="flex min-h-11 items-center py-2 text-[14px] leading-relaxed text-muted hover:text-ink"
                >
                  {chapter.title}
                </a>
              ))}
            </nav>
            <div className="min-w-0 space-y-12">
              {GUIDE_CHAPTERS.map((chapter, index) => (
                <section
                  key={chapter.id}
                  id={chapter.id}
                  aria-labelledby={`guide-${chapter.id}`}
                  className="scroll-mt-8 border-b border-line pb-12"
                >
                  <p
                    className="text-[12px] tracking-[0.18em] text-[color:var(--eyebrow)]"
                    aria-hidden
                  >
                    {String(index + 1).padStart(2, '0')}
                  </p>
                  <h2
                    id={`guide-${chapter.id}`}
                    className="mt-3 text-[30px] leading-[1.2] text-ink sm:text-[36px]"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {chapter.title}
                  </h2>
                  <p className="mt-4 text-[16px] leading-relaxed text-muted">{chapter.summary}</p>
                  <ol className="mt-6 list-decimal space-y-4 pl-5 text-[15px] leading-relaxed text-ink">
                    {chapter.steps.map((step) => (
                      <li key={step} className="pl-2">
                        {step}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </div>
        </main>
        <footer className="border-t border-line px-6 py-8 text-center text-[14px] text-muted">
          Your books, your pace.{' '}
          <a href="#library-guide" className="underline underline-offset-4">
            Back to the beginning
          </a>
        </footer>
      </div>
    </>
  )
}
