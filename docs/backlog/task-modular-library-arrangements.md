# Modular library arrangements

Status: **approved and implemented for account persistence** on 2026-09-06. Open
`/lab/arrangements` for the original study or **Settings → Arrange Reverie** for the signed-in
editor. The full decision and persistence contract live in
`design/MODULAR_LIBRARY_ARRANGEMENTS.md`.

## Reader outcome

A reader can make Reverie open around the way they spend time with books. Someone maintaining a
collection, someone choosing a next read, and someone keeping a reading journal should each find
their everyday actions close at hand. The app must remain recognizable when they change rooms.

## Starting evidence

The landing's shared guest library has three dock presets in
`apps/web/src/auth/landing/guest/state.ts` and a working arrangement preview in `GuestConfigure.tsx`.
Those settings live only in guest memory. The signed-in navigation in
`apps/web/src/components/navigation.ts` remains fixed. Home already prioritizes current reading
and Next read; the goal is reader choice, not another replacement of the core reading flow.

## Design scope

- Three starting arrangements: **Keep my books close**, **Find my next read**, and **Remember my
  reading**, using the landing's language and actual destinations.
- Navigation: reorder, hide, and restore destinations in a phone dock and desktop rail. Library
  remains an anchor; Add, search, Settings, and hidden destinations remain reachable. Decide the
  visible-slot limit from phone measurements, not from the number of available features.
- Home: choose and order existing reading, next-read, priority, release, and optional goal modules.
  Specify empty, loading, unavailable, and no-current-read states. Do not invent a new dashboard
  metric or a learned taste score to fill space.
- A preview, explicit save, restore-defaults action, and a clear way to cancel changes. Keyboard
  move buttons and touch controls must work without drag gestures.
- Define whether device layouts share one logical order or allow deliberate device overrides.
  Saved account preferences need a versioned default and an understandable fallback for a newly
  introduced or removed destination.
- Guest-to-account mapping: carry an arrangement only when the reader explicitly accepts the guest
  handoff during onboarding.

## Constraints

An arrangement changes visibility and order, not book ownership, reading history, ratings, notes,
series membership, entitlements, or library scope. Hidden modules retain their data. Losing a paid
capability must preserve data and leave an understandable route back. Room selection never chooses
a Discover genre or Next read candidate scope.

Keep the same destination names and interaction meanings across all nine rooms. Each room may
retain its typography, shapes, materials, and decorative treatment. Use the actual component/token
system for the design; do not create a beautiful arrangement that cannot fit real book titles,
multiple active reads, or a long navigation label.

## Reviewable deliverables and acceptance

1. A mobile and desktop flow for choosing a preset, editing it, saving, cancelling, restoring a
   hidden destination, and returning to defaults. Include 320px, 390px, and 1440px layouts.
2. A component/slot map showing what changes and what remains reachable. Separate navigation
   choices from Home module choices so one toggle has one predictable effect.
3. Examples using the same curated books in Tryst, Marginalia, Aphelion, and Hearth, plus a
   registry-wide contrast and focus review in Day/Night before implementation is accepted.
4. Persistence and recovery rules for reload, another device, sign-out/account switching, offline
   reads, a new module, and an unavailable entitlement. Do not promise offline configuration writes
   until that save path exists.
5. An observed walkthrough in which a reader can change their starting arrangement, find an action
   they hid, and restore the default without coaching. Record any assistance as a design finding.

The approved implementation stores a versioned document on the reader's profile, updates it only
through an explicit Save, and maps the guest dock during the explicit onboarding handoff. Release
verification must prove the saved value survives a reload and drives both navigation and Home DOM
order.
