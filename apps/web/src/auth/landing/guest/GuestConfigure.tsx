import { useState } from 'react'
import { useGuestLibrary } from './context'
import { GUEST_PRESETS, GUEST_VIEWS, type GuestView } from './state'
import { primary, quiet } from './styles'

export function GuestConfigure() {
  const { state, dispatch } = useGuestLibrary()
  const [dock, setDock] = useState([...state.dock])
  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted">
          Personalization preview
        </p>
        <h4
          className="mt-2 text-xl font-semibold leading-snug"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Make room for the way you read.
        </h4>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Try a starting arrangement, then move or hide destinations. It changes this guest dock now
          and comes with your books only if you choose to bring this library into an account.
        </p>
      </div>
      <div className="grid gap-2">
        {GUEST_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            className={`${quiet} text-left`}
            aria-pressed={dock.join() === preset.dock.join()}
            onClick={() => setDock([...preset.dock])}
          >
            <span className="block">
              {dock.join() === preset.dock.join() && (
                <span aria-hidden="true" className="mr-2">
                  ✓
                </span>
              )}
              {preset.name}
            </span>
            <span className="mt-1 block font-normal text-muted">{preset.note}</span>
          </button>
        ))}
      </div>
      <ol className="space-y-2">
        {dock.map((id, index) => (
          <li
            key={id}
            className="skin-card flex flex-wrap items-center justify-between gap-2 border border-line bg-[color:var(--card-solid)] p-2 text-sm"
          >
            <span className="px-1 font-semibold">
              {index + 1}. {GUEST_VIEWS[id]}
            </span>
            <span className="flex flex-wrap gap-1">
              {([-1, 1] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  className={quiet}
                  aria-label={`Move ${GUEST_VIEWS[id]} ${direction === -1 ? 'earlier' : 'later'}`}
                  disabled={index + direction < 0 || index + direction >= dock.length}
                  onClick={() => {
                    const next = [...dock]
                    ;[next[index], next[index + direction]] = [
                      next[index + direction]!,
                      next[index]!,
                    ]
                    setDock(next)
                  }}
                >
                  {direction === -1 ? '↑' : '↓'}
                </button>
              ))}
              {id !== 'library' && (
                <button
                  type="button"
                  className={quiet}
                  aria-label={`Hide ${GUEST_VIEWS[id]}`}
                  onClick={() => setDock(dock.filter((item) => item !== id))}
                >
                  Hide
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(GUEST_VIEWS) as GuestView[])
          .filter((id) => !dock.includes(id))
          .map((id) => (
            <button key={id} type="button" className={quiet} onClick={() => setDock([...dock, id])}>
              Add {GUEST_VIEWS[id]}
            </button>
          ))}
      </div>
      <button
        type="button"
        className={primary}
        onClick={() => dispatch({ type: 'configure', dock })}
      >
        Use this arrangement
      </button>
    </div>
  )
}
