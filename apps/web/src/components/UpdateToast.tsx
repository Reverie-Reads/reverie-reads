import { APP_NAME } from '@reverie/core'
import { useEffect, useState } from 'react'
import { applyUpdate, initUpdateWatch } from '../lib/updates'
import { Surface } from './Surface'

/** Quiet bottom toast when a newer deploy is live — refresh on the reader's terms, never forced
 *  mid-session. Sits above the mobile tab bar; regular bottom margin on desktop. */
export function UpdateToast() {
  const [ready, setReady] = useState(false)

  useEffect(() => initUpdateWatch(() => setReady(true)), [])

  if (!ready) return null
  return (
    <div
      role="status"
      className="fixed inset-x-0 z-[60] flex justify-center px-4 lg:bottom-6"
      style={{ bottom: 'calc(84px + env(safe-area-inset-bottom))' }}
    >
      {/* tone="card-solid" replaces the hand-rolled gradient — §7.4's collapse (see AppShell's
          sheet for the numbers; marrow/dark maxΔ=19 vs Modal's authored plate). radius="panel"
          replaces the pill: tokens.css names --radius-panel "nameplate / stat block / TOAST
          panels", and the pill also disagreed with sibling WriteErrorToast's 16px. Pills survive
          where the skin wants them (tryst/hearth/bloom panel=12-14 is close; the pill was 999). */}
      <Surface
        tone="card-solid"
        radius="panel"
        pad={0}
        raised
        className="flex items-center gap-3 py-2 pl-4 pr-2 text-[13px] text-ink"
      >
        A new version of {APP_NAME} is ready
        <button
          type="button"
          onClick={() => void applyUpdate()}
          className="skin-control px-3.5 py-1.5 text-[12.5px] font-semibold"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          Refresh
        </button>
      </Surface>
    </div>
  )
}
