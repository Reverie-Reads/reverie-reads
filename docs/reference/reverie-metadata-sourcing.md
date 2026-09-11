# Reverie: Book Metadata Sourcing & Licensing

_Supersedes "Reverie Phase 0: Book Metadata Source Matrix and Licensing Analysis."_

## Why this rewrite exists

The original analysis was scoped for a different product: a 200k–500k record
deep-metadata corpus intended for publication as an open derived dataset, built by
ingesting bulk dumps into Postgres (~250GB working space), reconciled with OpenRefine
tooling, and published under CC0 with BY-SA material segregated into a separate module.

Reverie is not that. Reverie is a proprietary, deployed personal-library app that
enriches individual readers' libraries on demand. Almost every constraint that dominates
the original — copyleft contamination, share-alike segregation, non-commercial traps in a
published dataset, bulk-dump cadence, entity-reconciliation accuracy at scale — either
doesn't apply or applies in a much weaker form. Meanwhile the one constraint the original
correctly identifies as _the_ unresolved risk — cover images — applies to us directly.

This document keeps the original's research, discards its corpus-building apparatus, and
re-scopes its conclusions to the product we actually run.

---

## What Reverie is (the constraints that actually bind)

- **Proprietary, all rights reserved.** We publish no dataset. Nothing we ingest is
  redistributed to anyone.
- **Per-user libraries at human scale** — hundreds to low thousands of books per reader,
  not millions of records.
- **On-demand enrichment**, not bulk ingestion. We look a book up when a reader adds it.
- **Deployed and public-facing** (reveriereads.app), not a localhost hobby project. This
  matters: several sources' terms distinguish personal/backend use from serving a public
  app.
- **Our differentiators are built, not sourced.** The trope taxonomy, mood dimension,
  taste calibration, tier vocabulary, series curation, and skin system are all ours.

That last point is the strategic one. Because the interesting parts of Reverie are
generated rather than licensed, our external data needs are unusually narrow — which
means we can afford to source conservatively without losing anything that makes the
product distinctive.

## The four things we need from outside

1. **Identity and lookup** — resolve "this book" to title, author(s), ISBN, publisher,
   year, page count, format.
2. **Series membership and reading-order position**, including decimal positions for
   novellas.
3. **Cover images.**
4. **Edition alternates** — so a reader can pick the edition they actually own.

Everything else — genre assignment, tropes, mood, spice, ratings, reading history,
shelves, taste — originates with the reader or with us.

---

## Source stack

### Tier 1 — build on these (CC0, unambiguous)

**Open Library / Internet Archive — CC0.** Bibliographic records, ISBNs, crosswalk
identifiers (OLID, LCCN, OCLC, Goodreads, Wikidata), and — critically — **the most
defensible cover source available to us.** The Internet Archive asserts no new copyright
over the database, though it also cannot warrant that every cover is free of third-party
rights. "Best available, honestly caveated" is the correct characterization; it is
materially better than every alternative. Coverage is strong on mainstream English trade
fiction, weaker on contemporary self-published titles.

**Wikidata — CC0.** The best _openly licensed_ source of structured reading order:
property **P179** (part of the series) with the **P1545** series-ordinal qualifier, which
supports decimal ordinals ("4.5") as strings. This maps exactly onto the decimal-position
model Reverie already implements. Also the richest crosswalk hub (VIAF, ISNI, OLID, ISBN,
LC). Coverage concentrates on notable series and is thin on indie/self-published — so it
is a seed, not a complete answer.

### Tier 2 — live lookup only, never stored

**Google Books.** Usable only for explicit reader-triggered search, where Reverie preserves
provider order, a separate result block, the Google Books badge, and a valid per-result link.
It is **not** a store: Google's terms prohibit creating permanent copies, prohibit caching
beyond the cache header, and require deletion of stored content on termination. Google also
licenses much of the underlying data rather than owning it.

Practical consequence for us: Google results and thumbnails stay within the attributed search
experience. They do not feed guided Discover, genre browsing, personalized ranking, releases,
automatic enrichment, or cover alternatives, and new saved books do not persist a Google cover
reference. Historical reader choices remain readable and editable.

### Tier 3 — paid gap-fill (evaluated and dropped)

The bounded ISBNdb study is complete. Selective use improved 38 of 100 works, but the broad join
also regressed 20, and the benefit did not justify subscription and retention dependence. The owner
dropped ISBNdb from the planned stack. No further paid requests are authorized without a new owner
decision; preserve the consumed study locks and follow `docs/tasks/isbndb-retirement.md`.

### Tier 4 — currently in use, risk flagged

**Hardcover.** Currently a backend source for explicit catalog search, release discovery, series
evidence, and cover/edition candidates. Three concerns, in order of seriousness: the license is
asserted as "same as OpenLibrary" rather than granted as CC0, with acknowledged rights
caveats; API tokens are personal, backend/localhost-oriented, expire annually, and there
is no allowlisting path for third-party sites; there is no bulk export or documented
commercial tier.

None of that makes Hardcover unusable today, but it is the shakiest dependency in the
stack and it is load-bearing across three features. Mitigation is to reduce what depends
on it (move series seeding to Wikidata) and to keep every Hardcover-derived field
treated as a _suggestion the reader confirms_ rather than authoritative data — which is
already how our trope suggestions work.

### Do not use

- **Goodreads** — API retired December 2020, no new keys, no licensing path, developer
  terms prohibit storage. Goodreads IDs survive as reconciliation keys via Wikidata and
  Open Library.
- **Amazon Product Advertising API** — requires an Associates account with qualifying
  sales; PA-API 5.0 retires April 2026 in favor of a Creators API with a higher sales
  bar. Intended for affiliate display, not as a metadata or cover backend.
- **OCLC WorldCat / Nielsen BookData / Bowker** — institutional or enterprise contracts
  only; no self-serve tier; use restrictions preclude our use case.
- **LibraryThing Common Knowledge** — genuinely the best series data available, but
  CC BY-SA. Share-alike is a live problem _for us specifically_: incorporating BY-SA
  content into a proprietary app is the exact incompatibility to avoid. `thingISBN` is
  non-commercial, which is worse. Do not ingest.
- **TV Tropes** — CC BY-NC-SA, no API, no dump, contributors assign rights irrevocably.
  Non-commercial disqualifies it entirely.
- **BISAC / Thema** — the code list is free to _use for classification_, but
  incorporating the list into a system requires a paid license and the documentation is
  copyright BISG. We avoid this entirely by having built our own genre taxonomy.

---

## Covers

### Current implementation

Reverie's cover pipeline fetches an eligible image, ingests it through an Edge Function,
normalizes it to WebP at a 1,600px long edge plus a 720px card derivative, and stores it in a
reader- or corpus-scoped Supabase Storage path with provenance. Eligible sources include Open
Library, reviewed Hardcover assets, reader upload, and camera capture. The Edge boundary rejects
Google image hosts even when a caller labels the URL differently.

### Target posture

**Ingest and store** (defensible):

- **Open Library** covers — the most defensible external source; make this the preferred
  ingest source.
- **Reader uploads and camera captures** — unambiguously the reader's own, stored in
  their own scoped path. This is the strongest position in the whole stack.
- **Publisher-supplied assets**, if ever obtained through a legitimate ONIX or trade
  relationship.

**Explicit search display only, never persisted for a new book**:

- **Google Books** thumbnails — render only inside its attributed search-result block.
- Any other source without an explicit grant.

**Honest absence**: where no defensible cover exists, the skin-tokened placeholder is the
correct outcome — never a wrong cover, never Google's "image not available" plate (see
the plate-detection work already shipped).

### Why camera capture matters more than it looks

Camera capture is the only cover source that is unambiguously ours, and it happens to
cover precisely the gap no database fills: indie, KU, signed, and special editions. It is
simultaneously the most legally defensible path and the most personal one — the reader
photographing the actual copy on their actual shelf. It should be promoted in the UI, not
buried as a fallback.

### Implemented posture

One rule, expressed once in `packages/core/src/covers.ts` and read by every caller:
`INGESTIBLE_COVER_SOURCES` / `isIngestibleCoverUrl` / `mayIngestCover`.

- **A pasted URL is not an egress grant.** Exact Open Library and Hardcover asset URLs may enter
  the durable pipeline; Open Library's exact Internet Archive redirect chain and the configured
  project cover origin are enforced again at the Edge boundary. Every other pasted URL remains a
  working display-time hotlink, but the server never resolves or fetches its reader-controlled
  hostname.
- **Ingest chain prefers Open Library.** `fetchCover` resolves from Open Library only; a miss
  returns empty rather than falling through to a display-only source. Automatic enrichment uses
  Open Library and optional Hardcover under the `durable-sources-v1:` namespace.
- **There was a fifth ingest path, and it gated nothing — removed 2026-08.** The enrich Edge
  Function's `scheduleCoverCache` stored every resolved cover to a global `covers/{isbn}.jpg`,
  with no host check at all, while `PRECEDENCE.cover` puts `google` **second**. So the rule below
  held at the four entry points this section enumerated and was bypassed entirely at a fifth one
  in another function. Worse for the audit further down: a cover stored that way carried **our**
  host, so matching on the host in `cover_source_url` — the very refinement that section adopted
  because label-matching alone closes the question wrongly — would also have reported clean.
  The path is gone; the objects it already wrote are a separate data decision (see BACKLOG).
  The lesson is the one this section already implies but did not enforce: "the `covers` function
  is the authoritative gate" is only true if no other function can write cover bytes, and nothing
  was checking that. `packages/core/src/noGlobalCoverCache.test.ts` now does.
- **Google is explicit-search display only.** It is refused at four ingest entry points — the lazy
  backfill, the re-sharpen sweep, the cover sheet, and the `covers` Edge Function, which is
  the authoritative gate (the client is not the security boundary). Refusal is by **host** as
  well as by source label, because the lazy backfill migrates pre-existing covers under the
  label `url`, and a Google image wearing that label is still a Google image.
- **Historical Google choices still render.** Existing reader-selected links and provenance remain
  readable and editable. Current Cover Studio alternatives use Hardcover and exact-ISBN Open
  Library. Saving a new Google Books search result keeps its identity and looks for a durable cover;
  otherwise the active room supplies its designed placeholder.
- **Upload and camera stay first-class stored sources**, and camera now leads the sheet.
- **Hardcover's ingest posture is unchanged** by this pass. The doc flags its licence as
  asserted rather than granted, but that is remediation item 4's decision, not this one's.

### What was already stored — audited, decided, closed

**Run against production, 2026-07-26. Result: 3 rows.**

| `cover_source` | stored, Google-derived |
| -------------- | ---------------------- |
| `url`          | 3                      |

Zero rows carried `cover_source = 'google'`. All three came in through the lazy backfill, which
labelled what it swept `'url'` regardless of host — which is exactly why the query matches on the
**host in `cover_source_url`** as well as on the source label. Counting the label alone would have
reported none and closed the question wrongly.

```sql
-- Google-derived assets already ingested into our own Storage.
select
  coalesce(cover_source, '(null)') as cover_source,
  count(*) as stored_google_derived
from public.books
where cover_url like '%/storage/v1/object/public/covers/%'
  and (
    cover_source = 'google'
    or cover_source_url ~* '(books[.]google[.][a-z.]+|googleusercontent[.]com)/books/content'
  )
group by 1
order by 2 desc;
```

**Decision (owner, 2026-07-26): leave them in place.** The host-based gate shipped in the same
change stopped the population growing, and three rows in a private, per-user library — no
redistribution, no public surface — does not justify a re-source pass or the visible cost of
purging a reader's covers to a placeholder. The options weighed (re-source / leave / purge, plus
an opportunistic convert-on-re-sharpen middle path) are recorded in the branch history; this is
the settled answer, not a deferral.

Revisit only if the exposure assumptions change — public shelves, shared lists, or marketing use
of cover imagery would each warrant a fresh look, as would the count growing, which would mean the
gate has a hole.

### Honest statement of residual risk

Cover art is the publisher's or artist's copyright regardless of the metadata license
attached to the record. **No source cleanly licenses an independent app to store and
serve high-resolution covers.** Open Library is the most defensible option, not a clean
grant. Reverie's practical exposure is low — private per-user storage, human-scale
libraries, no redistribution, no public gallery — but "low practical risk" and "clearly
permitted" are different things, and the two should not be quietly conflated. Treat
covers as a per-source permissions question and revisit if Reverie's usage pattern
changes (public shelves, shared lists, marketing surfaces).

---

## Series ordering — recommended upgrade

Move primary series seeding from **Hardcover** to **Wikidata (P179 + P1545)**:

- CC0, so no license ambiguity.
- Decimal ordinals are native to the model, matching Reverie's existing decimal-position
  and label implementation (`#2.5`, "novella").
- Reduces load-bearing dependence on the stack's shakiest source.

Retain Hardcover as a **gap-filler** for series Wikidata doesn't cover, and keep manual
curation first-class — no source is complete, and Reverie's position-seeding logic
already assumes source data may be wrong or absent. User edits must continue to win over
any source refresh, which is the existing non-overwrite principle.

---

## Tropes, genre, and mood — validated, no change needed

The original analysis independently confirms three decisions Reverie already made:

- **No usable openly-licensed trope dataset exists.** TV Tropes is non-commercial with no
  export; fan wikis are BY-SA or BY-NC-SA; AO3 tags aren't published as a reusable
  dataset; academic corpora aren't production metadata. Building our own taxonomy was the
  only viable path, and the analysis explicitly frames a bespoke taxonomy as a
  differentiator aligned with anti-consensus discovery. Our facet-based canonical set
  plus reader-created personal tropes is the recommended posture.
- **Genre taxonomy built in-house avoids BISAC licensing** entirely. Our nine primaries
  plus multi-select subgenres are ours to change and ours to ship.
- **Mood is reader-assigned and unsourced by construction** — there is no external
  dataset to conflict with, and the no-derivation guarantee means there never will be.

Nothing to change. This section exists so the decisions are recorded as _validated_
rather than merely made.

---

## What Reverie explicitly does not do

- No bulk dump ingestion, no Postgres corpus, no ~250GB working set.
- No entity-reconciliation pipeline (BookReconciler, OpenRefine, VIAF clustering).
- No published derived dataset — which dissolves the entire copyleft-contamination and
  license-segregation problem the original analysis spends most of its length on.
- No BISAC or Thema list redistribution.
- No scraping of any source, including archived copies.

---

## Remediation and opportunity queue

Ordered by value, not urgency. None of these is an outage.

1. ~~**Cover source re-ordering**~~ — **done** (#79). See _Implemented posture_ below. The audit
   of already-stored assets is **complete and decided** — 3 rows, left in place; see _What was
   already stored_.
2. **Series seeding to Wikidata.** Primary source becomes CC0 with native decimal
   ordinals; Hardcover retained as gap-fill.
3. ~~**Evaluate ISBNdb.**~~ **Completed and dropped.** The measured benefit did not justify the
   subscription and retention dependency; no further paid acquisition without owner approval.
4. **Hardcover risk decision.** Decide deliberately whether to keep it as a suggestion
   source (acceptable, with everything reader-confirmed) or reduce dependence further.
   Token expiry and the absence of third-party allowlisting are the operational risks.
5. **Attribution surface.** Add a Settings → About → _Data sources_ panel naming Open
   Library / Internet Archive, Wikidata, Google Books, Hardcover, OpenStreetMap and CARTO
   (already attributed on the indie-bookstore map), and any paid source added later. CC0
   requires no attribution; naming sources anyway is both courteous and consistent with
   the app's honesty about where things come from.

---

## Open questions and residual risks

- **Covers remain the largest unresolved legal question.** Open Library is the most
  defensible option available, not a clean grant. Reader-captured covers are the only
  unambiguous ones.
- **Hardcover's license is asserted, not granted**, and its tokens are not designed for a
  deployed third-party app.
- **CARTO's basemap key is client-visible and should be domain-restricted.** Without it, the app
  keeps the nearby-store list and suppresses the map instead of rendering watermarked tiles.
- **Multi-user changes the calculus.** Everything above assumes private, per-user
  libraries with no public surface. Public shelves, shared lists, or marketing use of
  cover imagery would each warrant a fresh look.
- **This document is not legal advice.** It reflects a careful reading of published terms
  and a conservative posture. If Reverie ever becomes commercially significant, the cover
  question in particular deserves a lawyer.
