# Midniht landing and logo handoff

Owner request, September 19, 2026: save required logo versions and begin the formal
landing page from the latest `design/brand-exploration/midniht-preview` design.

## Scope

- Preserve the final clean-joins vector, earlier explorations, short wavy hair,
  face, moon, and matched cream/gold boundaries.
- Package AI/PDF/SVG masters, clear-space SVG, one-color vectors, transparent and
  opaque PNGs, app-icon sizes, a maskable tile, favicon and social card.
- Build the public landing in the real app, with the preview's midnight/parchment
  modes, blended existing hero art, and JavaScript-owned twinkling stars.
- Keep the real guest library, room selector, notes, sign-in and sign-up routes,
  privacy explanations, guide and legal links. Guest actions retain their existing
  memory-only and explicit-transfer boundary.

## Boundaries

The owner authorized publishing the landing on September 19 after the cover and
scroll fixes. The authenticated app, manifest,
installed icons and account pages remain Reverie. The existing canonical domain
is retained until the owner chooses the domain/migration plan. Sample rooms retain
their own styles and independent day/night selection. Landing mode is session-only
React state; it does not change a reader's saved skin/mode.

The extracted hero is the existing preview illustration, not new generated art.
The icon exports retain the full approved mark; tiny-size simplification remains
a separate design decision. RGB print reference is not a press-certified CMYK PDF.

## Implementation

`Landing.tsx` supplies the public hero and working sample library. `MidnihtStars`
owns seeded Canvas drawing, theme colors, pause, reduced motion, tab visibility,
intersection and listener cleanup. CSS positions the canvas and supplies palette
tokens; there are no CSS star animations. The established lazy below-fold boundary
continues to protect the hero when its separate chunk is unavailable.

Export entry point: `apps/web/scripts/package-midniht-brand.py` (Pillow,
pypdfium2, and the system Georgia font for the social card). The kit includes
checksums and usage notes; originals remain in the exploration folder.

## Before release

- Preserve the existing domain and authenticated identity for this landing-only
  release; a coordinated full rename remains a separate decision.
- Passing repository gates and fresh-local-stack e2e verification, followed by
  a reviewed PR and git-connected web deployment. No production data writes.

## Local verification and remaining work

September 19: typecheck, lint and unit suites passed (including 1,082 web tests).
The initial production build passed with the expected local-backend URL warning.
Asset checks verified the ZIP, 10 PNG dimensions/alpha channels, and all 12
unchanged vector paths. Browser review covered 320, 390, 768 and 1440 px layouts,
both public themes, navigation, star pause/play and room selection.

The initial full 355-test regression run finished with 337 passed, 10 skipped and
8 failed, with one worker and no retries against
the existing local stack, not a fresh database. It is **not a clean release gate**:
it overlapped final edits/asset exports and retained some pre-edit test labels.
Failures include a navigation-interrupted signed-in accessibility scan, two
save-recovery tests, stale landing labels and a star-test viewport comparison.
The labels and star-test viewport were updated. All 22 focused landing, guest
library and shell browser tests subsequently passed, including the scroll guard
and explicit phone navigation. Final lint, typecheck, unit suites and build passed.
A reproducible scroll jump when switching the lower guest-library view was traced
to browser scroll anchoring. The public landing now disables automatic anchoring,
preserving the existing prevent-scroll focus and explicit phone guidance behavior.
The fresh-database full run and hosted release evidence are recorded in the PR;
do not treat the initial run as a clean gate. A recoverable local database backup
was taken before the fresh run. No production database changes are involved.

The owner also requested the former covers. Exact matches recovered:

- Jane Eyre: Google Books volume `VIdMOzpFBgoC`, ISBN `9780141329741`, orange/red
  artwork. ADR 0010 deliberately removed Google-hosted covers from the demo.
  The owner approved their supplied image as a local landing asset. The Google
  endpoint and intake safeguard remain unchanged.
- The Left Hand of Darkness: Penguin Galaxy, ISBN `9780143111597`, blue artwork.
  Publisher page: https://www.penguinrandomhouse.com/books/538943/the-left-hand-of-darkness-by-ursula-k-le-guin/
  Verified publisher image: https://images3.penguinrandomhouse.com/cover/700jpg/9780143111597
  (437 × 700). The supplied matching blue artwork is hosted locally alongside
  Jane Eyre. Both catalog entries now carry the matching ISBN, and cover loading
  and explicit guest handoff are covered by tests. See public cover source notes.
