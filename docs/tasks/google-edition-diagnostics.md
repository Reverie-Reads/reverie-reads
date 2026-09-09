# Google page counts: endpoint diagnostic

September 9, 2026. Development diagnosis, not production qualification.

## Result

**Google search and volume detail can disagree about page count for the same returned
volume ID and exact ISBN.** A bounded six-edition probe found zero publisher-count agreements
from search and five from detail. One detail count still disagreed. This identifies an actionable
endpoint-level problem, not a universal correction rule or a measured catalog-wide accuracy rate.

Do not subtract one, substitute `printedPageCount`, or automatically trust all detail counts.
Do not rerun the consumed ISBNdb study to improve its recorded results.

## Method and boundaries

The six ISBNs below were chosen from public publisher pages before Google acquisition. They cover
four works, with a print/ebook pair and a standard/large-print pair to expose edition differences.
They are a purposive PRH-published/distributed sample, not a random or representative gold set.
The reference is the publisher's catalog extent for the exact ISBN, not physical pagination
independently counted from copies. Reference values were used only for comparison, not requests.

An in-memory preflight compared ISBNs and normalized title containment against the consumed
100-work frame and the public authority gold/candidate frames: 435 prior identities, zero overlap.
No qualification case file was loaded, no case truth was printed, and no frozen frame, lock,
attempt marker or acquisition runtime was changed.

The local diagnostic made one ISBN search per edition, with `maxResults=10` and `projection=full`.
It fetched one full volume detail only when search returned exactly one matching ISBN candidate
with a syntactically safe volume ID. Detail URLs were built on the fixed Google API origin from
that ID, never followed from a provider's `selfLink`. Both returned ISBN-10 and ISBN-13 identifiers
were checksum-normalized and required to agree with the requested ISBN. Search/detail volume IDs,
title, subtitle, authors and language were compared; this is an endpoint-pair identity check, not
a new automatic admission rule for the corpus. Publisher marketing title qualifiers were not
used to change any production title matcher.

Seven synthetic observation controls passed before live acquisition: distinct page-count fields
remain distinct, exact ISBN matches, another edition does not match, absent identifiers do not
match, absent pages stay null, and a returned zero remains visible in diagnostics rather than
being silently converted into a successful observation. These controls validate the observation
extractor only, not the complete production enrichment workflow.

One initial request received HTTP 403 and stopped. The diagnostic had omitted the already-configured
`GOOGLE_BOOKS_REFERRER`; after using the existing Referer/Origin settings, the bounded probe
completed with 12 successful Google requests in 15.914 seconds, including deliberate 1.1-second
pacing per request. Total Google requests including the initial refusal: 13. No key values or error
bodies were printed. No settings were changed. No automatic retries, paid-provider, Exa, application LLM,
PRH API or production Supabase requests were made.

Raw responses, descriptions and artwork were held only in memory and discarded. The compact
observations below are diagnostic evidence, not corpus input. The one-off local probe's SHA-256
was `dec2ede3e494754db84a8930cfaa679d83fac4f61c94119cc1d7650abf423ca4`;
it was not added as a reusable or qualification acquisition command. This document does not
authorize unrestricted harvesting or redistribution of either provider's catalog.

## Observations

Every search returned one candidate. All six search/detail pairs retained the same volume ID,
exact equivalent ISBN identifiers, title, subtitle, authors and English language.

| Work / edition                     | Requested ISBN | Publisher pages | Search `pageCount` | Detail `pageCount` | Detail `printedPageCount` |
| ---------------------------------- | -------------- | --------------: | -----------------: | -----------------: | ------------------------: |
| The Anxious Generation / hardcover | 9780593655030  |             400 |                401 |                400 |                       401 |
| The Anxious Generation / ebook     | 9780593655047  |             400 |                401 |                400 |                       401 |
| James / hardcover                  | 9780385550369  |             320 |                  0 |                302 |                       302 |
| James / large print                | 9780593862735  |             368 |                369 |                368 |                       369 |
| The Wager / hardcover              | 9780385534260  |             352 |                  0 |                352 |                       352 |
| Watershed / paperback              | 9780807016275  |             208 |                210 |                208 |                       210 |

Publisher reference pages, consulted September 9:

- [The Anxious Generation, hardcover](https://penguinrandomhousehighereducation.com/book/?isbn=9780593655030)
  and [ebook](https://penguinrandomhousehighereducation.com/book/?isbn=9780593655047).
- [James, hardcover](https://penguinrandomhousesecondaryeducation.com/book/?isbn=9780385550369)
  and [large print](https://penguinrandomhousehighereducation.com/book/?isbn=9780593862735).
- [The Wager, hardcover](https://penguinrandomhousehighereducation.com/book/?isbn=9780385534260).
- [Watershed, paperback](https://www.penguinrandomhouse.com/books/206138/watershed-by-percival-everett/).

Search did not return `printedPageCount` for any of these six. Its four positive page counts
equaled the corresponding detail `printedPageCount`, while two search counts were zero despite
positive detail counts. That correspondence suggests differing endpoint representations; it
does not establish Google's internal implementation or the meaning of the undocumented field.
The [public Volume schema](https://developers.google.com/books/docs/v1/reference/volumes)
defines `volumeInfo.pageCount` as the total pages; the
[detail method](https://developers.google.com/books/docs/v1/reference/volumes/get) retrieves a
volume by ID. No documented contract reviewed here makes `printedPageCount` a correction source.

The hardcover of James is the negative control against blindly promoting detail: 302 differs
from the publisher's 320 even though the identifiers and work identity agree. The reason for that
remaining extent difference is unestablished. Two Google endpoints are one source lineage, not
independent corroboration. Five agreeing editions represent only four works; do not present 5/6
as a general accuracy estimate or retroactively reclassify the completed 100-work study.

## Current production-path findings

Source revision examined: [public main c82b700](https://github.com/Reverie-Reads/reverie-reads/tree/c82b7008c425dae5280b4e4f76ec51e0fe3c1fc7).

- `supabase/functions/enrich/index.ts`: `adapterGoogle` requests one result and takes `items[0]`
  without checking returned ISBN, title or authors. Supplying an ISBN initially assigns high
  confidence independently of what comes back. The full title search can also select an ISBN
  for a work without proving that the reader chose that edition.
- The same file's Open Library adapters use work-level search records. Their `isbn` collection
  and `number_of_pages_median` do not establish the page extent of one requested edition.
- `packages/core/src/enrich.ts` and its edge mirror map Google's search `pageCount` directly,
  map Open Library's median directly, and prefer Open Library for pages. Simply changing Google
  to detail would leave that work-level median able to win the merge.
- The generic numeric merge accepts finite zero. The trial's independent page parser already
  requires an integer from 1 through 20,000; production needs an equivalent page-specific guard,
  not a global numeric change that would affect series positions or dates.
- `apps/web/src/data/enrichLibrary.ts` forwards pages to the fill-only personal import merge;
  `apps/web/src/lib/corpusSweepPolicy.ts` forwards non-null pages to the corpus patch. Fill-only
  preserves existing data but can still fill a blank with an unsupported edition observation.
- The old trial baseline already requests `projection=full`, up to ten Google results, and
  validates returned identity. Adding full projection alone cannot explain or solve its anomaly.

These are source-code findings. No production rows were read or changed in this diagnostic,
and it is not an authenticated end-to-end assessment of affected readers.

## Next implementation slice

Build a no-write edition-page evidence path first, then qualify its output before wiring it into
automatic enrichment. Reuse the existing checksum/identity and HTTP failure-classification
patterns; do not modify the consumed study runtime or weaken its admission rules.

1. Require one unambiguous exact returned ISBN candidate and conservative title/full-author
   consistency when those identity fields are available. Do not equate a title-selected work or
   search rank with a reader-selected edition. Missing, mixed, malformed and competing identifiers
   remain unresolved/reviewable.
2. Retrieve at most one Google detail record from the selected safe ID, revalidate identity after
   retrieval, and accept only integer page observations in 1..20,000. Missing detail, access
   refusals and changed identity must not fall back to an unverified search page count.
3. Obtain a separate exact Open Library edition observation when available; do not use the search
   work median for edition corroboration. Publisher evidence requires exact ISBN plus reviewed
   technical access/rights, not an unbounded scraper or reactivation of the inactive PRH API.
4. Represent pages separately from work confidence: source, endpoint, volume/edition identifier,
   target ISBN, timestamp, observed value and decision reason. Distinguish unsupported, candidate,
   independently corroborated and conflicting observations. Agreement from two Google endpoints
   counts once. Protect reader/trusted values and keep conflicts review-only; an LLM can explain
   supplied evidence but cannot repair unsupported numbers by inference.
5. Test wrong-first/right-second results, ISBN-10/13 equivalence, mixed-ISBN payloads, multiple exact
   candidates, changed detail identity, invalid pages, missing detail, HTTP failures, and opposing
   exact-edition page counts. Assert that no rejected value reaches a response, cache promotion,
   personal patch or corpus patch. Preserve unrelated cover, series and bibliographic choices.
6. Measure on a new, broader development sample with independent exact-edition references,
   including non-PRH, translated, indie and audiobook cases. Count correct new fills, erroneous
   fills, conflicts, abstentions, request count and latency separately. Holdout qualification and
   production rollout are subsequent gates, not cleared by these six observations.

The measured Google detail path adds one request per eligible cold lookup. Keep it conditional on
need and budgeted; do not double every search or add a model call for deterministic extraction.
Use an edition/field-versioned cache with explicit evidence eligibility so a historic search count
cannot bypass the new policy. Cache design must respect source-specific rights and must not
restore the retired ISBNdb namespace. No vector database or new subscription is needed to test this
specific failure mode.

## Delivery status

The original diagnostic landed as docs-only PR #507. The follow-up implements the bounded
`metadata:pages` trial command described in the
[trial README](../../packages/series-source-trial/README.md#exact-edition-page-evidence-trial-only).
It selects a unique exact Google search identity, revalidates one volume-detail response, and
joins the existing exact-edition Open Library path into a memory-only, review-only page packet.
Cross-provider agreement is deliberately not called independent corroboration. Existing values
stay protected and neither search pages nor undocumented printed pages can rescue failed detail.

The CLI requires a fresh reviewed frame and uses the hash-authenticated consumed frame only to
refuse overlapping ISBNs/base titles before credential loading. No frozen source file or attempt
marker is changed. References do not enter acquisition. The synthetic fixture is dry-only; mocked
HTTP exercises failures, ambiguity, provenance, request bounds, privacy and the still-wrong
302-versus-320 detail case. Removing the detail-ID guard makes its test fail; removing the duplicate
candidate guard makes both selection and HTTP call-bound tests fail. Both guards were restored.

Production adapters, cache behavior and metadata writes remain unchanged. This implementation
does not add new live-provider quality observations to the six-edition diagnostic above. A broader
fresh reference comparison is still required before choosing a production eligibility policy;
passing transport tests alone cannot certify page accuracy or source rights.
