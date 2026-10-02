import { render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SkinAtmosphereCanvas } from './SkinAtmosphereCanvas'

const painting = vi.hoisted(() => ({ material: vi.fn(() => 'canvas'), motion: vi.fn() }))
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

it('ignores observer deliveries after a room preview is detached, including before effect cleanup', () => {
  let resize: ResizeObserverCallback | undefined
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
