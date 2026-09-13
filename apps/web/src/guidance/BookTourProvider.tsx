import { useMemo, useReducer, type ReactNode } from 'react'
import { BookTourContext } from './BookTourContext'
import { bookTourReducer, INITIAL_BOOK_TOUR } from './bookTourModel'

/** Keyed by the authenticated reader. No storage, provider calls or book writers. */
export function BookTourProvider({ children }: { children: ReactNode }) {
  const [state, send] = useReducer(bookTourReducer, INITIAL_BOOK_TOUR)
  const value = useMemo(() => ({ state, send }), [state])
  return <BookTourContext.Provider value={value}>{children}</BookTourContext.Provider>
}
