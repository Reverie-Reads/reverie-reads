import { useId, type CSSProperties } from 'react'
import {
  BEARD_COLORS,
  BEARD_RAINBOW_STOPS,
  DEFAULT_BEARD,
  type BeardAppearance,
} from '../design/beardAppearance'

const SHAPES: Record<BeardAppearance['style'], string> = {
  classic:
    'M12 16c-2 9-4 18-2 31 3 19 13 30 30 37 17-7 27-18 30-37 2-13 0-22-2-31-3 11-8 19-15 21H27C20 35 15 27 12 16Z',
  rounded:
    'M14 30c-3 8-4 17-1 27 4 13 13 22 27 27 14-5 23-14 27-27 3-10 2-19-1-27-4 9-11 14-26 14S18 39 14 30Z',
  full: 'M9 24c-4 10-5 21-2 30l4 3-1 7 7 3 2 7 9 1 6 8 6-2 6 2 6-8 9-1 2-7 7-3-1-7 4-3c3-9 2-20-2-30-4 13-15 18-31 18S13 37 9 24Z',
  trimmed:
    'M14 28c-2 9-3 20 0 30 4 10 12 16 26 16s22-6 26-16c3-10 2-21 0-30-4 10-12 15-26 15S18 38 14 28Z',
  goatee: 'M24 38c-2 8-1 19 3 28l13 18 13-18c4-9 5-20 3-28-5 4-10 6-16 6s-11-2-16-6Z',
  braided:
    'M12 26c-2 10-2 18 2 29l6 8-2 11 8 11 14-7 14 7 8-11-2-11 6-8c4-11 4-19 2-29-4 10-12 17-26 17s-22-7-26-17Z',
}

/** The original beard remains the default. Colour changes only this portrait, never the room. */
export function BeardGlyph({
  className = '',
  appearance = DEFAULT_BEARD,
}: {
  className?: string
  appearance?: BeardAppearance
}) {
  const clipId = useId()
  const gradientId = `${clipId}-rainbow`
  const color = BEARD_COLORS.find((entry) => entry.id === appearance.color) ?? BEARD_COLORS[0]
  const hairFill = color.id === 'rainbow' ? `url(#${gradientId})` : 'var(--beard-hair)'
  const variables = {
    '--beard-hair': `var(${color.hair})`,
    '--beard-ground': `var(${color.ground})`,
  } as CSSProperties
  return (
    <svg
      viewBox="0 0 80 88"
      fill="none"
      aria-hidden="true"
      className={`beard-glyph ${className}`}
      style={variables}
      data-beard-color={color.id}
      data-beard-style={appearance.style}
    >
      <defs>
        {color.id === 'rainbow' && (
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="8"
            y1="18"
            x2="72"
            y2="80"
          >
            {BEARD_RAINBOW_STOPS.map((token, index) => (
              <stop
                key={token}
                offset={`${(index / (BEARD_RAINBOW_STOPS.length - 1)) * 100}%`}
                stopColor={`var(${token})`}
              />
            ))}
          </linearGradient>
        )}
        <clipPath id={clipId}>
          <path d={SHAPES[appearance.style]} />
        </clipPath>
      </defs>
      {color.id !== 'room' && (
        <rect x="0" y="0" width="80" height="88" rx="36" fill="var(--beard-ground)" />
      )}
      <path d={SHAPES[appearance.style]} fill={hairFill} />
      <path
        d="M40 23c-7-6-12-7-17-3-4 3-6 9-11 10 6 6 17 6 28-1 11 7 22 7 28 1-5-1-7-7-11-10-5-4-10-3-17 3Z"
        fill={hairFill}
      />
      <path
        d={
          appearance.style === 'braided'
            ? 'M31 40c6 3 12 3 18 0M26 52l8 8-8 8 8 8m20-24-8 8 8 8-8 8M40 49v24'
            : 'M31 40c6 3 12 3 18 0M27 52l5 16m21-16-5 16m-8-17v25'
        }
        stroke="var(--beard-ground)"
        clipPath={`url(#${clipId})`}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
