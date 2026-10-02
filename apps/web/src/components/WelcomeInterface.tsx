import { APP_NAME } from '@reverie/core'
import { Button } from './Button'
import { Label } from './Label'
import { ReadingModeChoice } from './ReadingModeChoice'

/** First welcome choice; it changes presentation only, before guidance or any library write. */
export function WelcomeInterface({ onContinue }: { onContinue: () => void }) {
  return (
    <>
      <Label className="block text-[12px] text-muted">Welcome to {APP_NAME}</Label>
      <h1
        className="mt-3 text-[34px] leading-[1.15] text-ink"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        Make this your library.
      </h1>
      <div className="mt-6">
        <ReadingModeChoice />
      </div>
      <Button className="mt-6" onClick={onContinue}>
        Continue
      </Button>
    </>
  )
}
