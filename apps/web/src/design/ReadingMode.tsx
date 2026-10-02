import { useEffect, useState, type ReactNode } from 'react'
import { keyFor, readReadingMode, ReadingModeContext, type ReadingMode } from './useReadingMode'
import { beardKeyFor, readBeardAppearance, type BeardAppearance } from './beardAppearance'

/** A browser-local view preference, isolated by account. The root keys this provider by account:
 * changing identity must never paint the departed reader's choice, even for one render. */
export function ReadingModeProvider({
  accountId,
  children,
}: {
  accountId: string
  children: ReactNode
}) {
  const [mode, setModeState] = useState(() => readReadingMode(accountId))
  const [beard, setBeardState] = useState(() => readBeardAppearance(accountId))
  const [storageUnavailable, setStorageUnavailable] = useState(false)
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === keyFor(accountId) || event.key === null)
        setModeState(readReadingMode(accountId))
      if (event.key === beardKeyFor(accountId) || event.key === null)
        setBeardState(readBeardAppearance(accountId))
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [accountId])
  function setMode(next: ReadingMode) {
    setModeState(next)
    try {
      localStorage.setItem(keyFor(accountId), JSON.stringify({ version: 1, mode: next }))
      setStorageUnavailable(false)
    } catch {
      setStorageUnavailable(true)
    }
  }
  function setBeard(next: BeardAppearance) {
    setBeardState(next)
    try {
      localStorage.setItem(beardKeyFor(accountId), JSON.stringify({ version: 1, ...next }))
      setStorageUnavailable(false)
      return true
    } catch {
      setStorageUnavailable(true)
      return false
    }
  }
  return (
    <ReadingModeContext.Provider value={{ mode, setMode, storageUnavailable, beard, setBeard }}>
      {children}
    </ReadingModeContext.Provider>
  )
}
