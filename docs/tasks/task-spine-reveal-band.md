# Superseded task: shared spine reveal band

Status: **closed after revalidation on 2026-09-09**. Do not implement this historical specification
against current `main`.

## Revalidation result

The premise below no longer describes the shipped shelf. The shared band did ship in #144, then
the in-row interaction was redesigned through #145–#149. Current `SpineShelf` has no absolute
120px cover overlay over a 29–46px hit target: the spine button itself transforms, neighboring
buttons move aside, leading and responsive trailing slack keep the transformed boxes inside the
track, and every book passes through one fixed reveal window. The selected cover therefore remains
attached to its spine without the sibling burial this task was written to remove.

The current mobile reachability suite passed all 12 guards during revalidation, including every
terminal pick, coordinate-level tap access on tiny shelves, zero neighbor overlap at rest, stable
scroll dimensions, horizontal and vertical containment, cover aspect, and reduced motion. The
shared band would restore a 196px permanently sticky surface that the later interaction deliberately
removed while solving a defect that no longer reproduces. Keep the fixed reveal window and its
guards.

The remaining text is the historical design record that produced #144 and explains the discarded
tradeoff.

Branch: `fix/spine-reveal-band` off `main`.
Audits: `docs/audits/spine-overlay-clamp.md` (951ec48) and
`docs/audits/spine-reveal-band.md` including the shared-band addendum (b69d8f5).
Read both before writing code.

## What this retires

In-row occlusion was my decision in `fix/spine-shelf-overlay`, argued as "what a physical shelf does when you pull a book forward." Device evidence killed it. A 120px cover over a 29–46px slot overhangs 37–45px each side **by construction**, so it always covers its neighbours, and at either extreme that overhang clips off-screen. No clamp fixes this: the clamp keeps the cover inside the track, and the problem is that it is inside the track and still on top of things.

The reveal is the feature, on every surface. It does not get removed from `/shelves` to save space.

## The design, decided

A **single shared reveal band per page**, sticky to the **bottom of the viewport, directly above the nav**. The picked cover renders there — never in the spine row. `SpineShelf` stops rendering the reveal entirely and becomes a spine row plus a pick reporter.

Decisions and their reasons, so they are not re-litigated in implementation:

- **Shared, not per-rail.** Per-rail scales with the reader's shelf count without bound: at collections scale the addendum measured +2256px for per-rail against +188px for shared. On single-rail surfaces shared degenerates to per-rail with no special casing.
- **Sticky, not scroll-away.** Scroll-away gives back its height by showing nothing — the reveal would only work at the top of a page nobody reads from the top. Scrolled-state cost is 2.1 rails against today's 2.8, and that is the price of the feature working where it is used.
- **Bottom, not top.** Thumb-adjacent on a phone, so the cover appears near the hand rather than behind it; it is the physical direction of pulling a book toward you; and it avoids the `scroll-margin-top` trap where keyboard focus lands underneath a pinned top band.
- **Rest state is rail one's current pick**, not empty. Height is reserved in every case, so the only question is what fills it, and the sliding anchor already picks a book at `scrollLeft 0` — that is a true value, not a placeholder. An empty reserved band reads as broken.
- **No collapse-until-touched.** That is the layout shift the whole premise forbids.

Cover size: choose from the addendum's measured table and state the choice. The band is paid once now, so the constraint is looser than the per-rail case — but report the vertical cost of the size you pick against the scrolled-state numbers, not the top-of-page ones.

## What must be got right

Each of these was named in the audits. Report on each explicitly.

1. **Stacking context.** Sticky creates one. Reconcile with `main`'s `z-[1]` and the fixed nav's `z-40`. The band sits directly above the nav and must not paint over it, be painted over by it, or escape to cover a dialog.

2. **Sticky scope.** Sticky is bounded by its parent's box. A band inside the derived-shelves wrapper stops serving the collections rails. It has to live high enough to serve every rail on the page — which is the same structural choice that makes it shared.

3. **Ownership without render churn.** Last-touched-wins is the rule. A page-level `useState` would re-render all twelve rails ~15 times per fling — the same cadence problem in a new place. Use a subscription, a ref-based store, or whatever avoids re-rendering non-owning rails; state the mechanism and why it cannot churn.

4. **Handoff when the owning rail scrolls out of view.** Under a sticky band this is unavoidable rather than invisible. Decide and justify: does the band hold the last pick, or hand off to a visible rail? Argue it rather than picking one.

5. **No layout mutation, still.** The band's height is a fixed constant; only its contents change. The implementations that break this are already named in the audit — content-derived height, wrapping captions, mount-on-pick, per-pick box-size animation. Avoid all four.

6. **Cover-to-spine association.** Under the sliding anchor the terminal picks are the resting state at both ends, so the cover being far from its spine is the first and last thing a reader sees, not an edge case. Ship the picked-spine lift (reusing `rv-spine-lift`, already tokenized) plus a sliding caret tracking the anchor. If measurement argues for a different pairing from the audit's five options, say so with the measurement.

## What is deleted, not kept

Per the audit's survival table. Leaving assertions that pass because they test nothing is the failure mode this arc has spent itself naming.

- **Content-edge clamp** — dead. Remove it.
- **Minimum slot pitch** — dead, replaced. Burial is structurally impossible once the cover is in another band. `spineMetrics.ts`, the spread state, and its resize listener go with it.
- **Invariant guard** — gut to the width sweep, fold that into the reachability suite, delete the file. Its clamp-bounds and slot-anchoring assertions describe machinery this branch removes.
- **Reachability guard** — survives as the load-bearing suite, with locator retargeting and its spread-pitch test deleted.
- **Sliding anchor** — survives unchanged, still per-rail.
- **Mouse-only `pointerleave`** — survives, load-bearing. It fixed a pick-state race, not a rendering one.

## Guard requirement — a new assertion class

Every existing reachability fixture is a **single-rail page**, where shared and per-rail are indistinguishable. A shared-band ownership bug is invisible to the entire current suite.

Add a **multi-rail `/shelves` fixture** and assert: scrolling rail A puts rail A's pick in the band; then scrolling rail B puts rail B's pick in the band; the band's height never changes across either; and whatever handoff rule item 4 settles on actually holds when the owning rail leaves the viewport.

Reachability itself still applies: every book on every rail has a gesture path to being revealed and opened.

Mutants: revert to per-rail rendering (must fail the shared-ownership assertion); remove the sticky positioning (must fail visibility while a lower rail is scrolled); break last-touched-wins so the first rail always owns (must fail the rail-B assertion).

## Standing

- Investigate and report root cause before fixing, if anything here turns out not to hold.
- Full gate including `format:check` against a clean worktree of the committed HEAD, pinned prettier not `npx`.
- Full e2e at default workers, all three projects.
- This is touch-layer work and cannot use eyeball-before-merge — the guard plus the gate is the merge gate, and feel is iterated on `main` afterwards.
- No merge without explicit authorization.
