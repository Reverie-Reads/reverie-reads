import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function DrawerDialog({
  title,
  closeLabel,
  onClose,
  children,
}: {
  title: string
  closeLabel: string
  onClose: () => void
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.documentElement.style.overflow
    const scrollPosition = {
      left: window.scrollX,
      top: window.scrollY,
      behavior: 'instant' as const,
    }
    const cancel = (event: Event) => {
      event.preventDefault()
      onCloseRef.current()
    }
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusable = [
        ...dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.tabIndex >= 0 && element.getClientRects().length > 0)
      const first = focusable[0]
      const last = focusable.at(-1)
      if (!first || !last) return

      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    dialog.addEventListener('cancel', cancel)
    dialog.addEventListener('keydown', trapFocus)
    if (!dialog.open) dialog.showModal()
    document.documentElement.style.overflow = 'hidden'
    closeRef.current?.focus({ preventScroll: true })
    window.scrollTo(scrollPosition)

    return () => {
      dialog.removeEventListener('cancel', cancel)
      dialog.removeEventListener('keydown', trapFocus)
      if (dialog.open) dialog.close()
      document.documentElement.style.overflow = previousOverflow
      opener?.focus({ preventScroll: true })
      window.scrollTo(scrollPosition)
    }
  }, [])

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={title}
      aria-modal="true"
      data-drawer-dialog
      className="m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-ink"
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Dismiss ${title}`}
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: 'color-mix(in srgb, var(--bg0) 55%, transparent)' }}
      />
      <section
        className="absolute right-0 top-0 flex h-dvh w-[min(360px,92vw)] flex-col border-l border-line"
        style={{ background: 'var(--bg1)', boxShadow: 'var(--shadow)' }}
      >
        <div className="flex justify-end p-2">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="skin-control grid h-8 w-8 place-items-center border border-line text-[13px] text-ink"
            style={{ background: 'var(--card)' }}
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </section>
    </dialog>,
    document.body,
  )
}
