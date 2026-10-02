import { useId } from 'react'
import { useReadingMode } from '../design/useReadingMode'
import { BeardChooser } from './BeardChooser'

export function ReadingModeChoice() {
  const { mode, setMode, storageUnavailable } = useReadingMode()
  const descriptionId = useId()
  return (
    <fieldset className="reading-mode-choice" aria-describedby={descriptionId}>
      <legend className="text-[18px] font-semibold text-ink">
        How much would you like on screen?
      </legend>
      <p id={descriptionId} className="mt-2 text-[14px] leading-relaxed text-muted">
        Bearded Mode is inspired by the Bearded Bookseller, our admins’ local bookstore owner. Its
        simpler, intuitive layout puts your priorities first. Open more tools whenever you need
        them.
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {(['standard', 'bearded'] as const).map((choice) => (
          <div
            key={choice}
            className="reading-mode-option skin-card flex cursor-pointer items-center gap-3 border border-line p-4 text-ink"
            data-selected={mode === choice}
          >
            <label className="flex min-h-16 min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name={descriptionId}
                value={choice}
                checked={mode === choice}
                onChange={() => setMode(choice)}
                className="h-5 w-5 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold">
                  {choice === 'bearded' ? 'Bearded Mode' : 'Full interface'}
                </span>
                <span className="mt-1 block text-[14px] leading-relaxed text-muted">
                  {choice === 'bearded'
                    ? 'Fewer choices. Larger controls.'
                    : 'Your tools and saved arrangement.'}
                </span>
              </span>
            </label>
            {choice === 'bearded' && <BeardChooser className="h-16 w-14 shrink-0" />}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        You can change this in Settings. The choice is remembered for your account in this browser.
        Your reading room and saved arrangement stay yours.
      </p>
      {storageUnavailable && (
        <p role="status" className="mt-2 text-[14px] text-ink">
          This browser could not remember the choice. It will apply until you leave or reload.
        </p>
      )}
    </fieldset>
  )
}
