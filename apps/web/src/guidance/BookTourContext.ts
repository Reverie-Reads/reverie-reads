import { createContext, useContext, useEffect, type Dispatch } from 'react'
import { INITIAL_BOOK_TOUR, type BookTourEvent, type BookTourStep } from './bookTourModel'

export const BookTourContext = createContext({
  state: INITIAL_BOOK_TOUR,
  send: (() => {}) as Dispatch<BookTourEvent>,
})

export function useBookTour() {
  return useContext(BookTourContext)
}

/** Called only after a real screen has the data it claims to show. Observes; never performs a write. */
export function useBookTourObservation(step: BookTourStep | null, bookId?: string) {
  const { state, send } = useBookTour()
  const running = state.status !== 'off'
  useEffect(() => {
    if (running && step) send({ type: 'observe', run: state.run, step, bookId })
  }, [running, state.run, step, bookId, send])
}
