import { useId, useState, type CSSProperties } from 'react'
import { useReadingMode } from '../design/useReadingMode'
import { BEARD_COLORS, BEARD_STYLES, type BeardAppearance } from '../design/beardAppearance'
import { BeardGlyph } from './BeardGlyph'
import { Modal } from './Modal'
import { Button } from './Button'

/** A small optional portrait editor. Nothing is saved until the reader chooses Use this beard. */
export function BeardChooser({ className = '' }: { className?: string }) {
  const { beard, setBeard, storageUnavailable } = useReadingMode()
  const [draft, setDraft] = useState<BeardAppearance | null>(null)
  const groupId = useId()
  return (
    <>
      <button
        type="button"
        className={`beard-chooser-trigger ${className}`}
        aria-label="Choose your beard"
        aria-haspopup="dialog"
        onClick={() => setDraft(beard)}
      >
        <BeardGlyph appearance={beard} className="h-full w-full" />
        <span aria-hidden="true" className="beard-chooser-hint">
          Choose your beard
        </span>
      </button>
      {draft && (
        <Modal wide title="Choose your beard" onClose={() => setDraft(null)}>
          <div className="beard-picker">
            <div className="flex flex-col items-center gap-2 pb-3">
              <BeardGlyph appearance={draft} className="h-20 w-[72px]" />
              <p className="text-[14px] text-muted">
                {BEARD_STYLES.find((entry) => entry.id === draft.style)?.label} ·{' '}
                {BEARD_COLORS.find((entry) => entry.id === draft.color)?.label}
              </p>
            </div>
            <fieldset>
              <legend className="text-[16px] font-semibold text-ink">Style</legend>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {BEARD_STYLES.map((entry) => (
                  <label
                    key={entry.id}
                    className="beard-picker-option"
                    data-selected={draft.style === entry.id}
                  >
                    <input
                      type="radio"
                      name={`${groupId}-style`}
                      checked={draft.style === entry.id}
                      onChange={() => setDraft({ ...draft, style: entry.id })}
                      className="sr-only"
                    />
                    <BeardGlyph appearance={{ ...draft, style: entry.id }} className="h-10 w-9" />
                    <span>{entry.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="mt-5">
              <legend className="text-[16px] font-semibold text-ink">Color</legend>
              <div className="beard-colors-grid mt-3 grid grid-cols-4 gap-2 sm:grid-cols-8">
                {BEARD_COLORS.map((entry) => (
                  <label
                    key={entry.id}
                    className="beard-picker-option"
                    data-selected={draft.color === entry.id}
                  >
                    <input
                      type="radio"
                      name={`${groupId}-color`}
                      checked={draft.color === entry.id}
                      onChange={() => setDraft({ ...draft, color: entry.id })}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="beard-color-swatch"
                      style={{ background: `var(${entry.hair})` } as CSSProperties}
                    />
                    <span>{entry.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="beard-picker-actions mt-5 flex flex-wrap gap-2">
              <p className="w-full text-[13px] leading-relaxed text-muted">
                Remembered in this browser. Your room stays the same.
              </p>
              {storageUnavailable && (
                <p role="status" className="w-full text-[14px] text-ink">
                  This browser could not remember the choice. It will apply until you leave or
                  reload.
                </p>
              )}
              <Button
                onClick={() => {
                  if (setBeard(draft)) setDraft(null)
                }}
              >
                Use this beard
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
