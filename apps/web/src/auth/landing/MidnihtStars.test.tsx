import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MidnihtStars } from './MidnihtStars'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function setup(reduce = false) {
  const preference = Object.assign(new EventTarget(), { matches: reduce })
  vi.spyOn(window, 'matchMedia').mockReturnValue(preference as MediaQueryList)
  const paint = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setTransform: vi.fn(),
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    paint as unknown as CanvasRenderingContext2D,
  )
  let hidden = false
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden)
  let intersect: (entries: Array<{ isIntersecting: boolean }>) => void = () => {}
  const disconnect = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect = disconnect
    },
  )
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof intersect) {
        intersect = callback
      }
      observe() {}
      disconnect = disconnect
    },
  )
  let id = 0
  const request = vi.fn(() => ++id)
  const cancel = vi.fn()
  vi.stubGlobal('requestAnimationFrame', request)
  vi.stubGlobal('cancelAnimationFrame', cancel)
  return {
    preference,
    paint,
    request,
    cancel,
    disconnect,
    visibility(next: boolean) {
      hidden = next
      document.dispatchEvent(new Event('visibilitychange'))
    },
    intersection(next: boolean) {
      intersect([{ isIntersecting: next }])
    },
  }
}

describe('Midniht canvas stars', () => {
  it('paints a static sky for reduced motion and never requests an animation frame', () => {
    const { request, paint, preference } = setup(true)
    const { unmount } = render(
      <header>
        <MidnihtStars mode="light" />
      </header>,
    )
    expect(paint.clearRect).toHaveBeenCalled()
    expect(request).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stars still · reduced motion' })).toBeDisabled()
    act(() => {
      preference.matches = false
      preference.dispatchEvent(new Event('change'))
    })
    expect(request).toHaveBeenCalled()
    unmount()
  })
  it('pauses for the reader, hidden tabs and offscreen heroes, and cleans up on unmount', () => {
    const env = setup()
    const { unmount } = render(
      <header>
        <MidnihtStars mode="dark" />
      </header>,
    )
    const canvas = screen.getByTestId('midniht-stars')
    expect(canvas).toHaveAttribute('data-animation', 'running')
    fireEvent.click(screen.getByRole('button', { name: 'Pause stars' }))
    expect(canvas).toHaveAttribute('data-animation', 'static')
    fireEvent.click(screen.getByRole('button', { name: 'Play stars' }))
    act(() => env.visibility(true))
    expect(canvas).toHaveAttribute('data-animation', 'static')
    act(() => env.visibility(false))
    expect(canvas).toHaveAttribute('data-animation', 'running')
    act(() => env.intersection(false))
    expect(canvas).toHaveAttribute('data-animation', 'static')
    act(() => env.intersection(true))
    expect(canvas).toHaveAttribute('data-animation', 'running')
    unmount()
    const requests = env.request.mock.calls.length
    act(() => env.visibility(false))
    expect(env.request).toHaveBeenCalledTimes(requests)
    expect(env.cancel).toHaveBeenCalled()
    expect(env.disconnect).toHaveBeenCalled()
  })
})
