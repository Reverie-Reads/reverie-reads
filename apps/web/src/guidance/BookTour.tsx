import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Button } from '../components/Button'
import { useJustFinishedStore } from '../lib/chainPrompt'
import { useBookTour } from './BookTourContext'
import { BOOK_TOUR_STEPS, bookTourReturnHref, isBookTourLocation } from './bookTourModel'
import './bookTour.css'

/** Visible targets only: the shell can render both desktop and mobile Add controls. */
function findBookTourTarget(name: string): HTMLElement | null {
  return (
    [...document.querySelectorAll<HTMLElement>(`[data-book-tour="${name}"]`)].find(
      (element) =>
        element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden',
    ) ?? null
  )
}

/** Entry controls preserve the current form; only an explicit return leaves this screen. */
function StartTour({
  journey,
  label,
  className = '',
  quiet = false,
  bookId,
}: {
  bookId?: string
  journey: 'first-book' | 'reading'
  label: string
  className?: string
  quiet?: boolean
}) {
  const { state, send } = useBookTour()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const continuing = state.status !== 'off' && state.journey === journey
  const here = isBookTourLocation(state, pathname)
  const currentBookId = bookId ?? /^\/book\/([^/]+)$/.exec(pathname)?.[1]
  const startHere =
    journey === 'reading'
      ? pathname === '/library' || !!currentBookId
      : pathname === '/add' || pathname === '/library'
  function start() {
    const event =
      journey === 'reading'
        ? { type: 'start-reading' as const, bookId: currentBookId }
        : { type: 'start' as const }
    if (journey === 'reading' && bookId && pathname !== `/book/${bookId}`)
      void navigate({ to: '/book/$bookId', params: { bookId } }).then(() => send(event))
    else if (startHere) send(event)
    else void navigate({ to: '/library', search: {} }).then(() => send(event))
  }
  // The active coach already carries resume/replay. Do not add a duplicate toolbar above a form.
  if (quiet && continuing && here) return null
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <Button
        variant={quiet ? 'ghost' : 'primary'}
        onClick={() => {
          if (!continuing) start()
          else if (here) send({ type: 'resume' })
          else
            void navigate({ href: bookTourReturnHref(state) }).then(() => send({ type: 'resume' }))
        }}
      >
        {continuing ? (here ? 'Continue walkthrough' : 'Return to previous walkthrough') : label}
      </Button>
      {continuing && !here && (
        <Button variant="ghost" onClick={start}>
          {startHere ? 'Start over here' : 'Start over in Library'}
        </Button>
      )}
    </span>
  )
}

export function StartBookTour({
  className = '',
  label = 'Guide me in the app',
  quiet = false,
}: {
  className?: string
  label?: string
  quiet?: boolean
}) {
  return <StartTour journey="first-book" label={label} className={className} quiet={quiet} />
}

export function StartReadingTour({ quiet = false, bookId }: { quiet?: boolean; bookId?: string }) {
  return <StartTour journey="reading" label="Guide my reading" quiet={quiet} bookId={bookId} />
}

export function BookTour() {
  const { state, send } = useBookTour()
  const finishedBookId = useJustFinishedStore((s) => s.target?.book.id)
  useEffect(() => {
    if (state.journey !== 'reading' || !state.bookId) return
    if (finishedBookId === state.bookId)
      send({ type: 'reading', run: state.run, action: 'reflect-open', bookId: state.bookId })
    else if (!finishedBookId)
      send({ type: 'reading', run: state.run, action: 'reflect-close', bookId: state.bookId })
  }, [finishedBookId, state.journey, state.bookId, state.run, send])
  const location = useRouterState({ select: (s) => s.location })
  const navigate = useNavigate()
  const step = BOOK_TOUR_STEPS[state.step]
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const [modal, setModal] = useState<HTMLElement | null>(null)
  const [missing, setMissing] = useState(false)
  const [touch, setTouch] = useState(() => window.matchMedia('(pointer: coarse)').matches)
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [playing, setPlaying] = useState(false)
  const [shown, setShown] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const cue = useRef<HTMLDivElement>(null)
  const animation = useRef<Animation | null>(null)
  const attempt = useRef(0)
  const active = state.status === 'active'
  const running = state.status !== 'off'
  const stop = useCallback(() => {
    attempt.current += 1
    animation.current?.cancel()
    animation.current = null
    setPlaying(false)
    setShown(false)
  }, [])

  useEffect(() => {
    if (!running) return
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => {
      setReduced(preference.matches)
      stop()
    }
    const input = (event: PointerEvent) => {
      if (event.pointerType) setTouch(event.pointerType !== 'mouse')
      // A real action takes precedence over a pending demonstration, including clicking Pause.
      stop()
    }
    preference.addEventListener('change', change)
    document.addEventListener('pointerdown', input, true)
    return () => {
      preference.removeEventListener('change', change)
      document.removeEventListener('pointerdown', input, true)
    }
  }, [stop, running])

  useEffect(() => {
    if (!running) return
    const pause = () => {
      stop()
      send({ type: 'pause' })
    }
    const visibility = () => {
      if (document.hidden) pause()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') pause()
      else stop()
    }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('blur', pause)
    document.addEventListener('keydown', key, true)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('blur', pause)
      document.removeEventListener('keydown', key, true)
    }
  }, [running, send, stop])

  useEffect(() => {
    stop()
    if (!running) return
    if (!isBookTourLocation({ journey: state.journey, bookId: state.bookId }, location.pathname))
      send({ type: 'pause' })
    else send({ type: 'location', run: state.run, href: location.href })
  }, [
    location.pathname,
    location.href,
    running,
    state.bookId,
    state.journey,
    state.run,
    send,
    stop,
  ])

  useEffect(() => {
    stop()
    setMissing(false)
    if (!running) {
      setTarget(null)
      return
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const locate = () => {
      const element = findBookTourTarget(step.target)
      const openModal = [...document.querySelectorAll<HTMLElement>('dialog[open]')].at(-1) ?? null
      setModal(openModal)
      const usable = !openModal || (element && openModal.contains(element)) ? element : null
      setTarget((previous) => (previous === usable ? previous : usable))
      if (usable) {
        setMissing(false)
        clearTimeout(timeout)
        timeout = undefined
      } else if (!timeout) timeout = setTimeout(() => setMissing(true), 4000)
      // The rail mounts its target before its observation reaches this provider.
      // Let that real book-open transition settle without treating it as an unrelated dialog.
      if (
        openModal &&
        !usable &&
        !openModal.querySelector('[data-book-tour="tour-opened-book"]') &&
        !(
          state.journey === 'reading' &&
          openModal.querySelector(`[data-reading-tour-book="${state.bookId}"]`)
        )
      ) {
        stop()
        send({ type: 'pause' })
      }
    }
    locate()
    const observer = new MutationObserver(locate)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'hidden', 'data-book-tour'],
    })
    window.addEventListener('resize', locate)
    return () => {
      observer.disconnect()
      clearTimeout(timeout)
      window.removeEventListener('resize', locate)
    }
  }, [running, step.target, state.journey, state.bookId, state.run, stop, send])

  useEffect(() => stop(), [target, stop])

  useEffect(() => {
    if (!active || !target) return
    const previous = target.getAttribute('aria-describedby')
    target.setAttribute(
      'aria-describedby',
      [previous, 'book-tour-instruction'].filter(Boolean).join(' '),
    )
    target.setAttribute('data-book-tour-active', '')
    return () => {
      const ids = (target.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .filter((id) => id !== 'book-tour-instruction')
      if (ids.length) target.setAttribute('aria-describedby', ids.join(' '))
      else target.removeAttribute('aria-describedby')
      target.removeAttribute('data-book-tour-active')
    }
  }, [target, active])

  const modalOutlet = modal?.querySelector<HTMLElement>('[data-book-tour-outlet]') ?? null
  const blockedByModal = !!modal && (!target || !modal.contains(target))
  useEffect(() => {
    const floating = panel.current
    if (!running || !floating || blockedByModal) return
    if (modalOutlet) {
      floating.removeAttribute('style')
      floating.removeAttribute('data-compact')
      return
    }
    let disposed = false
    const update = () => {
      const viewport = window.visualViewport
      const width = viewport?.width ?? window.innerWidth
      const top = viewport?.offsetTop ?? 0
      const height = viewport?.height ?? window.innerHeight
      floating.toggleAttribute('data-compact', width < 700 && height < 600)
      if (!target || state.status === 'paused' || width < 700) {
        const left = (viewport?.offsetLeft ?? 0) + 12
        const panelHeight = floating.getBoundingClientRect().height
        // A step can group related controls, such as cover/tags/Done after saving.
        // Keep that entire working area clear, not just the highlighted button.
        const rect = (target?.closest('[data-book-tour-region]') ?? target)?.getBoundingClientRect()
        const minY = top + 72
        const bottomY = Math.max(minY, top + height - panelHeight - 88)
        let y = bottomY
        if (rect && rect.bottom > bottomY - 12 && rect.top < bottomY + panelHeight + 12) {
          const above = rect.top - panelHeight - 16
          const below = rect.bottom + 16
          if (above >= minY) y = Math.min(bottomY, above)
          else if (below <= bottomY) y = Math.max(minY, below)
          else y = minY
        }
        Object.assign(floating.style, {
          left: `${left}px`,
          top: `${y}px`,
          visibility: 'visible',
        })
        return
      }
      void computePosition(target, floating, {
        strategy: 'fixed',
        placement: 'left-start',
        middleware: [
          offset(18),
          flip({ fallbackPlacements: ['right-start', 'bottom-start', 'top-start'] }),
          // A step can point below the fold. Keep its navigation reachable so the reader
          // can ask the demonstration to bring that target into view.
          shift({ padding: 16, crossAxis: true }),
        ],
      }).then(({ x, y }) => {
        if (!disposed)
          Object.assign(floating.style, { left: `${x}px`, top: `${y}px`, visibility: 'visible' })
      })
    }
    update()
    const cleanup = target ? autoUpdate(target, floating, update) : undefined
    const resize = new ResizeObserver(update)
    resize.observe(floating)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    return () => {
      disposed = true
      cleanup?.()
      resize.disconnect()
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [target, running, state.status, blockedByModal, modalOutlet])

  useEffect(
    () => () => {
      attempt.current += 1
      animation.current?.cancel()
    },
    [],
  )

  async function demonstrate() {
    if (!target || !active || playing) return
    const original = target
    const serial = ++attempt.current
    const start = document.activeElement?.getBoundingClientRect()
    const view = window.visualViewport
    const rect = original.getBoundingClientRect()
    if (
      rect.top < (view?.offsetTop ?? 0) + 72 ||
      rect.bottom > (view?.offsetTop ?? 0) + (view?.height ?? innerHeight) - 90
    )
      original.scrollIntoView({ block: 'center', behavior: 'instant' })
    const destination = original.getBoundingClientRect()
    const x = destination.left + Math.min(destination.width / 2, 60)
    const y = destination.top + Math.min(destination.height / 2, 24)
    setPlaying(true)
    setShown(true)
    const pointer = cue.current
    if (pointer) {
      pointer.style.left = `${x}px`
      pointer.style.top = `${y}px`
      if (!reduced && pointer.animate) {
        animation.current = pointer.animate(
          [
            {
              transform: `translate(${(start?.left ?? x) - x}px, ${(start?.top ?? y) - y}px)`,
              opacity: 0,
            },
            { transform: 'translate(0, 0)', opacity: 1 },
          ],
          { duration: touch ? 400 : 600, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
        )
        try {
          await animation.current.finished
          const ripple = pointer.querySelector<HTMLElement>('.book-tour-ripple')
          if (ripple && serial === attempt.current) {
            animation.current = ripple.animate(
              [
                { transform: 'scale(.4)', opacity: 0.8 },
                { transform: 'scale(1.7)', opacity: 0 },
              ],
              { duration: 300 },
            )
            await animation.current.finished
          }
        } catch {
          return
        }
      }
    }
    const current = original.getBoundingClientRect()
    if (
      serial !== attempt.current ||
      !original.isConnected ||
      document.hidden ||
      findBookTourTarget(step.target) !== original ||
      Math.abs(current.left - destination.left) > 2 ||
      Math.abs(current.top - destination.top) > 2 ||
      Math.abs(current.width - destination.width) > 2 ||
      Math.abs(current.height - destination.height) > 2
    ) {
      if (serial === attempt.current) stop()
      return
    }
    // The allowlist contains navigation only. No save, result choice, field value or mutation.
    if (
      step.demonstration === 'click' &&
      ['add', 'saved', 'library', 'read-progress', 'read-finish', 'read-reflect'].includes(
        state.step,
      ) &&
      !original.matches(':disabled')
    )
      original.click()
    else if (step.demonstration === 'focus' && original instanceof HTMLInputElement)
      original.focus({ preventScroll: true })
    else {
      if (!original.hasAttribute('tabindex') && !original.matches('button,a,input'))
        original.setAttribute('tabindex', '-1')
      original.focus({ preventScroll: true })
    }
    setPlaying(false)
  }

  function finish() {
    stop()
    const focusTarget = target ?? document.getElementById('main')
    focusTarget?.focus({ preventScroll: true })
    send({ type: 'end' })
  }

  if (!running || blockedByModal) return null
  return createPortal(
    <>
      <aside
        ref={panel}
        className="book-tour-panel"
        aria-label="Live walkthrough"
        data-book-tour-panel
        data-inline={!!modalOutlet}
      >
        <div className="book-tour-heading">
          <p className="book-tour-eyebrow">
            {state.status === 'paused'
              ? 'Walkthrough paused'
              : state.journey === 'reading'
                ? 'Your reading life'
                : 'Your first book'}
          </p>
          <button
            type="button"
            className="book-tour-close"
            aria-label="End live walkthrough"
            onClick={finish}
          >
            ×
          </button>
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="book-tour-title">
          {step.title}
        </p>
        {active && (
          <p id="book-tour-instruction" className="book-tour-text">
            {step.text}
          </p>
        )}
        {active && missing && (
          <p className="book-tour-text">
            This step is not visible here. Continue in the app, or pause and return when you are
            ready.
          </p>
        )}
        {state.status === 'paused' && !isBookTourLocation(state, location.pathname) && (
          <p className="book-tour-text">
            Returning leaves this page. Finish any unsaved changes first.
          </p>
        )}
        <div className="book-tour-actions">
          {state.status === 'paused' ? (
            isBookTourLocation(state, location.pathname) && target ? (
              <Button variant="secondary" onClick={() => send({ type: 'resume' })}>
                Resume
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  void navigate({ href: bookTourReturnHref(state) }).then(() =>
                    send({ type: 'resume' }),
                  )
                }}
              >
                Return to this task
              </Button>
            )
          ) : state.step === 'opened' ? (
            <>
              <Button onClick={finish}>Keep exploring</Button>
              <StartReadingTour bookId={state.bookId ?? undefined} />
            </>
          ) : (
            <Button
              disabled={!target || playing}
              aria-busy={playing}
              aria-description={step.action}
              onClick={() => void demonstrate()}
            >
              Show me this step
            </Button>
          )}
          {active &&
            ['read-saved', 'read-finished', 'read-finish', 'read-finish-editor'].includes(
              state.step,
            ) && (
              <Button variant="secondary" onClick={finish}>
                Continue reading
              </Button>
            )}
          {active && ['read-progress', 'read-saved'].includes(state.step) && state.bookId && (
            <Button
              variant="ghost"
              onClick={() =>
                send({
                  type: 'reading',
                  run: state.run,
                  action: 'offer-finish',
                  bookId: state.bookId!,
                })
              }
            >
              When I finish
            </Button>
          )}
          {active && state.step === 'read-choose' && <StartBookTour label="Start with a book" />}
          {active && state.step !== 'opened' && (
            <Button
              variant="ghost"
              onClick={() => {
                stop()
                send({ type: 'pause' })
              }}
            >
              Pause
            </Button>
          )}
          {state.step === 'opened' && (
            <Link
              to="/settings/guidance"
              onClick={() => {
                stop()
                send({ type: 'end' })
              }}
              className="book-tour-guide-link"
            >
              More walkthroughs
            </Link>
          )}
          {state.status === 'paused' && isBookTourLocation(state, location.pathname) && target && (
            <Button
              variant="ghost"
              onClick={() =>
                send(
                  state.journey === 'reading'
                    ? { type: 'start-reading', bookId: state.bookId ?? undefined }
                    : { type: 'start' },
                )
              }
            >
              Start over here
            </Button>
          )}
          {missing && state.journey === 'reading' && (
            <Button
              variant="ghost"
              onClick={() => {
                void navigate({ to: '/library', search: {} }).then(() =>
                  send({ type: 'start-reading' }),
                )
              }}
            >
              Choose another book
            </Button>
          )}
        </div>
        {active && state.step !== 'opened' && (
          <p className="book-tour-handoff">Your turn whenever you are ready.</p>
        )}
      </aside>
      <div
        ref={cue}
        className="book-tour-cue"
        data-input={touch ? 'touch' : 'mouse'}
        data-shown={shown && active}
        data-motion={reduced ? 'reduced' : 'full'}
        aria-hidden="true"
      >
        {touch ? (
          <span className="book-tour-dot" />
        ) : (
          <svg viewBox="0 0 28 36" width="28" height="36">
            <path d="M3 2v28l7-7 5 11 5-2-5-11h10Z" />
          </svg>
        )}
        <span className="book-tour-ripple" />
      </div>
    </>,
    modalOutlet ?? modal ?? document.body,
  )
}
