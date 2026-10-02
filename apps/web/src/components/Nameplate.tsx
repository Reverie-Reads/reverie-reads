import { type CSSProperties, type ReactNode } from 'react'
import { type SkinId } from '@reverie/core'
import { useEffectiveSkin } from '../skin/labels'

/**
 * The book-detail "nameplate" — the highest-character single element in the kit. It names the book
 * like an engraved plate, not a heading. Built on the `.skin-plate` material (opaque --panel-fill =
 * the AA floor; gilt/instrument character from the border + inset --ornament-frame), plus a per-skin
 * STRUCTURAL ornament: Tryst hangs a gilt fleuron over the top rule; Aphelion frames it in four
 * instrument corner-brackets with a blinking status dot. Other skins inherit the clean plate until
 * their stage. Pass `skin` to force a skin's ornament (gallery / eyeball previews); otherwise it
 * follows the active skin. Text uses the contract type tokens (--label-font / --font-display), never
 * a parallel type scale.
 */
type PlateOrnament = {
  /** drawn inside the plate, absolutely positioned (brackets, top fleuron, status dot) */
  ornament?: ReactNode
  eyebrowColor: string
  subtitleStyle: CSSProperties
}

/** A single signature glyph hung over the top rule of the plate, in the skin's accent. */
function topGlyph(ch: string): ReactNode {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[-3px] -translate-x-1/2 text-[13px] leading-none"
      style={{ color: 'var(--accent)' }}
    >
      {ch}
    </span>
  )
}

const PLATE: Partial<Record<SkinId, PlateOrnament>> = {
  tryst: {
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: { fontFamily: 'var(--font-display)', fontStyle: 'italic' },
    ornament: (
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-1px] -translate-x-1/2 text-[13px] leading-none"
        style={{ color: 'var(--accent)' }}
      >
        ❦
      </span>
    ),
  },
  aphelion: {
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: { fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' },
    ornament: (
      <>
        {/* four instrument corner-brackets */}
        {(
          [
            'left-0 top-0 border-l border-t',
            'right-0 top-0 border-r border-t',
            'left-0 bottom-0 border-l border-b',
            'right-0 bottom-0 border-r border-b',
          ] as const
        ).map((pos) => (
          <span
            key={pos}
            aria-hidden
            className={`pointer-events-none absolute h-2.5 w-2.5 ${pos}`}
            style={{ borderColor: 'var(--ornament-frame)' }}
          />
        ))}
      </>
    ),
  },
  grimoire: {
    // The incipit uses the tested text accent; the ❖ sigil crowns the plate
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: { fontFamily: 'var(--font-display)', fontStyle: 'italic' },
    ornament: (
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-2px] -translate-x-1/2 text-[14px] leading-none"
        style={{ color: 'var(--accent)' }}
      >
        ❖
      </span>
    ),
  },
  marrow: {
    // Fable 5: the specimen card — the № pasted at its head does the identifying
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: {
      fontFamily: 'var(--font-sans)',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      fontSize: '11px',
    },
    ornament: (
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-9px] -translate-x-1/2 px-1.5 py-0.5 text-[9px] font-bold leading-none"
        style={{
          background: 'var(--paper)',
          color: 'var(--paper-ink)',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35)',
          fontFamily: 'var(--font-sans)',
          letterSpacing: '0.08em',
        }}
      >
        №
      </span>
    ),
  },
  // Stage 3 — a single signature glyph over the top rule, in the skin's accent.
  // Fable 5 Gaslight: the docket — the case number typed on the tab; REPORTED BY beneath
  umbra: {
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: {
      fontFamily: 'var(--font-mono)',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      fontSize: '10.5px',
    },
    ornament: topGlyph('▣'),
  },
  // Fable 5 Marginalia: the galley slug — the red margin rule down the left, the caret in the margin
  folio: {
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: { fontFamily: 'var(--font-display)', fontStyle: 'italic' },
    ornament: (
      <>
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-0 top-0"
          style={{
            left: 10,
            width: 1,
            background: 'color-mix(in srgb, var(--accent-fill) 45%, transparent)',
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute bottom-1 left-[5px] text-[12px] font-bold leading-none"
          style={{ color: 'var(--accent-fill)', fontFamily: 'var(--font-display)' }}
        >
          ‸
        </span>
      </>
    ),
  },
  // Fable 5 Hearth: the pantry label — the sewn button hung over the top rule
  hearth: {
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: {
      fontFamily: 'var(--font-sans)',
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      fontSize: '10px',
    },
    ornament: (
      <span
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[-6px] -translate-x-1/2 rounded-full"
        style={{
          width: 12,
          height: 12,
          background:
            'radial-gradient(circle at 36% 36%, rgba(40, 28, 12, 0.7) 1px, transparent 1.4px), radial-gradient(circle at 64% 36%, rgba(40, 28, 12, 0.7) 1px, transparent 1.4px), radial-gradient(circle at 36% 64%, rgba(40, 28, 12, 0.7) 1px, transparent 1.4px), radial-gradient(circle at 64% 64%, rgba(40, 28, 12, 0.7) 1px, transparent 1.4px), radial-gradient(circle at 35% 30%, var(--gold), var(--gold-deep))',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
        }}
      />
    ),
  },
  // Fable 5 Almanac: the band block — double rule + grommet filed at the foot
  almanac: {
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: {
      fontFamily: 'var(--font-sans)',
      letterSpacing: '0.14em',
      textTransform: 'uppercase',
      fontSize: '10.5px',
    },
    ornament: (
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-2 left-5 right-5 flex items-center justify-between"
      >
        <span
          style={{
            width: '54%',
            height: 4,
            borderTop: '1px solid var(--ornament-frame)',
            borderBottom: '1px solid var(--ornament-frame)',
          }}
        />
        <span
          className="rounded-full"
          style={{ width: 9, height: 9, border: '2.5px solid var(--ornament-frame)' }}
        />
      </span>
    ),
  },
  // Fable 5 Firstlight: the sticker plate — the gold star stuck at the corner
  bloom: {
    eyebrowColor: 'var(--accent-ink)',
    subtitleStyle: {
      fontFamily: 'var(--font-sans)',
      letterSpacing: '0.18em',
      textTransform: 'uppercase',
      fontSize: '10px',
    },
    ornament: (
      <span
        aria-hidden
        className="pointer-events-none absolute right-3 top-3"
        style={{
          width: 15,
          height: 15,
          background: 'var(--gold)',
          clipPath:
            'polygon(50% 0, 63% 34%, 98% 38%, 72% 60%, 81% 95%, 50% 74%, 19% 95%, 28% 60%, 2% 38%, 37% 34%)',
          boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.7)',
        }}
      />
    ),
  },
}

export function Nameplate({
  eyebrow,
  title,
  subtitle,
  skin,
  align = 'center',
  className = '',
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  skin?: SkinId
  align?: 'center' | 'start'
  className?: string
}) {
  const active = useEffectiveSkin()
  const id = skin ?? active
  const plate = PLATE[id]
  const alignCls = align === 'center' ? 'text-center items-center' : 'text-left items-start'

  return (
    <div className={`skin-plate skin-panel overflow-hidden px-5 py-4 ${className}`}>
      {plate?.ornament}
      {/* Aphelion's status dot sits with the eyebrow; Tryst leads with the fleuron only. */}
      <div className={`relative flex flex-col gap-1 ${alignCls}`}>
        {eyebrow && (
          <div className="flex items-center gap-2">
            {id === 'aphelion' && (
              <span
                aria-hidden
                className="rv-anim h-1.5 w-1.5 rounded-full"
                style={{
                  background: 'var(--accent)',
                  boxShadow: '0 0 8px var(--accent)',
                  animation: 'sig-blink 2s step-end infinite',
                }}
              />
            )}
            <span
              className="skin-label text-[10px]"
              style={{ color: plate?.eyebrowColor ?? 'var(--muted)' }}
            >
              {eyebrow}
            </span>
          </div>
        )}
        <h2
          className="max-w-full text-balance text-[22px] leading-tight text-ink [overflow-wrap:anywhere]"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontFeatureSettings: 'var(--numeral-feature)',
          }}
        >
          {title}
        </h2>
        {subtitle && (
          <p
            className="max-w-full text-[13px] text-muted [overflow-wrap:anywhere]"
            style={plate?.subtitleStyle}
          >
            {subtitle}
          </p>
        )}
      </div>
    </div>
  )
}
