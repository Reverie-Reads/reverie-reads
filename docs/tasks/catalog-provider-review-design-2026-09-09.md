# Administrator provider comparison

Status: proposed implementation contract, not a shipped feature or source-use approval.
Source inspection: public main `155df22853d7d552bf283ae9178c3f7781e145b6` (merged #518).

Owner update, September 9: the planned reader-facing comparison is a **Pro feature**, not an
administrator-only product. PR #521 stays draft. See [the current scope](app-first-book-data.md#planned-pro-feature-compare-edition-details).
The administrator route, permission and target-access assumptions below are historical design
inputs and must not be copied as the Pro implementation contract. Source admission, no automatic
field application and source-use/retention safeguards remain relevant.

## Decision

Add a read-only **Compare provider evidence** section to the existing administrator metadata
workspace, scoped to one explicitly selected ISBN. Keep independently admitted observations
visible beside the other provider's unresolved/review status, but keep the joint decision withheld.
No winner, acceptance checkbox, field application, identity repair, bulk run or LLM is part of v1.

First build and test the display contract with synthetic inputs and no provider connection.
Live acquisition is a separate, default-off delivery requiring a reviewed browser-display,
retention and operational policy for each enabled provider. Neither a public API nor an existing
enrichment integration establishes permission for this new data flow. This document does not
reassess vendor terms, authorize paid calls or make a legal reuse determination.

This follows the #517 live sample and #518 offline comparison. Those studies do not prove the
cause of Open Library's title mismatches. Do not reopen consumed samples, strip title qualifiers,
repair rejected source records, or use model confidence to dismiss an identity conflict.

## Existing architecture and the actual gaps

| Existing component                                     | Reuse                                                                                            | Do not assume                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `CatalogMetadataReviewRoute` / `CatalogMetadataEditor` | Administrator gating, selected-work navigation, responsive shell and preserved description draft | Related records are internal corpus peers, not external provider responses                                          |
| `corpusMetadataReview.ts`                              | Account-scoped keys, explicit request/action handling, revision-aware review context             | `CatalogMetadataWork` lacks pages and typed contributors despite the SQL returning contributors                     |
| Metadata review RPC                                    | Bounded queue, permission checks, work/peer fingerprint and revision                             | Fingerprint does not cover pages; it cannot certify a page decision or provider snapshot                            |
| Existing assessment actions                            | Keep description/assessment/defer/reopen behavior independent                                    | Their persisted notes/history are not a storage channel for transient provider output                               |
| Trial edition client and packet                        | Behavioral specification, strict admission rules and negative test cases                         | Packets deliberately refuse JSON serialization; the frozen Node clients are not browser/Edge services               |
| `enrich`                                               | General authentication/rate-limit patterns elsewhere in Edge functions                           | Its merged records and global enrichment cache are not independent source evidence or a no-write comparison service |
| Offline cache exclusion                                | Existing `catalog-metadata-review` namespace and sign-out clearing                               | A differently named provider query would be persisted unless explicitly excluded                                    |

The work model is especially important. `works.isbns` can contain several editions; `works.pages`
is a single scalar, not an ISBN-bound extent. `books.pages` is personal reader data. There is no
edition-bound shared page-review decision in this workspace. Therefore v1 must not offer an
“Apply pages” shortcut, use the first ISBN automatically, infer possession from binding, or treat
shared page count as the selected edition's current truth.

The current source code, not a reported migration/deployment, supports these conclusions. Hosted
schema and live UI state were not verified in this assessment; neither is required for this design.

## Reader-visible flow

1. An administrator opens a catalog work in `/catalog/metadata`. Opening the page, changing queue
   filters, opening history and editing a description make **zero provider calls**.
2. A separate section explains: “Compare one edition. Provider details are observations, not saved
   catalog changes.” Choose one valid normalized ISBN from the displayed work; even a single ISBN
   requires an explicit Compare action. Show the exact selected identifier beside every result.
3. Disable comparison for missing/invalid identifiers, an ISBN claimed by multiple works, or
   incomplete/unusable title and full-author identity. Explain the reason; do not pick a peer,
   split an author-display string, or substitute a provider's title to manufacture a match.
4. Explicit Compare starts one bounded request. No automatic polling, navigation fetch, retry,
   background refresh, prefetch or library-wide completion job. Repeat clicks share the in-flight
   request rather than consume another budget.
5. Display one source card per configured provider in a fixed order, with plain-text status,
   observation time and eligible field values. Display missing fields as unknown, never zero.
   Expired/cancelled results are not reused for another ISBN or work. A source outage is not “no
   series,” “standalone,” “no edition,” or permission to silently choose the other source.
6. Keep existing description and assessment controls separate. Provider results never prefill a
   description, note, source field or confirmation checkbox, and viewing them never marks a work
   assessed. The existing editor draft is not replaced by a provider response or background refetch.

The first field scope is page extent and edition binding only. Do not add descriptions, artwork,
reviews, author biographies, series, recommendations or raw response inspection. Source identity
status means exact fields matched the requested identity under the adapter's rules—not certified
bibliographic truth. Unknown observed language stays visibly unknown even if admission tolerates it.

## Display policy: evidence is not permission to write

Each provider must be validated independently before any of its values enter the display object.
Separately retain the conservative joint disposition; do not overwrite it with a source count or
the successful provider's status. The existing trial join and serialized reports remain unchanged.

| Source outcomes for the same target                                   | Display                                                                                                               | Joint message / action                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Google exact match; Open Library title mismatch                       | Google's admitted page observation; Open Library's finite rejection reason, no rejected record values                 | “Identity review needed. No changes made.”                                                 |
| Google exact match; Open Library author lookup unavailable            | Google's admitted observation; incomplete-author status, not a partial author list                                    | “Comparison incomplete. No changes made.”                                                  |
| Both exact matches, same page value                                   | Two attributed observations                                                                                           | “Sources agree; independence and edition format may still be unconfirmed.” No apply action |
| Both exact matches, different page values                             | Both attributed values with a textual difference label                                                                | “Page counts differ.” No automatic preferred source                                        |
| One exact match; other returns no exact edition                       | One attributed observation plus the precise no-match result                                                           | “One source only.” Not a standalone or completeness conclusion                             |
| Both unresolved/rejected                                              | Status/reason cards only                                                                                              | “No admitted observations.” No inferred values                                             |
| Binding conflicts, or an admitted audio edition                       | Keep eligible binding observations; label any other provider's page value not comparable and never as an audio extent | “Edition format needs review” or “Pages do not apply to this audio edition.”               |
| Shared work already has pages                                         | Label that scalar “Shared record value; edition not established”                                                      | Never treat it as the selected ISBN's current value without an explicit edition link       |
| Unknown source, malformed matched record, forged source/ISBN/endpoint | No values from that record                                                                                            | Fail closed with a bounded diagnostic; do not silently treat it as matched                 |

Rejected titles/subtitles and raw error bodies remain excluded. A finite `title_mismatch` reason
does not reveal whether it was repetition, a missing subtitle or a genuinely different title.
The UI must say it cannot determine that from this result. An LLM is not needed to render these
states and must not reconstruct the discarded evidence or select a “correct” record.

## Proposed contract and freshness

Use a new allowlisted display DTO rather than removing `toJSON` protection from a trial packet.
The display object is deliberately serializable **only for the new reviewed server-to-admin flow**;
that is a new retention/exposure boundary, not a loophole in the aggregate-only trials.

Request fields: work UUID, explicitly selected canonical ISBN, expected catalog fingerprint and
review revision. Reject unknown keys, arbitrary URLs, client-supplied provider records, caller IDs,
model output or reference answers. The server reloads the work and resolves the selected ISBN
uniquely. Derive the complete author/co-author list from structured contributors; never silently
drop an extra author or treat translators/narrators as authors. If identity fields are incomplete
or ambiguous, return a preflight explanation with no provider call. Missing subtitle information
can cause conservative rejection; this feature does not repair the catalog's identity to evade it.

Response envelope: schema version, work UUID, target ISBN, request identity fingerprint, existing
review revision, comparison snapshot hash, acquisition time, expiration, fixed joint disposition,
and at most two provider results. A hash binds a snapshot; it is not an authorization credential
or proof that a provider told the truth.

Provider result fields: allowlisted provider/endpoint, terminal status and finite reason; bounded
source identifier sufficient to derive an approved non-secret source link; observed time; checked
identity dimensions including observed-language-known/unknown; nullable valid integer pages and
allowlisted binding only for independently admitted records. No generic metadata dictionary,
arbitrary URL, query, HTTP body, request ID, headers, token, stack trace or HTML. Source links must
be derived from allowlisted identifiers and origins, never copied from arbitrary response strings.

Define a separate comparison fingerprint over every displayed target field, structured authors,
selected ISBN, the work's ISBN assignments, shared page value and its provenance, provider-policy
version and review revision. The existing metadata fingerprint remains unchanged. Check target
identity, unique ISBN binding, admin permission and comparison context before requests and again
before releasing results; discard the response if any changed. The UI also compares the account,
work, ISBN and request generation before rendering a late response.

Keep an at-most-five-minute display lifetime, further shortened by the approved provider policy.
No policy means no live display, not a default five-minute permission. Clear on expiration, route
departure, ISBN/work change, sign-out, account change or detected permission revocation. Refocus
requires a fresh permission/context check before redisplaying values, not an automatic provider
refresh. A disconnected/uncertain permission state hides the provider panel and allows an explicit
check. No claim of instant revocation across an already delivered browser response is possible.

## Service, retention and cost boundary

Do not call the merged/cached `enrich` service for this comparison, import Node trial clients into
the browser, duplicate a frozen client wholesale, or change consumed study files. A later live
delivery needs an independently reviewed, bounded server adapter with parity tests for the existing
admission behavior. Credentials remain server-only. Start with Google Books and Open Library;
ISBNdb stays retired and Hardcover/PRH/Exa/Parallel/model calls are not in this delivery.

The proposed server endpoint validates the bearer session and current corpus-administrator
membership before source access. Use caller-scoped reads where possible, fixed provider origins,
bounded response bodies, manual validated redirects and full author resolution. Do not trust a
browser's admin boolean or use an arbitrary-fetch proxy. Apply an explicit server enable flag plus
per-provider policy gate, both default off. A missing credential/policy produces an honest unavailable
state; it must not initiate a fallback provider or source enrollment.

Proposed request budget per comparison: at most two Google calls (unique exact-ISBN search then
revalidated volume detail), and ten Open Library calls (ISBN lookup, at most one approved edition
redirect and at most eight author lookups). Maximum 12 external requests, 512 KiB per response,
30-second total deadline, and no automatic retry. Abort remaining work at the deadline; partial
author resolution is unavailable. Maintain provider request-start pacing at least as conservative
as the trial, with a server-wide provider limiter so simultaneous administrators do not multiply
the allowed rate. Requests spent on a cancelled browser view remain charged to the budget.

Proposed pilot ceilings: ten comparisons per administrator per hour and 100 globally per day,
subject to lower provider quotas/policies. Reserve budgets atomically before acquisition and fail
closed if the limiter cannot be checked. Operational counters may require database writes; therefore
call this **no catalog writes**, not “no database writes.” Those counters contain no book identities
or provider values. No application model cost exists in this design; HTTP ceilings are not a
monetary quote or a guarantee about an account's billing.

Return `Cache-Control: no-store, private`; exclude the endpoint from service-worker/API caching.
Keep results in component memory rather than persistent query or mutation caches. If TanStack Query
is used, require account-keyed entries under the already-excluded `catalog-metadata-review` prefix,
no retries/refetch-on-mount/focus/reconnect, and explicit removal on lifecycle exit—not just staleTime.
No localStorage, IndexedDB, offline backup, download/export, analytics/session replay capture,
provider-response logging, error-report payload or enrichment-cache write may retain the data.
Aggregate counters are the only operational telemetry. Expiry is an application retention boundary,
not a promise to prevent screenshots or an authorized person's independent notes.

Do not reuse `corpus_metadata_review_events` for provider snapshots. Its existing audit intentionally
persists full review context. A future durable source decision needs separate approved provenance,
retention/deletion semantics and a fresh revision-bound RPC. It must also solve the work-versus-edition
storage issue before accepting page values. Manual recording by an administrator is not a way to
turn restricted source material into unrestricted catalog data.

## Delivery and acceptance gates

1. **Offline contract and component:** add a pure display projection plus synthetic fixtures and
   an isolated comparison component, with no production data source or enabled route action.
   Proposed homes are a new `packages/core/src/providerComparison.ts` and
   `apps/web/src/components/catalog/ProviderComparison.tsx`; names are plans, not existing files.
   Reuse design tokens and contrast-test patterns. Confirm exact scope with the other chat first.
   Keep this implementation branch draft until its intended caller is wired and verified; do not
   merge unused exported helpers, an unreachable component or synthetic book data into the app.
2. **Live read-only review:** only after provider-use/retention approval and explicit owner clearance,
   implement the bounded endpoint and administrator-only invocation. Test on fresh non-holdout
   identities under a new preregistration if acquisition quality is measured. Do not turn UI smoke
   tests into unbounded acquisitions. Deploy through the private overlay and existing owner gates.
3. **Optional future field decision:** separate proposal, not implicit scope. It requires an
   edition-bound storage model, immutable source provenance, stale-evidence rejection, explicit
   field selection and reader-choice protection. No automatic promotion follows from v1 usage.

Required tests for the first implementation:

- Positive-control admitted records render real values; a valid source survives another provider's
  identity failure **for display only**, while the joint review disposition stays withheld.
- Wrong ISBN/title/full-author/language, multiple ISBN candidates, incomplete authors, malformed
  data, unknown providers and spoofed endpoint/source metadata never expose rejected values.
- Same-value agreement, conflicting pages, missing pages, unknown language/binding, audio and
  mixed-format cases have distinct text; no average, invented format or preferred winner appears.
- No writes or provider calls on mount, navigation or rendering; fixtures cannot reach real fetch.
  Assert absent mutation behavior with spies on actual writer boundaries, not only disabled buttons.
- Slow response after work/ISBN/account change cannot render; expiry, permission loss, offline state
  and sign-out clear values. Existing description drafts and stale-save refusals remain intact.
- Serialization allows only the new DTO, never raw packets; offline dehydration, service-worker
  caches, analytics and error paths retain no case-level provider data. Test known sensitive fixture
  strings against each sink, not a superficial property-name scan alone.
- Keyboard and screen-reader statuses, text-based conflict labels, all nine skins in both modes,
  narrow layouts and long bounded identifiers. Mirror the existing metadata browser journeys.

The live delivery additionally requires server-auth/permission-race, unique-ISBN, request-budget,
global pacing, timeout, redirect, source-shape and response-fingerprint tests. Any new RPC explicitly
resets public/anon/authenticated grants before deliberate grants. Run the full non-browser gate and
one fresh-database/default-worker/no-retry E2E suite for implementation; a green synthetic projection
alone is not proof that the delivered browser/service flow behaves correctly.

## Source evidence and verification

Read in full: the metadata route, editor and hooks; metadata review migration and hook tests; the
trial review packet and field-evidence builder; offline cache implementation. Checked related
edition client/packet logic, author-role extraction, Edge authentication/cache paths and browser-test
coverage. `codebase_search` was unavailable; direct `rg` searches and complete relevant definitions
provided the implementation evidence instead.

- [Current route](https://github.com/Reverie-Reads/reverie-reads/blob/155df22853d7d552bf283ae9178c3f7781e145b6/apps/web/src/routes/CatalogMetadataReviewRoute.tsx)
- [Editor and existing write controls](https://github.com/Reverie-Reads/reverie-reads/blob/155df22853d7d552bf283ae9178c3f7781e145b6/apps/web/src/components/catalog/CatalogMetadataEditor.tsx)
- [Review model, fingerprint and transaction](https://github.com/Reverie-Reads/reverie-reads/blob/155df22853d7d552bf283ae9178c3f7781e145b6/supabase/migrations/20260928010000_catalog_metadata_review.sql)
- [Memory-only trial packet](https://github.com/Reverie-Reads/reverie-reads/blob/155df22853d7d552bf283ae9178c3f7781e145b6/packages/series-source-trial/src/metadata/review-packet.mjs)
- [Offline cache exclusion](https://github.com/Reverie-Reads/reverie-reads/blob/155df22853d7d552bf283ae9178c3f7781e145b6/apps/web/src/lib/offlineCache.ts)

This change is documentation only. No endpoint, component, API call, migration, source approval,
database mutation or deployment was created. Repository validation passed: 403 trial tests, 2,708
core tests, 909 web tests and the compiler-backed Workflow integration test, plus typecheck, lint,
build, formatting and diff checks. The local build retained its expected local-URL/bundle-size warnings and is not deployment
verification. No public PR was open at the conflict check; the other active chat was notified of
the exact one-document scope before publication. Private-overlay files and the local DB were untouched.
Fresh browser E2E is explicitly exempt for this documentation-only branch; the future implementation
is not exempt.
