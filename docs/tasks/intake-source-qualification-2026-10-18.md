# Intake source-use qualification review — 2026-10-18

Status: research with a bounded core implementation, not source approval. All three intake
adapters remain `review_only`. Intake cutover, durable provider-packet storage, redistribution,
and model input are not authorized by this report. No book API acquisition, account enrollment,
terms acceptance, paid request, or personal-data operation was performed for this review.

## Existing boundaries

`packages/core/src/intakeSourceAdapters.ts` assigns qualification in code, preserves unknown
upstream lineage, and prevents a response or caller from granting source authority.
`docs/reference/DATA_SOURCES.md` already distinguishes Open Library trial inputs pending rights
review from Hardcover decision inputs pending usable terms. A model paraphrase cannot change
either boundary. The current intake packet is transient; aggregate comparison receipts are
not a license to retain the underlying provider content.

The website-origin profiles in
`packages/series-source-trial/src/authority/retrieval/profiles.mjs` and their fail-closed inspector
in `profile.mjs` are useful precedents for versioned review records. They are not API licenses.
In particular, the PRH retail website is `manual_only`; this does not establish the permissions
of PRH's separate metadata API. Existing expired origin trials must not be treated as current
approval. Identity accuracy, contributor-role accuracy, data-use permissions, and independent
upstream lineage remain separate questions.

## Official sources inspected

All URLs below were checked on **2026-10-18**. A currently accessible page may contain older
text; dates below describe the page, not a newly negotiated agreement. No account-specific API
contract was available for this review. The observations are operational evidence for review,
not a legal conclusion about every fact or jurisdiction.

### Open Library

- [Developer API guidance](https://openlibrary.org/developers/api), displaying an October 9,
  2026 edit: supports human-facing, bounded discovery and lookup, asks applications to cache
  responses, identify requests, and observe rate limits. It directs bulk acquisition to dumps;
  it excludes HTML scraping, distributed limit evasion, and use as a high-traffic commercial
  backend. Published limits are one request/second unidentified and three identified. This
  documents an interface and operating constraints, not approval of every commercial use.
- [Licensing](https://openlibrary.org/developers/licensing), displaying a June 27, 2021 edit:
  Internet Archive asserts no new proprietary rights over the database but recognizes that
  pre-existing contribution rights and jurisdictional questions can remain. This is not a
  blanket CC0 grant for contributed descriptions, covers, or other third-party content.
- The linked [Internet Archive terms](https://archive.org/about/terms) did not yield readable
  terms text in the research tool. Their contents and applicability were not verified here.

**Qualification:** limited lookup and response caching have explicit public guidance. Scope
and field rights still matter. Persistent prose/images, redistribution, and third-party model
input remain unresolved for this application. The developer page's examples of AI tools do
not by themselves grant those permissions. Per-record upstream origin and rights remain
unknown unless separately evidenced; a second API returning the same fact is not independence.

### Penguin Random House

- [Developer portal](https://developer.penguinrandomhouse.com/) and
  [enhanced API overview](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api):
  document keyed book/author metadata access. The overview is an older published API document;
  availability and technical correctness do not establish storage or reuse rights.
- [Common parameters](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Common_Parameters):
  documents pagination, record-count suppression, links, empty results, and format filters.
  A parameter permitting a large response is not permission for bulk retention.
- [Domains](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Domains):
  describes MyHouse-backed domains and regional/product selection. This supports a generic
  publisher-controlled source-family description, not claim-level lineage, every contributor's
  rights, or independence from a provider that may ingest the same publisher feed.
- [PRH website terms](https://www.penguinrandomhouse.com/terms/), displaying an effective date
  of February 9, 2015: provide limited personal, informational, noncommercial content use and
  restrict commercial reuse and automated extraction. Their stated scope concerns that site
  and services linking to those terms. Applicability to the separate metadata API was not
  established. The website's page-caching exception is not a catalog-retention license.
- [Developer registration](https://developer.penguinrandomhouse.com/member/register) presents
  portal-management terms. A portal account or API key does not independently prove a content
  license. No registration or acceptance was performed. The attempted
  [developer terms URL](https://developer.penguinrandomhouse.com/terms) was unavailable to the
  research tool; this is not proof that no applicable agreement exists.

**Qualification:** the bounded metadata API is a documented technical interface. API-specific
transient-display, cache, durable-fact, redistribution, and model-input permission remain
unverified. Retail scraping or copyrighted-content reuse contrary to the published website
terms must not be used as a fallback. Do not silently extend those website terms to the API,
or treat their silence about a particular model use as permission. Preserve the current
review-only API adapter, partial-roster notices, and its exclusion of prose and covers.

### Hardcover

- [Official API entry](https://api.hardcover.app/) documents authenticated GraphQL access using
  a token from account settings. This establishes a supported access mechanism, not a data
  license.
- The [API documentation](https://docs.hardcover.app/),
  [API page](https://hardcover.app/api), and attempted public terms pages
  [terms](https://hardcover.app/terms) and [pages/terms](https://hardcover.app/pages/terms)
  were unavailable to this research tool. No access restriction was bypassed. Unavailable
  evidence means unknown, not forbidden or permitted.

**Qualification:** account authorization, application/commercial-use terms, caching, display,
retention, redistribution, model input, and claim-level upstream lineage need usable evidence.
Neither a token, an open-source client, nor a roadmap comment supplies that evidence. Retain
the current decision-input/review-only boundary; do not present Hardcover agreement with PRH
or Open Library as independent corroboration without upstream provenance.

## Capability conclusions

These are public-document observations, not new execution approvals. “Unknown” means no
sufficient applicable permission was established in this review; it does not assert that an
operation is unlawful. Local engineering policy can be stricter than provider terms.

| Operation                                 | Open Library                                           | PRH metadata API                                              | Hardcover API                                                       |
| ----------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Bounded lookup interface                  | Documented, subject to stated use/rate constraints     | Documented keyed interface; applicable use terms unresolved   | Documented authenticated interface; applicable use terms unresolved |
| Transient review display                  | Lookup purpose documented; mixed-content rights remain | Unknown API-specific grant                                    | Unknown                                                             |
| Response caching                          | Explicit guidance, not unrestricted downstream rights  | Unknown                                                       | Unknown                                                             |
| Durable facts and contributor credits     | Field/source scope needs qualification                 | Unknown API-specific grant                                    | Unknown                                                             |
| Prose/image storage or export             | Not established by database-rights statement           | Not established; adapter excludes these fields                | Unknown                                                             |
| Redistribution or third-party model input | Unknown for this application/content                   | Unknown                                                       | Unknown                                                             |
| Independent claim-level upstream lineage  | Unknown by default                                     | Publisher family documented; claim-level independence unknown | Unknown                                                             |

No evidence in this review warrants changing `usage` to eligible. Unsupported or ambiguous
credits remain under review even if a later rights review succeeds. Conversely, a correct exact
ISBN or author does not resolve a source-use hold.

## Implementation and integration boundary

`packages/core/src/intakeSourceQualification.ts` now provides
`getIntakeSourceQualification(provider, asOf)`: a code-owned manifest for the six operations
below, fixed `review_only` authority, unknown upstream lineage, and derived promotion blockers.
Returned records and nested arrays are independent, frozen copies. Unknown providers do not echo
their input, which might contain a private locator. Invalid timestamps, dates before the review,
and stale reviews receive explicit holds. The local freshness interval is October 18 through
November 16, 2026 UTC; November 17 begins the stale state. This is an engineering review cadence,
not a provider license expiration. Historical documentary findings remain visible when stale.

The focused manifest file passes 18 tests, and core typechecking passes. Parent-owned integration
now consumes qualification in source construction, transient review, and aggregate comparison
reports. The combined qualification/review/shadow checks pass 70 tests, including deterministic
current/stale dates, selected-but-unavailable providers, fixed review-only status, and absence of
record literals from aggregate reports. These checks establish local behavior, not permission or
live-source accuracy. The manifest is covered by the existing core/acquisition-system hash; no
replacement of consumed frames or new permission grant follows from this implementation.

## Remaining qualification work

1. Obtain the applicable API/account terms for the intended application and field classes. Record
   permitted scope separately for lookup, transient review, caching, durable facts, export and
   model input. Reference private agreements without committing their contents or credentials.
2. Establish claim-level upstream lineage before counting two APIs as independent corroboration.
   Publisher website/API agreement is one source family, not independent confirmation.
3. Once permissions are evidenced, review the explicit handoff with lossless credit storage and
   existing authority/fingerprint checks. Unknown roles and identity conflicts remain held even
   if source-use permissions are later qualified. No current finding grants a writer or model path.

The immediately useful outcome is an honest, enforceable review handoff with visible holds.
Obtaining applicable API terms or a specific license can resolve individual operations later;
this report does not require contacting a provider, accepting terms, or expanding the provider
list. A fresh non-LLM comparison measures matching behavior only within its frozen scope. It
does not itself qualify retention, general corpus accuracy, or readiness to switch intake.
