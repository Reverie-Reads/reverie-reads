# ISBNdb final subscription-value comparison: prospective plan

The owner authorized this bounded evaluation before further ISBNdb contact, with no production
or billing changes. This plan is written before tested-provider acquisition. It is not a result.

## Decision rule

Compare free-only, selective ISBNdb and ISBNdb-first using the unchanged five-field scorer and
exact edition identity rules. Report additional correctly improved distinct works, regressions,
incorrect selected values, missing/unscored fields, conflicts, coverage, latency and calls. A
filled field, provider response or same-upstream agreement is not automatically a useful work.

For this final practical decision, a policy must improve at least 10 of 100 works without
increasing wrong-value works over free-only to merit further integration consideration. This
10% utility floor is an analyst-selected, prospective prioritization rule, not an owner-specified
economic threshold or a statistical guarantee. If neither paid policy clears it, recommend drop.
If one clears it, compare its gains, harms and subscription-only scenarios before recommending
conditional keep or drop. Missing reference coverage and provider outages must be visible; an
infrastructure failure yields an incomplete study, never evidence of poor ISBNdb data quality.

Use the owner-reported $14.99 monthly fee. Monthly distinct-work volume and the owner's acceptable
cost per additional work remain null. Show 100/500/1,000-work monthly sensitivity scenarios and
the distinct-work volume needed to reach illustrative $0.25/$0.10/$0.05 costs per additional
correctly improved work. Do not count recurring cache hits as fresh gains or invent saved review
time. These are subscription-only projections, not measured total operating costs.

## Reference and selection boundaries

Prepare exactly 100 distinct works, one ISBN per work, from a finite snapshot of the public
Penguin Random House Library Marketing homepage plus at most 25 Beacon homepage titles and
24 NYRB Classics collection titles. These official publisher/distributor pages supply identities
and edition facts independently of Google, Open Library and ISBNdb API acquisition. The PRH
consumer page's exact-ISBN Book schema supplies language only when it matches the target ISBN.
The library page supplies full title/subtitle, credited authors, format, imprint, pages and date.
Raw page content stays in memory; private factual reference records retain source URLs and hashes.

This is a deliberately scoped convenience frame with a common distribution channel, not a random
sample of all publishing or evidence of source independence. Distinct publishing organizations
must not be counted by their imprints. Require at least five actual publishing groups. Include
backlist, recent releases, fiction, nonfiction, small/independent presses, translated editions,
print/ebook where present and known audiobook controls. Exclude future publications, unsupported
formats, ambiguous identities, missing primary authors, duplicate works, and detected overlap
with completed metadata or private qualification identities. Unknown facts stay unscored.

Review the eligible pool before selection; choose deterministic, reference-complete cases with
explicit audio controls and publishing-group breadth. No tested-provider outcomes enter selection.
Publish aggregate candidate, exclusion, group/format and reference coverage counts with the lock.
Document missing older frames rather than claiming an exhaustive historical overlap audit.

### Pre-acquisition reference-frame amendment

The original finite frame contains 166 distinct ISBNs, including 20 unsupported large-print
editions and many forthcoming titles. Its reference-eligibility check cannot supply 100 usable
distinct works. Before any tested-provider book request, add the first 80 non-original, valid,
unique ISBNs in extraction order from the complete 36-page
[Spring 2022 Literature publisher catalog](https://penguinrandomhousehighereducation.com/wp-content/uploads/2022/05/TM-Lit-S22-040822b-web.pdf).
The catalog contains 167 unique checksum-valid ISBNs; its byte hash and ISBN selection
audit stay private. It is an identity-selection frame only; current exact-edition pages still
provide the reference facts. This fixes the source-population shortfall, not provider outcomes.
There will be no further population expansion after acquisition begins.

Three original identities receive a pre-freeze reference-parser repair: the publisher's explicit
`Ebook (EPUB)` label maps to ebook, and two audiobook consumer-page 404s leave language unknown
instead of discarding otherwise valid publisher edition references. Audio pages remain not
applicable. Known audiobook controls need not have scored language. Publisher-imprint extraction
and bounded, same-book/same-ISBN canonical redirects were also corrected during reference
preparation, before provider acquisition. Neither provider admission nor the scorer changed.

The authenticated, read-only ISBNdb account endpoint returned Basic, 5,000 daily calls, 8 already
spent and 4,992 remaining on September 9 before study acquisition. Its documented account check
does not consume quota. The observed rate policy is 60 requests per 60 seconds; transport spacing
remains at least 1.1 seconds. API keys were checked for presence without displaying their values.

Selection order is fixed before acquisition: retain the two audiobook controls; choose the
lowest-ranked ebook, one explicitly reviewed translated edition, one fiction and one nonfiction
case, and one case from each of five confirmed publishing groups; then fill to 100 by ascending
SHA-256 rank of the study label, work-group key and ISBN. Skip already selected work groups.
The translated control's publisher page explicitly credits a translator; this is not inferred
from an author's nationality. Rank and complete factual records stay private. Five confirmed
groups are PRH (its imprints collapse together),
[NYRB](https://www.nyrb.com/pages/about), [Beacon](https://www.beacon.org/),
[MIT Press](https://mitpress.mit.edu/about/), and
[Catapult Book Group](https://books.catapult.co/catalogs/) (including Counterpoint and Soft Skull).
Other publishers may appear but are not used to inflate the certified group count.

### Reviewed selection, before freeze

There are 246 unique candidate ISBNs: 166 initial and 80 catalog additions. Reference collection
made 249 candidate assessments because three initial parser exclusions were repaired. The initial
pass returned 81 reference records and 85 exclusions (81 identity/format/future-date exclusions,
one prior ISBN, three consumer 404s). The supplement/repair pass returned 59 reference records and
24 exclusions (four identity/format/date exclusions and 20 unapproved canonical redirects).
The three repaired records reduce the final unique excluded count to 106. Public reference
preparation was retried/fixed before freeze; tested-provider requests were still zero.

Of 140 unique reference records, one anthology exceeds the instrument's eight-contributor cap.
The remaining 139 eligible editions represent 137 distinct works: three editions of one work
collapse to one. Deterministic selection takes 100 works and leaves 37 eligible works unselected.
All selected identity and factual records were inspected before freezing; unknown language on
the two audiobook controls was not inferred. References are publisher observations, not a claim
of infallible ground truth.

| Frozen reference characteristic | Count |
| --- | ---: |
| Distinct works / ISBN editions | 100 / 100 |
| Paperback / hardcover / ebook / audiobook | 62 / 35 / 1 / 2 |
| Edition date before 2020 / 2020–2024 / 2025–2026 | 24 / 39 / 37 |
| PRH / NYRB / Beacon / MIT / Catapult-group works | 69 / 15 / 6 / 3 / 2 |
| Other publisher works, not counted as certified groups | 5 |
| Library homepage / NYRB collection / Beacon homepage / 2022 catalog selections | 42 / 15 / 3 / 40 |
| Publisher fiction / nonfiction / children-or-YA category observations | 64 / 27 / 7 |
| Reviewed pages / format / publisher / date / language | 98 / 100 / 100 / 100 / 98 |

Category observations are not a mutually exclusive taxonomy or a promise of genre balance.
Pages are not applicable to two audiobook controls; their language remains unknown. All 98
scored language references are English. The 100-ISBN set hash is
`a3a215d08c39d2e951d0c0e96fc8a4feeb84d48054c3492c5111479a6a07771e`.

The overlap audit checked identity fields from the completed 20-edition metadata baseline,
10-edition gap trial, 10-edition page comparison and the private authority qualification pool.
No selected ISBN or normalized work title overlaps those located frames. The older 12-edition
private input was not located; this is not an exhaustive historical non-overlap certification.
No qualification truth or tested-provider record enters the reference dataset or public report.

## Execution boundaries

Commit runtime, reviewed plan and the non-secret dataset/system lock before acquisition. Five
work-preserving cohorts of 20, in order, once each; one Google and one ISBNdb lookup per edition,
at most 80 Open Library HTTP requests per cohort. Whole-study ceiling: Google 100, ISBNdb 100,
Open Library 400. No repeat, replacement or post-result tuning. Authentication/quota/infrastructure
stops carry across cohorts. All five validated cohort results are needed for a combined result.

Only the approved ISBN-set hash may pass the public live runner. Preserve repository-common
attempt markers and aggregate-only output. Do not print credentials or retain tested-provider
records. No LLM/Exa/PRH API calls, corpus writes, deployments, billing changes, source-provider
contact or production source-use clearance. Public publisher website reference reads are distinct
from the inactive PRH API, which is not used.
