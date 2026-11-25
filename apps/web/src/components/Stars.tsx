import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { snapHalfRating } from '@reverie/core'

/**
 * Five-star rating, whole or half stars.
 *
 * ── STEP IS OPT-IN, AND THAT IS THE TRUNCATION GUARD ────────────────────────────────────────────
 * `step` defaults to 1. Half stars exist only where a caller passes `step={0.5}` — the reader's own
 * rating (`books.rating`, `reads.rating`, both `numeric(2,1)`). The REVIEWS composer never passes
 * it, because `reviews.rating` is a cross-user `smallint`: a 4.5 sent there would silently
 * truncate. `useUpsertReview` additionally refuses non-integers loudly (see data/reviews.ts) —
 * the default here is the first fence, that throw is the one that cannot be forgotten at a new
 * call site.
 *
 * ── THE INTERACTIVE PATH IS A SLIDER, NOT A BUTTON ROW — the a11y is the feature ────────────────
 * Half steps have to be reachable without a pointer, and a screen reader has to say "3.5 stars",
 * not five booleans. That is the WAI-ARIA rating pattern: one `role="slider"` stop with
 * Left/Right = ±step, Home/End = 0/5, `aria-valuetext` carrying the human value. A button-per-star
 * group cannot express 3.5 without ten buttons or a hidden click-cycles-through-states affordance;
 * the slider gets keyboard, announcement, and touch for free. Pointer clicks still work per star:
 * the LEFT HALF of a star sets the half value when step=0.5, the right half the whole — and
 * clicking the current value clears to 0, the affordance the whole-star control already had.
 *
 * Rendering: each star is a chip-border glyph with a gold overlay clipped to 0/50/100% width —
 * same two colours the whole-star control used, so no new contrast pair is introduced.
 */
export function Stars({
  value,
  onChange,
  size = 20,
  step = 1,
  labelText = 'Your rating',
}: {
  value: number
  onChange?: (v: number) => void
  size?: number
  labelText?: string
  step?: 1 | 0.5
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  /** Mouse-only live preview: the value the cursor is currently over, or null when it is not over
   *  the control (or the pointer is not a mouse). Never committed — see `display` below. */
  const [hoverValue, setHoverValue] = useState<number | null>(null)
  /** The value under a finger MID-DRAG. Like `hoverValue` it is preview-only and never committed
   *  until pointerup; unlike it, it is set for every pointer type, because a drag is not a fiction
   *  the browser synthesises — the finger really is somewhere. */
  const [dragValue, setDragValue] = useState<number | null>(null)
  /** Whether this press has become a drag. A ref, not state: it is read inside pointer handlers in
   *  the same tick it is written, where a state update has not landed yet. */
  const draggingRef = useRef(false)
  /** Where the press started, so pointerup can tell a TAP from a DRAG without a distance guess. */
  const pressRef = useRef<{ x: number; value: number | null } | null>(null)
  // POINTER QUANTIZATION, deliberately local — the same clamp-and-snap policy as core's
  // snapHalfRating, generalized over `step` for what the interactive control may EMIT. It stays
  // here, unexported, on purpose: a step-parameterized `snapRating(raw, step)` in core would
  // invite `snapRating(x, 1)` on an import path and silently reopen the whole-star truncation
  // #289 closed. This is a third operation that merely RESEMBLES the two data coercions core
  // consolidated; resemblance is not identity, and exporting it would let someone "finish the
  // job" that must not be finished.
  const snap = (v: number) => Math.max(0, Math.min(5, Math.round(v / step) * step))
  // Display mode always renders the half grid: `step` bounds what an INTERACTIVE control can
  // emit (the truncation fence), but a read-only view of a stored 4.5 must show 4.5 — the
  // per-read rows and the format line render without a step prop. snapHalfRating IS this policy
  // (one place, #289); its isFinite guard is the one delta from the expression it replaces —
  // non-finite input now renders 0 rather than propagating NaN into aria labels and overlay
  // widths. Unreachable from a numeric column; strictly safer where it isn't.
  const shown = onChange ? snap(value) : snapHalfRating(value)
  const label = (v: number) => `${v % 1 === 0 ? v : v.toFixed(1)} star${v === 1 ? '' : 's'}`

  /**
   * WHAT THE EYE SEES, split from what the control IS — and the split is the whole design.
   *
   * `shown` stays the COMMITTED value and keeps every job it had: `aria-valuenow`/`aria-valuetext`,
   * the keyboard's `set(shown + delta)`, and the clicking-your-current-value-clears check. `display`
   * is the render-only value, and only `fill()` reads it.
   *
   * Collapsing the two — letting hover override `shown` outright — breaks three things quietly:
   *   · aria would announce a value the reader never chose. A screen-reader user is not moving a
   *     mouse, so a hover preview is a sighted-mouse-user affordance; the accessible value must not
   *     appear to change until a real commit. This is deliberately NOT what is on screen mid-hover.
   *   · arrow keys would step from wherever the mouse happens to be resting rather than from the
   *     committed rating.
   *   · clear-on-reclick compares the clicked value to the current one; against a hover value that
   *     comparison is `v === v` and the affordance dies.
   */
  // Drag first: while a finger is down its position is the most recent thing the reader did, and
  // a stale mouse hover must not outrank it. `shown` is untouched, so aria still announces the
  // COMMITTED value throughout the drag — see the block above for why that split exists.
  const display = dragValue ?? hoverValue ?? shown

  const fill = (i: number): '0%' | '50%' | '100%' => {
    if (display >= i) return '100%'
    if (display >= i - 0.5) return '50%'
    return '0%'
  }

  /**
   * TOUCH TARGET SIZING — coarse pointers only, interactive only.
   *
   * Measured before (390x844): the glyph box was 19.88 x 20px, so each HALF-star zone was
   * 9.94 x 20 — 41% of WCAG 2.5.8's 24x24 minimum (AA in 2.2). Greg reported half stars as hard
   * to hit; that number is the report.
   *
   * A half-zone is BY CONSTRUCTION half a star's box and the zones tile a continuous strip, so
   * padding buys nothing — every pixel already belongs to some half. The star BOX WIDTH is the
   * only lever, and the arithmetic is forced:
   *   step 0.5 -> 10 targets -> 10 x 24 = 240px strip  (62% of a 390px viewport — fits)
   *   step 1   ->  5 targets ->  5 x 24 = 120px strip  (the reviews composer, which omits `step`)
   * 2.5.5 (AAA, 44px) is NOT chased: 10 x 44 = 440px does not fit 390.
   *
   * GLYPH AND ZONE ARE SEPARATE, deliberately: the zone width is driven by the floor above, the
   * glyph stays at its designed `size` (20px default) and is centred inside it. Growing the star
   * to 48px to win the target would be a design change nobody asked for.
   *
   * DISPLAY-MODE STARS ARE NOT TARGETS and get none of this — no floor applies to them.
   *
   * Scope is `pointer-coarse:` (Tailwind's variant, the idiom CoverCard's fave toggle already
   * uses, alongside globals.css's coarse-pointer font-size rule). It cannot affect desktop, and
   * it cannot affect the surface-visual harness, which runs Desktop Chrome — a FINE pointer.
   */
  const targetClass = onChange
    ? step === 0.5
      ? 'pointer-coarse:w-12 pointer-coarse:min-h-6 pointer-coarse:flex pointer-coarse:items-center pointer-coarse:justify-center'
      : 'pointer-coarse:w-6 pointer-coarse:min-h-6 pointer-coarse:flex pointer-coarse:items-center pointer-coarse:justify-center'
    : ''

  /**
   * GLYPH SIZE ON COARSE POINTERS — ruled from the crops, not defaulted.
   *
   * The zone work above widened the interactive strip 107px -> 240px while the glyph stayed at its
   * designed 20px, leaving ~28px of empty space per cell. The before/after crops (almanac + tryst,
   * 390x844) showed two things a passing geometry assertion cannot: the row stopped reading as ONE
   * control and became five scattered marks, and — worse — the SAME screen carries display-mode
   * stars (the per-format line, per-read rows) whose tight rhythm the spread row now contradicts.
   * Same glyph size, radically different spacing, 40px apart vertically: that reads as broken
   * rather than as hierarchy.
   *
   * 32px in a 48px cell fills it, restores the row as a unit, and makes the interactive control
   * visibly PRIMARY against the small (12px) display rows — which is the correct relationship and
   * turns the mismatch into hierarchy. 20px was designed for a fine pointer at desktop scale; a
   * thumb at 390px is a different design context. Targets comply at either glyph size, so this is
   * a design call — and the crops are why it is now a decision rather than a leftover.
   *
   * Delivered as a CSS variable so the coarse-pointer override beats the inline base size, and so
   * DISPLAY-MODE stars keep their caller's `size` untouched (they are not targets and get none of
   * this).
   */
  //  --star-glyph is set ONLY by the coarse-pointer rule below; the caller's `size` rides as the
  //  var()'s FALLBACK on the glyph itself. Setting the base inline (the first attempt) made the
  //  override inert: an inline custom property beats a stylesheet rule regardless of media query,
  //  so the class was present, the CSS was generated, and the glyph still computed 20px. Measured,
  //  not reasoned — the audit read `--star-glyph: 20px` with the class applied.
  const glyphGrow = onChange ? 'pointer-coarse:[--star-glyph:32px]' : ''

  const star = (i: number) => (
    <span
      key={i}
      aria-hidden
      data-star={i}
      className={`relative inline-block leading-none ${targetClass}`}
      style={{ fontSize: `var(--star-glyph, ${size}px)`, color: 'var(--chip-border)' }}
    >
      {/* The gold fill clips a copy of the glyph. It is positioned against the GLYPH's own box
          (a nested relative span), not the widened target box — otherwise a 48px-wide coarse
          target would stretch the 50% fill to 24px and the half star would render as a smear. */}
      <span className="relative inline-block">
        ★
        <span
          className="absolute inset-y-0 left-0 overflow-hidden"
          style={{ width: fill(i), color: 'var(--gold)' }}
        >
          ★
        </span>
      </span>
    </span>
  )

  if (!onChange) {
    return (
      <div className="flex gap-0.5" role="img" aria-label={`Rated ${label(shown)} of 5`}>
        {[1, 2, 3, 4, 5].map(star)}
      </div>
    )
  }

  const set = (v: number) => onChange(snap(v))

  const onKeyDown = (e: KeyboardEvent) => {
    const delta =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? step
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -step
          : null
    if (delta !== null) {
      e.preventDefault()
      set(shown + delta)
      return
    }
    if (e.key === 'Home') {
      e.preventDefault()
      set(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      set(5)
    }
  }

  /** Which value the pointer is over: closest [data-star], left half vs right half. Extracted so
   *  the move and the press cannot drift apart — two copies of this arithmetic is exactly how a
   *  preview ends up one half-star off the thing it commits. */
  const hitValue = (e: PointerEvent): number | null => {
    const root = rootRef.current
    if (!root) return null
    // COORDINATE-BASED, NOT `e.target.closest(...)`, and this is what makes the drag work at all.
    //
    // `setPointerCapture` RETARGETS every subsequent event to the capturing element — the root —
    // so `e.target` stops being the star under the finger the moment capture is taken. The old
    // `closest('[data-star]')` then returns null for the entire drag and every move is discarded:
    // no error, no warning, the stars simply never move. Asking the ROOT which star contains this
    // x-coordinate is immune, because it never consults the event's target.
    const stars = Array.from(root.querySelectorAll('[data-star]')) as HTMLElement[]
    if (stars.length === 0) return null
    // First star whose right edge is at or past the pointer; past the last star, the last one.
    // Clamping rather than returning null keeps a drag that runs off either end pinned to the end
    // instead of dropping the preview mid-gesture.
    const hit = stars.find((el) => e.clientX <= el.getBoundingClientRect().right) ?? stars.at(-1)
    if (!hit) return null
    const i = Number(hit.getAttribute('data-star'))
    const rect = hit.getBoundingClientRect()
    const leftHalf = e.clientX - rect.left < rect.width / 2
    return step === 0.5 && leftHalf ? i - 0.5 : i
  }

  /**
   * MOUSE ONLY, and that is a correctness gate rather than a preference.
   *
   * A touch "hover" is a fiction the browser synthesises: `pointermove` fires with
   * `pointerType: 'touch'` during a drag, and the event ordering around tap is not dependable —
   * so a touch preview would light stars under a finger that is scrolling past. Coarse pointers
   * also already have a deliberately different model here (the 32px glyph / 48px target work in
   * the block above), and this must not disturb it. Pen is excluded for the same ordering reason:
   * hover is only trustworthy from a device that genuinely has it.
   */
  const isMouse = (e: PointerEvent) => e.pointerType === 'mouse'

  const onPointerMove = (e: PointerEvent) => {
    // A press in progress takes precedence over the hover model for EVERY pointer type: once a
    // finger (or a held mouse button) is down, the reader is choosing, not browsing.
    if (pressRef.current) {
      const v = hitValue(e)
      if (v === null) return
      // A press only becomes a drag once it moves to a DIFFERENT value. A few pixels of thumb
      // wobble inside one half-star zone is still a tap, which is what keeps clear-on-reclick
      // usable on touch — the affordance would otherwise be almost unhittable.
      if (v !== pressRef.current.value) draggingRef.current = true
      setDragValue(v)
      return
    }
    if (!isMouse(e)) return
    setHoverValue(hitValue(e))
  }

  /** Both, because they are different exits: leave is the mouse going away, cancel is the browser
   *  taking the pointer (a drag starting, a context menu, the tab losing it). Either way the
   *  preview is stale and the display owes the reader the committed value again. */
  const clearHover = () => setHoverValue(null)

  /**
   * PRESS PREVIEWS, RELEASE COMMITS. The press no longer writes.
   *
   * Committing on pointerdown made every drag a write of wherever the finger first landed, and
   * then four more writes as it moved — the reader's rating would be whatever they happened to
   * touch on the way to what they wanted. One gesture is one decision, so it is one commit.
   */
  const onPointerDown = (e: PointerEvent) => {
    const v = hoverValue ?? hitValue(e)
    if (v === null) return
    pressRef.current = { x: e.clientX, value: v }
    draggingRef.current = false
    setDragValue(v)
    // Capture so the gesture keeps reporting after the finger leaves the star it started on —
    // without it, moves outside the root never arrive and the drag stops at the first boundary.
    try {
      rootRef.current?.setPointerCapture(e.pointerId)
    } catch {
      // Older/synthetic pointers may refuse capture. The drag then works only within the root,
      // which is a degradation rather than a break — so this is deliberately not fatal.
    }
  }

  const onPointerUp = (e: PointerEvent) => {
    const press = pressRef.current
    pressRef.current = null
    const wasDragging = draggingRef.current
    draggingRef.current = false
    setDragValue(null)
    if (!press) return
    const v = hitValue(e) ?? press.value
    if (v === null) return
    // CLEAR-ON-RECLICK IS A TAP AFFORDANCE, NOT A DRAG ONE. Dragging to the value you already have
    // is a reader landing where they meant to land; zeroing it there would punish precision. Only
    // a tap — press and release without the pointer having moved between stars — can clear.
    if (!wasDragging && v === shown) set(0)
    else set(v)
  }

  return (
    <div
      ref={rootRef}
      role="slider"
      tabIndex={0}
      aria-label={labelText}
      aria-valuemin={0}
      aria-valuemax={5}
      aria-valuenow={shown}
      aria-valuetext={shown === 0 ? 'No rating' : label(shown)}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={clearHover}
      onPointerCancel={(e) => {
        // The browser took the pointer (scroll took over, context menu, tab blur). Abandon the
        // gesture WITHOUT committing: a cancelled gesture is not a decision.
        pressRef.current = null
        draggingRef.current = false
        setDragValue(null)
        clearHover()
        void e
      }}
      // gap-0 on coarse pointers: a 2px gap between stars is a DEAD strip between adjacent
      // targets, and the ten half-zones are supposed to tile continuously. Fine pointers keep it.
      className={`flex cursor-pointer gap-0.5 outline-offset-2 focus-visible:outline focus-visible:outline-2 pointer-coarse:gap-0 ${glyphGrow}`}
      // `pan-y`, NOT `none`: the browser keeps vertical scrolling, so a reader swiping the page
      // from over the stars still scrolls, while horizontal movement belongs to the rating. `none`
      // would trap the page — the control would win a gesture the reader meant for the document.
      style={{ outlineColor: 'var(--accent)', touchAction: 'pan-y' }}
    >
      {[1, 2, 3, 4, 5].map(star)}
    </div>
  )
}
