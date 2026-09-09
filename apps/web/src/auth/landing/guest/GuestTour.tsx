import { useEffect, useRef, useState } from 'react'
import type { GuestPage } from './state'
import { primary, quiet } from './styles'

interface TourStep {
  page?: GuestPage
  bookId?: string
  title: string
  body: string
}

const STEPS: readonly TourStep[] = [
  {
    page: 'library',
    title: 'Begin with the books already around you.',
    body: 'Each book keeps its copy, format, reading state, and place on your shelf. This little library starts with one owned book and one borrowed audiobook.',
  },
  {
    page: 'next',
    title: 'Choose from what is actually available.',
    body: 'Next read starts with books you own or have borrowed. You can widen the choice deliberately, without a public score deciding for you.',
  },
  {
    bookId: 'guest-jane',
    title: 'Let the book hold what happens next.',
    body: 'Progress, your rating, and a private note stay with the book. Finishing it moves that exact reading into your journal.',
  },
  {
    page: 'configure',
    title: 'Arrange the library around your habits.',
    body: 'Choose what stays close in the dock. A full account also lets you order the modules that greet you on Home.',
  },
]

/** A truthful path through the working guest library. It changes only which existing view is
 * visible; the visitor remains in control of every book, note, and reading-state mutation. */
export function GuestTour({ onShow }: { onShow: (step: TourStep) => void }) {
  const [stepIndex, setStepIndex] = useState<number | null>(null)
  const primaryAction = useRef<HTMLButtonElement>(null)
  const hasRendered = useRef(false)
  const step = stepIndex == null ? null : STEPS[stepIndex]

  useEffect(() => {
    if (!hasRendered.current) {
      hasRendered.current = true
      return
    }
    primaryAction.current?.focus({ preventScroll: true })
  }, [stepIndex])

  const show = (index: number) => {
    const next = STEPS[index]
    if (!next) return
    const position = { left: window.scrollX, top: window.scrollY }
    onShow(next)
    setStepIndex(index)
    window.requestAnimationFrame(() => window.scrollTo({ ...position, behavior: 'instant' }))
  }

  if (stepIndex == null || !step) {
    return (
      <aside
        id="guest-tour"
        aria-label="A short tour of Reverie"
        className="skin-card mb-5 flex flex-col gap-3 border border-line bg-[color:var(--card-solid)] p-4 sm:flex-row sm:items-center sm:justify-between"
      >
        <div>
          <p className="text-sm font-semibold text-ink">New here? Take a one-minute tour.</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Four stops through this working library. Nothing changes unless you choose it.
          </p>
        </div>
        <button
          ref={primaryAction}
          type="button"
          className={`${primary} shrink-0`}
          onClick={() => show(0)}
        >
          Show me around
        </button>
      </aside>
    )
  }

  const last = stepIndex === STEPS.length - 1
  return (
    <aside
      id="guest-tour"
      aria-label="A short tour of Reverie"
      className="skin-card mb-5 border border-line bg-[color:var(--card-solid)] p-4"
    >
      <div aria-live="polite" aria-atomic="true">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          A short tour · {stepIndex + 1} of {STEPS.length}
        </p>
        <h4
          className="mt-2 text-xl font-semibold leading-snug text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          {step.title}
        </h4>
        <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {stepIndex > 0 && (
          <button type="button" className={quiet} onClick={() => show(stepIndex - 1)}>
            Previous stop
          </button>
        )}
        <button
          ref={primaryAction}
          type="button"
          className={primary}
          onClick={() => (last ? setStepIndex(null) : show(stepIndex + 1))}
        >
          {last ? 'Explore on my own' : 'Next stop'}
        </button>
        <button type="button" className={quiet} onClick={() => setStepIndex(null)}>
          Close tour
        </button>
      </div>
    </aside>
  )
}
