import { useState, type ReactNode } from 'react'
import { useReadingMode } from '../design/useReadingMode'

/** Native disclosure for secondary information, never for a save, error or primary read action. */
export function ReadingSection({
  id,
  title,
  children,
  alwaysOpen = false,
  className = 'mt-8 border-t border-line pt-6',
}: {
  id: string
  title: string
  children: ReactNode
  alwaysOpen?: boolean
  className?: string
}) {
  const { mode } = useReadingMode()
  const [expanded, setExpanded] = useState(false)
  const simple = mode === 'bearded' && !alwaysOpen
  const heading = (
    <h2
      id={id}
      className="text-[20px] font-semibold leading-snug text-ink"
      style={{ fontFamily: 'var(--font-display)' }}
    >
      {title}
    </h2>
  )
  // Keep the children in one stable tree, including across mode changes from another tab.
  // A disclosure may close; an edition editor or form draft must never be recreated.
  return (
    <section aria-labelledby={simple ? `${id}-disclosure` : id} className={className}>
      <div className="mb-4" hidden={simple}>
        {heading}
      </div>
      <details
        open={!simple || expanded}
        onToggle={(event) => {
          if (simple) setExpanded(event.currentTarget.open)
        }}
      >
        <summary
          hidden={!simple}
          className="min-h-12 cursor-pointer text-[20px] font-semibold leading-snug text-ink"
          id={`${id}-disclosure`}
        >
          {title}
        </summary>
        <div className={simple ? 'pt-4' : undefined}>{children}</div>
      </details>
    </section>
  )
}
