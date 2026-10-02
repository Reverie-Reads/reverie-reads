import { useEffect, useId, useState } from 'react'
import { APP_NAME } from '@reverie/core'

type InstallDevice = 'apple' | 'android' | 'computer'
const DEVICES: readonly { id: InstallDevice; label: string }[] = [
  { id: 'apple', label: 'iPhone or iPad' },
  { id: 'android', label: 'Android' },
  { id: 'computer', label: 'Computer' },
]
const APPLE_HELP = 'https://support.apple.com/guide/iphone/iphea86e5236/ios'
const CHROME_HELP = 'https://support.google.com/chrome/answer/9658361'

function appleStandalone() {
  return (
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}
function installedApp() {
  return (
    appleStandalone() ||
    (typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  )
}
function suggestedDevice(): InstallDevice {
  if (typeof navigator === 'undefined') return 'computer'
  if (
    /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
    return 'apple'
  return /Android/i.test(navigator.userAgent) ? 'android' : 'computer'
}

/** Optional instructions only: no install prompt, account preference or library mutation. */
export function InstallHelp({
  hideWhenInstalled = true,
  className = 'mt-4',
}: {
  hideWhenInstalled?: boolean
  className?: string
}) {
  const [installed, setInstalled] = useState(installedApp)
  const [device, setDevice] = useState(suggestedDevice)
  const groupId = useId()
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(display-mode: standalone)')
    const update = () => setInstalled(query.matches || appleStandalone())
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  if (installed && hideWhenInstalled) return null
  return (
    <details className={`text-left text-[14px] leading-relaxed text-ink ${className}`}>
      <summary className="min-h-11 cursor-pointer py-3 font-semibold underline underline-offset-4">
        {installed ? 'Install and Home Screen help' : `Add ${APP_NAME} to your Home Screen`}
      </summary>
      <div className="mt-2 rounded-[var(--radius-card)] border border-line p-4">
        <p className="text-muted">
          {installed
            ? 'You are already using the app view. You can add it to another device, too.'
            : 'Keep your library one tap away. You can also keep using it in your browser.'}
        </p>
        <fieldset className="mt-4">
          <legend className="font-semibold">Your device</legend>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {DEVICES.map((entry) => (
              <label key={entry.id} className="flex min-h-11 cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name={groupId}
                  checked={device === entry.id}
                  onChange={() => setDevice(entry.id)}
                  className="h-4 w-4"
                />
                {entry.label}
              </label>
            ))}
          </div>
        </fieldset>
        {device === 'apple' ? (
          <>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>Open this website in Safari.</li>
              <li>Tap Share. In Safari’s compact layout, open the Page Menu to find it.</li>
              <li>Scroll the share options and choose Add to Home Screen.</li>
              <li>Turn on Open as Web App if offered, then tap Add.</li>
            </ol>
            <p className="mt-3 text-muted">
              Missing Add to Home Screen? Scroll to Edit Actions at the bottom of the share list and
              add it there.
            </p>
          </>
        ) : device === 'android' ? (
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Open this website in Chrome.</li>
            <li>Open the three-dot menu beside the address bar.</li>
            <li>
              Choose Install and create shortcut, then Install. Older versions may say Add to Home
              screen.
            </li>
            <li>Follow the browser’s confirmation steps.</li>
          </ol>
        ) : (
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Open this website in Chrome on your computer.</li>
            <li>Use Install in the address bar, if shown.</li>
            <li>Or open the three-dot menu, then Cast, save, and share → Install page as app.</li>
            <li>Follow the browser’s confirmation steps.</li>
          </ol>
        )}
        <p className="mt-3 text-muted">
          If your browser does not offer installation, bookmark this page instead.
        </p>
        <a
          href={
            device === 'apple'
              ? APPLE_HELP
              : `${CHROME_HELP}?co=GENIE.Platform%3D${device === 'android' ? 'Android' : 'Desktop'}`
          }
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4"
        >
          {device === 'apple' ? 'Apple’s illustrated instructions' : 'Chrome’s installation help'}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </details>
  )
}
