import { useEffect, type ReactNode } from 'react'
import { SKINS, type SkinId, type ResolvedMode } from '@reverie/core'
import { loadSkinFont } from '../../skin/fonts'
import { SkinPreviewContext } from '../../skin/SkinPreviewContext'
import { SkinAtmosphereCanvas } from '../../components/SkinAtmosphereCanvas'

export interface RoomSelection {
  skin: SkinId
  mode: ResolvedMode
}

export function ReadingRoomPreview({
  skin,
  mode,
  children,
  className = '',
}: RoomSelection & { children: ReactNode; className?: string }) {
  useEffect(() => loadSkinFont(skin), [skin])
  return (
    <SkinPreviewContext.Provider value={skin}>
      <div className="rv-reading-window" data-skin={skin} data-mode={mode}>
        <div
          data-skin={skin}
          data-mode={mode}
          data-testid="room-example"
          className={`rv-reading-window-surface relative isolate overflow-hidden bg-bg0 text-ink ${className}`}
          style={{ fontFamily: 'var(--font-sans)' }}
        >
          <SkinAtmosphereCanvas skin={skin} mode={mode} />
          <div className="relative z-[1]">{children}</div>
        </div>
      </div>
    </SkinPreviewContext.Provider>
  )
}

export function RoomCaption({ skin, mode }: RoomSelection) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 text-sm leading-relaxed text-muted">
      <span>
        {SKINS[skin].label} · {mode === 'dark' ? 'Night' : 'Day'}
      </span>
      <a
        className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4"
        href="#skins"
      >
        Change the room ↓
      </a>
    </div>
  )
}
