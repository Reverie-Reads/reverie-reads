import { useEffect, useMemo, useState } from 'react'
import {
  ARRANGEMENT_DESTINATIONS,
  ARRANGEMENT_PRESETS,
  DEFAULT_ARRANGEMENT_PRESET,
  HOME_MODULES,
  MAX_PRIORITY_DESTINATIONS,
  arrangementsEqual,
  cloneArrangement,
  hideDestination,
  moveItem,
  restoreDestination,
  type ArrangementConfig,
  type ArrangementDestinationId,
  type HomeModuleId,
} from '../design/arrangements'
import { useProfile, useUpdateProfile } from '../data/profile'
import { NavigationGlyph } from './NavigationGlyph'

const rowClass =
  'skin-card flex min-h-14 items-center gap-2 border border-line px-3 py-2 text-[13px] text-ink'
const iconButton =
  'skin-control skin-btn-secondary grid h-11 w-11 flex-none place-items-center text-[12px] disabled:opacity-35'

function destination(id: ArrangementDestinationId) {
  return ARRANGEMENT_DESTINATIONS.find((item) => item.id === id)!
}

function module(id: HomeModuleId) {
  return HOME_MODULES.find((item) => item.id === id)!
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    window.addEventListener('online', sync)
    window.addEventListener('offline', sync)
    return () => {
      window.removeEventListener('online', sync)
      window.removeEventListener('offline', sync)
    }
  }, [])
  return online
}

export function ArrangementEditor() {
  const profileQuery = useProfile()
  const { data: profile } = profileQuery
  const updateProfile = useUpdateProfile()
  const server = profile?.arrangement ?? DEFAULT_ARRANGEMENT_PRESET.config
  const [saved, setSaved] = useState<ArrangementConfig>(() => cloneArrangement(server))
  const [draft, setDraft] = useState<ArrangementConfig>(() => cloneArrangement(server))
  const [status, setStatus] = useState('')
  const online = useOnline()

  const serverKey = JSON.stringify(server)
  useEffect(() => {
    setSaved(cloneArrangement(server))
    setDraft(cloneArrangement(server))
    // serverKey is the stable value boundary; `server` is rebuilt only when the profile query lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, serverKey])

  useEffect(() => setStatus(''), [profile?.id])

  const dirty = !arrangementsEqual(draft, saved)
  const complete = draft.destinations.length === MAX_PRIORITY_DESTINATIONS
  const preset = ARRANGEMENT_PRESETS.find((item) => arrangementsEqual(item.config, draft))
  const hiddenDestinations = ARRANGEMENT_DESTINATIONS.filter(
    (item) => !draft.destinations.includes(item.id),
  )
  const hiddenModules = HOME_MODULES.filter((item) => !draft.homeModules.includes(item.id))
  const previewItems = useMemo(
    () => draft.destinations.map((id) => destination(id)),
    [draft.destinations],
  )

  if (profileQuery.isPending) {
    return (
      <p role="status" className="text-[13px] text-muted">
        Preparing your saved arrangement…
      </p>
    )
  }

  if (profileQuery.isError) {
    return (
      <div>
        <p role="status" className="text-[13px] text-muted">
          Your arrangement could not be loaded.
        </p>
        <button
          type="button"
          className="skin-control skin-btn-secondary mt-3 min-h-11 px-4 text-[13px]"
          onClick={() => void profileQuery.refetch()}
        >
          Try again
        </button>
      </div>
    )
  }

  const announce = (message: string) => setStatus(message)
  const change = (next: ArrangementConfig, message: string) => {
    setDraft(next)
    announce(message)
  }

  const save = () => {
    if (!online || !complete || !dirty || updateProfile.isPending) return
    const next = cloneArrangement(draft)
    updateProfile.mutate(
      { arrangement: next },
      {
        onSuccess: () => {
          setSaved(next)
          announce('Arrangement saved. It will follow this account across devices.')
        },
        onError: () =>
          announce('The arrangement could not be saved. Your previous layout is kept.'),
      },
    )
  }

  return (
    <div>
      <p className="text-[13px] leading-relaxed text-muted">
        Choose the three places kept close in navigation, then order what greets you on Home. Books,
        notes, and hidden areas are never removed.
      </p>

      <div className="mt-4">
        <div className="skin-label text-[11px] text-muted">Starting arrangement</div>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {ARRANGEMENT_PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={preset?.id === item.id}
              onClick={() => change(cloneArrangement(item.config), `Previewing ${item.label}.`)}
              className="skin-control skin-btn-secondary min-h-16 px-3 py-2 text-left"
              style={preset?.id === item.id ? { outline: '2px solid var(--primary)' } : undefined}
            >
              <span className="block text-[13px] font-semibold text-ink">{item.label}</span>
              <span className="mt-1 block text-[11px] leading-[1.4] text-muted">
                {item.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <div className="flex items-end justify-between gap-2">
            <div className="skin-label text-[11px] text-muted">Close at hand</div>
            <div className="text-[11px] text-muted">
              {draft.destinations.length}/{MAX_PRIORITY_DESTINATIONS}
            </div>
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Library stays anchored. Add and More remain fixed.
          </p>
          <ol className="mt-2 space-y-2">
            {draft.destinations.map((id, index) => {
              const item = destination(id)
              return (
                <li key={id} className={rowClass}>
                  <NavigationGlyph name={item.icon} className="h-5 w-5 flex-none" />
                  <span className="min-w-0 flex-1 font-semibold">{item.label}</span>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === 0}
                    aria-label={`Move ${item.label} earlier`}
                    onClick={() =>
                      change(
                        { ...draft, destinations: moveItem(draft.destinations, index, -1) },
                        `${item.label} moved earlier.`,
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === draft.destinations.length - 1}
                    aria-label={`Move ${item.label} later`}
                    onClick={() =>
                      change(
                        { ...draft, destinations: moveItem(draft.destinations, index, 1) },
                        `${item.label} moved later.`,
                      )
                    }
                  >
                    ↓
                  </button>
                  {id === 'library' ? (
                    <span className="w-14 text-center text-[10px] uppercase tracking-wider text-muted">
                      Anchor
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="skin-control skin-btn-secondary min-h-11 w-14 px-2 text-[11px]"
                      aria-label={`Hide ${item.label} from close at hand`}
                      onClick={() =>
                        change(hideDestination(draft, id), `${item.label} moved to More.`)
                      }
                    >
                      Hide
                    </button>
                  )}
                </li>
              )
            })}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            {hiddenDestinations.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={complete}
                className="skin-control skin-btn-secondary min-h-11 px-3 text-[12px] disabled:opacity-40"
                onClick={() =>
                  change(
                    restoreDestination(draft, item.id),
                    `${item.label} restored to navigation.`,
                  )
                }
              >
                + {item.label}
              </button>
            ))}
          </div>
          {!complete && (
            <p className="mt-2 text-[12px] text-[color:var(--accent-ink)]">
              Choose one more destination before saving.
            </p>
          )}
        </div>

        <div>
          <div className="skin-label text-[11px] text-muted">Home modules</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Navigation and Home stay independent.
          </p>
          <ol className="mt-2 space-y-2">
            {draft.homeModules.map((id, index) => {
              const item = module(id)
              return (
                <li key={id} className={rowClass}>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{item.label}</span>
                    <span className="mt-0.5 block text-[11px] leading-[1.4] text-muted">
                      {item.description}
                    </span>
                  </span>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === 0}
                    aria-label={`Move ${item.label} earlier`}
                    onClick={() =>
                      change(
                        { ...draft, homeModules: moveItem(draft.homeModules, index, -1) },
                        `${item.label} moved earlier.`,
                      )
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={iconButton}
                    disabled={index === draft.homeModules.length - 1}
                    aria-label={`Move ${item.label} later`}
                    onClick={() =>
                      change(
                        { ...draft, homeModules: moveItem(draft.homeModules, index, 1) },
                        `${item.label} moved later.`,
                      )
                    }
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="skin-control skin-btn-secondary min-h-11 w-14 px-2 text-[11px]"
                    aria-label={`Hide ${item.label} from Home`}
                    onClick={() =>
                      change(
                        {
                          ...draft,
                          homeModules: draft.homeModules.filter((candidate) => candidate !== id),
                        },
                        `${item.label} hidden from Home.`,
                      )
                    }
                  >
                    Hide
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="mt-3 flex flex-wrap gap-2">
            {hiddenModules.map((item) => (
              <button
                key={item.id}
                type="button"
                className="skin-control skin-btn-secondary min-h-11 px-3 text-[12px]"
                onClick={() =>
                  change(
                    { ...draft, homeModules: [...draft.homeModules, item.id] },
                    `${item.label} restored to Home.`,
                  )
                }
              >
                + {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="skin-label text-[11px] text-muted">Phone preview</div>
        <div className="rv-mobile-dock mt-2 grid grid-cols-5 overflow-hidden border border-line">
          {[previewItems[0], previewItems[1]].map((item) =>
            item ? (
              <div
                key={item.id}
                className="grid min-h-[62px] place-items-center px-1 py-2 text-center"
              >
                <NavigationGlyph name={item.icon} className="h-5 w-5" />
                <span className="skin-label text-[10px]">{item.label}</span>
              </div>
            ) : (
              <span key="empty-leading" aria-hidden />
            ),
          )}
          <div className="grid min-h-[62px] place-items-center px-1 py-2 text-center">
            <span className="text-[18px]" aria-hidden>
              ＋
            </span>
            <span className="skin-label text-[10px]">Add</span>
          </div>
          {previewItems[2] ? (
            <div className="grid min-h-[62px] place-items-center px-1 py-2 text-center">
              <NavigationGlyph name={previewItems[2].icon} className="h-5 w-5" />
              <span className="skin-label text-[10px]">{previewItems[2].label}</span>
            </div>
          ) : (
            <span aria-hidden />
          )}
          <div className="grid min-h-[62px] place-items-center px-1 py-2 text-center">
            <span className="text-[18px]" aria-hidden>
              ⋯
            </span>
            <span className="skin-label text-[10px]">More</span>
          </div>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          className="skin-control skin-btn-primary min-h-11 px-4 text-[13px] font-semibold disabled:opacity-40"
          disabled={!dirty || !complete || !online || updateProfile.isPending}
          onClick={save}
        >
          {updateProfile.isPending ? 'Saving…' : 'Save arrangement'}
        </button>
        <button
          type="button"
          className="skin-control skin-btn-secondary min-h-11 px-4 text-[13px]"
          disabled={!dirty || updateProfile.isPending}
          onClick={() => {
            setDraft(cloneArrangement(saved))
            announce('Unsaved arrangement changes cancelled.')
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="skin-control skin-btn-secondary min-h-11 px-4 text-[13px]"
          disabled={updateProfile.isPending}
          onClick={() =>
            change(
              cloneArrangement(DEFAULT_ARRANGEMENT_PRESET.config),
              'Default arrangement ready. Save to keep it.',
            )
          }
        >
          Restore default
        </button>
      </div>
      {!online && (
        <p className="mt-3 text-[12px] text-muted">
          Reconnect to save an arrangement. Your current saved layout remains available offline.
        </p>
      )}
      {status && (
        <p role="status" aria-live="polite" className="mt-3 text-[12px] text-muted">
          {status}
        </p>
      )}
    </div>
  )
}
