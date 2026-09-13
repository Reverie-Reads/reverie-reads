import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Surface } from './Surface'

/** A simple accessible modal: labelled dialog, Escape + backdrop to close, focus moved in.
 *  The native top layer matters when a modal opens from a mobile DrawerDialog: a fixed div cannot
 *  out-rank an already-open native dialog regardless of z-index. Portaling a second native dialog
 *  to body makes the newest layer visible and interactive above both the drawer and mobile tabs. */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  // HTMLElement, not HTMLDivElement: the panel renders through Surface, whose `as` contract means
  // the element is not assumable — and focus() is all this ref ever asks of it.
  const panelRef = useRef<HTMLElement>(null)

  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  return createPortal(
    <dialog
      ref={dialogRef}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none border-0 bg-transparent p-0 text-ink"
    >
      <div
        className="flex h-full items-end justify-center sm:items-center sm:p-4"
        style={{ background: 'rgba(0,0,0,0.5)' }}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose()
        }}
      >
        {/* radius="none" + `.rv-modal` in className is the API pass's ruling, not a laundering of the
          defect the migration retired: rv-modal is TOKEN-driven at desktop (var(--radius-panel))
          and its mobile shape (24px 24px 0 0 — a bottom sheet) is a deliberate responsive design
          the four-value enum cannot express. The bespoke radius stays named in a kit class where
          it is visible; Surface absorbs what it genuinely shares — tone, border, pad, elevation,
          and now the focus ref. */}
        <Surface
          ref={panelRef}
          tabIndex={-1}
          tone="card-solid"
          radius="none"
          pad={5}
          raised
          className={`max-h-[92dvh] w-full rv-modal overflow-y-auto outline-none ${
            wide ? 'sm:max-w-2xl' : 'sm:max-w-md'
          }`}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2
              className="text-[22px] italic leading-tight text-ink"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-line text-muted hover:text-ink"
            >
              ✕
            </button>
          </div>
          <div data-book-tour-outlet />
          {children}
        </Surface>
      </div>
    </dialog>,
    document.body,
  )
}
