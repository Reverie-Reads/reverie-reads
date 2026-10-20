type Frame = { payload: { toString(): string } }
type Socket = {
  on(event: 'framereceived', listener: (frame: Frame) => void): unknown
  off(event: 'framereceived', listener: (frame: Frame) => void): unknown
}
type Page = {
  on(event: 'websocket', listener: (socket: Socket) => void): unknown
  off(event: 'websocket', listener: (socket: Socket) => void): unknown
}

/** Observe before navigation so an early acknowledgement cannot be missed. Start the unchanged
 * 20-second subscription deadline only when the caller has reached the ready application. */
export function observeLibrarySubscription(page: Page, uid: string): () => Promise<void> {
  const listeners = new Map<Socket, (frame: Frame) => void>()
  let joined = false
  let notify: () => void = () => {}
  const acknowledgement = new Promise<void>((resolve) => {
    notify = resolve
  })
  const socketOpened = (socket: Socket) => {
    const received = ({ payload }: Frame) => {
      const frame = payload.toString()
      if (
        frame.includes(`realtime:library:${uid}`) &&
        frame.includes('phx_reply') &&
        frame.includes('"status":"ok"')
      ) {
        joined = true
        notify()
      }
    }
    listeners.set(socket, received)
    socket.on('framereceived', received)
  }
  page.on('websocket', socketOpened)
  return async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (!joined)
        await Promise.race([
          acknowledgement,
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('The app did not join its private library channel')),
              20_000,
            )
          }),
        ])
    } finally {
      clearTimeout(timer)
      page.off('websocket', socketOpened)
      for (const [socket, listener] of listeners) socket.off('framereceived', listener)
    }
  }
}
