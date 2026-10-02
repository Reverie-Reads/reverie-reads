import { createContext, useContext } from 'react'
import { DEFAULT_BEARD, type BeardAppearance } from './beardAppearance'

export type ReadingMode = 'standard' | 'bearded'
export const keyFor = (accountId: string) => `midniht.reading-mode.v1.${accountId}`

export function readReadingMode(accountId: string): ReadingMode {
  try {
    const raw = localStorage.getItem(keyFor(accountId))
    if (!raw) return 'standard'
    const value: unknown = JSON.parse(raw)
    return typeof value === 'object' &&
      value !== null &&
      'version' in value &&
      value.version === 1 &&
      'mode' in value &&
      value.mode === 'bearded'
      ? 'bearded'
      : 'standard'
  } catch {
    return 'standard'
  }
}

interface ReadingModeValue {
  mode: ReadingMode
  setMode: (mode: ReadingMode) => void
  storageUnavailable: boolean
  beard: BeardAppearance
  setBeard: (beard: BeardAppearance) => boolean
}
export const ReadingModeContext = createContext<ReadingModeValue>({
  mode: 'standard',
  setMode: () => {},
  storageUnavailable: false,
  beard: DEFAULT_BEARD,
  setBeard: () => false,
})

export const useReadingMode = () => useContext(ReadingModeContext)
