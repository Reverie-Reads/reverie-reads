import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, computePosition, flip, offset, shift } from '@floating-ui/dom'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { Button } from '../components/Button'
import { useBookTour } from './BookTourContext'
import { BOOK_TOUR_STEPS } from './bookTourModel'
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

export function StartBookTour({ className = '' }: { className?: string }) {
  const { send } = useBookTour()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  return (
    <Button
      className={className}
      onClick={() => {
        if (pathname === '/add' || pathname === '/library') send({ type: 'start' })
        else void navigate({ to: '/library', search: {} }).then(() => send({ type: 'start' }))
      }}
    >
      Guide me in the app
    </Button>
  )
}

export function BookTour() {
  const { state, send } = useBookTour()
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
    const allowed =
      location.pathname === '/library' ||
      location.pathname === '/add' ||
      (state.bookId && location.pathname === `/book/${state.bookId}`)
    if (!allowed) send({ type: 'pause' })
  }, [location.pathname, running, state.bookId, send, stop])

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
      if (openModal && !usable && !openModal.querySelector('[data-book-tour="tour-opened-book"]')) {
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
  }, [running, step.target, stop, send])

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

  const blockedByModal = !!modal && (!target || !modal.contains(target))
  useEffect(() => {
    const floating = panel.current
    if (!running || !floating || blockedByModal) return
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
          shift({ padding: 16 }),
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
  }, [target, running, state.status, blockedByModal])

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
    if (step.demonstration === 'click' && ['add', 'saved', 'library'].includes(state.step))
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
      >
        <div className="book-tour-heading">
          <p className="book-tour-eyebrow">
            {state.status === 'paused' ? 'Walkthrough paused' : 'Your first book'}
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
        <div className="book-tour-actions">
          {state.status === 'paused' ? (
            <Button variant="secondary" onClick={() => send({ type: 'resume' })}>
              Resume
            </Button>
          ) : state.step === 'opened' ? (
            <Button onClick={finish}>Keep exploring</Button>
          ) : (
            <Button disabled={!target || playing} onClick={() => void demonstrate()}>
              {playing ? 'Showing you…' : shown ? 'Show me again' : 'Show me this step'}
            </Button>
          )}
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
          {state.status === 'paused' && (
            <Button
              variant="ghost"
              onClick={() => {
                void navigate(
                  state.bookId ? { to: '/library', search: {} } : { to: '/add', search: {} },
                ).then(() => send({ type: 'resume' }))
              }}
            >
              Return to this task
            </Button>
          )}
        </div>
        {active && state.step !== 'opened' && (
          <p className="book-tour-handoff">
            {playing ? step.action : 'Your turn whenever you are ready.'}
          </p>
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
    modal ?? document.body,
  )
}
