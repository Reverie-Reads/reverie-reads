# Cover sourcing, quality, and Cover Studio

Status: **current product policy and ordered implementation plan**, revised 2026-09-11. The source
rights analysis in `reverie-metadata-sourcing.md` remains authoritative when it is more restrictive.

## What “best cover” means

The best image is the correct edition first and the sharpest compliant image second. A high-resolution
cover for the wrong edition makes a personal library less faithful. Reverie should therefore rank a
candidate using four independent questions:

1. Does it match the work and, when known, the exact ISBN or edition?
2. Is the source allowed to be stored, or only displayed remotely with attribution?
3. Does it have enough real pixels for the surface where it will appear?
4. Did the reader choose or lock this image for their copy?

The reader's choice wins. Automatic enrichment may fill a blank but must not replace a reader upload,
photo, locked edition, or explicit placeholder.

## Candidate order

1. **Reader photograph or upload, locked to the personal copy.** This is the most intimate and
   edition-faithful option, especially for signed, special, indie, and out-of-print editions.
2. **Exact-ISBN edition candidate.** Store it only when the provider permits storage. Otherwise keep
   it as an attributed remote reference.
3. **Exact-work candidate with explicit confidence and provenance.** Let the reader compare editions
   when identity is ambiguous.
4. **Skin-themed typographic placeholder.** Honest absence is better than a wrong cover, an enlarged
   blur, or a provider's “image unavailable” plate.

Cover choice remains personal. A shared catalog cover may be offered as a default but does not become
the reader's edition without their choice.

## Rights modes

Every cover candidate needs a machine-readable handling mode. Provider name alone is insufficient.

| Mode                        | Meaning                                                       | Reverie behavior                                              |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| `stored_owned`              | Reader photo/upload or an asset Reverie owns                  | Normalize and store in the reader-scoped bucket               |
| `stored_provider_permitted` | Provider terms or a direct agreement permit storage           | Normalize, store, retain source and permission basis          |
| `remote_attributed`         | Display is allowed but permanent copying is not               | Keep provider URL, render remotely, show required attribution |
| `reference_only`            | Identity candidate without adequate display or storage rights | Use only to help find the correct edition                     |

The shipped ingest gate already rejects Google hosts regardless of the caller's source label. Keep
that server-side defense. Hardcover may remain an edition candidate, but durable storage should not
become more load-bearing until written reuse terms or a commercial agreement covers the intended use.

## Source policy

### Google Books

Use Google Books only when a reader explicitly searches. Keep its result block in provider order and
visually separate from Reverie's catalog results. Show the required badge and a prominent, valid link
to each Google Books result. Do not use those results in guided Discover, genre browsing,
personalized ranking, release feeds, automatic enrichment, or Cover Studio alternatives.

Within the attributed search result, prefer the API's official fields in this order: `extraLarge`,
`large`, `medium`, `small`, `thumbnail`, then `smallThumbnail`. The documented widths are
approximately 1,280, 800, 575, 300, 128, and smaller; requesting the strongest returned field is more
reliable than rewriting a thumbnail URL. When the reader saves the result, keep the book identity and
seek a durable Open Library or Hardcover cover; otherwise use the room placeholder. Never persist a
new Google cover reference or image bytes. Historical reader choices remain untouched.

Primary references:

- [Volumes fields](https://developers.google.com/books/docs/v1/reference/volumes)
- [Using the API](https://developers.google.com/books/docs/v1/using)
- [Google APIs Terms](https://developers.google.com/terms)
- [Google Books branding](https://developers.google.com/books/branding)

### Open Library and Internet Archive

Prefer cover ID or OLID lookups and request the large (`-L`) image with `default=false` so a missing
cover returns 404 instead of a placeholder. Respect the documented human-scale limits, identify the
client, cache eligible responses, and never crawl the Covers API. Public display may point directly to
the Covers service under its guidelines. The bibliographic data is open, while the copyright position
of an individual cover still depends on the underlying artwork; keep the existing conservative rights
decision for durable copies.

Primary references:

- [Open Library API guidelines](https://openlibrary.org/developers/api)
- [Open Library Covers API](https://openlibrary.org/dev/docs/api/covers)

### Hardcover

Use exact edition/ISBN relationships as candidates and retain source lineage. Its GraphQL schema gives
useful edition identity and popularity information, but no clear public cover-reuse grant was located
in the official documentation. Keep current usage bounded and replaceable. Seek written terms before
making its images a commercial durable-storage dependency.

Primary reference: [Hardcover developer documentation](https://github.com/hardcoverapp/hardcover-docs)

### Retired paid coverage trial

The bounded ISBNdb study is complete and the owner dropped it from the planned source stack. Do not
make further paid requests without new owner approval. Preserve its single-use locks and see the
September 9 result linked from `DATA_SOURCES.md`.

### Sources that do not fit the core pipeline

Apple Search API artwork is promotional material tied to Store promotion and is unsuitable as a
general library-image backend. LibraryThing's cover service has useful user-contributed coverage, but
its limits, variable large-image quality, and use restrictions require a direct terms decision before
integration. Neither should be added as an automatic fallback today.

## Technical quality gate

Record the original width, height, byte count, content hash, provider, source URL, rights mode,
identity confidence, checked time, and reader-lock state for every accepted candidate.

- Reject known provider placeholders, scan strips, corrupt decodes, and implausible cover ratios.
- Do not upscale. A larger file containing interpolated blur does not improve the library.
- A landing or hero cover should be at least 800px wide and 1,200px on the long edge after validating
  the exact edition.
- A normal card should have at least the rendered CSS width multiplied by the device pixel ratio.
  For current layouts, a 600–720px long-edge derivative covers most two- and three-density displays.
- Keep the existing full derivative at a 1,600px long edge. The 390px two-column library renders
  covers at roughly 160–175 CSS pixels, making the old 300px thumbnail soft even at DPR 2. Use the
  new 720px card derivative for new and deliberately reprocessed covers.
- Serve responsive candidates so a grid does not download every 1,600px full image. The current
  `CoverImage` chain should grow an explicit `srcset`/size contract for stored assets instead of
  always accepting the first successful thumbnail.
- Preserve the original aspect ratio and use crop only as a presentation choice, never when storing
  the canonical personal image.

Supabase supports on-the-fly Storage transformations, but charges by origin image beyond the included
quota and recommends pre-generating common sizes when the set is stable. Reverie's current Edge
Function already uses `magick-wasm`, which is also Supabase's documented Edge example. Pre-generating
one card derivative and one full derivative remains the predictable side-business choice; measure
decode time and transfer size before adding more variants.

Primary references:

- [Supabase image transformations](https://supabase.com/docs/guides/storage/serving/image-transformations)
- [Transformation usage and pricing](https://supabase.com/docs/guides/platform/manage-your-usage/storage-image-transformations)
- [Edge image manipulation](https://supabase.com/docs/guides/functions/examples/image-manipulation)

## Cover Studio experience

Cover Studio should feel like caring for a home library, not repairing a database.

- **Photograph your copy** leads on mobile.
- **Choose an edition** shows comparable candidates with ISBN, format, year, publisher, source, image
  dimensions, and whether Reverie can save the image or only link to it.
- **Upload an image** supports a file already owned by the reader.
- **Use this room's placeholder** previews the same title in the active room.
- **Needs attention** is a bounded post-import queue for missing, broken, ambiguous, or soft covers.

Show a small quality note such as “Sharp on cards,” “Best for detail view,” or “May look soft” instead
of exposing raw pixel math as the primary decision. Display the raw edition facts beneath it. Let the
reader lock a choice so later enrichment cannot replace it.

The source/attribution panel belongs in the book's cover editor and the public About/Data Sources
surface. It should say where the current image came from, whether it is saved or linked, and when it
was last checked.

## Current implementation and next changes

Already shipped:

- title/author enrichment with ISBN self-resolution;
- edition candidates from Hardcover and exact-ISBN Open Library;
- server-side host and source checks before ingestion;
- attributed Google Books results in explicit search only;
- reader upload and camera capture;
- full WebP at 1,600px, a 720px card WebP, and dominant color;
- broken-image and Google no-cover/strip rejection;
- skin placeholders and a cover-attention review bucket.

Implemented in this change:

- Google Books is confined to explicit, attributed search; new saved books do not carry its cover
  reference into the personal or shared catalog.
- Discover uses the reviewed local shelf plus shared corpus and may still apply reader taste ranking.
- Releases use Hardcover, optional PRH confirmation, and reader-entered dates.
- Automatic enrichment uses Open Library and optional Hardcover under a fresh cache namespace.
- Cover Studio uses Hardcover and exact-ISBN Open Library candidates. Existing reader-selected
  Google covers remain readable and editable.
- The landing sample uses manually reviewed exact-ISBN Open Library images.

Implement next, in order:

1. The edition chooser shows decoded image dimensions, resolution labels, and exact-ISBN
   matches first (Discover quality follow-up). Provider title searches require conservative work
   identity. Persisted quality metadata and broader edition-confidence evaluation remain separate
   work; never change a reader-locked choice.
2. Measure transfer size and cache hit rate for the 720px card derivative, then add responsive
   source selection if another stable size is justified.
3. Persist source rights mode and reviewed quality observations if measurement proves the current
   runtime-only labels insufficient. The personal Studio already shows current source,
   saved-versus-linked status, and decoded dimensions without treating them as edition proof.
4. Seek written Hardcover cover-use terms before making its art more load-bearing.
5. The administrator catalog queue is implemented at `/catalog/covers` (details below). The
   personal queue is implemented separately at `/covers`; it mutates only the reader's book and
   never treats that choice as a shared catalog approval.

For landing pages and other marketing surfaces, curate exact editions manually, confirm natural image
dimensions in a real browser, and keep the provider-compliant display path. Do not auto-fill marketing
screens from a changing enrichment result. The landing's current six-book sample follows this approach.

## Shared catalog cover review

Settings → Library tools → **Review catalog covers** opens the administrator workspace. It reads
shared works directly; a reviewer does not need a personal copy. Search by title, author, or ISBN,
and use Needs attention, For later, Reviewed, or All books. Pages contain 20 works; recorded identity
and artwork concerns precede missing images. Unmeasured images are not silently classified as soft.

Open a work to see its title, author, recorded ISBNs, complete cover, source link, and decoded image
size. Alternatives load only on request. The default searches the work; selecting an ISBN deliberately
narrows the edition. Compare current and proposed art, confirm the printed identity, and approve,
flag a specific concern, or set the work aside. A larger image alone is not proof of the right edition.
Historical Google choices stay linked; current alternatives use eligible provider art through the
existing corpus-owned ingestion path.

Decisions retain an administrator note, image measurement, and audit history. The current review is
bound to a fingerprint of the catalog identity and cover fields, plus a review revision. Changes
invalidate prior approval; a concurrent edit refuses the stale save and offers a refresh. Opening the
workspace never writes data, and approvals are never queued offline. The bounded queue has no
background provider crawl or automatic approval. Recent history shows the latest ten decisions.

Only the shared work's cover changes. A reader's own cover, bibliographic choices, possession, and
reading history remain unchanged. Identity concerns are recorded for curation, not automatically
rewritten. The September audit remains evidence for deliberate review, not an automatic data repair.

This workspace requires migration `20260927010000_catalog_cover_review.sql` after merge, operated
through the production deploy guard by the owner. It reuses the existing covers Edge Function and
needs no new provider credential or function deployment.
