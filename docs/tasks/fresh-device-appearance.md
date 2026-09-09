# First-paint appearance handoff

September 8, 2026. A signed-in reader on a device without a complete local appearance now remains
in Reverie's neutral front-door atmosphere until the profile's room and mode have been applied
together. The private application shell is never painted under the fallback Tryst/system state.

## Reader contract

- A device with a valid saved room and mode opens immediately and remains usable with that local
  choice while offline. Profile reconciliation still follows when the network is available.
- A first sign-in, a device whose appearance keys were manually cleared, and an Adaptive room wait
  for the profile. Adaptive's generated palette is profile data; its local room id cannot reproduce
  the appearance by itself.
- The document marks an incomplete appearance before the application stylesheet loads and paints
  Reverie's midnight, parchment, and lamplight front-door material. The signed-in shell stays out of
  the document until the complete profile choice is ready.
- Profile hydration runs before the browser's next paint. It applies room and mode as one operation,
  then removes the neutral first-paint marker.
- If the profile cannot be reached after the query's normal retries, the screen says that the
  library is unchanged. The reader can retry or enter with Reverie's default room. This fallback
  stores a complete local choice so it cannot leave the page in a half-themed state.
- Authentication loading uses the same neutral tokens when appearance is pending, avoiding an
  unreadable room-colored loading label on the front-door background.

## Corrected reachability

The earlier backlog entry said sign-out made the issue common by clearing room preferences. Current
source does not do that: sign-out clears the IndexedDB mirror, while room and mode remain in
localStorage. The defect was still reachable on a reader's first device, after manual storage
clearing, or with Adaptive, whose palette exists only in the profile.

## Verification boundary

The browser regression creates a reader whose saved profile is Aphelion/dark while the test device
prefers light mode and has no local room keys. It holds the profile response, confirms that the
neutral screen is accessible and contained, then proves the application shell never appears until
Aphelion/dark is already active. A second pass forces profile failure, checks the recovery screen,
and verifies the explicit default-room escape. The same flow passes in the standard desktop project
and the 390px layout project.

This change adds no table, migration, edge function, provider, cache, or production deployment step.
