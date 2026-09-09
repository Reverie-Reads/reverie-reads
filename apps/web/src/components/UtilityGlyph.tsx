import type { ReactNode } from 'react'

export type UtilityGlyphName = 'grip' | 'search' | 'stop' | 'timer'

const glyphs: Record<UtilityGlyphName, ReactNode> = {
  grip: (
    <>
      <circle cx="7" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="5.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="7" cy="14.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="13" cy="14.5" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  search: (
    <>
      <circle cx="8.8" cy="8.8" r="5" />
      <path d="m12.5 12.5 4 4" />
    </>
  ),
  stop: <rect x="5" y="5" width="10" height="10" rx="1.4" fill="currentColor" stroke="none" />,
  timer: (
    <>
      <circle cx="10" cy="11" r="6" />
      <path d="M8 2.5h4M10 5V2.5M14.4 6.6l1.3-1.3M10 11V7.8M10 11l2.6 1.5" />
    </>
  ),
}

/** Stable interface marks for controls whose former Unicode symbols depended on OS font coverage. */
export function UtilityGlyph({
  name,
  className = 'h-4 w-4',
}: {
  name: UtilityGlyphName
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`inline-block flex-none ${className}`}
    >
      {glyphs[name]}
    </svg>
  )
}
