# Brand assets and guided tour

Status: implemented for public review on 2026-09-09.

## Outcome

Carry the accepted open-book identity through installed and shared Reverie, then give a new visitor
one clear path through the real guest library. The path should explain the product through working
views without inventing a recommendation, persisting a private note, or pretending that a guest
session is an account.

## Implementation

- The favicon, ordinary install icons, dedicated maskable icon, Apple touch icon, manifest colors,
  and Next read social card use Midnight & Lamplight and the open-book mark.
- `apps/web/scripts/generate-brand-assets.mjs` produces every raster brand asset from the accepted
  palette and self-hosted type. `brand-assets.generated.json` records the generator and outputs.
- The social card uses two curated public-domain catalog fixtures rendered as typographic cover
  treatments. It does not retain third-party cover art or private account data.
- The compact landing demo offers a four-stop, nonmodal tour of Library, Next read, book detail,
  and dock arrangement. Each stop opens an existing guest-library view; the visitor must still make
  every reading, note, rating, copy, and import choice.
- Closing or finishing the tour returns control to the visitor. The guest library remains usable
  with or without the tour.

## Verification contract

- The tour reaches all four existing product views in order and never sends a write request.
- The sample library and its reading progress remain unchanged while advancing through the tour.
- The manifest exposes ordinary and maskable icons with the accepted background and theme color.
- The favicon identifies the open-book mark.
- Landing behavior remains usable at phone and desktop widths, with visible keyboard focus and
  reduced-motion behavior inherited from the existing landing shell.
- Build, type, lint, unit, and landing browser checks pass.

## Release boundary

This work changes only public static assets, the signed-out guest experience, and documentation. It
adds no provider call, authentication promise, database migration, service role, or production-data
write.
