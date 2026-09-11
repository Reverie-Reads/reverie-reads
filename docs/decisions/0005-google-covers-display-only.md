# ADR 0005 — Google Books covers are display-only; Open Library is the ingest source

**Status:** accepted · 2026-07-26
**Context:** `fix/cover-sourcing` (#79; posture detail in `docs/reference/reverie-metadata-sourcing.md` §Covers)

**September 11 addendum:** ADR 0010 narrows new Google Books use to explicit, attributed search.
This ADR still governs the ingest boundary and preserved historical reader choices.

## Decision

A cover may be **ingested and stored** only from Open Library, reader upload, camera capture, or
Hardcover. A directly pasted URL is ingested only when its exact origin is one of those reviewed
providers; every other pasted URL remains display-time only. **Google Books is display-time only** —
hotlinked at display size, never copied into our Storage.

The rule is expressed once, in `packages/core/src/covers.ts`, and read by every caller:

```ts
INGESTIBLE_COVER_SOURCES = ['openlibrary', 'upload', 'camera', 'url', 'hardcover']
DISPLAY_ONLY_COVER_SOURCES = ['google']
isIngestibleCoverUrl(url)   // host-based
mayIngestCover(source, url?)
```

`url` remains in the source enum because it records how the reader chose the cover; it is not a
network trust grant. The Edge Function accepts only exact Open Library/Internet Archive redirect,
Hardcover asset, and configured project-cover origins. This closes authenticated server-side URL
fetching against reader-controlled DNS while preserving pasted artwork as a hotlink.

`fetchCover` resolves from Open Library **only**. A miss returns empty rather than falling through
to Google, because whatever it returns gets persisted.

## Why

Google Books' terms prohibit creating permanent copies, prohibit caching beyond the cache header,
and require deletion of stored content on termination. The cover pipeline was built to do exactly
the opposite: fetch, normalize to webp, and store permanently in a user-scoped Storage path.

The two were built at different times against different understandings. This is the correction —
we keep the pipeline and narrow what may enter it.

## What this deliberately does not do

**Google still renders.** `coverCandidates`, the zoom upgrade, and the "image not available" plate
detection are untouched. Choosing a Google edition in the cover sheet remains a working choice: it
stores the _reference_ rather than the bytes, and the row is labelled "linked, not saved". Demoting
Google to display-only is not the same as removing it, and a reader who picks a Google edition
should get a cover, not a dead end.

## Two things that would have made this wrong

**1. The gate is the Edge Function, not the client.** Refusal happens at four ingest entry points —
the lazy backfill, the re-sharpen sweep, the cover sheet, and the `covers` Edge Function. Only the
last is authoritative; the client is not a security boundary. The other three exist so the UI
doesn't offer something the server will refuse.

**2. Refusal is by host, not only by source label.** The lazy backfill labelled everything it swept
`cover_source = 'url'` regardless of where the image actually came from. A Google image wearing a
`url` label is still a Google image, so `isIngestibleCoverUrl` matches on the host in
`cover_source_url` as well.

This mattered in fact, not just in principle. The production audit of already-stored covers found
**zero** rows with `cover_source = 'google'` and **three** Google-derived rows carrying
`cover_source = 'url'`. A label-only check would have reported none and closed the question wrongly.

## The three already-stored rows: left in place

Audited against production on 2026-07-26; the decision was the owner's. Three rows, all pre-dating
this posture, all ingested by the backfill under a `url` label. They stay. Rewriting a reader's
existing covers to placeholders to satisfy a rule adopted afterwards costs them something real and
gains close to nothing; the gate stops the population from growing. Recorded in
`docs/reference/reverie-metadata-sourcing.md` §"What was already stored — audited, decided, closed", with the
query, so a future audit re-runs the same check rather than inventing one.

## Consequences

- **Camera capture is promoted, not buried.** It is the only source unambiguously the reader's own,
  and it covers precisely the gap no database fills — indie, KU, signed, and special editions. It
  now leads the cover sheet.
- **Open Library becomes the quality floor for automated covers.** It has thinner coverage than
  Google, so more books resolve to no cover. That is the intended outcome: the skin-tokened
  placeholder is an honest absence, and it is a designed plate rather than a gray box.
- Adding a new durable remote origin means extending both the client and Edge exact-origin gates
  and justifying it here; adding a source label alone grants no network access.
- **Hardcover's ingest posture is unchanged by this ADR.** `docs/reference/reverie-metadata-sourcing.md` flags
  its licence as asserted rather than granted; that is a separate open question, not settled here.
