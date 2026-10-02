export interface TourRectangle {
  left: number
  top: number
  right: number
  bottom: number
}
interface Viewport {
  left: number
  top: number
  width: number
  height: number
}

/** Intersect the visual viewport (including zoom/keyboard offsets) with the device safe area.
 * Insets belong to the layout viewport: a keyboard already inside it must not subtract them twice. */
export function tourSafeRectangle(
  viewport: Viewport,
  layout: { width: number; height: number },
  insets: { top: number; right: number; bottom: number; left: number },
): TourRectangle {
  const left = Math.max(viewport.left, insets.left)
  const top = Math.max(viewport.top, insets.top)
  return {
    left,
    top,
    right: Math.max(left, Math.min(viewport.left + viewport.width, layout.width - insets.right)),
    bottom: Math.max(top, Math.min(viewport.top + viewport.height, layout.height - insets.bottom)),
  }
}

function clamp(value: number, low: number, high: number) {
  return Math.max(low, Math.min(value, Math.max(low, high)))
}

/** A last containment guard for asynchronous desktop placement and shortened phone coaching. */
export function constrainTourPosition(
  point: { x: number; y: number },
  area: TourRectangle,
  panel: { width: number; height: number },
) {
  return {
    x: clamp(point.x, area.left + 12, area.right - panel.width - 12),
    y: clamp(point.y, area.top + 12, area.bottom - panel.height - 12),
  }
}

export function fallbackTourPosition(
  area: TourRectangle,
  panel: { width: number; height: number },
  target?: { top: number; bottom: number },
) {
  const minY = Math.max(area.top + 12, Math.min(area.top + 72, area.bottom - panel.height - 12))
  const bottomY = Math.max(minY, area.bottom - panel.height - 88)
  let y = bottomY
  if (target && target.bottom > bottomY - 12 && target.top < bottomY + panel.height + 12) {
    const above = target.top - panel.height - 16
    const below = target.bottom + 16
    if (above >= minY) y = Math.min(bottomY, above)
    else if (below <= bottomY) y = Math.max(minY, below)
    else y = minY
  }
  return constrainTourPosition({ x: area.left + 12, y }, area, panel)
}
