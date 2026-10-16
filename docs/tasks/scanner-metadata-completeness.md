# Scanner and intake metadata completeness

The barcode viewfinder now uses roughly half the phone viewport, with a whole-barcode aiming
guide and camera aspect-ratio preference matched to its displayed area. Decoder frames remain
uncropped. Capture is still a page-session review queue; it never writes a book or quantity.

ISBN Add first asks the existing enrichment service for an exact edition. A successful lookup
becomes one explicit search choice. Otherwise ordinary catalog search remains available. An ISBN
query survives choosing a work search hit; it is the reader's observed identifier, not a work's
arbitrary first ISBN. Selecting a catalog record starts blank-field completion in the mounted Add
draft. Edited identity, departed screens and open review prevent late completion from changing
that task. Existing values and explicitly edited blanks win. Review freezes the exact payload.

## Two metadata scopes

- An exact Open Library or Hardcover edition independently validates its returned ISBN, title and
  full author. Compilations, duplicate ISBN matches, truncated/incomplete contributor lists and
  conflicting edition identities cannot fill edition fields. Only the edition record supplies its
  pages, date, publisher, language and format; parent-work scalar values cannot substitute.
- A successful ISBN absence may try an independently exact title/full-author **work** lookup.
  This lane supplies work descriptions, covers and categories only. It never selects an ISBN or
  borrows pages, date, language, publisher or binding from another edition. Hardcover uses its
  exact relational book query rather than a truncated ranked search. Duplicate exact work
  identities remain unresolved. An edition conflict or provider outage does not trigger this
  absence fallback.

The new `identity-admitted-v3:` cache namespace keeps older sparse results from delaying the new
lookup. Admission response version 2 and existing reader correction protections remain intact.
Partial provider failures are visible and do not become reusable completed cache entries or stamp a personal book as fully checked. Incomplete bibliography uses a three-day retry window, including books that already have covers.

## Edition choices

Add and saved-book Edit expose a bounded Hardcover edition comparison, following a unique confirmed
work identity. Publisher, format, language, date, pages and ISBN remain per-candidate observations.
The reader selects an ISBN explicitly. Invalid, competing and duplicate ISBN records are withheld;
reached limits and withheld records are disclosed. A source failure is distinct from an empty list.
This is not exhaustive edition coverage; ISBN-less editions remain manual. Choices do not create
copy inventory or ownership. Saved-book corrections remain in the draft, and changing its ISBN
retains the existing explicit ISBN/pages/date review before Save.

Import completion uses the same improved enrichment service and existing fill-only merge. Existing
imports are not automatically rewritten or re-run by this change. Saved imported books can use
Edit's edition comparison. Shared catalog corrections continue through their existing administrator
review paths.

## Evaluation boundaries

A private, immutable reader-authorized baseline and paired development evaluation are kept outside
both repositories. No reader identities, collection contents, case-level source outputs or private
history are fixtures or public reports. Acquisition uses only bibliographic lookup inputs; no
benchmark calls production writers, caches, rate-limit RPCs or telemetry. A local run of the actual
handler with real providers measures acquisition, not deployed Deno performance. Provider agreement
and strict input matching do not certify independently verified bibliographic truth.

Synthetic handler tests cover exact-edition admission and work-only fallback. Browser verification
uses generated EAN pixels through the actual packaged decoder and local-only account data. It does
not establish physical-phone autofocus, low-light reliability or iOS camera behavior. Deployment of
the updated enrichment function is required in addition to the web release.

## Source exploration

The investigation includes independent exact-ISBN, exact-work and edition-list endpoints, plus
an ephemeral Google Books search/detail diagnostic. Google output is not promoted into durable
catalog enrichment: its API documentation explicitly distinguishes display/search use from a
replacement metadata service, and its API terms restrict permanent copies. See
[Google Books API overview](https://developers.google.com/books/docs/overview) and
[Google API content terms](https://developers.google.com/terms).

The [Open Library API](https://openlibrary.org/dev/docs/api/books) exposes separate work, edition,
ISBN and work-edition-list endpoints. Hardcover's live GraphQL schema was checked for edition
fields, contributor roles and parent-work relationships before implementing its exact queries.
[PRH Title](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Title) and
[Work](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Work) resources
could add publisher-specific confirmation and edition lists; they do not represent the whole book
market. [OCLC WorldCat](https://www.oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html)
requires qualifying subscriptions or a commercial partnership. Direct publisher/ONIX feeds,
ISBNdb and reader photographs/OCR remain possible further evaluation methods, not ruled out by
prior product prioritization. They were not silently activated, purchased or treated as measured
coverage in this change. OCR can transcribe an observed title page or copyright page but cannot
establish unseen editions or invent missing facts.
