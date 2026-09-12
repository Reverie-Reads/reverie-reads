import type { ReactNode } from 'react'
import { ReadingTips } from './ReadingTips'

/** Shared editorial heading for top-level routes. Keeps page identity quiet and skin-led. */
export function PageHeader({
  eyebrow,
  title,
  description,
  descriptionIsTip = false,
  actions,
  showDescriptionOnMobile = false,
  className = '',
}: {
  eyebrow?: ReactNode
  title: ReactNode
  description?: ReactNode
  /** Opt in only for introductions; scope, privacy and other essential explanations stay visible. */
  descriptionIsTip?: boolean
  actions?: ReactNode
  showDescriptionOnMobile?: boolean
  className?: string
}) {
  const descriptionElement = description ? (
    <p
      className={`mt-2 max-w-[64ch] text-[14px] leading-relaxed text-muted ${showDescriptionOnMobile ? '' : 'hidden sm:block'}`}
    >
      {description}
    </p>
  ) : null
  return (
    <header
      className={`flex flex-wrap items-end justify-between gap-5 border-b border-line pb-5 ${className}`}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <div
            className="skin-label mb-2 text-[12px] leading-[1.4]"
            style={{ color: 'var(--accent-ink)' }}
          >
            {eyebrow}
          </div>
        ) : null}
        <h1
          className="max-w-[24ch] text-balance text-[30px] font-semibold leading-[1.14] text-ink sm:text-[38px]"
          style={{ fontFamily: 'var(--font-display)', letterSpacing: '-0.025em' }}
        >
          {title}
        </h1>
        {descriptionIsTip ? <ReadingTips>{descriptionElement}</ReadingTips> : descriptionElement}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
