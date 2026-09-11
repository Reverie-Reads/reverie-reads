import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { authorOf, isBorrowedBook, isDnf, isPossessed, stateSuffix, type Book } from '@reverie/core'
import { Spine } from './Spine'
import { CoverImage } from './CoverImage'
import { PlusGlyph } from './PlusGlyph'
import { StatePill } from './StatePill'
import { ProgressMeter } from './Structure'

/**
 * A horizontal shelf of book spines — each a real per-skin Spine (gilt-bound Tryst · brushed-metal
 * Aphelion), sized book-to-book, with a FIXED REVEAL WINDOW (fix/spine-reveal-window): one
 * position on screen — where the first book sits at rest — where magnification always happens.
 * Books scroll THROUGH it; whatever spine passes under it blooms into its cover and contracts as
 * the next arrives. The window never moves. A book's magnification is a pure function of its
 * distance from the window, evaluated per frame from live scroll position — inherently
 * continuous, no stepping, no lag, no stale pick, because there is no travelling centre left to
 * go stale. (The travelling anchor this replaces was the source of every remaining defect: it
 * reached the terminals where there was no room, so #146 clamped it, #147 shoved its overflow
 * back on-screen, and #148 dampened its thumb-drift jitter. All three died with it.)
 * docs/research/in-row-expansion.md is the feasibility basis; the audits it cites are
 * the failure history this mechanism must not repeat:
 *
 *  · NOT the in-flow swap (attempt 1): that mutated scrollWidth mid-gesture, so momentum computed
 *    its destination against a track whose end then moved. Transforms do not reflow — layout boxes
 *    here never change, and the pick arithmetic below deliberately reads offset* geometry (layout
 *    space, transform-independent) so magnification cannot feed back into its own anchor.
 *  · NOT the absolute overlay (attempt 2): a 120px box over a 36px slot buried siblings by
 *    construction. Here neighbours are translated aside and keep their own hit regions and a11y
 *    nodes — hit-testing follows the transformed box (CSS Transforms L1), so the magnified spine
 *    is tappable at its enlarged rectangle and a displaced neighbour is tappable where it moved.
 *  · NOT the naive dock either: in Blink/WebKit a transformed child crossing the scroll
 *    container's END edge extends scrollWidth (CSSWG #9458 — observed behavior; the START edge
 *    trims and contributes nothing). A rightward neighbour push would reintroduce the momentum
 *    bug through a different door. The RESERVED SLACK below is the recipe that avoids it: static
 *    leading/trailing spacers, part of scrollWidth from the first frame, sized above the peak
 *    expansion delta, so every transformed box stays inside the natural content bounds and
 *    scrollWidth is a constant that momentum computes against correctly.
 *
 * The choreography is driven imperatively — per-frame style writes from the scroll handler's rAF,
 * never through React state. React renders only when the PICK changes (aria-labels), ~15×/fling;
 * the transforms move at frame rate without a single re-render.
 */

/** Magnified (cover) size — the same 120×176 every reveal in this app has used. */
const MAG_W = 120
const MAG_H = 176
/** LEADING reserved slack. Sized so the window (the first slot's centre, at LEAD_SLACK + gap +
 *  w0/2 ≈ 118-125px) has room for the magnified box's left half plus ring (MAG_W/2 + RING_W ≈
 *  62px) inside the viewport at rest — measured margin ~57px at the narrowest fixture. Static,
 *  rendered from the first frame, never mutated: that is the momentum contract (scrollWidth is a
 *  constant every fling computes against). The TRAILING slack is the responsive spacer below —
 *  sized per layout so the LAST book's centre reaches the window at scrollLeft max, exactly. */
const LEAD_SLACK = 96
/** Gaussian falloff width (px, content space). At slot pitch ~44px the immediate neighbour sits
 *  at t≈0.29 and the next at t≈0.007 — only the 1–3 items nearest the anchor deviate
 *  meaningfully, which is the density constraint (~10 spines per screen at rest). */
const SIGMA = 28
/** The picked item's lift, folded into the same transform (translateY · t). */
const LIFT = 8
/** The picked-cover accent ring's width (the box-shadow spread in the JSX below). */
const RING_W = 2
/** HOVER INTENT (fix/spine-reveal-window): a mouse hover arms the pointer pin after this delay
 *  instead of instantly. An instant hover-pin bloomed whatever the cursor CROSSED on its way to
 *  a target, and the bloom's displacement reshuffled the shelf under the approaching cursor —
 *  measured as seven oscillating pointerenter events on one approach, a drag that started on the
 *  crossed spine instead of the aimed-at one, and Playwright's dragTo hanging on a source whose
 *  box never stabilised. With intent, transit never pins — only dwell does — so boxes hold still
 *  for anything aiming at them. Click/tap/focus picks stay instant. */
const HOVER_INTENT_MS = 80

function ShelfArrow({ direction }: { direction: 'previous' | 'next' }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`h-5 w-5 ${direction === 'previous' ? 'rotate-180' : ''}`}
      fill="none"
    >
      <path
        d="M5 12h13M13 7l5 5-5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
/** VERTICAL HEADROOM (fix/spine-reveal-window): the revealed cover's peak extent above the spine
 *  baseline is a CONSTANT — MAG_H + LIFT + RING_W = 186px — yet the row's height was
 *  content-derived (tallest spine + padding), so shelves whose tallest spine fell short clipped
 *  the revealed cover's top at the track's clip edge. Measured before this fix: the 1- and 2-book
 *  fixtures clipped 11px and 8px of cover+ring AT REST. Every invariance assertion in this arc
 *  measured scrollWidth only; nothing ever asserted the vertical box — which is how that shipped
 *  green. The track's minHeight reserves the peak exactly: headroom + bottom padding (pb-4 =
 *  16px) + the reorder-arrows row where present. Cost, measured against the spine-reveal-band
 *  audit's budget table: 0px on every rail whose tallest spine ≥ ~154px (all four measured
 *  /shelves rails and shelf detail pay nothing); only short-spined shelves grow, ≤ ~19px. */
const REVEAL_HEADROOM = MAG_H + LIFT + RING_W
/** pb-4 on the track, in px — part of the minHeight arithmetic above. */
const TRACK_PAD_BOTTOM = 16
/** The reorder-arrows row under each spine on arrangeable shelves (13px buttons + 4px mt-1). */
const REORDER_ROW_H = 17

type SlotNodes = { art: HTMLElement; cover: HTMLElement }

export function SpineShelf({
  books,
  onOpen,
  onAdd,
  addLabel = 'Add a book',
  onReorder,
  compact = false,
}: {
  books: Book[]
  onOpen: (id: string) => void
  /** renders a "+" end-cap slot on the shelf — the add-book affordance in shelf form */
  onAdd?: () => void
  addLabel?: string
  /** when set, spines can be dragged (and keyboard-moved) into a new order */
  onReorder?: (orderedIds: string[]) => void
  /** overview rows omit the selected-book inspector so several shelves remain quickly scannable */
  compact?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(books[0]?.id ?? null)
  // Pointer/keyboard pick, layered over the scroll-driven pick: shelves too short to scroll never
  // move activeId, so hover / :focus-visible / first-tap must be able to pick a spine too.
  const [pointerId, setPointerId] = useState<string | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const shownId = pointerId ?? activeId
  const shownIdRef = useRef<string | null>(shownId)
  shownIdRef.current = shownId
  /** Move the spine at `from` into slot `to`, then hand the whole new order up. */
  const place = (from: number, to: number) => {
    if (
      !onReorder ||
      from === to ||
      to < 0 ||
      to >= books.length ||
      from < 0 ||
      from >= books.length
    )
      return
    const ids = books.map((b) => b.id)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved!)
    onReorder(ids)
  }

  const nodesCache = useRef(new WeakMap<HTMLElement, SlotNodes>())
  const nodesFor = (slot: HTMLElement): SlotNodes | null => {
    const cached = nodesCache.current.get(slot)
    if (cached && cached.art.isConnected) return cached
    const art = slot.querySelector<HTMLElement>('[data-mag-art]')
    const cover = slot.querySelector<HTMLElement>('[data-mag-cover]')
    if (!art || !cover) return null
    const nodes = { art, cover }
    nodesCache.current.set(slot, nodes)
    return nodes
  }

  /**
   * THE WAVE RENDERER. Everything READS offset* geometry — layout space, which transforms cannot
   * touch — so the wave can never perturb its own inputs. Everything WRITES transforms and
   * opacities — paint space, which layout cannot see — so the wave can never perturb scrollWidth
   * either, provided every transformed box stays inside the slack (the guard's job to prove).
   *
   * The centre `cx` is EXPLICIT, in track content coordinates. Two callers only:
   *   · the scroll rAF passes the WINDOW's content position (scrollLeft + windowW) — same-frame,
   *     no React round-trip (the #146 bar: p50 0.6ms scroll-to-write), continuous by definition;
   *   · a pointer/keyboard pick passes the pinned slot's own centre, so a hovered or tapped spine
   *     blooms in place without moving the shelf.
   * No clamp: the window's content position can only leave [firstCentre, lastCentre] during
   * rubber-band overscroll, where every t shrinks toward rest and no box approaches either
   * content edge — the #146 clamp existed because the travelling anchor degenerated to
   * cx = scrollLeft there and pushed the first box past the trimmed start edge; a window at
   * scrollLeft + ~120px cannot. No hard block either: the window sits ≥ MAG_W/2 + RING_W inside
   * the viewport by the slack arithmetic, so the revealed box is fully visible by construction —
   * the #147 block existed to shove a terminal-pinned wave's overflow back on-screen, and there
   * is no terminal-pinned wave left.
   *
   * prefers-reduced-motion: the falloff wave is replaced by a binary state — the picked item at
   * full magnification, everything else exactly at rest. No intermediate scale/translate wave.
   */
  const renderWave = (cxRaw: number): void => {
    const el = ref.current
    if (!el) return
    const slots = el.querySelectorAll<HTMLElement>('[data-spine]')
    const n = slots.length
    if (n === 0) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const cx = cxRaw

    // Pass 1: magnification factor and the width each slot's scale visually adds.
    const t = new Array<number>(n)
    const sx = new Array<number>(n)
    const sy = new Array<number>(n)
    const added = new Array<number>(n)
    const widths = new Array<number>(n)
    let total = 0
    for (let i = 0; i < n; i++) {
      const s = slots[i]!
      const w = s.offsetWidth
      const h = s.offsetHeight
      const centre = s.offsetLeft + w / 2
      widths[i] = w
      const d = centre - cx
      let ti = Math.exp(-(d * d) / (2 * SIGMA * SIGMA))
      if (reduced) ti = s.dataset.spine === shownIdRef.current ? 1 : 0
      t[i] = ti
      sx[i] = 1 + (MAG_W / w - 1) * ti
      sy[i] = 1 + (MAG_H / h - 1) * ti
      added[i] = w * (sx[i]! - 1)
      total += added[i]!
    }
    // Pass 2: displacement — each slot shifts by (width added before it + half its own) minus half
    // the total, so growth splits symmetrically around the wave: left neighbours end near
    // −total/2, right neighbours near +total/2, the wave's centre near 0. The slack absorbs the
    // halves at the ends; nothing is ever pushed past it.
    let cum = 0
    for (let i = 0; i < n; i++) {
      const s = slots[i]!
      const nodes = nodesFor(s)
      const dx = cum + added[i]! / 2 - total / 2
      cum += added[i]!
      if (!nodes) continue
      const ti = t[i]!
      // The transform goes on the BUTTON itself, not an inner wrapper. getBoundingClientRect does
      // not include descendants, so a wrapper-level transform left the button's reported box at
      // its layout position while its visuals moved aside — and everything that aims at the box
      // (a hit-test runner, a keyboard focus ring, scrollIntoView) aimed at a spot the magnified
      // neighbour was now painting over. Transforming the button keeps box, focus ring and
      // visuals in agreement; hit-testing follows the transformed box (CSS Transforms L1).
      s.style.transform = `translate(${dx.toFixed(2)}px, ${(-LIFT * ti).toFixed(2)}px) scale(${sx[i]!.toFixed(4)}, ${sy[i]!.toFixed(4)})`
      s.style.zIndex = String(1 + Math.round(ti * 8))
      // Cross-fade spine → cover across the top half of the magnification. The BUTTON's scale is
      // non-uniform by necessity (spine ratio → cover ratio), so each child COUNTER-SCALES to a
      // uniform net factor — the bitmap-bearing boxes never distort; the transition is carried by
      // the cross-fade and the container geometry (fix/spine-magnify-geometry, defect 1: covers
      // measured squat down to ratio 0.45 vs 0.68 intrinsic mid-glide, with object-cover then
      // cropping mid-image into the wrong-ratio box).
      const fade = Math.min(1, Math.max(0, ti * 2 - 1))
      nodes.art.style.opacity = String(1 - fade)
      nodes.cover.style.opacity = String(fade)
      // Spine art: net uniform scale sy — it tracks the box's height (the shelf line) and keeps
      // the spine texture's own ratio at every wave position.
      nodes.art.style.transform = `scale(${(sy[i]! / sx[i]!).toFixed(4)}, 1)`
      // Cover: a fixed 120×176 layout box (bottom-centre anchored), net-scaled uniformly so its
      // rendered width always equals the button's rendered box width — the cover inflates with
      // the box, at the cover's own ratio, and lands at exactly MAG_W×MAG_H when t = 1 where the
      // box IS 120×176. cu is the net factor; dividing out the button's (sx, sy) yields the
      // child transform.
      const cu = (widths[i]! * sx[i]!) / MAG_W
      nodes.cover.style.transform = `translateX(-50%) scale(${(cu / sx[i]!).toFixed(4)}, ${(cu / sy[i]!).toFixed(4)})`
    }
    // The add end cap is the next shelf item after the final spine, so it must take the same
    // right-side displacement as every item after the wave. Leaving it at its layout position let
    // the magnified final spine paint across the entire + control. The trailing reserved slack
    // already contains this paint-space movement, preserving the fixed scrollWidth contract.
    const add = el.querySelector<HTMLElement>('[data-shelf-add]')
    if (add) add.style.transform = `translateX(${(total / 2).toFixed(2)}px)`
  }
  const renderWaveRef = useRef(renderWave)
  renderWaveRef.current = renderWave
  const idleTimerRef = useRef(0)
  /** Mirror of pointerId for the scroll handler (it lives in a [books]-keyed effect). */
  const pointerIdRef = useRef<string | null>(null)
  pointerIdRef.current = pointerId
  /** Pending hover-intent timer (see HOVER_INTENT_MS). */
  const hoverTimerRef = useRef(0)
  /** Screen point that armed the current hover pin. Magnification can move another hit box under a
   *  stationary cursor; a pointerenter at the same point is layout churn, not reader intent. */
  const hoverPinnedPointRef = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => () => window.clearTimeout(hoverTimerRef.current), [])
  const armHoverPick = (id: string, x: number, y: number) => {
    const pinnedPoint = hoverPinnedPointRef.current
    if (
      pointerIdRef.current != null &&
      pinnedPoint &&
      Math.hypot(x - pinnedPoint.x, y - pinnedPoint.y) < 6
    )
      return
    window.clearTimeout(hoverTimerRef.current)
    const point = { x, y }
    hoverTimerRef.current = window.setTimeout(() => {
      hoverPinnedPointRef.current = point
      setPointerId(id)
    }, HOVER_INTENT_MS)
  }
  /** True while settleScroll's own smooth glide is emitting scroll events. Its writes are the
   *  component's, not the user's — they must never dismiss a pointer pin (a hover pick landing
   *  while the glide's tail is still emitting was getting cleared by the pin's scroll-dismissal
   *  rule on slow CI runners). Cleared on arrival at the settle target, or instantly by any real
   *  user input (which also cancels the native smooth scroll itself). */
  const settlingRef = useRef(false)
  const settleTargetRef = useRef(0)
  /** When the pointer pin was set — scroll clears the pin only after a grace period, because a
   *  keyboard focus on an off-screen spine triggers the browser's own scroll-into-view, and that
   *  programmatic scroll must not immediately dismiss the pick it belongs to. */
  const pinnedAtRef = useRef(0)
  useEffect(() => {
    if (pointerId != null) pinnedAtRef.current = performance.now()
  }, [pointerId])

  /** THE WINDOW: the fixed on-screen offset where reveals happen — the first slot's centre at
   *  scrollLeft 0 (LEAD_SLACK + gap + w0/2), so the resting appearance matches what every reader
   *  already knows. Offset geometry, so the wave cannot perturb it. */
  const windowW = (el: HTMLElement): number => {
    const first = el.querySelector<HTMLElement>('[data-spine]')
    return first ? first.offsetLeft + first.offsetWidth / 2 : 0
  }

  /** Seat a book in the fixed reveal window. Arrow buttons and the scrubber use the same geometry
   *  as touch scrolling, including the terminal slack solve, so the final marker and final spine
   *  arrive together instead of representing two subtly different notions of "the end". */
  const scrollToIndex = (index: number): void => {
    const el = ref.current
    if (!el || books.length === 0) return
    const next = Math.max(0, Math.min(books.length - 1, index))
    const slot = el.querySelectorAll<HTMLElement>('[data-spine]')[next]
    const book = books[next]
    if (!slot || !book) return
    const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth)
    const target = Math.min(
      maxScroll,
      Math.max(0, slot.offsetLeft + slot.offsetWidth / 2 - windowW(el)),
    )
    setPointerId(null)
    setActiveId(book.id)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    settlingRef.current = !reduced
    settleTargetRef.current = target
    el.scrollTo({ left: target, behavior: reduced ? 'auto' : 'smooth' })
  }

  /** Auto-centre after a gesture ends: scroll the nearest slot into the window so every settled
   *  state ends with a book fully open (t = 1) — the settled-state guarantee that used to come
   *  from easing the WAVE onto the pick now comes from easing the SCROLL onto the slot, which
   *  keeps the single invariant intact: magnification is a pure function of scroll position.
   *  Native smooth scrolling (cancelled automatically by user input, snapped under
   *  prefers-reduced-motion); its own scroll events re-arm the idle timer, and the re-fire
   *  no-ops once the target is reached. */
  const settleScroll = (): void => {
    const el = ref.current
    if (!el || pointerIdRef.current != null) return
    const W = windowW(el)
    const cx = el.scrollLeft + W
    let bestCentre: number | null = null
    let bd = Infinity
    el.querySelectorAll<HTMLElement>('[data-spine]').forEach((s) => {
      const c = s.offsetLeft + s.offsetWidth / 2
      const d = Math.abs(c - cx)
      if (d < bd) {
        bd = d
        bestCentre = c
      }
    })
    if (bestCentre == null) return
    const maxScroll = el.scrollWidth - el.clientWidth
    const target = Math.min(maxScroll, Math.max(0, bestCentre - W))
    if (Math.abs(target - el.scrollLeft) < 1) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    settlingRef.current = !reduced
    settleTargetRef.current = target
    el.scrollTo({ left: target, behavior: reduced ? 'auto' : 'smooth' })
  }
  const settleScrollRef = useRef(settleScroll)
  settleScrollRef.current = settleScroll

  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const update = () => {
      // THE WINDOW replaces the sliding anchor (docs/audits/spine-overlay-clamp.md §4/§6): the
      // anchor existed so scrolling could pick the terminal books past a fixed viewport-CENTRE
      // anchor's dead zone. The window solves the same reachability differently — the trailing
      // slack is sized so the LAST book's centre reaches the window at scrollLeft max exactly,
      // and the leading slack puts the FIRST book in it at 0 — so every book scrolls through it
      // with no progress mapping, no amplification factor, and no terminal it can't reach. All
      // distances are OFFSET geometry — transform-independent — so the magnification wave cannot
      // oscillate its own pick.
      const cx = el.scrollLeft + windowW(el)
      let best: string | null = null
      let bd = Infinity
      el.querySelectorAll<HTMLElement>('[data-spine]').forEach((s) => {
        const d = Math.abs(s.offsetLeft + s.offsetWidth / 2 - cx)
        if (d < bd) {
          bd = d
          best = s.dataset.spine ?? null
        }
      })
      setActiveId(best)
      if (settlingRef.current && Math.abs(el.scrollLeft - settleTargetRef.current) < 2)
        settlingRef.current = false
      // A real USER scroll dismisses a pointer pin (the window takes over) — but not the
      // settle-glide's own writes (settlingRef), and not within the grace period after a pin
      // (the browser's own focus-scroll for that pin).
      if (
        !settlingRef.current &&
        pointerIdRef.current != null &&
        performance.now() - pinnedAtRef.current > 400
      )
        setPointerId(null)
      // The wave follows the window in the SAME frame the scroll was sampled — no React
      // round-trip (the #146 bar), and no second regime: this is the only place scroll-driven
      // magnification is ever computed. A live pointer pin keeps its in-place bloom instead.
      if (pointerIdRef.current == null) renderWaveRef.current(cx)
      // When no scroll event lands for 140ms the gesture is over; ease the SCROLL so the nearest
      // book centres in the window and the settled state ends fully open.
      window.clearTimeout(idleTimerRef.current)
      idleTimerRef.current = window.setTimeout(() => settleScrollRef.current(), 140)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const onUserInput = () => {
      settlingRef.current = false
    }
    el.addEventListener('wheel', onUserInput, { passive: true })
    el.addEventListener('touchstart', onUserInput, { passive: true })
    el.addEventListener('pointerdown', onUserInput, { passive: true })
    // Initial mount: the first book sits in the window by construction — render and pick it.
    renderWaveRef.current(el.scrollLeft + windowW(el))
    update()
    setPointerId(null)
    return () => {
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onUserInput)
      el.removeEventListener('touchstart', onUserInput)
      el.removeEventListener('pointerdown', onUserInput)
      cancelAnimationFrame(raf)
      window.clearTimeout(idleTimerRef.current)
    }
  }, [books])

  // THE TRAILING SLACK, responsive: sized so the LAST book's centre reaches the window at
  // scrollLeft max, exactly — trail = clientWidth − window − wLast/2 − gap, which makes
  // maxScroll + window = lastCentre by construction (and makes a 1-book shelf's scrollWidth
  // exactly clientWidth: nothing to scroll, the sole book already in the window). Measured at
  // mount and on container resize — both OUTSIDE any gesture, so scrollWidth remains the
  // constant every fling computes against (the momentum contract; the per-frame invariance
  // guard proves it). Until the first measurement it renders at LEAD_SLACK, one layout pass.
  const [trailSlack, setTrailSlack] = useState<number | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const slots = el.querySelectorAll<HTMLElement>('[data-spine]')
      const spacer = el.querySelector<HTMLElement>('[data-trail-slack]')
      if (slots.length === 0 || !spacer) return
      const last = slots[slots.length - 1]!
      const lastCentre = last.offsetLeft + last.offsetWidth / 2
      // Solve against the ACTUAL content end rather than assuming the last book is the last
      // child — the add-book end-cap (and any future trailing content) sits between the last
      // spine and this spacer, and a formula that ignored it left maxScroll ~42px past the
      // window's last-book position (caught by the diagnosis probe, not by review). We want
      // scrollWidth = lastCentre + (clientWidth − window), i.e. maxScroll + window = lastCentre.
      // The content-so-far is the spacer's own offsetLeft — NEVER scrollWidth − spacerWidth,
      // because scrollWidth is floored at clientWidth: on a desktop viewport a tiny shelf's
      // content is narrower than the track, the floored value overstates it, and the solve
      // converges ~590px short — measured as maxScroll 0 on the 2-book fixture at 976px, the
      // last book permanently unable to reach the window (caught by the terminal-rest guard on
      // the rest project; the mobile project's narrower viewport never hits the floor).
      const trail = Math.max(
        0,
        Math.round(lastCentre + el.clientWidth - windowW(el) - spacer.offsetLeft),
      )
      setTrailSlack((prev) => (prev === trail ? prev : trail))
    }
    measure()
    // jsdom (the unit-test DOM) has no ResizeObserver; every target browser does. The initial
    // measure above is unconditional — only the resize RE-measure is feature-gated.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [books])

  // Pointer picks (hover, tap, :focus-visible) bloom IN PLACE — the wave renders around the
  // pinned slot's own centre in the same frame its aria flips, so the magnified state and the
  // accessible state agree; when the pin clears, the wave returns to the window.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (pointerId != null) {
      const slot = el.querySelector<HTMLElement>(`[data-spine="${CSS.escape(pointerId)}"]`)
      if (slot) renderWaveRef.current(slot.offsetLeft + slot.offsetWidth / 2)
    } else {
      renderWaveRef.current(el.scrollLeft + windowW(el))
    }
  }, [pointerId, books])

  const shownIndex = Math.max(
    0,
    books.findIndex((book) => book.id === shownId),
  )
  const shownBook = books[shownIndex]
  // Index / (length - 1), not (index + 1) / length: the endpoints are semantic. The first book is
  // exactly 0 and the last is exactly 100, including the two-book case that exposed the old
  // one-short marker visually.
  const positionPct = books.length <= 1 ? 100 : (shownIndex / (books.length - 1)) * 100

  return (
    <section
      data-spine-shelf
      className="skin-panel isolate overflow-hidden border border-line"
      style={{ background: 'var(--panel-fill)', boxShadow: 'var(--shadow)' }}
    >
      {!compact &&
        (shownBook ? (
          <div
            className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-4 border-b border-line p-4 sm:grid-cols-[86px_minmax(0,1fr)_auto] sm:gap-5 sm:p-5"
            style={{
              background:
                'linear-gradient(110deg, color-mix(in srgb, var(--primary) 10%, transparent), transparent 48%)',
            }}
          >
            <button
              type="button"
              onClick={() => onOpen(shownBook.id)}
              className="skin-card aspect-[2/3] w-[72px] overflow-hidden border border-line sm:w-[86px]"
              style={{
                background: 'var(--field)',
                filter: 'drop-shadow(0 10px 12px rgba(0, 0, 0, 0.28))',
              }}
              aria-label={`Open ${shownBook.title}`}
            >
              <CoverImage book={shownBook} />
            </button>
            <div className="min-w-0">
              <span className="skin-label text-[12px]" style={{ color: 'var(--accent-ink)' }}>
                Volume {String(shownIndex + 1).padStart(2, '0')} · {books.length}
              </span>
              <h3
                className="mt-1 break-words text-[20px] font-semibold leading-[1.08] text-ink sm:text-[25px]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {shownBook.title}
              </h3>
              <p className="mt-1 break-words text-[13px] leading-[1.45] text-muted">
                {authorOf(shownBook) || 'Author not set'}
              </p>
              <div className="mt-3 max-w-[360px]">
                <ProgressMeter value={shownBook.progress} max={100} />
                <div className="mt-1.5 flex items-center justify-between gap-3 text-[12.5px] text-muted">
                  <span>{shownBook.readStatus}</span>
                  <span className="skin-numeral">{shownBook.progress}%</span>
                </div>
              </div>
            </div>
            <div className="col-span-2 flex items-center gap-2 sm:col-span-1 sm:flex-col sm:items-stretch">
              <button
                type="button"
                onClick={() => onOpen(shownBook.id)}
                className="skin-control skin-btn-primary h-11 flex-1 px-4 text-[13.5px] sm:flex-none"
              >
                Open book
              </button>
              <div className="flex flex-none gap-2">
                <button
                  type="button"
                  onClick={() => scrollToIndex(shownIndex - 1)}
                  disabled={shownIndex === 0}
                  className="skin-control skin-btn-icon grid h-11 w-11 flex-none place-items-center disabled:opacity-45"
                  aria-label="Previous book"
                >
                  <ShelfArrow direction="previous" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollToIndex(shownIndex + 1)}
                  disabled={shownIndex === books.length - 1}
                  className="skin-control skin-btn-icon grid h-11 w-11 flex-none place-items-center disabled:opacity-45"
                  aria-label="Next book"
                >
                  <ShelfArrow direction="next" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 border-b border-line p-5">
            <div>
              <span className="skin-label text-[12px]" style={{ color: 'var(--accent-ink)' }}>
                The shelf is waiting
              </span>
              <p className="mt-1 text-[13px] text-muted">Add the first volume to begin.</p>
            </div>
            {onAdd ? (
              <button
                type="button"
                onClick={onAdd}
                className="skin-control skin-btn-primary h-11 px-4 text-[13.5px]"
              >
                ＋ Add a book
              </button>
            ) : null}
          </div>
        ))}

      <div className="flex items-end justify-between gap-4 px-4 pb-1 pt-4 sm:px-5">
        <div>
          <span className="skin-label text-[12px]" style={{ color: 'var(--accent-ink)' }}>
            Browse the shelf
          </span>
          <p className="mt-1 text-[12.5px] leading-[1.45] text-muted">
            Drag, swipe, or use the arrows
          </p>
        </div>
        {shownBook ? (
          <span className="skin-numeral text-[12.5px] text-muted">
            {shownIndex + 1} / {books.length}
          </span>
        ) : null}
      </div>

      <div className="relative overflow-hidden pt-2">
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-[var(--panel-fill)] to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-[var(--panel-fill)] to-transparent" />
        <div
          ref={ref}
          // `relative` so the track is its slots' offsetParent: every offsetLeft in the pick and wave
          // arithmetic is then in the SAME track-content coordinate space as scrollLeft. Without it,
          // offsets were measured from <main> — a systematic ~16px (section padding) frame mismatch
          // between slot centres and the anchor, found while measuring the tracking defect.
          className="relative flex items-end gap-1.5 overflow-x-auto pb-4 pt-8"
          // minHeight reserves the revealed cover's constant peak extent (see REVEAL_HEADROOM's
          // comment) — the floor, not the height: shelves whose spines already exceed it are
          // untouched.
          style={{
            scrollbarWidth: 'none',
            minHeight: REVEAL_HEADROOM + TRACK_PAD_BOTTOM + (onReorder ? REORDER_ROW_H : 0),
          }}
          // MOUSE-ONLY. Touch pointers are transient: the
          // browser fires a full pointerleave chain after EVERY tap-release (measured in Chromium's
          // emulation; iOS documents the same), so an unconditional clear races the tap's trailing
          // click — tap-to-pick survived only because its click re-set pointerId after the leave, and
          // tap-to-OPEN was a coin flip between opening and silently re-picking. A touch pick is
          // dismissed by what touch does next (another tap, or a scroll re-pick), not by the phantom
          // leave of a finger that lifted.
          onPointerLeave={(e) => {
            if (e.pointerType !== 'mouse') return
            window.clearTimeout(hoverTimerRef.current)
            hoverPinnedPointRef.current = null
            setPointerId(null)
          }}
          // Track-level intent is deliberate. Per-spine pointerenter depends on which transformed
          // box wins hit-testing while the wave is moving; the nearest LIVE visual box at the
          // pointer coordinate is stable, and a stationary cursor cannot retarget itself.
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse' || dragIdx != null) return
            let bestId: string | null = null
            let distance = Infinity
            ref.current?.querySelectorAll<HTMLElement>('[data-spine]').forEach((slot) => {
              const box = slot.getBoundingClientRect()
              const d = Math.abs(box.left + box.width / 2 - e.clientX)
              if (d < distance) {
                distance = d
                bestId = slot.dataset.spine ?? null
              }
            })
            if (bestId) armHoverPick(bestId, e.clientX, e.clientY)
          }}
        >
          {/* RESERVED SLACK, leading. Static from the first frame; puts the window (the first slot's
        centre) far enough inside the viewport that the revealed box and its ring fit at rest
        with no clamping — see LEAD_SLACK's comment. */}
          <div aria-hidden className="flex-none self-end" style={{ width: LEAD_SLACK }} />
          {books.map((b, i) => {
            const shown = b.id === shownId
            // Spines you don't have in hand (wishlist / unset) sit ghosted on the shelf — a TBR shelf
            // is mostly books you don't own yet. A borrowed book is in hand, so it never ghosts.
            // Artwork-only dim (--ghost-opacity); the title stays in the aria-label.
            const unowned = !isPossessed(b)
            return (
              <div key={b.id} className="flex flex-none flex-col items-center self-end">
                <button
                  data-spine={b.id}
                  data-spine-picked={shown ? '' : undefined}
                  draggable={!!onReorder}
                  onDragStart={() => {
                    window.clearTimeout(hoverTimerRef.current)
                    setDragIdx(i)
                  }}
                  onDragOver={(e) => onReorder && e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx != null) place(dragIdx, i)
                    setDragIdx(null)
                  }}
                  onDragEnd={() => setDragIdx(null)}
                  // One rule, every modality: a not-yet-picked spine's first activation picks it; the
                  // picked spine opens. Mouse hover picks before the click lands (click opens); touch
                  // gets tap-to-pick then tap-to-open; keyboard picks on focus, Enter opens.
                  onClick={() => (shown ? onOpen(b.id) : setPointerId(b.id))}
                  onFocus={(e) => {
                    if (e.target.matches(':focus-visible')) setPointerId(b.id)
                  }}
                  title={b.title}
                  // On a spine the ACCESSIBLE NAME is the load-bearing channel for state: a 26px spine
                  // cannot carry a text pill, so the edge marker is a find-it-fast affordance and this
                  // is the actual information. Same fixed order as everywhere else — DNF, then borrowed.
                  aria-label={
                    shown
                      ? `Open ${b.title}${stateSuffix(b)}`
                      : `Reveal ${b.title}${stateSuffix(b)}`
                  }
                  className="relative flex-none"
                  style={{
                    transformOrigin: '50% 100%',
                    willChange: 'transform',
                    ...(dragIdx === i ? { opacity: 0.4 } : undefined),
                  }}
                >
                  {/* The magnification target is the BUTTON (see the choreography's comment on why —
                boxes, focus rings and visuals must agree). Its LAYOUT box is the natural spine
                size and never changes; the choreography writes transform/z-index imperatively.
                The cover is NOT inset-0: it is a fixed 120×176 box — the cover's own ratio —
                bottom-centre anchored and counter-scaled per frame so the bitmap never renders
                at any other ratio (defect 1 of fix/spine-magnify-geometry). Its initial
                transform keeps it far inside the slack until the first choreography write. */}
                  <span
                    className="relative block"
                    style={unowned ? { opacity: 'var(--ghost-opacity)' } : undefined}
                  >
                    <span data-mag-art className="block" style={{ transformOrigin: '50% 100%' }}>
                      <Spine
                        book={b}
                        active={false}
                        tint={b.coverColor}
                        dnf={isDnf(b)}
                        borrowed={isBorrowedBook(b)}
                      />
                    </span>
                    {/* skin-card (--radius-card): the SAME token CoverCard uses for a real cover of
                  this shape — reads truer than --mark-radius, which is the small chip/badge
                  silhouette, not a card-sized surface (Marrow cuts corners on both; softer skins
                  differ meaningfully — --radius-card 12 vs --mark-radius 3). The box-shadow ring
                  sits OUTSIDE this box (never inset, so it can never crop the art) and follows
                  the same radius automatically. Its colour is --pick-ring (polish/spine-pick-feel:
                  each skin's own frame/ornament material where that material is legible against
                  the shelf background, else --primary — see the token's comment in tokens.css)
                  and it needs no separate fade: this whole span's opacity already carries the
                  spine→cover cross-fade, and box-shadow fades with its element like any paint. */}
                    <span
                      data-mag-cover
                      aria-hidden
                      className="pointer-events-none absolute bottom-0 left-1/2 skin-card overflow-hidden border border-line"
                      style={{
                        width: MAG_W,
                        height: MAG_H,
                        opacity: 0,
                        transformOrigin: '50% 100%',
                        transform: 'translateX(-50%) scale(0.2)',
                        boxShadow: `0 0 0 ${RING_W}px var(--pick-ring)`,
                      }}
                    >
                      <CoverImage book={b} thumb />
                      {isDnf(b) && <StatePill kind="dnf" className="absolute left-1 top-1" />}
                      {isBorrowedBook(b) && (
                        <StatePill kind="borrowed" className="absolute bottom-1 right-1" />
                      )}
                    </span>
                  </span>
                </button>
                {/* The keyboard half of the gesture — drag alone would leave the shelf unarrangeable
              without a pointer. Quiet enough to leave the signature look intact. */}
                {onReorder && (
                  <span className="mt-1 flex gap-0.5">
                    <button
                      type="button"
                      onClick={() => place(i, i - 1)}
                      disabled={i === 0}
                      aria-label={`Move ${b.title} earlier`}
                      className="rounded border border-line px-1 text-[11px] leading-none text-muted disabled:opacity-30"
                      style={{ background: 'var(--chip)' }}
                    >
                      ◀
                    </button>
                    <button
                      type="button"
                      onClick={() => place(i, i + 1)}
                      disabled={i === books.length - 1}
                      aria-label={`Move ${b.title} later`}
                      className="rounded border border-line px-1 text-[11px] leading-none text-muted disabled:opacity-30"
                      style={{ background: 'var(--chip)' }}
                    >
                      ▶
                    </button>
                  </span>
                )}
              </div>
            )
          })}
          {onAdd && (
            <button
              data-shelf-add
              type="button"
              onClick={onAdd}
              aria-label={addLabel}
              title={addLabel}
              className="flex-none self-end"
              style={{ transformOrigin: '50% 100%', willChange: 'transform' }}
            >
              <span
                className="flex h-36 w-9 items-center justify-center rounded-md border border-dashed border-line text-[18px]"
                style={{ background: 'var(--chip)', color: 'var(--muted)' }}
              >
                <PlusGlyph />
              </span>
            </button>
          )}
          {/* RESERVED SLACK, trailing — responsive (see the trailSlack effect): sized so the last
        book's centre reaches the window at scrollLeft max, exactly. Also the momentum-contract
        half: end-edge transformed overhang would extend scrollWidth (CSSWG #9458), and every
        rightward displacement lands inside this spacer. */}
          <div
            aria-hidden
            data-trail-slack
            className="flex-none self-end"
            style={{ width: trailSlack ?? LEAD_SLACK }}
          />
        </div>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[18px] border-t"
          style={{
            borderColor: 'var(--gold-deep)',
            background:
              'linear-gradient(180deg, color-mix(in srgb, var(--gold-deep) 55%, var(--bg1)), var(--bg0))',
            boxShadow: '0 -7px 16px rgba(0, 0, 0, 0.18), inset 0 1px rgba(255, 255, 255, 0.1)',
          }}
        />
      </div>

      {shownBook ? (
        <div className="px-4 pb-4 pt-3 sm:px-5">
          <div className="relative h-5" data-spine-position={shownIndex}>
            <span
              aria-hidden
              className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
              style={{ background: 'var(--chip)' }}
            />
            <span
              aria-hidden
              className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full"
              style={{ width: `${positionPct}%`, background: 'var(--primary)' }}
            />
            <span
              data-spine-marker
              aria-hidden
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45"
              style={{
                left: `${positionPct}%`,
                background: 'var(--accent)',
                boxShadow: '0 0 10px color-mix(in srgb, var(--accent) 65%, transparent)',
              }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(0, books.length - 1)}
              step={1}
              value={shownIndex}
              disabled={books.length <= 1}
              onInput={(event) => scrollToIndex(Number(event.currentTarget.value))}
              aria-label="Browse books by position"
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
            />
          </div>
        </div>
      ) : null}
    </section>
  )
}
