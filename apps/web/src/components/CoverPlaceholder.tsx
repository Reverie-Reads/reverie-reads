import {
  accentCss,
  callsign,
  placeholderColorVars,
  placeholderSpec,
  type SkinId,
} from '@reverie/core'
import type { CSSProperties } from 'react'
import { useEffectiveSkin } from '../skin/labels'
import { useStructure } from '../skin/structure'

/** Author names may wrap, including inside an exceptionally long name, but never leave the plate. */
const AUTHOR_OVERFLOW: CSSProperties = {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
}

type TitleScale = { minPx: number; fluidCqw: number; maxPx: number }

/**
 * Size the longest word against the narrowest title panel used by the nine plates. Short titles
 * retain their expressive display scale; long words shrink with the cover before reaching the
 * readable pixel floor. The 82cqw budget includes a conservative glyph-width allowance, panel
 * padding, uppercase tracking, and italic overhang.
 */
function fittedTitleSize(title: string, scale: TitleScale): string {
  const longestWord = Math.max(
    1,
    ...title
      .trim()
      .split(/\s+/u)
      .map((word) => Array.from(word).length),
  )
  const fittedCqw = Math.min(scale.fluidCqw, 82 / longestWord)
  return `clamp(${scale.minPx}px, ${Number(fittedCqw.toFixed(2))}cqw, ${scale.maxPx}px)`
}

/**
 * A one-word title must read as one typographic gesture. It scales to fit, then ellipsises at the
 * readable floor instead of breaking into an arbitrary final fragment. Multi-word titles retain a
 * bounded line clamp and balance at word boundaries, so their line breaks look composed.
 */
function titleFlow(title: string, lines: number): CSSProperties {
  const oneWord = !/\s/u.test(title.trim())
  return oneWord
    ? {
        display: 'block',
        maxWidth: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }
    : {
        display: '-webkit-box',
        maxWidth: '100%',
        WebkitLineClamp: lines,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        overflowWrap: 'normal',
        wordBreak: 'normal',
        textWrap: 'balance',
      }
}

function PlaceholderTitle({
  title,
  lines,
  scale,
  className,
  style,
}: {
  title: string
  lines: number
  scale: TitleScale
  className?: string
  style: CSSProperties
}) {
  return (
    <span
      aria-hidden
      className={className}
      data-placeholder-title=""
      style={{
        ...style,
        fontSize: fittedTitleSize(title, scale),
        ...titleFlow(title, lines),
      }}
    >
      {title}
    </span>
  )
}

/**
 * The placeholderCover slot (Fable 5 slot 9): a coverless book gets a DESIGNED plate, never a gray
 * box. FILLS its parent (the caller provides the sized/bordered/overflow-hidden box) and scales via
 * container units, so it drops in from a reading-now thumb to the detail hero.
 *
 * Per-skin bones via `SKIN_STRUCTURE.placeholder` (same registered pattern as the signature motif):
 * - 'cloth-boards'   — Tryst's unjacketed edition: plum cloth, blind-ruled gilt double frame, ❦,
 *                      title hand-set in italic (one-word titles at display scale), author in caps.
 * - 'specimen-plate' — Aphelion's archive plate: gridded metal, corner brackets, a callsign chip,
 *                      the orbit ring holding where art would go, and a status LED.
 * - 'vellum-boards'  — Grimoire's unjacketed edition: vellum boards, blind double frame with gilt
 *                      corner squares, an illuminated initial tile, italic title, "by the hand of".
 * - 'box-lid'        — Marrow's specimen box: ash board, bone rule, a chamfered paper label plate,
 *                      № pasted top-left, the tail dipped in oxblood.
 * - 'case-file'      — Gaslight's jacketless file: fog board, brass head band, a typed paper label,
 *                      an eyelet, NO JACKET ON FILE stamped low.
 * - 'plain'          — the neutral title/author plate (accent-mixed, AA by construction) for skins
 *                      whose designed plate hasn't landed yet.
 * All values are tokens (--ph-*), per skin × mode — AA guarded by the registry-keyed contrast test.
 */
function PlaceholderPlate({
  book,
  className,
  skin,
}: {
  book: { id?: string; title?: string; first?: string; last?: string }
  className?: string
  /** Force a skin's plate (landing showcase / previews) — the caller must also provide that skin's
   *  token scope via `data-skin`, since the plate's colours come from CSS vars. Defaults to the
   *  active skin, exactly like `useStructure`. */
  skin?: SkinId
}) {
  const active = useEffectiveSkin()
  const variant = useStructure(skin).placeholder
  const skinId = skin ?? active
  const { title, author, accent } = placeholderSpec(book)
  const label = `${title || 'Untitled'}${author ? ` by ${author}` : ''} — placeholder cover`
  const oneWord = !!title && !title.includes(' ')

  if (variant === 'cloth-boards') {
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '12% 9%',
          background:
            'var(--ph-glow), linear-gradient(160deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))',
          containerType: 'inline-size',
        }}
      >
        {/* blind-ruled gilt double frame */}
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            inset: '5.5%',
            border: '1px solid color-mix(in srgb, var(--gold) 50%, transparent)',
            borderRadius: 4,
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            inset: '8.5%',
            border: '1px solid color-mix(in srgb, var(--gold) 26%, transparent)',
            borderRadius: 2,
          }}
        />
        <span
          aria-hidden
          style={{
            color: 'var(--gold)',
            fontSize: 'clamp(10px, 9cqw, 14px)',
            fontFamily: 'var(--font-display)',
            lineHeight: 1,
            marginBottom: '7%',
          }}
        >
          ❦
        </span>
        <PlaceholderTitle
          title={title || 'Untitled'}
          lines={3}
          scale={{ minPx: 9, fluidCqw: oneWord ? 17 : 10, maxPx: oneWord ? 26 : 15 }}
          style={{
            position: 'relative',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontStyle: 'italic',
            lineHeight: 1.25,
            color: 'var(--ph-ink)',
            textAlign: 'center',
          }}
        />
        <span
          aria-hidden
          style={{
            width: '18%',
            height: 1,
            background: 'color-mix(in srgb, var(--gold) 50%, transparent)',
            margin: '7% 0',
          }}
        />
        {author && (
          <span
            aria-hidden
            className="uppercase"
            style={{
              ...AUTHOR_OVERFLOW,
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              fontSize: 'clamp(9px, 6.5cqw, 10px)',
              letterSpacing: '0.2em',
              color: 'var(--ph-muted)',
              textAlign: 'center',
            }}
          >
            {author}
          </span>
        )}
      </div>
    )
  }

  if (variant === 'specimen-plate') {
    const call = callsign(book.id ?? title ?? 'specimen', skinId.slice(0, 3).toUpperCase())
    const grid = 'color-mix(in srgb, var(--primary) 9%, transparent)'
    const bracket = (pos: Record<string, number | string>) => (
      <span
        aria-hidden
        style={{
          position: 'absolute',
          width: '6.5%',
          aspectRatio: '1',
          borderColor: 'var(--primary)',
          borderStyle: 'solid',
          ...pos,
        }}
      />
    )
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: `linear-gradient(${grid} 1px, transparent 1px), linear-gradient(90deg, ${grid} 1px, transparent 1px), linear-gradient(165deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))`,
          backgroundSize: '14% 14%, 14% 14%, 100% 100%',
          containerType: 'inline-size',
        }}
      >
        {bracket({ left: 0, top: 0, borderWidth: '1px 0 0 1px' })}
        {bracket({ right: 0, top: 0, borderWidth: '1px 1px 0 0' })}
        {bracket({ left: 0, bottom: 0, borderWidth: '0 0 1px 1px' })}
        {bracket({ right: 0, bottom: 0, borderWidth: '0 1px 1px 0' })}
        {/* callsign chip */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '7%',
            top: '6.5%',
            border: '1px solid color-mix(in srgb, var(--primary) 55%, transparent)',
            background: 'var(--plate)',
            padding: '2% 4%',
            borderRadius: 1,
            lineHeight: 1.35,
          }}
        >
          <span
            className="block font-bold"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(8px, 6cqw, 9px)',
              letterSpacing: '0.08em',
              color: 'var(--accent-ink)',
            }}
          >
            {call.code}
          </span>
          <span
            className="block font-bold"
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'clamp(8px, 6cqw, 9px)',
              letterSpacing: '0.04em',
              color: 'var(--ph-muted)',
            }}
          >
            {call.id}
          </span>
        </span>
        {/* the orbit ring holding where art would go */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '36%',
            width: '39%',
            aspectRatio: '1',
            transform: 'translate(-50%, -50%)',
            border: '1px solid color-mix(in srgb, var(--primary) 55%, transparent)',
            borderRadius: '50%',
          }}
        />
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '36%',
            width: 5,
            height: 5,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
            background: 'var(--primary)',
            boxShadow: '0 0 8px var(--primary)',
          }}
        />
        <PlaceholderTitle
          title={title || 'Untitled'}
          lines={3}
          scale={{ minPx: 9, fluidCqw: oneWord ? 12 : 9.5, maxPx: oneWord ? 18 : 14 }}
          style={{
            position: 'absolute',
            left: '8%',
            right: '8%',
            bottom: '20%',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: oneWord ? '0.04em' : 0,
            textTransform: oneWord ? 'uppercase' : 'none',
            color: 'var(--ph-ink)',
          }}
        />
        {author && (
          <span
            aria-hidden
            className="uppercase"
            style={{
              ...AUTHOR_OVERFLOW,
              position: 'absolute',
              left: '8%',
              bottom: '8%',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              fontSize: 'clamp(8px, 6.5cqw, 9px)',
              letterSpacing: '0.16em',
              color: 'var(--ph-muted)',
            }}
          >
            {author}
          </span>
        )}
        <span
          aria-hidden
          className="rv-anim"
          style={{
            position: 'absolute',
            right: '7%',
            bottom: '8%',
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--primary)',
            boxShadow: '0 0 8px var(--primary)',
            animation: 'sig-blink 2.4s step-end infinite',
          }}
        />
      </div>
    )
  }

  if (variant === 'vellum-boards') {
    const initial = (title || 'U').charAt(0).toUpperCase()
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '13% 9%',
          background: 'linear-gradient(160deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))',
          containerType: 'inline-size',
        }}
      >
        {/* blind double frame with gilt corner squares */}
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            inset: '6%',
            border: '1px solid color-mix(in srgb, var(--gold) 55%, transparent)',
          }}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            inset: '9%',
            border: '1px solid color-mix(in srgb, var(--gold) 27%, transparent)',
          }}
        />
        {(
          ['4% 4% auto auto', '4% auto auto 4%', 'auto 4% 4% auto', 'auto auto 4% 4%'] as const
        ).map((inset, i) => {
          const [top, right, bottom, left] = inset.split(' ')
          return (
            <span
              key={i}
              aria-hidden
              style={{
                position: 'absolute',
                width: '4.5%',
                aspectRatio: '1',
                background: 'var(--gold)',
                boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.25)',
                top: top === 'auto' ? undefined : top,
                right: right === 'auto' ? undefined : right,
                bottom: bottom === 'auto' ? undefined : bottom,
                left: left === 'auto' ? undefined : left,
              }}
            />
          )
        })}
        {/* the illuminated initial tile */}
        <span
          aria-hidden
          className="grid place-items-center"
          style={{
            position: 'relative',
            width: '21%',
            aspectRatio: '1',
            background: 'linear-gradient(160deg, var(--cta-hi), var(--cta-lo))',
            boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.4), 0 2px 5px rgba(0, 0, 0, 0.35)',
            marginBottom: '9%',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(13px, 13cqw, 20px)',
            color: 'var(--cta-ink)',
          }}
        >
          {initial}
        </span>
        <PlaceholderTitle
          title={title || 'Untitled'}
          lines={3}
          scale={{ minPx: 9, fluidCqw: oneWord ? 18 : 10, maxPx: oneWord ? 27 : 15 }}
          style={{
            position: 'relative',
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontStyle: 'italic',
            lineHeight: 1.22,
            color: 'var(--ph-ink)',
            textAlign: 'center',
          }}
        />
        <span
          aria-hidden
          style={{
            width: '18%',
            height: 1,
            background: 'color-mix(in srgb, var(--gold) 55%, transparent)',
            margin: '7% 0 5%',
          }}
        />
        {author && (
          <>
            <span
              aria-hidden
              className="uppercase"
              style={{
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 'clamp(8px, 6cqw, 9px)',
                letterSpacing: '0.2em',
                color: 'var(--ph-muted)',
              }}
            >
              by the hand of
            </span>
            <span
              aria-hidden
              className="uppercase"
              style={{
                ...AUTHOR_OVERFLOW,
                marginTop: '2%',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 'clamp(9px, 7cqw, 10px)',
                letterSpacing: '0.16em',
                color: 'var(--rubric)',
              }}
            >
              {author}
            </span>
          </>
        )}
      </div>
    )
  }

  if (variant === 'box-lid') {
    const call = callsign(book.id ?? title ?? 'specimen', 'NO')
    const cham =
      'polygon(6px 0, calc(100% - 6px) 0, 100% 6px, 100% calc(100% - 6px), calc(100% - 6px) 100%, 6px 100%, 0 calc(100% - 6px), 0 6px)'
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(165deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))',
          containerType: 'inline-size',
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            inset: '5.5%',
            border: '1px solid color-mix(in srgb, var(--ph-ink) 25%, transparent)',
          }}
        />
        {/* № pasted top-left */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '9%',
            top: '7%',
            background: 'var(--paper)',
            color: 'var(--paper-ink)',
            padding: '2% 4%',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
            fontFamily: 'var(--font-sans)',
            fontWeight: 700,
            fontSize: 'clamp(8px, 6cqw, 9px)',
            letterSpacing: '0.08em',
          }}
        >
          № {call.id}
        </span>
        {/* the chamfered label plate */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '46%',
            transform: 'translate(-50%, -50%)',
            width: '76%',
            clipPath: cham,
            background: 'var(--paper)',
            padding: '9% 7%',
            textAlign: 'center',
          }}
        >
          <PlaceholderTitle
            title={title || 'Untitled'}
            lines={3}
            className="block"
            scale={{ minPx: 9, fluidCqw: oneWord ? 17 : 9.5, maxPx: oneWord ? 26 : 14 }}
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              lineHeight: 1.2,
              color: 'var(--paper-ink)',
            }}
          />
          <span
            className="mx-auto my-[6%] block"
            style={{
              width: '20%',
              height: 1,
              background: 'color-mix(in srgb, var(--paper-ink) 40%, transparent)',
            }}
          />
          {author && (
            <span
              className="block uppercase"
              style={{
                ...AUTHOR_OVERFLOW,
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 'clamp(8px, 6.5cqw, 9px)',
                letterSpacing: '0.18em',
                color: 'color-mix(in srgb, var(--paper-ink) 78%, var(--paper))',
              }}
            >
              {author}
            </span>
          )}
        </span>
        <span
          aria-hidden
          className="uppercase"
          style={{
            position: 'absolute',
            left: '9%',
            bottom: '10%',
            fontFamily: 'var(--font-sans)',
            fontWeight: 600,
            fontSize: 'clamp(8px, 6cqw, 9px)',
            letterSpacing: '0.16em',
            color: 'var(--ph-muted)',
          }}
        >
          Collected
        </span>
        {/* the tail dipped in oxblood */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: '4.5%',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--accent-fill) 50%, transparent), var(--accent-fill))',
          }}
        />
      </div>
    )
  }

  if (variant === 'case-file') {
    const call = callsign(book.id ?? title ?? 'case', 'NO')
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(165deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))',
          containerType: 'inline-size',
        }}
      >
        {/* brass head band */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            height: '5.5%',
            background:
              'repeating-linear-gradient(180deg, var(--gold) 0 1.5px, color-mix(in srgb, var(--gold) 45%, #000) 1.5px 3px)',
          }}
        />
        {/* typed case number */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: '8%',
            top: '9%',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: 'clamp(8px, 6.5cqw, 9px)',
            letterSpacing: '0.1em',
            color: 'var(--gold)',
          }}
        >
          No.{call.id}
        </span>
        {/* the typed paper label, pasted square */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '10%',
            right: '10%',
            top: '32%',
            background: 'var(--paper)',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.35), inset 0 0 0 1px rgba(0, 0, 0, 0.08)',
            padding: '8% 7%',
            textAlign: 'center',
          }}
        >
          <PlaceholderTitle
            title={title || 'Untitled'}
            lines={3}
            className="block uppercase"
            scale={{ minPx: 8, fluidCqw: oneWord ? 14 : 9, maxPx: oneWord ? 20 : 13.5 }}
            style={{
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: '0.06em',
              color: 'var(--paper-ink)',
            }}
          />
          {author && (
            <span
              className="mt-[5%] block uppercase"
              style={{
                ...AUTHOR_OVERFLOW,
                fontFamily: 'var(--font-mono)',
                fontWeight: 400,
                fontSize: 'clamp(8px, 6.5cqw, 9px)',
                letterSpacing: '0.1em',
                color: 'color-mix(in srgb, var(--paper-ink) 78%, var(--paper))',
              }}
            >
              {author}
            </span>
          )}
        </span>
        {/* the eyelet + the stamp */}
        <span
          aria-hidden
          className="rounded-full"
          style={{
            position: 'absolute',
            right: '9%',
            bottom: '16%',
            width: '6%',
            aspectRatio: '1',
            border: '1.5px solid var(--gold)',
            boxShadow: '0 1px 2px rgba(0, 0, 0, 0.4)',
          }}
        />
        <span
          aria-hidden
          className="uppercase"
          style={{
            position: 'absolute',
            left: '8%',
            bottom: '8%',
            padding: '1.5% 3%',
            border: '1.5px solid color-mix(in srgb, var(--ph-muted) 80%, transparent)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: 'clamp(7.5px, 5.5cqw, 9px)',
            letterSpacing: '0.12em',
            color: 'var(--ph-muted)',
            transform: 'rotate(-3deg)',
          }}
        >
          No jacket on file
        </span>
      </div>
    )
  }

  if (variant === 'proof-sheet') {
    // Marginalia: the uncorrected proof — plain bond, a taped cover slug, hand-set title, the red
    // caret and a Caveat note where the jacket will go. The page never inverts; only the desk does.
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '13% 10%',
          background: 'linear-gradient(165deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))',
          containerType: 'inline-size',
        }}
      >
        {/* the masking-tape tab, pressed on a little crooked */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '50%',
            top: '-4%',
            transform: 'translateX(-50%) rotate(3deg)',
            width: '24%',
            height: '9%',
            border: '2px solid var(--ph-muted)',
            borderBottom: 0,
            borderRadius: '7px 7px 3px 3px',
            opacity: 0.75,
          }}
        />
        <span
          aria-hidden
          className="uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 'clamp(8px, 6cqw, 9.5px)',
            letterSpacing: '0.26em',
            color: 'var(--ph-muted)',
            marginBottom: '9%',
          }}
        >
          A novel
        </span>
        <PlaceholderTitle
          title={title || 'Untitled'}
          lines={3}
          scale={{ minPx: 9, fluidCqw: oneWord ? 17 : 9.5, maxPx: oneWord ? 25 : 14 }}
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontStyle: oneWord ? 'italic' : 'normal',
            lineHeight: 1.25,
            fontFeatureSettings: "'onum' 1",
            color: 'var(--ph-ink)',
            textAlign: 'center',
          }}
        />
        <span
          aria-hidden
          style={{ width: '20%', height: 1, background: 'var(--ph-muted)', margin: '8% 0' }}
        />
        {author && (
          <span
            aria-hidden
            style={{
              ...AUTHOR_OVERFLOW,
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 'clamp(9px, 7cqw, 10.5px)',
              color: 'var(--ph-ink)',
            }}
          >
            {author}
          </span>
        )}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: '7%',
            bottom: '7%',
            fontFamily: 'var(--font-hand)',
            fontSize: 'clamp(11px, 10cqw, 15px)',
            color: 'var(--accent-fill)',
            transform: 'rotate(-6deg)',
          }}
        >
          no jacket yet
        </span>
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '8%',
            bottom: '6%',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(11px, 10cqw, 15px)',
            color: 'var(--accent-fill)',
          }}
        >
          ‸
        </span>
      </div>
    )
  }

  if (variant === 'linen-board') {
    // Hearth: the linen board — oat cloth, a dashed thread frame, a paper recipe label where the
    // jacket will go, the wooden button sewn beneath.
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '12% 9%',
          background:
            'repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.05) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.045) 0 1px, transparent 1px 3px), linear-gradient(165deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))',
          containerType: 'inline-size',
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            inset: '6%',
            borderRadius: 4,
            border: '2px dashed color-mix(in srgb, var(--thread) 75%, transparent)',
          }}
        />
        {/* the pasted recipe card */}
        <span
          aria-hidden
          style={{
            position: 'relative',
            width: '76%',
            background: 'var(--paper)',
            borderRadius: 8,
            padding: '9% 7%',
            textAlign: 'center',
            boxShadow: '0 3px 8px rgba(40, 28, 12, 0.3)',
          }}
        >
          <PlaceholderTitle
            title={title || 'Untitled'}
            lines={3}
            className="block"
            scale={{ minPx: 9, fluidCqw: oneWord ? 16 : 9.5, maxPx: oneWord ? 23 : 14 }}
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              lineHeight: 1.25,
              color: 'var(--paper-ink)',
            }}
          />
          <span
            aria-hidden
            className="mx-auto block"
            style={{
              width: '22%',
              height: 2,
              backgroundImage:
                'repeating-linear-gradient(90deg, var(--accent-fill) 0 4px, transparent 4px 7px)',
              margin: '7% auto',
            }}
          />
          {author && (
            <span
              className="block uppercase"
              style={{
                ...AUTHOR_OVERFLOW,
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 'clamp(8px, 6.5cqw, 9px)',
                letterSpacing: '0.14em',
                color: 'color-mix(in srgb, var(--paper-ink) 78%, var(--paper))',
              }}
            >
              {author}
            </span>
          )}
        </span>
        {/* the button, sewn beneath */}
        <span
          aria-hidden
          className="rounded-full"
          style={{
            position: 'relative',
            marginTop: '8%',
            width: 'clamp(10px, 9cqw, 14px)',
            aspectRatio: '1',
            background:
              'radial-gradient(circle at 36% 36%, rgba(40, 28, 12, 0.7) 1px, transparent 1.5px), radial-gradient(circle at 64% 36%, rgba(40, 28, 12, 0.7) 1px, transparent 1.5px), radial-gradient(circle at 36% 64%, rgba(40, 28, 12, 0.7) 1px, transparent 1.5px), radial-gradient(circle at 64% 64%, rgba(40, 28, 12, 0.7) 1px, transparent 1.5px), radial-gradient(circle at 35% 30%, var(--gold), var(--gold-deep))',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.4)',
          }}
        />
      </div>
    )
  }

  if (variant === 'buff-manual') {
    // Almanac: the buff manual — the band block carries title + REF, the tab off the edge, the
    // double rule and grommet at the foot.
    const call = callsign(book.id ?? title ?? 'reference', 'REF')
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: 'linear-gradient(165deg, var(--ph-a), var(--ph-b) 55%, var(--ph-c))',
          containerType: 'inline-size',
        }}
      >
        {/* the band block */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: '22%',
            background: 'var(--cta-lo)',
            padding: '8% 8% 9%',
          }}
        >
          <span
            className="block uppercase"
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              fontSize: 'clamp(7.5px, 5.5cqw, 8.5px)',
              letterSpacing: '0.22em',
              color: 'color-mix(in srgb, var(--cta-ink) 78%, var(--cta-lo))',
              marginBottom: '4%',
            }}
          >
            Field reference
          </span>
          <PlaceholderTitle
            title={title || 'Untitled'}
            lines={3}
            className="block uppercase"
            scale={{ minPx: 8, fluidCqw: oneWord ? 14 : 9, maxPx: oneWord ? 21 : 13.5 }}
            style={{
              fontFamily: 'var(--font-sans)',
              fontWeight: 700,
              lineHeight: 1.2,
              letterSpacing: oneWord ? '0.06em' : '0.02em',
              color: 'var(--cta-ink)',
            }}
          />
          {author && (
            <span
              className="block uppercase"
              style={{
                ...AUTHOR_OVERFLOW,
                marginTop: '4%',
                fontFamily: 'var(--font-sans)',
                fontWeight: 600,
                fontSize: 'clamp(8px, 6.5cqw, 9px)',
                letterSpacing: '0.14em',
                color: 'color-mix(in srgb, var(--cta-ink) 78%, var(--cta-lo))',
              }}
            >
              {author} · REF {call.id.slice(1)}
            </span>
          )}
        </span>
        {/* the orange tab, off the edge */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: 0,
            top: '8%',
            width: '5.5%',
            height: '17%',
            background: 'var(--accent)',
            borderRadius: '2px 0 0 2px',
            boxShadow: '-1px 1px 3px rgba(0, 0, 0, 0.3)',
          }}
        />
        {/* the double rule + grommet at the foot */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: '8%',
            right: '8%',
            bottom: '8%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span
            style={{
              width: '54%',
              height: 4,
              borderTop: '1px solid var(--ph-ink)',
              borderBottom: '1px solid var(--ph-ink)',
              opacity: 0.6,
            }}
          />
          <span
            className="rounded-full"
            style={{
              width: 'clamp(7px, 6cqw, 9px)',
              aspectRatio: '1',
              border: '2px solid var(--ph-ink)',
              opacity: 0.7,
            }}
          />
        </span>
      </div>
    )
  }

  if (variant === 'sky-mockup') {
    // Firstlight: the sky mock-up — a white sticker label on the dawn, the star at the corner,
    // the small sun at the foot. Stars come out in dark mode only (.rv-sky-star).
    return (
      <div
        role="img"
        aria-label={label}
        className={className}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          padding: '12% 10%',
          background: 'var(--sky)',
          containerType: 'inline-size',
        }}
      >
        <span
          aria-hidden
          className="rv-sky-star absolute rounded-full"
          style={{
            left: '22%',
            top: '12%',
            width: 2.5,
            height: 2.5,
            background: 'rgba(238, 240, 250, 0.9)',
          }}
        />
        <span
          aria-hidden
          className="rv-sky-star absolute rounded-full"
          style={{
            left: '72%',
            top: '8%',
            width: 2,
            height: 2,
            background: 'rgba(238, 240, 250, 0.6)',
          }}
        />
        <span
          aria-hidden
          className="rv-sky-star absolute rounded-full"
          style={{
            left: '56%',
            top: '20%',
            width: 1.5,
            height: 1.5,
            background: 'rgba(238, 240, 250, 0.5)',
          }}
        />
        {/* the sticker */}
        <span
          aria-hidden
          style={{
            position: 'relative',
            width: '78%',
            background: 'var(--paper)',
            borderRadius: 11,
            padding: '9% 7%',
            textAlign: 'center',
            boxShadow: '0 0 0 3px rgba(255, 255, 255, 0.35), 0 5px 12px rgba(10, 10, 30, 0.35)',
          }}
        >
          <PlaceholderTitle
            title={title || 'Untitled'}
            lines={3}
            className="block"
            scale={{ minPx: 9, fluidCqw: oneWord ? 16 : 9.5, maxPx: oneWord ? 24 : 14 }}
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              lineHeight: 1.2,
              color: 'var(--paper-ink)',
            }}
          />
          {author && (
            <span
              className="mt-[5%] block uppercase"
              style={{
                ...AUTHOR_OVERFLOW,
                fontFamily: 'var(--font-sans)',
                fontWeight: 700,
                fontSize: 'clamp(8px, 6.5cqw, 9px)',
                letterSpacing: '0.14em',
                color: 'var(--ph-muted)',
              }}
            >
              {author}
            </span>
          )}
        </span>
        {/* the star sticker + the small sun */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: '9%',
            top: '7%',
            width: 'clamp(12px, 11cqw, 17px)',
            aspectRatio: '1',
            background: 'var(--gold)',
            clipPath:
              'polygon(50% 0, 63% 34%, 98% 38%, 72% 60%, 81% 95%, 50% 74%, 19% 95%, 28% 60%, 2% 38%, 37% 34%)',
            boxShadow: '0 0 0 2.5px rgba(255, 255, 255, 0.7)',
          }}
        />
        <span
          aria-hidden
          className="rounded-full"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '4%',
            transform: 'translateX(-50%)',
            width: 'clamp(9px, 8.5cqw, 13px)',
            aspectRatio: '1',
            background: 'radial-gradient(circle at 40% 35%, #ffe2a0, var(--gold))',
            boxShadow: '0 0 10px var(--gold)',
          }}
        />
      </div>
    )
  }

  // 'plain' — the neutral accent-mixed title/author plate (AA by construction; see @reverie/core)
  const colors = placeholderColorVars(accent)
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: '6%',
        padding: '9% 11%',
        overflow: 'hidden',
        background: colors.background,
        containerType: 'inline-size',
      }}
    >
      <span
        aria-hidden
        className="block flex-none"
        style={{ height: 2, width: '34%', background: colors.color, opacity: 0.55 }}
      />
      <PlaceholderTitle
        title={title || 'Untitled'}
        lines={4}
        scale={{ minPx: 9, fluidCqw: 15, maxPx: 22 }}
        style={{
          fontFamily: 'var(--font-display)',
          fontStyle: 'italic',
          fontWeight: 600,
          lineHeight: 1.06,
          color: colors.color,
        }}
      />
      {author && (
        <span
          aria-hidden
          className="skin-label"
          style={{
            fontSize: 'clamp(8px, 8cqw, 11px)',
            letterSpacing: '0.08em',
            color: colors.color,
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {author}
        </span>
      )}
    </div>
  )
}

/**
 * The public placeholder: the skin's designed plate at card sizes, a MONOGRAM plate at spine sizes.
 *
 * WHY TWO MODES (feat/discover-phase-a). At ≤64px the designed plates all collapse to the same
 * thing: a truncated shared prefix — five ACOTAR books rendering "Cou of… / SARA" five times over,
 * visually identical. The distinguishing signal that survives 36px is not typeset title text, it is
 * the monogram `placeholderSpec` has computed since the plates shipped and nothing ever rendered
 * ("CM" / "CT" / "CW"…), plus the per-book accent tint — now 10 recipes instead of 4, so
 * same-series neighbours rarely share one. 64px splits the app's real surfaces cleanly: every
 * strip/row thumb is ≤56px (w-6…w-14), every card ≥80px.
 *
 * Both blocks render; `.ph-plate-wide` / `.ph-plate-narrow` (globals.css) toggle on a container
 * query against THIS wrapper — CSS-only, no resize observer, no layout thrash. A browser without
 * container queries keeps the plates at every size (the narrow block's base style is display:none),
 * which is exactly today's behaviour. The wrapper owns role/aria-label; both visual blocks are
 * aria-hidden, so what a screen reader announces is unchanged at every width — the monogram is a
 * visual differentiator, never the accessible name.
 */
export function CoverPlaceholder({
  book,
  className,
  skin,
}: {
  book: { id?: string; title?: string; first?: string; last?: string }
  className?: string
  skin?: SkinId
}) {
  const { title, author, initials, accent } = placeholderSpec(book)
  const label = `${title || 'Untitled'}${author ? ` by ${author}` : ''} — placeholder cover`
  const colors = placeholderColorVars(accent)
  return (
    <div
      role="img"
      aria-label={label}
      className={className}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        containerType: 'inline-size',
      }}
    >
      <div aria-hidden className="ph-plate-wide" style={{ position: 'absolute', inset: 0 }}>
        <PlaceholderPlate book={book} skin={skin} />
      </div>
      <div
        aria-hidden
        className="ph-plate-narrow"
        style={{
          position: 'absolute',
          inset: 0,
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: colors.background,
        }}
      >
        {/* identity band: the raw accent, full strength — pure decoration (the AA-proven monogram
            below is the content), and the hue a reader can tell apart before reading any letters */}
        <span
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '7%',
            maxHeight: 5,
            background: accentCss(accent),
          }}
        />
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 'clamp(11px, 40cqw, 26px)',
            letterSpacing: '0.03em',
            lineHeight: 1,
            color: colors.color,
          }}
        >
          {initials}
        </span>
      </div>
    </div>
  )
}
