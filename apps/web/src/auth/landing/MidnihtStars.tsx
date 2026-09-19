import { useEffect, useRef, useState } from 'react'
import type { ResolvedMode } from '@reverie/core'

/** Canvas-only stars, adapted from the accepted Midniht preview. No CSS animation. */
export function MidnihtStars({ mode }: { mode: ResolvedMode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const elapsed = useRef(0)
  const [paused, setPaused] = useState(false)
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(query.matches)
    query.addEventListener('change', sync)
    return () => query.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const hero = canvas?.parentElement
    const context = canvas?.getContext('2d')
    if (!canvas || !hero || !context) return
    let frame: number | undefined
    let last = 0
    let visible = true
    let width = 0
    let height = 0
    let boxes: Array<{ left: number; right: number; top: number; bottom: number }> = []
    let seed = 41
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return (seed - 1) / 2147483646
    }
    const stars = Array.from({ length: 112 }, (_, i) => ({
      x: 0.015 + random() * 0.97,
      y: 0.015 + random() * 0.97,
      radius: 0.6 + random() * 0.85,
      phase: random() * Math.PI * 2,
      period: 3200 + random() * 4400,
      glint: i % 11 === 0,
    }))
    const color = getComputedStyle(hero).getPropertyValue('--midniht-star').trim()
    const draw = () => {
      context.clearRect(0, 0, width, height)
      context.fillStyle = color
      context.strokeStyle = color
      for (const star of stars) {
        const x = star.x * width
        const y = star.y * height
        if (boxes.some((b) => x > b.left && x < b.right && y > b.top && y < b.bottom)) continue
        const wave =
          ((Math.sin((elapsed.current / star.period) * Math.PI * 2 + star.phase) + 1) / 2) ** 1.7
        context.globalAlpha = 0.18 + wave * 0.72
        context.beginPath()
        context.arc(x, y, star.radius * (0.8 + wave * 0.5), 0, Math.PI * 2)
        context.fill()
        if (star.glint) {
          const length = 1.5 + wave * 3.8
          context.globalAlpha *= 0.75
          context.lineWidth = 0.65
          context.beginPath()
          context.moveTo(x - length, y)
          context.lineTo(x + length, y)
          context.moveTo(x, y - length)
          context.lineTo(x, y + length)
          context.stroke()
        }
      }
      context.globalAlpha = 1
    }
    const animate = (time: number) => {
      if (time - last >= 32) {
        if (last) elapsed.current += Math.min(time - last, 100)
        last = time
        draw()
      }
      frame = requestAnimationFrame(animate)
    }
    const sync = () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      frame = undefined
      last = 0
      const running = !paused && !reduced && !document.hidden && visible
      canvas.dataset.animation = running ? 'running' : 'static'
      draw()
      if (running) frame = requestAnimationFrame(animate)
    }
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = rect.width
      height = rect.height
      const ratio = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * ratio)
      canvas.height = Math.round(height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      boxes = Array.from(
        hero.querySelectorAll('.midniht-hero-copy > *, .midniht-hero-art, .midniht-motion'),
      ).map((el) => {
        const b = el.getBoundingClientRect()
        return {
          left: b.left - rect.left - 8,
          right: b.right - rect.left + 8,
          top: b.top - rect.top - 8,
          bottom: b.bottom - rect.top + 8,
        }
      })
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(hero)
    for (const element of hero.querySelectorAll('.midniht-hero-copy, .midniht-hero-art'))
      observer.observe(element)
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? false
      sync()
    })
    intersection.observe(canvas)
    document.addEventListener('visibilitychange', sync)
    resize()
    sync()
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer.disconnect()
      intersection.disconnect()
      document.removeEventListener('visibilitychange', sync)
    }
  }, [mode, paused, reduced])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="midniht-stars"
        aria-hidden="true"
        data-testid="midniht-stars"
        data-renderer="javascript-canvas"
      />
      <button
        className="midniht-motion"
        type="button"
        disabled={reduced}
        aria-pressed={paused || reduced}
        onClick={() => setPaused((value) => !value)}
      >
        {reduced ? 'Stars still · reduced motion' : paused ? 'Play stars' : 'Pause stars'}
      </button>
    </>
  )
}
