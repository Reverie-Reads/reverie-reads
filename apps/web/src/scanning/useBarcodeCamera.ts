import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createBarcodeDecoder } from './barcodeDecoder'

/** Owns one camera generation. Stop/unmount/backgrounding invalidate even pending permissions. */
export function useBarcodeCamera(
  video: RefObject<HTMLVideoElement | null>,
  onFrame: (values: string[]) => void,
) {
  const [state, setState] = useState<'off' | 'starting' | 'running'>('off')
  const [error, setError] = useState('')
  const generation = useRef(0)
  const stream = useRef<MediaStream | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const frame = useRef(onFrame)
  useEffect(() => {
    frame.current = onFrame
  }, [onFrame])
  const release = useCallback(() => {
    generation.current++
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }, [video])
  const stop = useCallback(() => {
    release()
    setState('off')
  }, [release])
  useEffect(() => {
    const hide = () => {
      if (document.hidden) stop()
    }
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      window.removeEventListener('pagehide', stop)
      release()
    }
  }, [release, stop])

  const start = async () => {
    release()
    const run = generation.current
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setState('off')
      setError(
        'Camera scanning needs HTTPS and camera access. Type an ISBN or use a connected scanner below.',
      )
      return
    }
    setState('starting')
    try {
      const decode = await createBarcodeDecoder()
      if (run !== generation.current) return
      const opened = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })
      if (run !== generation.current) {
        opened.getTracks().forEach((track) => track.stop())
        return
      }
      stream.current = opened
      const element = video.current
      if (!element) {
        stop()
        return
      }
      opened.getVideoTracks().forEach((track) =>
        track.addEventListener(
          'ended',
          () => {
            if (run !== generation.current) return
            stop()
            setError(
              'Camera disconnected. Your captured barcodes are still here. Restart or type an ISBN.',
            )
          },
          { once: true },
        ),
      )
      element.srcObject = opened
      await element.play()
      if (run !== generation.current) return
      setState('running')
      let failures = 0
      const tick = async () => {
        if (run !== generation.current) return
        if (element.readyState >= 2) {
          try {
            const values = await decode(element)
            if (run !== generation.current) return
            failures = 0
            frame.current(values)
          } catch {
            if (run !== generation.current) return
            if (++failures >= 3) {
              stop()
              setError(
                'The camera could not read frames. Restart it or enter the ISBN below. Your batch is unchanged.',
              )
              return
            }
          }
        }
        if (run === generation.current) timer.current = setTimeout(() => void tick(), 250)
      }
      void tick()
    } catch (cause) {
      if (run !== generation.current) return
      stop()
      const name = (cause as Error).name
      setError(
        name === 'NotAllowedError'
          ? 'Camera permission was declined. Allow it in browser settings, or type an ISBN below.'
          : 'Camera unavailable. Check that another app is not using it, or enter an ISBN below.',
      )
    }
  }
  return { state, error, start, stop }
}
