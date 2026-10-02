import { useEffect, useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { SKIN_LIST, isSkinId, type SkinId } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { BeardedHome } from '../components/BeardedHome'
import { BeardedChrome } from '../components/BeardedChrome'
import { WelcomeInterface } from '../components/WelcomeInterface'
import { DEFAULT_BEARD, type BeardAppearance } from '../design/beardAppearance'
import { ReadingModeContext, type ReadingMode } from '../design/useReadingMode'
import { catalogIncoming, guestBook } from '../auth/landing/guest/catalog'
import { loadAllSkinFonts } from '../skin/fonts'
import { SkinAtmosphereCanvas } from '../components/SkinAtmosphereCanvas'

const books = [
  guestBook('study-jane', catalogIncoming('jane-eyre')),
  guestBook('study-left', catalogIncoming('left-hand-of-darkness')),
]
books[0] = { ...books[0]!, readStatus: 'Reading', progress: 24 }

/** Explicit synthetic layout study: no profile, library hooks, capture or book writers. */
function ReadingModeStudy() {
  const [skin, setSkin] = useState<SkinId>('folio')
  const [dark, setDark] = useState(false)
  const [welcome, setWelcome] = useState(false)
  const [beard, setBeardState] = useState<BeardAppearance>(DEFAULT_BEARD)
  const [mode, setMode] = useState<ReadingMode>('bearded')
  useEffect(() => loadAllSkinFonts(), [])
  // The actual native dialogs render in the document top layer, outside this study's wrapper.
  // Give them the chosen room too, and restore the preceding appearance on route exit.
  useEffect(() => {
    const element = document.documentElement
    const previousSkin = element.getAttribute('data-skin')
    const previousMode = element.getAttribute('data-mode')
    const pending = element.hasAttribute('data-appearance-pending')
    const branded = element.classList.contains('gold-brand')
    element.removeAttribute('data-appearance-pending')
    element.classList.remove('gold-brand')
    return () => {
      if (previousSkin === null) element.removeAttribute('data-skin')
      else element.setAttribute('data-skin', previousSkin)
      if (previousMode === null) element.removeAttribute('data-mode')
      else element.setAttribute('data-mode', previousMode)
      if (pending) element.setAttribute('data-appearance-pending', '')
      if (branded) element.classList.add('gold-brand')
    }
  }, [])
  useEffect(() => {
    document.documentElement.setAttribute('data-skin', skin)
    document.documentElement.setAttribute('data-mode', dark ? 'dark' : 'light')
  }, [skin, dark])
  return (
    <div
      data-skin={skin}
      data-mode={dark ? 'dark' : 'light'}
      data-reading-mode={mode}
      className="relative min-h-dvh bg-[color:var(--bg)] text-ink"
    >
      <div className="relative z-[1] flex flex-wrap items-center gap-3 border-b border-line bg-[color:var(--card-solid)] px-5 py-3">
        <span className="text-[14px]">Layout study · example books. Links open the app.</span>
        <label className="flex items-center gap-2">
          Room{' '}
          <select
            className="skin-field min-h-12 border border-line bg-[color:var(--field)] px-3 text-ink"
            value={skin}
            onChange={(e) => {
              if (isSkinId(e.target.value)) setSkin(e.target.value)
            }}
          >
            {SKIN_LIST.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={dark} onChange={(e) => setDark(e.target.checked)} />
          Night
        </label>
        <button
          type="button"
          className="min-h-12 px-3 underline underline-offset-4"
          onClick={() => setWelcome(!welcome)}
        >
          {welcome ? 'Preview library' : 'Preview first welcome'}
        </button>
      </div>
      <ReadingModeContext.Provider
        value={{
          mode,
          setMode,
          storageUnavailable: false,
          beard,
          setBeard: (next) => {
            setBeardState(next)
            return true
          },
        }}
      >
        {welcome ? (
          <div className="relative z-[1] mx-auto flex min-h-[80dvh] max-w-[560px] flex-col justify-center px-5 py-10">
            <WelcomeInterface onContinue={() => setWelcome(false)} />
          </div>
        ) : mode === 'bearded' ? (
          <div className="relative flex min-h-dvh">
            <BeardedChrome householdAdd={false} />
            <div className="relative min-w-0 flex-1 pb-24 lg:pb-0">
              <SkinAtmosphereCanvas skin={skin} mode={dark ? 'dark' : 'light'} />
              <div className="relative">
                <BeardedChrome householdAdd={false} mobile />
                <BeardedHome
                  books={books}
                  loading={false}
                  failed={false}
                  retry={() => {}}
                  reportCoverErrors={false}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-xl p-8">
            <h1 className="text-3xl">Full interface selected</h1>
            <p className="mt-3 leading-relaxed">
              In your library, this restores your saved arrangement. This study contains only the
              simplified layout.
            </p>
            <button
              className="skin-control skin-btn-primary mt-5 px-4 py-3"
              onClick={() => setMode('bearded')}
            >
              Return to the Bearded mode study
            </button>
          </div>
        )}
      </ReadingModeContext.Provider>
    </div>
  )
}
export const labReadingModeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'lab/reading-mode',
  component: ReadingModeStudy,
})
