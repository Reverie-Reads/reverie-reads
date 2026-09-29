import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBarcodeCamera } from './useBarcodeCamera'
const decode = vi.hoisted(() => vi.fn())
vi.mock('./barcodeDecoder', () => ({ createBarcodeDecoder: async () => decode }))
const media = vi.fn()
let stop: ReturnType<typeof vi.fn>
function setup() {
  stop = vi.fn()
  const track = { stop, addEventListener: vi.fn() }
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
  const video = {
    current: {
      play: vi.fn().mockResolvedValue(undefined),
      readyState: 2,
      srcObject: null,
    } as unknown as HTMLVideoElement,
  }
  return { video, stream }
}
beforeEach(() => {
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: media },
  })
  decode.mockReset().mockResolvedValue([])
  media.mockReset()
})
afterEach(() => vi.unstubAllGlobals())
describe('camera ownership', () => {
  it('releases a permission request that finishes after cancellation', async () => {
    const { video, stream } = setup()
    let resolve!: (value: MediaStream) => void
    media.mockImplementation(
      () =>
        new Promise<MediaStream>((done) => {
          resolve = done
        }),
    )
    const frame = vi.fn()
    const { result } = renderHook(() => useBarcodeCamera(video, frame))
    let starting!: Promise<void>
    act(() => {
      starting = result.current.start()
    })
    await waitFor(() => expect(media).toHaveBeenCalled())
    act(() => result.current.stop())
    await act(async () => {
      resolve(stream)
      await starting
    })
    expect(stop).toHaveBeenCalledTimes(1)
    expect(video.current.srcObject).toBeNull()
    expect(frame).not.toHaveBeenCalled()
  })
  it('ignores a decoded frame completing after unmount and stops every track', async () => {
    const { video, stream } = setup()
    media.mockResolvedValue(stream)
    let resolve!: (value: string[]) => void
    decode.mockImplementation(
      () =>
        new Promise<string[]>((done) => {
          resolve = done
        }),
    )
    const frame = vi.fn()
    const { result, unmount } = renderHook(() => useBarcodeCamera(video, frame))
    await act(async () => {
      await result.current.start()
    })
    await waitFor(() => expect(decode).toHaveBeenCalled())
    unmount()
    await act(async () => resolve(['9780141439518']))
    expect(frame).not.toHaveBeenCalled()
    expect(stop).toHaveBeenCalledTimes(1)
  })
  it('shows permission denial without fabricating a capture', async () => {
    const { video } = setup()
    media.mockRejectedValue(new DOMException('Denied', 'NotAllowedError'))
    const frame = vi.fn()
    const { result } = renderHook(() => useBarcodeCamera(video, frame))
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.error).toMatch(/permission was declined/)
    expect(result.current.state).toBe('off')
    expect(frame).not.toHaveBeenCalled()
  })
})
