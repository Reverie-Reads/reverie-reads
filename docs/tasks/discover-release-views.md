# Discover: release freshness and distinct shelves

Status: implementation prepared for review; not deployed.

## Reader problem

The former “New and notable” shelf was a bundled curated list (41 entries; latest stored date
2025-10-28), displayed below the shared catalog with the same card treatment. It neither demonstrated
current releases nor clearly distinguished discovery from the reader's personal library.
The owner explicitly dropped Risingshadow from this task.

## Behavior

Discover has four named, URL-addressable sections: For you, New & upcoming, Curated picks and
Shared catalog. Existing guided discovery and explicit title/author/ISBN search remain available.
Curated picks identify their backlist character. The shared-catalog explanation remains visible
when optional reading tips are off. Only the selected section loads its browse query.

New & upcoming requests the existing authenticated releases function's new `browse` mode:

- Separate recent (today minus 90 days through today) and future (tomorrow through 183 days out)
  provider queries prevent either time window from consuming the other's request limit.
- Hardcover supplies at most 80 edition rows per window; optional PRH.US supplies at most 50.
  Existing global provider budgets and timeouts remain in force. No Google Books, ISBNdb,
  newsletter subscription, new provider or crawler is added.
- An exact, valid calendar day is required. Partial dates remain usable in the existing author
  release horizon but are not promoted into exact dates here. Both server and client enforce the
  rolling window. There is no older-book fallback or promise of a complete publishing calendar.
- First publication requires an exact parent-work date matching the edition date. A matching year
  alone is insufficient. A provably later edition is labeled New edition; other dates are simply
  Edition release. The default New books only filter includes only source-supported first
  publications. PRH on-sale dates alone do not prove a new work.
- The server retains at most 40 entries per window, reserving space for evidenced first publications
  before other editions. Exact ISBN/date/country duplicates prefer a complete Hardcover edition
  record, preserving its first-publication evidence; fields are never combined across editions.
  Different territories/dates remain distinct. Provider coverage can still miss new books.
- Cards show edition date, format and country when supplied, plus source attribution. Details
  remain read-only; Add opens the existing wishlist form and requires a deliberate save.
  Contributor arrays and available source links survive that handoff. Window/edition filters are
  in the URL and survive returning from Add.
- All-provider failure is an error with explicit retry. A successful empty result is an honest
  empty shelf. A partial outage is labeled and not cached. Configured sources with successful
  responses share a date/configuration-keyed 24-hour cache; checked time is shown unchanged on
  cache hits, including Check for updates.

## Source references

The new Hardcover request uses the same edition fields as the existing author-release adapter.
PRH query/date/sort parameters follow the official
[common parameters](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Common_Parameters)
and [Title resource](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Title).
PRH's numeric ISBN payload is now normalized without losing the identifier.

## Validation and rollout

Focused browser coverage exercises 390px and 1280px, view separation, release/edition filters,
old-date exclusion, source attribution, no-write previews, wishlist prefill/return, and error/retry.
Pure tests cover calendar boundaries, invalid/partial dates, bounded selection, intact-edition
deduplication, year-only uncertainty, and source failure versus successful emptiness.
Full regression results belong in the PR.

No database migration is required. The private deployment must carry both the web changes and the
updated `releases` Edge Function. Deploy the function before the web. Existing Hardcover credentials
are required; PRH remains optional. Live authenticated provider calls were not exercised locally
because those credentials were not configured in this checkout. After deployment, the owner should
verify one recent and one future provider record against its source page, including territory,
format, ISBN and first-publication status. Do not call fixture-backed tests live-provider evidence.
