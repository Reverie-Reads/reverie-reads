import { useEffect, useRef } from 'react'
import type { AdaptiveBundle, ResolvedMode, SkinId } from '@reverie/core'
import { paintRoomMaterial, paintRoomMotion, ROOM_SCENES, type RoomPalette } from './roomMaterials'

/** The approved material study shared by the app and landing. A small WebGL shader lights a
 * bounded height map once and releases its context; the visible canvas only redraws its cached
 * still plus quiet lamplight. Hidden previews and reduced-motion views rest. */
export function SkinAtmosphereCanvas({
  skin,
  mode,
  adaptiveBundle,
}: {
  skin: SkinId
  mode: ResolvedMode
  /** Repaint when the adaptive palette changes without changing its dominant room. */
  adaptiveBundle?: AdaptiveBundle | null
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    const still = document.createElement('canvas')
    const scene = still.getContext('2d')
    if (!scene) return
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)')
    // An observer's first delivery establishes visibility. Do not render every gallery card
    // before it arrives: synchronous material generation can block navigation and font loading.
    let visible = typeof IntersectionObserver === 'undefined'
    let timer = 0
    let frame = 0
    let width = 1
    let height = 1
    let palette: RoomPalette
    let materialKey = ''
    let disposed = false
    const cancel = () => {
      window.clearTimeout(timer)
      window.cancelAnimationFrame(frame)
    }
    const paint = (time = 0) => {
      if (disposed || !canvas.isConnected) return
      context.clearRect(0, 0, width, height)
      context.drawImage(still, 0, 0, width, height)
      if (time) paintRoomMotion(context, width, height, skin, palette, time)
    }
    const tick = () => {
      if (disposed || !canvas.isConnected || !visible || document.hidden || motion.matches) return
      frame = window.requestAnimationFrame((time) => {
        paint(time)
        timer = window.setTimeout(tick, 125)
      })
    }
    const start = () => {
      if (disposed || !canvas.isConnected) return
      cancel()
      if (!visible || document.hidden || !materialKey) return
      paint()
      tick()
    }
    const resize = () => {
      // A queued observer can arrive after React removes a preview but before effect cleanup.
      // Detached canvases have no inherited palette; painting one would pass empty colors to
      // CanvasGradient and turn an ordinary account/screen transition into an uncaught error.
      if (disposed || !canvas.isConnected || !visible || document.hidden) return
      const started = performance.now()
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const nextWidth = rect.width
      const nextHeight = rect.height
      // Match the reviewed material bound: previews and long app surfaces never retain more than
      // 900,000 material pixels, even on a high-density display.
      const ratio = Math.min(
        1.5,
        window.devicePixelRatio || 1,
        Math.sqrt(900_000 / (nextWidth * nextHeight)),
      )
      const styles = getComputedStyle(canvas)
      const value = (key: string) => styles.getPropertyValue(key).trim()
      const nextPalette: RoomPalette = {
        base: value('--bg0'),
        depth: value('--bg1'),
        ink: value('--ink'),
        gold: value('--gold'),
        accent: value('--primary'),
        paper: value('--card-solid'),
        star: value('--star'),
        fog: value('--fog'),
        vignette: value('--vignette'),
        glowA: value('--glow-a'),
        glowB: value('--glow-b'),
        glowC: value('--glow-c'),
        glowD: value('--glow-d'),
      }
      // ResizeObserver delivers initially even if resize() already painted this geometry.
      // Font/layout changes may also deliver the same box. Reuse the still, including on re-entry.
      const nextKey = JSON.stringify([nextWidth, nextHeight, ratio, nextPalette])
      if (nextKey === materialKey) return
      width = nextWidth
      height = nextHeight
      palette = nextPalette
      canvas.width = still.width = Math.max(1, Math.floor(width * ratio))
      canvas.height = still.height = Math.max(1, Math.floor(height * ratio))
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      canvas.dataset.renderer = paintRoomMaterial(still, skin, mode, palette, width)
      materialKey = nextKey
      canvas.dataset.materialPixels = String(still.width * still.height)
      canvas.dataset.paintMs = (performance.now() - started).toFixed(1)
      start()
    }
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    const intersection =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? false
            if (visible) resize()
            start()
          })
    const visibility = () => {
      if (!document.hidden && visible) resize()
      start()
    }
    resizeObserver?.observe(canvas)
    intersection?.observe(canvas)
    if (!resizeObserver) window.addEventListener('resize', resize)
    motion.addEventListener('change', start)
    document.addEventListener('visibilitychange', visibility)
    resize()
    return () => {
      disposed = true
      cancel()
      resizeObserver?.disconnect()
      intersection?.disconnect()
      window.removeEventListener('resize', resize)
      motion.removeEventListener('change', start)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [skin, mode, adaptiveBundle])
  return (
    <canvas
      ref={canvasRef}
      data-testid="skin-atmosphere"
      data-atmosphere={ROOM_SCENES[skin]}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
