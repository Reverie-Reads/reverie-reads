# Book data: source-to-screen audit

**Audit date:** September 12, 2026. **Public baseline:** `d139d9a5`.
**Result:** the pipeline does not yet justify a claim that every imported or acquired book detail is
complete and edition-correct. Several confirmed gaps are in application code, not provider coverage.
Existing fill-only and reader-choice protections reduce overwrite risk but do not make a bad fill
correct. This report does not authorize a production sweep, metadata repair, or new paid acquisition.

The audit follows active source acquisition, normalization, identity selection, cache, persistence,
and reader display. It includes search, barcode/add, personal and shared enrichment, CSV/backup,
covers, series, releases, and the separately maintained private edition lens. Historical scripts and
trial sources are identified separately; they are not counted as active provider coverage.

## Active source and field inventory

| Source/path                                              | What is actually acquired                                                                                                                                 | Acceptance / saved destination                                                                                                                     | Finding                                                                                                                                                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Books: explicit search                            | Search volume title, author strings, image links, identifiers, published-date year, source URL. Query restricts language to English.                      | Attributed results retain provider order and links. Reader selection enters Add/intake; durable art must come from another source or reader input. | No general metadata enrichment or release feed. Search subtitle, pages, publisher, description and language are not carried in `SearchResult`. Do not present that narrow search DTO as a complete edition record.                                 |
| Open Library: automatic enrichment                       | `/search.json`: work title, authors, first publication year, ISBN array, edition-key array, median pages, subjects, languages, cover ID, series label.    | Normalizer → field merge → `enrichment_cache` → personal fill-only or administrator corpus completion.                                             | Work-level search fields are being projected as edition fields. No exact Edition API read occurs here. Publisher, binding and description cannot be supplied by this adapter even though the merged DTO supports them.                             |
| Hardcover: automatic enrichment                          | Typesense Book search documents: title, author names, description, image, genre/mood/tag strings, series label, pages, release date/year, ISBNs, work ID. | First title-only adapter hit joins the field merge; search resolver also ranks up to five hits.                                                    | Per-adapter identity is not revalidated before the final merge. Work pages normalize but do not win `pageCount` precedence. Publisher/binding/language are not acquired. Year-only dates gain an invented January 1.                               |
| Hardcover: explicit search                               | Book search title, author strings, cover, one ISBN from a work ISBN list, year, series labels.                                                            | Reader-visible catalog results; search addition calls enrichment again.                                                                            | Coverless hits are dropped. Work ISBN selection is not proof of a particular edition.                                                                                                                                                              |
| Hardcover: cover alternatives                            | Exact ISBN→one parent book, or bounded exact title/author resolution; related edition records include art, ISBNs, format, year, publisher and pages.      | Cover Studio candidates; explicit selection and separate storage ingestion.                                                                        | This richer edition DTO does not flow through the ordinary enrichment adapter. Related-edition candidates are choices, not evidence that the existing copy has those properties.                                                                   |
| Open Library: covers                                     | Exact ISBN cover URL with `default=false`, or an identified work cover ID.                                                                                | Image validation/ingest → normalized Storage derivatives and provenance.                                                                           | Correct image bytes/dimensions do not certify edition identity. Work-cover versus chosen-edition provenance must remain distinct.                                                                                                                  |
| Reader image/upload/URL                                  | Reader-selected bytes or validated remote URL.                                                                                                            | One decoded image produces full/card/color outputs; no upscale; metadata stripped; separate cover save.                                            | Preserve this measured pipeline. Do not treat higher resolution as a bibliographic match.                                                                                                                                                          |
| Hardcover: series and tags                               | Exact-name relational graph or explicit book locator with bounded revalidation; separate exact title/author tag query.                                    | Classifier evidence/reasons → administrator review/graph → eligible personal defaults. Tags do not set reader moods.                               | Membership protections are materially stronger than generic enrichment identity. Search labels must remain outside membership authority.                                                                                                           |
| Hardcover: releases                                      | Author-associated edition dates, ISBN, format, publisher, territory, cover and work context. English/unknown-language filter; bounded 50-row query.       | 24-hour release cache, work-grouped reader horizon, explicit Add.                                                                                  | Partial dates are supported by the normalizer, but the provider query filters on non-null full `release_date`; year-only editions cannot arrive through that query. Work grouping can combine same-date format/territory evidence across editions. |
| PRH: optional release confirmation                       | Exact author search, then PRH.US titles with onsale, ISBN, format and cover link when configured.                                                         | Separate provenance; exact normalized date agreement contributes confirmation.                                                                     | Limited to one publisher catalog/territory. A work/date agreement is not independent confirmation of the selected ISBN or every edition field.                                                                                                     |
| Library of Congress + Open Library: private edition lens | Exact ISBN MODS and exact OL Edition, optionally one linked Work for all referenced author identities.                                                    | Entitlement and identity checks; five-minute memory-only display. No book/catalog writer.                                                          | Separate subtitle handling and source-author uncertainty defects confirmed; private fix in progress. It is not a fallback enrichment pipeline.                                                                                                     |
| Goodreads / StoryGraph CSV                               | Title, author/additional authors, ISBN, reader rating, reading state/history, binding, publication year, shelves, notes and date added.                   | Intake/duplicate review, personal rows and structured contributor/read records; bounded enrichment follow-up.                                      | `Number of Pages` is not mapped. Source rating averages are deliberately excluded. Notes without a read entry are flagged as unplaced rather than silently claimed as saved.                                                                       |
| Reverie/custom CSV                                       | Explicit column profiles and generic aliases for identity, classification, dates and reader state.                                                        | Same intake and explicit import provenance.                                                                                                        | Current column-profile shape has no page-count mapping. Do not silently claim unsupported columns were imported.                                                                                                                                   |
| Reverie backup / manual entry                            | Current personal schema, structured reads/contributors, preferences and explicit reader choices.                                                          | Existing restore validation and personal-write paths.                                                                                              | Personal `Book` has pages but no publisher/language/description fields. Shared works do have those fields. Adding new personal fields requires a deliberate model/export/restore decision, not spreading provider JSON into rows.                  |

Bundled curated Discover shelves and the CC0 bibliographic seed are additional local inputs, not
live providers. They supply intentionally bounded work descriptions/classification and retain their
curated marker; a seed or reviewed shelf is not edition verification. Household/shared-catalog
prefill reuses existing work rows and explicit reader-choice guards, rather than fetching a new
provider record when a page opens.

The older owner-run `scripts/import-corpus-csv.mjs` is a separate operational input, not the app's
CSV importer. It consumes a bespoke library CSV, can promote existing personal bibliographic rows
to shared works, and has a `--backfill` path joining the current enrichment-cache key namespace.
It makes no new provider request. Its direct-write behavior needs its own safeguards before reuse;
see D7. No invocation against a database was made for this audit.

Personalization is derived data, not another bibliography source. `embed` uses `gte-small` inside
the Supabase runtime to rank existing book/candidate text; its scores are not saved as authors,
page counts, genres or series evidence. Adaptive appearance computes weights from existing reader
state. Neither path fills missing bibliographic facts.

Production does **not** acquire ISBNdb, Apple/iTunes, LibraryThing, Inventaire, BookBrainz, Exa, or
LLM-authority results through these paths. Some names remain in historical provenance types, rate
configurations, scripts, or no-write trials. That is not evidence of enabled production coverage.
ISBNdb retirement and consumed trial locks remain unchanged.

## Confirmed findings, in correction order

### D1 — High confidence does not currently prove each enrichment source matched

**Priority: P0 for the ingestion correction, before a new broad completion sweep.**

`supabase/functions/enrich/index.ts` starts full mode at `high` whenever the supplied ISBN cleans to
any nonempty string. Open Library takes the first search row. Hardcover takes the first title-only
search hit. The final loop appends each record without verifying returned ISBN, title and full
contributors against the target or the previously resolved candidate. `withholdByConfidence` only
suppresses cover/series for selected lower confidence tiers; pages, dates, authors and other fields
can survive an unrelated or ambiguous candidate.

An additional offline probe ran the actual Edge handler with every HTTP request intercepted.
A single Hardcover result with an unrelated title, another author and a different ISBN was returned
as the enriched record with `confidence: high`. This is executed handler evidence, not only an
inference from a normalizer.

The resolver also treats matching surnames as confirmed authors. The offline fixture with
**Jane Smith** versus **John Smith**, same title, returns `high`. A fuzzy match can be useful for
review; it must not become automatic bibliographic identity. Series-label agreement must not
upgrade uncertain identity, because generic search labels are not relational evidence.

**Required correction:** validate every actual source result independently; normalize valid
equivalent ISBNs, exact supported title variants and complete contributor identity; keep uncertainty
explicit; never let a second unvalidated fetch override a resolved candidate. Separate candidate
ranking from automatic acceptance. Retire reusable old enrichment cache entries at the cutover.

### D2 — Work/edition boundaries fabricate precision and block real missing details

**Priority: P0 together with D1.**

`normalizeOpenLibrary` assigns `number_of_pages_median`, the first language, the first edition key,
the first 13-digit ISBN, and `first_publish_year` to fields read by downstream code as one record.
Those array positions are not linked to one another. `fetchDiscoveryDetails` subsequently treats
any matching ISBN in the merged ISBN union as enough to release publisher/language details; this
consumer does not restore the edition relationship lost by the upstream merge. Even an ISBN-filtered work search does not
make its median or first edition the selected edition. The synthetic reproduction shows this exact
projection. Hardcover enrichment likewise works from a work search, while its richer edition API
is used only by Cover Studio.

**Required correction:** keep work facts separate from edition observations. For a selected ISBN,
use a bounded exact-edition lookup, resolve every required contributor, and admit each fact with its
scope and source. Do not auto-choose an arbitrary ISBN when only the work is known. Page count,
binding, language, publisher and edition date require edition evidence. Missing source fields must
stay missing; gathering more work search fields cannot repair this boundary.

### D3 — Publication dates can be invented or assembled from different sources

**Priority: P1; reproducible without provider calls.**

`normalizeHardcoverSearch` maps a year-only response to January 1. `mergeRecords` resolves year,
month and day independently: an Open Library year of 1990 plus a Hardcover date of 2031-06-15
becomes **1990-06-15**, a date neither provider returned. `parsePubDate` accepts invalid calendar
days such as 2031-02-31. The corpus fill-only RPC also fills date axes independently, so fixing the
normalizer alone is not sufficient when an existing year conflicts with a new candidate's year.

**Required correction:** validate calendar dates; preserve year/month/day precision; choose a whole
source date and fill missing precision only when the already-known axes agree. Protect manual
partial dates. Historical repair must be a separately reviewed, provenance-scoped operation.

### D4 — Several acquisition-to-save paths drop fields the app already supports

**Priority: P1, after D1/D2 ensure the values are valid.**

- `apps/web/src/data/search.ts` fetches enrichment but omits `pageCount` from the new `Incoming`.
- `parseCsvRows` does not read `Number of Pages`; the custom `ColumnProfile` has no pages key.
- Add's metadata lookup fills contributors, genre and cover but does not populate pages or the
  returned publication date. The form has no page-count control. The external Discover preview
  sends only `hit.authors[0]` to Add; a multi-contributor external hit loses the rest at that handoff
  unless later enrichment reconstructs them. Corpus-backed prefill has its own shared-work path.
- Enrichment returns publisher/language/description; corpus completion has corresponding fields,
  but the personal `Book` model and mapper do not. Discover's preview already displays a catalog
  description, publisher and language; the personal book screen renders its page/date pills, not
  a corresponding shared bibliographic detail panel. This is a visible discontinuity after Add.

**Required correction:** carry valid supported values through all intake paths, with explicit
reader review and field ownership. Add a clearly labelled shared work/selected edition section for
existing shared metadata. Do not pretend work-level publisher/language is a property of every
personal copy, and do not add a database field solely because a provider happens to return it.

### D5 — Source failures can still look like empty coverage

**Priority: P1.**

Hardcover enrichment does not inspect a successful-HTTP GraphQL `errors` array. The actual-handler
probe returned `source: null` without `sourcesFailed` for a mocked HTTP-200 GraphQL error. Fast enrichment
catches adapter failures and can return an empty successful payload. Cover-alternative requests
convert a failed Hardcover request to `null`/an empty provider list. If an Open Library fallback
exists, that partial list can be cached without exposing that Hardcover was unavailable; a wholly
empty alternatives list is not cached. Release budget denial
returns an empty list, which can be cached as a completed author lookup. Other paths correctly
throw or distinguish pending/unavailable; those semantics should be reused consistently.

**Required correction:** represent data, no match, throttled, unavailable and malformed distinctly;
do not give outages a success/negative-cache stamp; add provider timeouts and bounded reads where
missing. Verify the actual handler/cache behavior, not only pure normalizers.

### D6 — Reader search and releases discard coverage or conflate edition context

**Priority: P2 after identity correctness.**

Hardcover explicit search filters out titles without covers. Google search is English-only. The
release query's `release_date` filter excludes year-only records even though the UI supports them.
Release grouping uses normalized title plus the first contributor and combines same-date formats,
territory/publisher fallbacks and cover choices. This is a work-level arrival summary, not an exact
edition comparison. Contributor ordering/roles and alternate editions need a visible, consistent
model before broadening the feed.

**Required correction:** retain valid coverless search hits with the existing placeholder, make
language scope explicit, acquire imprecise releases through a bounded compatible query, and keep
edition provenance attached to any edition-specific display or Add prefill.

### D7 — Older owner-run import/backfill paths also need the new admission boundary

**Priority: P1 before another owner-run import or cache promotion.**

`scripts/corpus-backfill.ts` joins by the requested cache key and proposes missing provider work ID,
cover and accumulated ISBNs without revalidating the cached identity, confidence or field scope.
The actual pure patch builder accepted a synthetic unrelated title/author with `confidence: none`
and proposed all three. Canonical ISBN validation and a whole-plan cross-work collision check are
valuable, but cannot detect a wrong, previously unassigned ISBN. The backing cache query also does
not read or filter expiration. A current namespace alone does not establish fresh, correct evidence.

The bespoke CSV operator directly upserts the owner's existing bibliographic projection into shared
works, including nullable pages, dates, covers and legacy series fields. That differs from the
current fill-only, review-aware app completion path. Its header still describes series membership
being created on first UI interaction, which is no longer the app's read-only series-page contract.
These are operator/payload findings, not evidence that this script recently ran or changed production.

**Required correction:** include these writers in D1/D2 cache invalidation and admission work; reject
expired or unqualified records, preserve reviewed shared fields, and reconcile or retire the older
direct-write operator against the current series/contributor model before reuse. Retain collision
preflight and dry-run review. Do not run it as a repair for the findings in this audit.

## Verified protections to preserve

- Google search remains separate and attributed; it does not supply generated shelves, releases,
  automatic enrichment or new durable cover alternatives. ISBNdb adapters remain retired.
- Cover ingestion validates bytes and uses a single decoded image with no upscaling. Cover choice,
  bibliographic choice and possession remain separate actions.
- Personal fill-only merges preserve nonempty reader values. Structured contributor rows and
  reading history have their own persistence paths. Corpus completion remains administrator-only.
- Series classification retains positive relational evidence, explicit unresolved states and
  reader-choice protections. A source outage is not standalone evidence.
- The private edition comparison is ephemeral and read-only. An independently admitted peer does
  retain its fields when the other source fails; repeated “Withheld” cells were presentation, not
  deletion of the reader's saved pages.
- Existing backup/import tests cover ownership, rereads, ratings, notes, deduplication and preferences;
  a green suite does not establish coverage for a column the parser never reads.

## Evidence and limits

The adjacent [synthetic reproduction receipt](book-data-ingestion-reproductions-2026-09-12.json)
was generated by executing the actual normalizers, merge, resolver and CSV parser from the baseline.
It proves the work projection, surname false match, fabricated date, mixed-source date, invalid day
acceptance and dropped CSV page count. A separate actual-handler probe confirms unrelated-source
admission and failure-to-empty conversion with all HTTP requests intercepted; no live credentials
or provider requests were used. It contains no personal library data or provider payload.
The pure backfill patch builder was also executed with synthetic cached data and no store/writer.
The remaining findings are source-to-writer/display call-path evidence in the files cited above.

One owner-supplied ISBN was checked read-only against the two free public edition endpoints and the
publisher's public page; case-specific details and the private lens correction are recorded only
in the private repository. The sources disagree on pagination; this audit does not pick a winner.
No production database, stored cover, reading record, entitlement, API secret, or consumed source
trial was changed. This is not an exhaustive live crawl, a provider accuracy percentage, a rights
clearance, or proof that hosted functions match this local baseline.

The companion task owns authority-source trial policy and offline regressions; see the separately
reviewed coordination receipt. Trial outputs remain no-write and cannot repair production identity.

## Completion gates for the corrective pipeline

1. D1/D2: source-by-source admission plus exact edition scope; handler tests cover wrong-first-hit,
   same-surname authors, returned-ISBN conflict, subtitles, anthologies and missing authors.
2. D3: date tuple/precision guard in normalizers, merges and the authoritative corpus write path.
3. D4: intake/CSV/read-only detail completeness; tests assert saved and reloaded values, including
   an existing reader value that must survive conflicting provider data.
4. D5/D6/D7: outage/cache behavior, coverage and older operator admission; distinguish legitimate
   sparse records from failure, and prevent unqualified cache promotion on every writer path.
5. Fresh database browser regression, then private public-source sync, function/migration deployment
   as required, and a small owner-reviewed production smoke sample. Historical repairs stay separate.

Until these gates pass, describe the catalog as partial and source-qualified. Do not claim that
“complete missing details” certifies the user's edition or that more acquired fields are always better.
