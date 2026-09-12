import { createContext, useContext, type ReactNode } from 'react'

const ReadingTipsContext = createContext(true)

/** The signed-in shell supplies the account preference; public previews keep their explanations. */
export function ReadingTipsProvider({ show, children }: { show: boolean; children: ReactNode }) {
  return <ReadingTipsContext.Provider value={show}>{children}</ReadingTipsContext.Provider>
}

/** Explicitly selected how-to copy. Essential labels, states and the guide never use this wrapper. */
export function ReadingTips({ children }: { children: ReactNode }) {
  return useContext(ReadingTipsContext) ? <>{children}</> : null
}
