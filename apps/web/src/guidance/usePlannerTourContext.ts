import { useEffect } from 'react'
import { useBookTour } from './BookTourContext'
import type { PlannerContext } from './bookTourModel'

/** The mounted screen owns context. Never infer confirmation from optimistic book data. */
export function usePlannerTourContext(context: PlannerContext | null) {
  const { state, send } = useBookTour()
  const running = state.journey === 'planner' && state.status !== 'off'
  const kind = context?.kind
  const view = context?.view
  const bookId = context?.kind === 'editor' ? context.bookId : undefined
  const editorId = context?.kind === 'editor' ? context.editorId : undefined
  useEffect(() => {
    if (!running || !kind) return
    if (kind === 'editor' && bookId && editorId && view)
      send({ type: 'planner-context', run: state.run, context: { kind, bookId, editorId, view } })
    else if (kind === 'view' && view)
      send({ type: 'planner-context', run: state.run, context: { kind, view } })
    else if (kind === 'picker' && view)
      send({ type: 'planner-context', run: state.run, context: { kind, view } })
  }, [running, state.run, kind, view, bookId, editorId, send])
}
