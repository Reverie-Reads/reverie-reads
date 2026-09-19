import { APP_NAME } from '@reverie/core'
import { MidnihtMark } from '../components/MidnihtMark'

/** The approved reader-and-moon mark; individual rooms keep their own motifs. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2.5 ${className ?? ''}`}>
      <MidnihtMark className="h-9 w-9" />
      <span
        className="text-[24px] leading-[1.2] text-ink"
        style={{ fontFamily: 'var(--font-display)', fontWeight: 500, letterSpacing: '-.3px' }}
      >
        {APP_NAME}
      </span>
    </span>
  )
}
