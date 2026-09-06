# Cover sourcing, quality, and Cover Studio

Status: **current product policy and ordered implementation plan**, revised 2026-09-06. The source
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

Use Google Books for live lookup and remote display. Do not persist its image bytes. Prefer the API's
official fields in this order: `extraLarge`, `large`, `medium`, `small`, `thumbnail`, then
`smallThumbnail`. The documented widths are approximately 1,280, 800, 575, 300, 128, and smaller;
requesting the strongest returned field is more reliable than rewriting a thumbnail URL. Preserve the
required Google attribution and a prominent path to the Google Books result.

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

### Paid coverage trial

Run a bounded ISBNdb trial against real unresolved books: contemporary indie, Kindle Unlimited,
special editions, and titles that current providers misidentify. Do not subscribe on catalog size
alone. Read the operative terms first and accept the provider only if the trial meets edition accuracy,
cover coverage, image size, rights, latency, and cost thresholds.

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
- edition candidates from Hardcover and Google Books;
- server-side host and source checks before ingestion;
- Google display-only behavior;
- reader upload and camera capture;
- full WebP at 1,600px, a 300px thumbnail WebP, and dominant color;
- broken-image and Google no-cover/strip rejection;
- skin placeholders and a cover-attention review bucket.

Implemented in this change:

- Google search, Discover, enrichment, and edition selection prefer the strongest official
  `imageLinks` field returned by the API;
- new stored covers receive a 720px card derivative while retaining the 1,600px full image.

Implement next, in order:

1. Add Google Books result links and the required attribution to every Google-backed display.
2. The edition chooser now shows decoded image dimensions, resolution labels, and exact-ISBN
   matches first (Discover quality follow-up). Provider title searches require conservative work
   identity, and saving linked images retains their working fallback. Persisted quality metadata and broader
   edition-confidence evaluation remain separate work; never change a reader-locked choice.
3. Measure transfer size and cache hit rate for the new 720px card derivative, then add responsive
   source selection if another stable size is justified.
4. Add source, rights mode, dimensions, and quality language to Cover Studio.
5. Run the bounded ISBNdb miss trial and seek written Hardcover cover-use terms.
6. Add a calm batch queue for soft, ambiguous, missing, and broken images.

For landing pages and other marketing surfaces, curate exact editions manually, confirm natural image
dimensions in a real browser, and keep the provider-compliant display path. Do not auto-fill marketing
screens from a changing enrichment result. The landing's current six-book sample follows this approach.
