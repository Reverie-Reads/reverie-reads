import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SkinAtmosphereCanvas } from './SkinAtmosphereCanvas'

const painting = vi.hoisted(() => ({
  material: vi.fn<typeof import('./roomMaterials').paintRoomMaterial>(() => 'canvas'),
  motion: vi.fn(),
}))
vi.mock('./roomMaterials', () => ({
  paintRoomMaterial: painting.material,
  paintRoomMotion: painting.motion,
  ROOM_SCENES: { folio: 'paper' },
}))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  painting.material.mockClear()
  painting.motion.mockClear()
})

function observeRoom() {
  let resize: ResizeObserverCallback | undefined
  let intersection: IntersectionObserverCallback | undefined
  let width = 400
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersection = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width, height: 300 }) as DOMRect,
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  return {
    resize: () => resize?.([], {} as ResizeObserver),
    intersect: (isIntersecting: boolean) =>
      intersection?.([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    setWidth: (value: number) => {
      width = value
    },
  }
}

it('does not paint an offscreen room until it enters the viewport, then uses its latest size', () => {
  const observer = observeRoom()
  const { unmount } = render(<SkinAtmosphereCanvas skin="folio" mode="light" />)
  expect(painting.material).not.toHaveBeenCalled()
  observer.intersect(false)
  observer.setWidth(600)
  observer.resize()
  expect(painting.material).not.toHaveBeenCalled()
  observer.intersect(true)
  expect(painting.material).toHaveBeenCalledTimes(1)
  expect(painting.material.mock.calls[0]?.[4]).toBe(600)
  unmount()
})

it('paints once for identical resize deliveries and repaints only changed visible geometry', () => {
  const observer = observeRoom()
  const { unmount } = render(<SkinAtmosphereCanvas skin="folio" mode="light" />)
  observer.intersect(true)
  expect(painting.material).toHaveBeenCalledTimes(1)
  observer.resize() // ResizeObserver always delivers once after observe(), even without a resize.
  observer.resize()
  observer.intersect(true)
  expect(painting.material).toHaveBeenCalledTimes(1)
  observer.intersect(false)
  observer.setWidth(600)
  observer.resize()
  expect(painting.material).toHaveBeenCalledTimes(1)
  observer.intersect(true)
  expect(painting.material).toHaveBeenCalledTimes(2)
  unmount()
  observer.intersect(true)
  observer.resize()
  expect(painting.material).toHaveBeenCalledTimes(2)
})

it('defers hidden-tab resize work and refreshes the visible room on return', () => {
  const observer = observeRoom()
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false)
  const { unmount } = render(<SkinAtmosphereCanvas skin="folio" mode="light" />)
  observer.intersect(true)
  expect(painting.material).toHaveBeenCalledTimes(1)
  hidden.mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  observer.setWidth(600)
  observer.resize()
  expect(painting.material).toHaveBeenCalledTimes(1)
  hidden.mockReturnValue(false)
  document.dispatchEvent(new Event('visibilitychange'))
  expect(painting.material).toHaveBeenCalledTimes(2)
  unmount()
})

it('ignores observer deliveries after a room preview is detached, including before effect cleanup', () => {
  let resize: ResizeObserverCallback | undefined
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback
      }
      observe() {}
      disconnect() {}
    },
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    setTransform: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 400,
    height: 300,
  } as DOMRect)

  const { getByTestId, unmount } = render(<SkinAtmosphereCanvas skin="folio" mode="light" />)
  const canvas = getByTestId('skin-atmosphere')
  expect(painting.material).toHaveBeenCalled()
  const painted = painting.material.mock.calls.length

  // The browser can queue a zero-size resize when React removes a preview. That delivery
  // precedes passive effect cleanup, so disconnecting in cleanup alone cannot protect it.
  const parent = canvas.parentElement!
  canvas.remove()
  resize?.([], {} as ResizeObserver)
  expect(painting.material).toHaveBeenCalledTimes(painted)
  parent.append(canvas)
  unmount()
  resize?.([], {} as ResizeObserver)
  expect(painting.material).toHaveBeenCalledTimes(painted)
})
