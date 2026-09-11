# ADR 0010 — Google Books is an explicit-search source

**Status:** accepted · 2026-09-11

## Context

ADR 0005 prevented Reverie from storing Google Books image bytes but still allowed Google results
and linked covers across Discover, release feeds, enrichment, and Cover Studio. Those surfaces blend,
deduplicate, or personalize candidates. Google Books' display requirements call for its result order
to remain intact, Google results to stay visually separate from other providers, the Google Books
badge to appear beside them, and each result to link back to Google Books.

That contract fits explicit search. It does not fit a personalized shelf or a merged provider feed.

## Decision

Google Books is available only after a reader explicitly searches for a title, author, or ISBN.
Reverie keeps its results in provider order, renders them in a separate labelled section with the
Google Books badge, and includes a validated Google Books link for every displayed result.

Google Books results do not enter guided Discover, genre browsing, taste ranking, release feeds,
automatic enrichment, or current cover alternatives. Saving a Google search result keeps its book
identity, but no new Google cover reference or image bytes enter the personal or shared catalog.
Open Library and optional Hardcover may fill a durable cover; otherwise the room placeholder is the
honest result.

Existing reader-selected Google covers and historical provenance remain readable and editable. This
decision requires no cleanup migration.

## Consequences

- Discover uses its reviewed local shelf plus shared catalog works and can personalize that pool.
- Releases use Hardcover, optional PRH confirmation, and reader-entered dates.
- Enrichment uses Open Library and optional Hardcover under `durable-sources-v1:` so historical
  mixed-source cache rows cannot re-enter it.
- Cover Studio uses Hardcover and exact-ISBN Open Library candidates.
- The search Edge Function remains the only live Google Books request path; the browser never sends a
  catalog request directly to Google.

This narrows ADR 0005's former “Google still renders” allowance. ADR 0005 remains the durable image
ingest and historical-row decision.
