# Midniht identity migration

Owner request, September 19, 2026: remove the arch crossing the landing preview cards,
replace the former app name throughout the product, and use the approved logo where appropriate.

## Presentation

- `APP_NAME` in `packages/core/src/brand.ts` is the shared reader-facing name. Auth, welcome,
  navigation, settings, guidance, catalog controls, and copy builders
  use it. Lowercase landing typography is derived from that constant.
- `MidnihtMark` references the approved full-color SVG. The face, hair, moon, and joins are
  not retraced. Favicons, install icons, and sharing artwork are copied from the approved kit.
- All landing room previews lose the separate arched mist outline. The ordinary rounded
  panel border, background glow, room atmosphere, and interactive library stay intact.
- Canonical and social URLs use `https://midniht.app`. New downloads use Midniht names;
  the old spreadsheet and share-image URLs remain working aliases with current branding.
- Import summaries translate the internal `reverie` profile to the current product name.

## Deliberately retained compatibility references

This is not a blind repository-wide replacement. The audit includes source, static assets,
tests, server/provider identity, package configuration, and current documentation.

- `@reverie/*`, repository URLs, Vercel project names, and local Supabase project IDs are
  technical identities, not reader-facing branding. Renaming them is unnecessary here.
- Browser preference, session, guest-handoff and IndexedDB keys stay unchanged. The shell
  cache gets a new version to pick up the approved install artwork; reader data is not cleared.
- Backups retain `app: 'reverie'`, their version and schema. CSV detector IDs and
  `REVERIE_TEMPLATE_COLUMNS` remain compatible with previously downloaded files.
- Historical plans, migrations, source evidence, prototype filenames, and licensing/repository
  links are not rewritten as if the former brand never existed. Current top-level guidance
  and the design system reflect Midniht.
- `contact@reveriereads.app` remains the established provider contact. No new mailbox is
  presumed. The Google Books key's legacy default Referer is retained until its restriction
  configuration is deliberately migrated; changing the string alone could break book search.

## Hosted configuration boundary

Vercel's canonical domain was separately moved to `midniht.app`, with the old domain redirecting.
Auth-provider application names, Supabase email subjects/templates/sender identity, redirect
allowlists, and any external dashboards are not source-controlled by this patch. They require
separate verified configuration access. A new domain does not transfer browser sessions.
Backend provider headers use the current name and public URL while retaining the working
contact mailbox; source updates do not claim that owner-gated Edge Functions were deployed.

## Verification

Regression coverage checks approved export hashes and dimensions, the shared name/mark,
canonical metadata and manifest, the absence of the preview arch, current import labels,
both download URLs, and restoration of a legacy-identified backup. Full-suite results belong
in the release handoff; do not infer a green browser gate from these unit checks alone.
