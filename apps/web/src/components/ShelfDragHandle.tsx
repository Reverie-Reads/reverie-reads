import { useEffect, useRef, useState } from 'react'

/** Dedicated pointer handle: touch scrolling on the book itself stays native. Order changes
 * only on release, so the shelf cannot move its own drop targets under the reader's finger. */
export function ShelfDragHandle({
  title,
  onDrop,
}: {
  title: string
  onDrop: (targetId: string) => void
}) {
  const active = useRef(false)
  const target = useRef<HTMLElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const clear = () => {
    target.current?.classList.remove('outline', 'outline-2', 'outline-primary', 'outline-offset-2')
    target.current = null
    active.current = false
  }
  useEffect(() => () => clear(), [])
  return (
    <button
      type="button"
      aria-label={`Drag ${title} to reorder`}
      aria-pressed={dragging}
      className="touch-none min-h-11 min-w-11 skin-control border border-line bg-field px-2 text-xs text-ink"
      onDragStart={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.preventDefault()
        active.current = true
        setDragging(true)
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!active.current) return
        target.current?.classList.remove(
          'outline',
          'outline-2',
          'outline-primary',
          'outline-offset-2',
        )
        const scope = event.currentTarget.closest('[data-shelf-reorder]')
        const next =
          document
            .elementFromPoint(event.clientX, event.clientY)
            ?.closest<HTMLElement>('[data-shelf-book]') ?? null
        target.current = next && scope?.contains(next) ? next : null
        target.current?.classList.add('outline', 'outline-2', 'outline-primary', 'outline-offset-2')
        if (event.clientY < 72) window.scrollBy(0, -24)
        else if (event.clientY > window.innerHeight - 72) window.scrollBy(0, 24)
      }}
      onPointerUp={(event) => {
        if (!active.current) return
        const id = target.current?.dataset.shelfBook
        clear()
        setDragging(false)
        event.currentTarget.releasePointerCapture(event.pointerId)
        if (id) onDrop(id)
      }}
      onPointerCancel={() => {
        clear()
        setDragging(false)
      }}
      onLostPointerCapture={() => {
        clear()
        setDragging(false)
      }}
    >
      {dragging ? 'Move…' : 'Drag'}
    </button>
  )
}
