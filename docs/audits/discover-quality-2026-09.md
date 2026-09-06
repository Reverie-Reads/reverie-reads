# Discover quality: selection and cover evidence

Audited 2026-09-06 against public base `df5026e` after private Discover release `098abeb3fc2d`.
Changes live on `codex/discover-quality` until its release is verified. This is a bounded engineering
quality pass, not a claim that readers prefer these recommendations.

## Catalog and image sample

The read-only query in `../queries/discover-quality-sample.sql` inspected the alphabetically first
eight shared works in each of the nine core genres. It returned **56 records in seven genres**;
there were no exact `cozy` or `young adult` shared-work rows in this query. Wider provider/editorial
shelves remain separate. The seven represented genres are fantasy, horror, literary, mystery,
nonfiction, romance, and science fiction. This sample deliberately exposes the records early in the
current query; it is not random or representative of catalog-wide prevalence.

- **50/56** contain descriptions; **52/56** contain cover URLs.
- **52/56** have multiple ISBNs. A shared-work ISBN array is not a chosen edition and does not
  identify which ISBN belongs to the current image.
- All **52 cover URLs loaded** in Chromium. Measurements used the image's decoded natural width
  and height, not CSS dimensions, response status alone, or a source's claimed size.
- **40/52 are under 480px wide**. Only **8/52 are at least 800px wide**. Several stored full images
  are 98–128px wide; opening their existing full URL cannot recover the missing detail.
- The sample uses stored corpus images. No provider cover bytes were newly ingested, no catalog
  metadata was repaired, and no personal records or reading data were queried or changed.

The bounded review list is `discover-cover-attention-2026-09.csv`. It contains only public-work
identity, dimensions, and the measured issue. It is a review queue, not a migration or an instruction
to replace every image. Verify the work and edition, source permission, and original pixels before
any owner-operated replacement; preserve personal reader choices.

The browser instrument was also checked against locally rendered 128×192 and 800×1200 PNG controls
in the cover-selection journey. These must report soft and detail-ready respectively. A broken
image must stay unavailable rather than receiving a quality label.

## Defects addressed

1. **Source crowding.** Previously, corpus results filled the 32-candidate ceiling before external
   candidates were considered. Bounded query groups now interleave after library exclusion and
   before deduplication/capping. Shared identity still wins at the existing list position.
2. **Owned duplicate leakage.** Detail navigation correctly refuses to choose an ambiguous personal
   copy. Discovery exclusion incorrectly reused that resolver and interpreted its refusal as absence.
   Exclusion now checks every matching copy without choosing a destination.
3. **Author repetition and incomplete ranking.** A source's first five books could all be by one
   writer. Supported alternatives now get room after two books per author, with remaining same-author
   books retained when alternatives do not exist. Author evidence stays above genre evidence. A
   partially completed semantic batch does not receive an accidental ranking advantage: each evidence
   tier uses semantic ordering only when all its candidates have valid scores. Available descriptions
   break otherwise factual ties; missing metadata is not invented.
4. **Genre and edition fidelity.** Anchor matching considers explicit secondary genres and canonical
   spellings. Shared works with multiple ISBNs no longer preselect the array's first edition in guided
   Discover. External results retain their explicit ISBN. Detail enrichment requires all contributors
   for a work-only match; publisher/language fields from another edition are withheld without an exact
   ISBN match.
5. **Description continuity.** A synopsis already present in the selection remains visible while
   detail refresh is pending or fails. Refreshed descriptions remain plain text; failure retains a
   retry path.
6. **Cover decisions.** The existing edition chooser now places exact-ISBN matches before storage
   convenience and displays the actual resolved image's dimensions. Labels are “May look soft,”
   “Sharp on cards” (at least 480×720), and “Sharp in detail” (at least 800×1200). These measure
   resolution only, not artistic quality, edition identity, licensing, or whether an original was
   previously upscaled. Broken candidates cannot replace a working image. Selecting a cover remains
   deliberate; syncing other edition fields remains a separate action.

## Regression evidence

A before/after run used the actual base and modified core modules against nine synthetic genre
controls with five books by one writer plus three supported alternatives. The old shortlist had one
author in each case; the new shortlist has four. The known owned-duplicate control returned one held
book before and zero after. These numbers prove those mechanisms, not recommendation satisfaction.

The persistent regression set additionally covers source balance, all nine genre controls, ISBN-10/13,
secondary genres, ambiguous identities, same-author-only catalogs, partial and complete semantic
scores, source outages, work-versus-edition metadata, actual cover dimensions, and reader selection.
The full local gate and browser result are recorded in the pull request before completion.

## What should follow

- Observe five readers using real starting books. Record independent shortlist choices, reasons they
  reject suggestions, and successful return/save behavior. Do not infer satisfaction from clicks.
- Review the bounded soft/missing cover sample before a larger refresh. Exact edition first,
  sufficient original pixels second; reuse the existing personal/corpus correction boundaries.
- Improve sparse cozy/YA coverage and evaluate lexical mood precision with reviewed examples. Current
  mood matching still uses description/tag vocabulary; it is not a validated mood classifier.
- Measure candidate recall beyond the current bounded, title-ordered corpus queries. Source balancing
  reduces crowding but does not make the entire corpus a semantic search index.

No new provider, subscription, model, database migration, or background sweep is introduced.
Google Books' [documented image tiers](https://developers.google.com/books/docs/v1/reference/volumes)
remain the preferred source fields; choosing an available large URL does not justify upscaling a
small image or transferring another edition's cover. Existing source/storage rules remain in force.
