import { useState, type ReactNode } from 'react'
import { DEFAULT_SKIN } from '@reverie/core'
import { BrandAtmosphere } from './BrandAtmosphere'
import { Wordmark } from './Wordmark'
import { Button } from '../components/Button'
import { useSkinSync } from '../skin/controls'
import { finishAppearanceBootstrap, useSkin } from '../skin/useSkin'

/**
 * Keep a first sign-in in Reverie's neutral front-door material until the reader's complete room
 * can be applied. Returning readers with a valid local room and mode pass straight through, which
 * preserves the app's instant and offline first paint.
 */
export function ReadingRoomGate({ children }: { children: ReactNode }) {
  const appearance = useSkinSync()
  const [localFallback, setLocalFallback] = useState(false)

  if (appearance.ready || localFallback) return children

  const useDefaultRoom = () => {
    useSkin.getState().hydrate(DEFAULT_SKIN, 'system', null)
    finishAppearanceBootstrap()
    setLocalFallback(true)
  }

  return (
    <div className="gold-brand relative flex min-h-dvh items-center justify-center px-6 py-12">
      <BrandAtmosphere />
      <main
        aria-busy={!appearance.unavailable}
        className="relative z-[1] flex w-full max-w-md flex-col items-center text-center"
      >
        <Wordmark />
        {appearance.unavailable ? (
          <>
            <h1
              className="mt-10 text-[clamp(2rem,9vw,3.2rem)] leading-[0.98] tracking-[-0.035em] text-ink"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 500 }}
            >
              Your room is out of reach.
            </h1>
            <p className="mt-5 max-w-sm text-[15px] leading-7 text-muted">
              We couldn’t load your saved appearance. Your library is unchanged. Try again, or open
              with Reverie’s default room for now.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Button onClick={appearance.retry}>Try again</Button>
              <Button variant="secondary" onClick={useDefaultRoom}>
                Use default room
              </Button>
            </div>
          </>
        ) : (
          <p role="status" className="mt-8 text-[15px] tracking-[0.02em] text-muted">
            Opening your reading room…
          </p>
        )}
      </main>
    </div>
  )
}
