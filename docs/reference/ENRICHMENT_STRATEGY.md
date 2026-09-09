# Metadata enrichment strategy — most-complete record on every scan / add

**Historical strategy, superseded where it recommends ISBNdb or unqualified series merging.**
The owner dropped ISBNdb on September 9. The retirement patch removes its live adapter and starts
a new enrichment cache namespace; it does not delete historical data or cancel billing. Existing
relational series safeguards in `DATA_SOURCES.md` remain authoritative. The scalar merge still has
quality limitations; neither longest description nor a work-level union certifies an exact edition.
See the [exit audit and handoff](../tasks/isbndb-retirement.md) before using the old roadmap below.

Goal: when a book enters the library (barcode scan, ISBN/title search, or manual add), end up
with the most complete, accurate record possible — without blocking the user, blowing API
quotas, or making the app brittle. This extends the shipped enrich Edge Function (A1), match.ts
(A2), and the bulk fill-missing job (A4); it's the spec they should converge to.

## Principle: AGGREGATE, don't pick

No single source is complete or consistently structured. The right model is a server-side
aggregator that queries several sources and merges FIELD BY FIELD using a per-field precedence
policy — never "first source wins wholesale." User-authored fields ALWAYS win and are never
overwritten (already a merge rule).

## Step 1 — Resolve identity (work + edition)

A scan is an EAN-13 → ISBN-13 (sometimes ISBN-10). Normalize ISBN-10<->13 (already in core).
Resolve to two levels:

- EDITION (the scanned copy): this cover, format/binding, page count or audio duration,
  publisher, publication date, language, the specific ISBN. Drives per-format ownership (S1/S2).
- WORK (the title across editions): canonical title/author, series + position, other
  editions/formats, community tags. Drives series gaps, "other formats", adaptive-skin genre.
  Cross-reference identifiers across sources: Open Library work/edition keys, Google volumeId,
  Hardcover book/edition ids.

## Step 2 — Source roster (what each is genuinely best for)

- Google Books — FREE, ~1,000 requests/day default per key (can request more); broad coverage;
  good for description, categories, search, cover thumbnails. Metadata is inconsistent/loosely
  structured, so it's not authoritative for structured edition fields. Cache hard.
- Open Library — FREE (courtesy rate limits; identify via User-Agent); ~30M+ titles; work/edition
  model + ISBN variants + format/binding + covers API (covers.openlibrary.org). The best free
  backbone for identity resolution and as a cover fallback.
- Hardcover — FREE GraphQL; best for SERIES + POSITION and community tags/genres + ratings.
  CAVEAT (important): the API is in BETA — backend/localhost only, the token is tied to YOUR
  account, and it "may break or reset without notice"; per-site allowlisting for real apps is
  "a way down the line." => Use only server-side, low-volume, best-effort. Never from the browser,
  never a blocking/core dependency, plan for it to be unavailable at scale.
- ISBNdb — PAID ($14.99 / 35.99 / 99.99 / 299.99 per month tiers; daily search cap per plan,
  resets 00:00 UTC, ratelimit headers). 110M+ titles, up to 19 data points (binding, pages,
  weight, dimensions, publisher, pub date, language, dewey, synopsis), daily-updated, strong on
  recent/rare titles; may cache locally while subscribed. This is the COMPLETENESS BACKSTOP for
  fields the free sources miss.
- Later/optional: NYT Bestsellers (list flags), Amazon PA-API (prices/availability — approved
  partners only, strict, no bulk), ONIX feeds (if a publisher relationship). WorldCat/Bowker/
  Ingram are largely restricted/commercial.

## Step 3 — Field-level precedence (the merge map)

For each field: ordered preference; on conflict, the rule noted. (Provenance + fetched-at stored
per field so conflicts can be re-evaluated and the user can override.)

- canonical title / author: Open Library / Hardcover work-level -> Google -> ISBNdb; prefer the
  edition-matched value.
- series + position: Hardcover -> Open Library -> manual.
- description / synopsis: longest non-empty of Google / ISBNdb / Open Library.
- categories / genre / tags: UNION across sources (dedupe), then map into the app's genre + tags;
  Hardcover community tags are high-value here.
- cover image: best available resolution, chain Google -> Open Library covers -> ISBNdb ->
  publisher; store URL AND cache the image.
- page count / audio duration: edition-specific -> ISBNdb / Open Library edition -> Google.
- publisher / pub date / binding / format / language / dimensions / weight / dewey:
  ISBNdb -> Open Library edition -> Google.
- ISBNs / alternate editions / formats: UNION (collect every edition's ISBNs to power per-format
  ownership and "other formats").
- intensity (spice) / content signals: not in these APIs -> user/manual; (romance skin) may infer
  from community tags as a hint only.
- ANY user-authored field: always wins; never overwritten by enrichment.

## Step 4 — Sync fast pass + async completion (UX)

- On scan/add: SYNC fast pass — normalize ISBN, hit cache; on miss, one fast source (Open Library
  or Google by ISBN) for title/author/cover so the book appears instantly in a "completing…" state.
- BACKGROUND: the enrich Edge Function runs the full multi-source merge, fills missing fields,
  reconciles by precedence, updates the record + cache, flips "completing" -> "complete".
- Never block scanning on a multi-source waterfall.

## Step 5 — Global shared cache (the cost + speed lever; see SCALING.md)

- Cache the normalized merged record keyed by normalized ISBN-13 AND resolved work/edition id, with
  per-field provenance + fetched-at — GLOBAL, not per-user, so the Nth user scanning the same book
  hits cache and triggers no external calls. This is the single biggest cost control.
- Refresh policy reuses the C1 retry logic: incomplete (missing cover/series) -> 3-day retry;
  complete -> 30-day; force re-enrich when a new source/field is added.
- Proxy ALL third-party calls through Edge Functions (never the browser): key secrecy, pooled
  rate-limiting, caching, and required for Hardcover (backend-only) + ISBNdb (key in header).

## Step 6 — Quota / rate management (grounded)

Google ~1k/day per key (per-run ceiling + cache from A4); Open Library courtesy throttle + UA;
Hardcover low-volume best-effort with backoff (beta); ISBNdb per-plan daily cap, honor the
ratelimit headers, note 404 may resolve later (retry). Negative-cache dead-ends (A4). Degrade
gracefully — partial record + queue for re-enrichment, never a hard failure.

## Step 7 — Match + dedupe on the way in

Feed the normalized record through match.ts / decideIntake so a scan/add that matches an existing
book merges (auto for strong, review for fuzzy). Completeness and dedupe happen together.

## Recommendation (tiered, pluggable)

- v1 (free, now): Open Library (identity + edition + cover fallback) + Google Books (description/
  categories/cover), merged field-level, cached globally, async. Hardcover optional via a backend
  token for series + tags (best-effort). Gets ~80–90% completeness at zero marginal cost.
- v2 (paid, when scale/budget justify): add ISBNdb as the completeness backstop for the
  still-missing edition fields and recent/rare titles — the biggest single completeness jump. Start
  at a low tier; cache hard to stretch the daily cap.
- Keep the aggregator SOURCE-PLUGGABLE (add/remove a source = config), same pattern as the
  buy-link attributionMode, so ISBNdb/ONIX/Amazon slot in later without a refactor.

## Owner actions

- HARDCOVER_TOKEN (backend, server-only) to turn on series/tags now (best-effort).
- Decide on an ISBNdb subscription when max completeness / rare-title coverage matters (v2).
