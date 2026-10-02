import { useEffect, useRef } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { Modal } from './Modal'

/** Protect in-app exits. Drafts remain page-session state, not durable or cross-device saves. */
export function DraftExitGuard({
  busy = false,
  canLeave,
}: {
  busy?: boolean
  canLeave?: () => boolean
}) {
  const blocker = useBlocker({
    shouldBlockFn: () => !canLeave?.(),
    withResolver: true,
    enableBeforeUnload: false,
  })
  const cancel = useRef(blocker.reset)
  useEffect(() => {
    cancel.current = blocker.reset
  }, [blocker.reset])
  useEffect(() => () => cancel.current?.(), [])
  if (blocker.status !== 'blocked') return null
  return (
    <Modal title={busy ? 'Saving your book' : 'Leave this draft?'} onClose={blocker.reset}>
      <p className="text-[14px] text-ink">
        {busy
          ? 'Wait for the save to finish before leaving.'
          : 'Your changes have not all been saved. Leaving will close this draft.'}
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={blocker.reset}
          className="skin-control skin-btn-primary min-h-11 px-4"
        >
          Keep editing
        </button>
        {!busy && (
          <button
            type="button"
            onClick={blocker.proceed}
            className="skin-control skin-btn-secondary min-h-11 px-4"
          >
            Leave draft
          </button>
        )}
      </div>
    </Modal>
  )
}
