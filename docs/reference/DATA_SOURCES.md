# Book data sources

Reliability is scored **for this project's use case** — a genre-neutral personal library that includes
trade, indie, Kindle Unlimited, and special-edition titles (several
"best" databases are effectively locked behind affiliate sales or library membership).

## Covers & backlist metadata

**September 9 source decision:** ISBNdb is dropped from the planned source stack. Its entries
below describe evaluated capabilities, not an active recommendation. The owner prefers improving
the existing pipeline over subscription-dependent data retention. See the
[completed comparison and final decision](../../packages/series-source-trial/reports/isbndb-value-study-results-2026-09-09.md).
The study itself changed neither runtime nor stored data. The subsequent retirement patch and
read-only inventory are described in [the exit handoff](../tasks/isbndb-retirement.md); deployment
and retention cleanup remain separate gates.

**September 9 Google diagnostic:** a [fresh six-edition endpoint comparison](../tasks/google-edition-diagnostics.md)
found search/detail page-count disagreement despite identical volume IDs and returned ISBNs.
Detail agreed with five publisher counts, not all six. This is a development finding, not a
production change or general accuracy estimate; work-level medians and search ranks must not be
treated as exact-edition corroboration. The separate trial-only `metadata:pages` command now tests
strict search-to-detail identity revalidation plus exact-edition Open Library observations; all
candidates remain review-only and output is aggregate-only. Cross-provider agreement does not
establish independent lineage. Production enrichment and the consumed study runtime are unchanged;
a broader fresh-reference comparison remains required before production integration.

| Source                      | Reliability /5 | Cost                                                  | How to grab data                                                                                                                                                                                          |
| --------------------------- | -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Books**            | 4.5 search     | Free; ~1,000 requests/day default, more on request    | **Explicit search only.** Preserve provider order, badge, and per-result link; do not use in personalized/generated shelves, releases, enrichment, or current cover alternatives. Optional server API key |
| **Hardcover**               | 4              | Free public API; ~$5/mo Supporter adds librarian edit | GraphQL `POST https://api.hardcover.app/v1/graphql` with a free Bearer token. Books carry editions, series, release dates, genres                                                                         |
| **ISBNdb**                  | 4 (paid)       | ~$15 / $36 / $100 / $300 per month tiers              | `GET https://api2.isbndb.com/book/{isbn}` with API-key header; ~1 req/sec; bulk up to 1,000/call on higher tiers                                                                                          |
| **Apple / iTunes Search**   | 3.5            | Free, no key (~20 calls/min)                          | `GET https://itunes.apple.com/search?media=ebook&term=…`; `artworkUrl100` → swap to higher res. Strong for audiobook art                                                                                  |
| **Open Library**            | 3.5            | Free                                                  | Search `…/search.json?title=&author=`; covers `https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg`. Cover-by-ISBN limited to 100 req/IP / 5 min; search 1 req/sec (3 with a User-Agent + contact email)   |
| **LibraryThing covers**     | 3              | Free dev key; attribution                             | `https://covers.librarything.com/devkey/{KEY}/large/isbn/{isbn}`                                                                                                                                          |
| **Open Library bulk dumps** | 3              | Free                                                  | Monthly data dumps to match offline; zero runtime calls                                                                                                                                                   |

> **Open Library cover resolution — credit.** The ISBN-direct cover endpoint
> (`/b/isbn/{isbn}-L.jpg?default=false`) and eager batch ingest into our own Storage — rather than
> ingesting only when a reader happens to open a book's detail page — were adapted from work shared
> by **Annabelle** ([somnia-library](https://github.com/Annabelle0726/somnia-library)). The
> `default=false` parameter is load-bearing: without it a miss returns a 43-byte 1×1 GIF at HTTP 200
> that sniffs as a valid image and would be stored as a durable cover.
>
> Adapted, not copied wholesale. Her project also falls back to Amazon, Goodreads and image search
> when Open Library misses; we deliberately do not: Amazon's terms bar
> use as a general covers backend outside an affiliate context, Goodreads' developer terms prohibit
> storing their data, and re-hosting scraped art is the unresolved rights risk named below. A personal, non-commercial library can take that rights risk; this one
> distributes to other readers and cannot.
> | **BookBrainz** | 2 | Free (CC0) | REST/GraphQL + dumps; sparse for romance |
> | **WorldCat / OCLC** | 2 practical (4 data) | Gated | Discovery/Search API needs library membership + OAuth |
> | **Amazon (PA-API → Creators API)** | 2 practical (5 data) | "Free" but gated | Best covers, but the API is being retired, closed to new sign-ups, and requires an Associates account with qualifying sales |
> | **Goodreads** | 1 practical (5 data) | n/a | Public API discontinued; only unofficial scrapers remain (against ToS) |
> | **Bowker / Books in Print / ONIX** | 1 practical | Enterprise | Authoritative ONIX feeds via contract; overkill |

### Caveats that hit a romance library hard

- **KU / indie ebooks frequently have no ISBN — only an Amazon ASIN.** ISBN lookups (ISBNdb, Open Library covers) miss them; covers really only live on Amazon/Goodreads. Expect a manual cover-paste fallback for those.
- **Hotlinking + CORS.** Cover URLs scraped from Amazon/B&N break unpredictably from a browser. API-served image URLs (Google / Open Library / Apple) are CORS-safe.
- **Cache aggressively.** Open Library will `403` quickly otherwise. The app caches covers at runtime; the enrich scripts bake them into the seed.

### Recommended stack

Use **Open Library plus optional Hardcover for automatic enrichment and cover candidates**. Keep
Google Books as a separate, attributed, reader-triggered search source. Use Hardcover, optional PRH
confirmation, and manual reader entry for releases. Reader photo/upload and the designed room
placeholder cover the unresolved edition gap without turning a display source into durable catalog
data.

## Selective ISBNdb metadata trial

The experiments below are historical. No further ISBNdb acquisition is authorized without new
owner approval. The final 100-work study found 38 additional correctly improved works under the
selective policy, but also 20 regressions; useful edition fields did not overcome the owner's
retention and recurring-dependency concerns. The consumed frame must not be rerun.

The separate edition comparison covered 12 editions. Among nine fully observed three-source
cases, ISBNdb offered five additional field opportunities over Google plus Open Library: two page
counts and three edition formats, with no additional strict identities. Three cases lacked a
complete baseline because of infrastructure errors. This small challenge sample supports a
selective supplement, not a general accuracy claim or replacement catalog.

The trial package now provides a baseline-first, gap-only ISBNdb evaluation command. Exact returned
ISBN, full title, and full-author agreement is required before a paid lookup. Page count and edition
format can become review-only candidates; existing values are never overwritten. Credentials stay
in a header to a fixed host, and only aggregate results leave the runner. There is no public gold,
training, search-index, corpus, or service export of provider values.

The acquired-baseline `metadata:benchmark` command now fetches and identity-checks Google and
Open Library itself, instead of trusting operator-supplied source labels. Both attempts must
complete; a provider outage, incomplete author list, ambiguous identity, or unknown binding cannot
trigger a paid gap lookup. Google digital availability is not evidence of the ISBN's edition format.
Publisher-referenced pages/formats score ephemeral candidates in memory; missing or conflicting
reference facts remain unscored. Reports retain aggregates only. This is still a development
benchmark, not a new LLM input, user-matching path, or persistence license.

A separate opt-in `metadata:review` command compares strictly admitted page observations even
when no gap exists. Its distinct development frame and paid routing do not alter the gap-only
benchmark. An in-memory per-field packet preserves eligible format fills beside page conflicts;
current values remain protected, and no field is automatically corrected. References score only
after routing and admission. The output contains aggregate paired comparisons, not provider
values or a selected winner. The completed [ten-edition page comparison](../../packages/series-source-trial/reports/metadata-page-results-2026-09-08.md)
admitted three paid comparisons: two Google ties against publisher references and one ISBNdb-only
agreement versus Open Library. Seven editions remained behind identity safeguards. This small,
conditional result does not establish catalog-wide accuracy or qualify an automatic correction.

The owner-requested `metadata:value` evaluation now measures subscription utility independently of
free-provider success, with three truth-blind modeled policies (free, selective, ISBNdb-first).
Publisher/date/language join pages/binding as ephemeral facts; cover, description and other-edition
presence are availability only. Distinct-work benefit, regressions, wrong values, real request counts,
and explicitly assumed monthly-cost scenarios are reported separately. The bounded live study is
complete; review-time savings remain unmeasured. Old trial routing and production adapters
are unchanged. See the [subscription-value protocol](../../packages/series-source-trial/reports/isbndb-subscription-value-design-2026-09-08.md).

This local experiment needs no migration, production flag, or new Supabase secret. It neither
enables nor certifies the existing production ISBNdb enrichment adapter. A subscription is not
blanket permission to persist or redistribute a catalog: account terms and retention/deletion
requirements must be reviewed before adding persistence or production use. See the
[trial instructions](../../packages/series-source-trial/README.md#selective-isbndb-edition-supplement-trial-only)
and [implementation report](../../packages/series-source-trial/reports/isbndb-selective-supplement-2026-09-08.md).

## Series membership and order

Series classification is a separate evidence problem from matching a book. A provider may identify
the correct title, author, and ISBN while still attaching a search-only label that is not a real
series. Reverie therefore stores identity confidence and membership confidence independently and
accepts an automatic corpus default only when a relationship source actually contains that work.

The shipped name-based Hardcover relationship lookup also accepts an explicit book locator from
the enrichment result. Only a successful empty exact-name lookup admits a bounded direct-book
fallback: revalidate title/full author, require one relationship, then fetch and revalidate that
series by its distinct provider series ID. Both classifier callers preserve the original candidate
label and the recovered canonical relationship as separate evidence. Existing stored-name/order
conflicts still require administrator review; a cache hit or direct ID never waives those guards.
Duplicate exact-name graphs may instead be disambiguated within the original bounded name response:
one graph must contain exactly one matching book ID with the full title and author, and every
returned graph must be complete below the response caps. Competing or malformed relationships
remain unresolved. Target-specific results use an isolated book cache, never the shared name cache.
Hardcover relationship row counts remain unknown lengths. This production adapter change does not
promote the separate trial resolver or alter qualification gates. See
[the fallback contract and rollout](../tasks/series-book-id-fallback.md).

Use this hierarchy by question:

| Question                              | Preferred evidence                                                                                                                                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Has the book actually been published? | A live publisher product page, issued ISBN/ONIX distributor data, or a post-publication national-library record. A product announcement or Library of Congress CIP record may be prepublication evidence, not proof of release.                                 |
| Is the series complete or continuing? | An explicit, dated author statement, then the publisher/imprint or rights catalog. “Latest release” and the current number of known books never prove completion.                                                                                               |
| What is the exact order?              | The author's recommended-order page, then a publisher series page, then corroborating relational databases. Preserve whether the value means `publication`, `recommended`, `narrative`, or `unspecified`; never silently collapse those into one kind of order. |
| Which edition/history is involved?    | National-library and ISBN/ONIX records; ISFDB is useful corroboration for speculative fiction. Edition publication does not by itself prove work-level series membership.                                                                                       |
| What breaks a tie?                    | Two independent sources, with author/publisher evidence controlling. A disagreement remains an administrator review item rather than being decided by source count alone.                                                                                       |

The Hardcover adapter uses its structured series-to-book relationship and provider cardinality;
candidate labels returned during ordinary Google Books/Open Library/Hardcover search are not
relationship evidence. The complete 209-case development frame showed that structure and
cardinality alone are insufficient for automatic membership: plausible wrong canonical names and a
publication-order container survived the earlier semantic quarantine. Hardcover relationships are
therefore candidates until independent open relational evidence agrees or the optional no-write
first-party adjudication join supplies a selected, policy-safe, hash-checked retrieval result from a
human-reviewed origin. A grounded first-pass scout result remains review-only. The evidence model
also accepts author, publisher, ISBN/ONIX, national-library, Wikidata, ISFDB, and Open Library
observations as supported connectors are added; unavailable sources remain retryable and cannot
become a negative ruling. Open Library's own guidance reserves its APIs for low-volume real-time use
and points bulk consumers to monthly dumps, so a future corpus-wide connector must use the dumps
rather than request every work live.

Inventaire and BookBrainz are implemented in the reproducible trial only, not production
classification. Inventaire's CC0 graph can add work-to-series relationships beyond Wikidata, but a
`wd:` entity observed through Inventaire retains Wikidata lineage and is not independent
corroboration. BookBrainz's CC0 relationship graph is useful corroboration but its alpha API and
sparse target-corpus coverage keep it supplemental. Both adapters verify the exact work through an
author relationship and then inside the provider's series roster; a one-member roster remains
review-only evidence.

The trial's LLM resolver is also not a source. It receives only already-fetched provider evidence,
has no browsing tools or truth labels, emits strict structured proposals, and has no Supabase write
path. A deterministic validator rejects any field or citation absent from the evidence packet and
keeps singletons, conflicts, and unsupported order/role claims out of automatic fills. Production
use remains blocked until the authority-reviewed accuracy, standalone-safety, provenance, privacy,
latency, and cost gates pass.

The authority-source acquisition scout is a separate truth-blind shadow capability. It receives
only title, author, and optional publication year, then uses bounded live search to propose author
or publisher evidence for human review. Existing truth labels, known authority URLs, selection
sources, and provider packets are withheld. Every cited URL must appear in the API's consulted-source
manifest, but URL grounding alone does not make the page eligible evidence: deterministic source
policy blocks a case's selection-frame pages, known conflicting marketing taxonomies, unsupported
positions, and standalone conclusions without an affirmative first-party standalone statement.
The scout's bounded search order treats locating a first-party origin as a separate objective. It
searches exact title and author with an official-source signal, inspects the result, and uses a
remaining query inside a newly discovered author or publisher host before a generic publisher
fallback. It may cite only exact URLs in the consulted-source manifest. Once a discovery-only source
establishes identity, remaining search budget goes to author or publisher discovery rather than
additional aggregators. Search-query telemetry is retained with the no-write trial report so a miss
is diagnosable; it does not add a known origin or truth source to the prompt. Series-name extraction
uses the label attached to the explicit bibliographic relationship, not a differing page,
collection, bundle, or campaign heading, and it preserves articles and named forms such as duology
or trilogy rather than shortening the source's name. Deterministic cleanup clears a claimed identity
when no eligible authority identity source survives; the search manifest and query telemetry remain
available for diagnosing the discovery miss without turning that discovery-only source into
evidence. Authority scoring may normalize only a bounded set of generic descriptor tails and never
creates a membership or changes the review proposal.
Only the source that defines the case's selection frame is blocked by that rule; author or
publisher identity pages recorded for sampling remain eligible if the truth-blind live search
independently rediscovers them. A single no-tools repair call may correct the narrow structural
error where a proposal says `series` but omits the membership object, using only facts and URLs
already present in that proposal. It cannot search, add evidence, or bypass revalidation.
Revisions and mirrors of a catalog with a demonstrated relational contradiction share that risk;
they cannot corroborate one another or establish classification merely because their URLs differ.
An exact-work page on the same author or publisher origin remains independently eligible when it
directly states the relationship.
First-party hosting does not promote third-party words: an attributed review, endorsement, blurb,
testimonial, retailer description, or quotation remains discovery-only even when an author or
publisher page reproduces it. The scout must preserve that attribution in its evidence summary, and
deterministic cleaning strips classification support from an attributed summary instead of treating
the page owner's domain as the speaker.
An author profile does not make its host author-controlled. Professional-association directories,
including Crime Writers’ Association member pages, remain discovery-only even when the model labels
their source kind `author`; deterministic host policy strips their classification support. The
frozen 22-work discovery holdout found this attribution failure without changing the prompt: known
direct author or publisher origins were consulted for 81.8% of cases, exact reviewed pages for
72.7%, and the corrected cached replay retained 100% resolved accuracy with zero false series or
false standalone decisions at 68.2% resolution. This set is now a regression benchmark, not a
fresh tuning set.
The model cannot assign authority to its own source. First-pass scout output may join a resolver
packet as review evidence, but it can never become membership-eligible. Only a later selected
retrieval result can enter the no-write resolver score as relational evidence, and only when its
persisted interpretation matches, its citations stay inside the hash-checked child manifest, its
origin has a human-reviewed profile, and ordinary deterministic validation remains policy-safe.
Neither path writes authority gold, Supabase, or the corpus, and both remain production-blocked by
the same safety, rights, privacy, latency, cost, and fixed-sample gates as the resolver.

An independent-index locator is evaluated separately from the model scout. Its fixed queries receive
the same truth-blind title, author, and optional publication year, and its URLs exist only in memory
long enough to compute discovery recall against a frozen development benchmark. It does not pass a
search result into provider evidence, the resolver, retrieval profiles, Supabase, or the corpus.
Only aggregate recall, request count, latency, error count, and estimated cost may be persisted;
queries, provider responses, result titles, snippets, URLs, and case-level provider output are not
retained. The locator refuses any benchmark marked as the qualification partition. The completed
first trial uses Exa Search because it provides a separate web index through a bounded API. It runs
in ordinary `auto` mode with at most ten results and requests no page contents, highlights,
summaries, synthesized output, deep search, or live crawl. On the frozen 18-work development slice
it recovered all four first-party origins and six of seven exact pages missed by the paired Luna-low
baseline. That clears a development gate, not a production gate.

The opt-in shadow fallback runs only after Luna is unresolved or policy-quarantined. It ranks at
most eight candidate domains in memory, excludes known discovery-only origins, and gives those
domains to a separate bounded Luna hosted-search call. Exa URLs, domains, queries, results, and
request IDs are not retained. Only the Luna call's own consulted-source manifest can ground a
proposal, and ordinary authority validation still controls whether that proposal replaces the first
pass. A generic-only membership form such as `series`, `trilogy`, or `duology` is
policy-quarantined because it does not name a bibliographic series. A live run remains a
source-recall experiment, not a new evidence source; production use remains blocked on a separate
rights, privacy, retention, cost, quality, and locked-qualification review.

The complete 209-work reviewed-development run exposed four additional deterministic boundaries.
An author-style profile on a hosted discovery platform does not become author-controlled because
the model labels it `author`; an unmapped translated-edition series label cannot silently replace
the original-language series identity; a storefront title shaped like `Installment: Collection #1`
is ambiguous when the target is the collection; and Hachette's known Violet Wars relationship stays
quarantined because the author's direct statement identifies the grouped novels as unrelated
standalones. Human source review also corrected one stale standalone truth after Micaiah Johnson's
current site directly placed _The Space Between Worlds_ in The Ashtown Series, and added the
publisher-supported singular _Time Tub Traveller_ alias. Replaying the same retained proposals
after those changes produced 100% resolved accuracy and membership precision, 89.2% series recall,
and zero false series or false standalone classifications at 80.9% resolution. Exa added eleven
correct resolutions over the cleaned Luna-only baseline. These are development results, not
production qualification.

Search-index recall is not repaired by letting the model fetch arbitrary URLs. The bounded trial
uses a single-hop, navigation-aware retrieval gateway: only a hosted-search-manifest URL on a
reviewed author/publisher origin may enter it; deterministic code may fetch that parent and one
same-origin child under strict SSRF, robots, size, timeout, privacy, and provenance controls. The
optional second model pass has no tools, may interpret only the hash-bound sanitized child packet,
and cannot choose another URL or source kind. The exact target title and author must occur before
the model is called; deterministic post-validation then requires one non-heading evidence line to
join the exact target title to each claimed bibliographic series or affirmative standalone
statement. The only heading exception requires a human-reviewed per-origin capability plus a
shallow, query-free author catalog with at least two distinct numbered titles sharing the same
non-generic series prefix and an exact target-title match. The gateway binds the capability into the
manifest, and provider conversion requires it to still match the current profile. A position or
membership role survives only on that same relationship line or exact catalog entry,
preventing cross-book fact assembly on multi-book pages. It runs only for an unresolved or
quarantined first pass, and its result replaces the first proposal only after those checks and
ordinary validation pass. Reports and caches retain the applicable selected-source manifest and
structured paraphrase, never page text. The design and acceptance gates are in
[ADR 0009](../decisions/0009-authority-retrieval-gateway.md). The trial CLI exposes this path only
behind `--retrieval`. The resolver's optional `--authority` input accepts the acquisition report,
but only a selected retrieval pass can cross the automatic-evidence gate. The only active real
origins are the owner-reviewed, time-boxed `authorljshen.com` and `smdaviesauthor.com` trial
profiles through 2026-10-07. The S. M. Davies profile alone has the catalog-heading capability,
after its public-network, redirect, robots, navigation, and contact-path review passed. The profile
remains no-write and review-only; its owner decision is recorded in
`packages/series-source-trial/reports/authority-origin-approval-sm-davies-2026-09-07.md`.
`alihazelwood.com`, `penguinrandomhouse.com`, and `penguin.co.uk` are manual-only under their
reviewed access terms. Nothing is connected to production.

Acquisition cleaning also distinguishes bibliographic membership from reading dependence. When an
author or publisher both assigns the exact work to a named series and markets it as independently
readable or “standalone,” the bibliographic series controls and the reading claim remains context.
A genre, trope, shared-world, trigger-warning, or merchandising heading does not establish a
series unless the authority explicitly names a series/collection/duology/trilogy or numbers the
work inside it. Link hubs and known discovery-only hosts cannot establish classification. A
spin-off, companion, shared-character, or same-world statement also cannot be reversed into
membership for the related work; that contextual source is demoted to identity-only unless separate
direct evidence supports the membership. A consulted source that is blocked for classification is
demoted to identity-only before validation. A membership that cited evidence before cleaning but
loses every citation because those sources were demoted is discarded; an independently supported
membership in the same proposal may survive. A membership that arrived with no evidence remains
visible so validation fails, and a series proposal with no surviving membership still fails closed.
This removes only the claim dependent on risky evidence; it never transfers support from another
claim or invents a replacement.

Current authority acquisition requires a `relationshipClaims` array on every source: exact name,
relationship type, and explicit position or null. The validator compares source claims with the
selected memberships, preserves articles and named forms, and blocks omitted competing series,
conflicting positions, and selected non-bibliographic groupings. These are model-extracted claims,
not source qualification. A publisher Series field or `/series/` URL can describe an imprint or
anniversary collection. The reviewed Random House 100 and Thousand Voices catalog profiles, and
the scoped Conform/Thousand Voices author-page conflict, cannot establish classification or be
laundered through structural repair. Rejected groupings never establish standalone status.
Old saved proposals remain usable for offline regression inspection without inventing the new
fields; current acquisition requires them and uses a new prompt/cache version. All outputs remain
review-only. The narrow future correction contract and outstanding qualification requirements are
in `docs/tasks/authority-automatic-correction-gates.md`.

The v14 acquisition protocol additionally requires each source's `observedIdentity` (literal
title, complete author list, and `single_work`/`omnibus`/`unknown` scope) and `originAssessment`
(`claimed_first_party`/`unverified`). Conservative Unicode-aware formatting normalization is not
spelling correction, a surname match, subtitle aliasing, or permission to drop a coauthor. An
omnibus association remains a review case even with a null position. Unknown work scope or an
observed identity discrepancy cannot become a resolved proposal. An unverified origin and an
on-domain link hub cannot establish classification; independent direct evidence may still survive.
The claimed-first-party value is model-reported observation, not origin qualification. Reviewed
retrieval profiles still own source kind, and the interpreter now requires every full target author
in the packet before a model call and checks observed identity against packet text afterwards.

Search passes are cumulative observations, not replacement verdicts. Focused search, Exa fallback,
structural repair and retrieval preserve rejected-pass observations and reject later resolutions
that erase grounded named/type/order, identity or container conflicts. The same unverified site
cannot become eligible merely by changing its path, www spelling or model label on a later pass. Only Luna proposals
and Luna-consulted manifests enter this history; Exa locator output remains ephemeral.
Standalone assertions use standalone support and a summary, not a fabricated relationship named
standalone. Unnamed descriptions remain summary-only and cannot donate an order to another source's
named series. Genuine named uncertainties and disagreements still require review.
See `docs/tasks/authority-evidence-safety.md`. These are offline-tested safeguards, not new live
accuracy evidence or clearance for automatic correction. Consumed frames must not be reacquired.

Provider data is cleaned before it reaches that resolver. Google contributes identity only.
Open Library, Wikidata, Inventaire, and BookBrainz contribute a membership only after the exact
author-matched work appears in a structured relationship; mirrored Wikidata observations share one
lineage. Hardcover is a high-coverage candidate supplement, not an automatic authority: its ordinary
exact-work, non-singleton relationship requires independent open relational agreement before it can
supply automatic membership, and it never corroborates another provider. Self-titled, singleton,
universe, reading-order, publication-order, chronological-order, recommended-order, and competing
relationships remain review-only. A fractional Hardcover position is also quarantined:
it may describe a novella or a legitimate intermediate installment, but the 50-case trial found it
on a publisher-declared standalone placed inside a connected-world reading order. Every current
community source needs independent agreement before an ordinal is automatic; a position conflict
keeps an otherwise eligible membership but clears the order. A deterministic post-pass corrects an
LLM `review` to `accept_membership` only when every review reason concerns order or the unknown role
of a single eligible membership, every proposed position is null, and the ordinary validator
independently proves the membership policy-safe. It never chooses among competing memberships or
promotes a universe, reading-order, singleton, or self-titled relation. An `abstain` response is
normalized to an empty membership list, so explanatory echoes cannot become claims or make a
conservative result structurally invalid.

The current default resolver study uses Open Library, Wikidata, Google Books, and Hardcover.
Inventaire and BookBrainz remain useful discovery and administrator-review inputs, but adding both
to the routine decision packet reduced safe automatic recall on the first 40 reviewed cases without
improving precision or standalone safety. Keep them out of the default automatic packet until the
larger authority set shows a net benefit; their evidence remains available for conflict discovery.
The complete 209-case development evaluation supersedes the earlier 61-case result. Raw Hardcover
relationships reached 68.0% membership recall but only 84.9% precision and produced false series
claims for 9.7% of authority-declared standalones. The previous cleaner plus resolver improved that
to 92.9% precision and 1.6% false standalone, still below the production thresholds. This evidence
is why Hardcover-only membership is now review-only. Production use remains blocked by the untouched
1,000-case qualification partition and source data-use rights.

That qualification partition is deliberately absent from the public development gold file. Build
at least 1,500 authority-reviewed candidates under ignored private storage from complete,
provider-independent identity frames with captured population, eligible, and exclusion counts;
block each frame URL from establishing its own case
classification; exclude every development work; then use the committed SHA-256 seed to select
exactly 600 series-positive and 400 affirmative-standalone cases with at most two selected works
per author identity. Before any model or Exa request, commit a non-secret lock containing the plan,
private-dataset, and full acquisition-system hashes. The frozen run uses Luna low plus Exa fallback,
no navigation retrieval, a qualification-only cache, and a $10 Exa ceiling. Only incomplete
infrastructure failures may resume against the same lock. A completed run cannot be repeated; an
inspected failure used for tuning burns the set into development and requires a new holdout. See
`packages/series-source-trial/reports/authority-qualification-design-2026-09-07.md`.
The run passes only with zero false-positive memberships, zero false standalones, at least 299
evaluated membership claims, at least 85% series recall, at least 75% overall resolution, and no
operational errors.

The same profiles keep data-use boundaries visible to the resolver: Wikidata, Inventaire, and
BookBrainz claims are durable CC0 inputs; Google is live identity-only; Open Library remains trial
input pending its rights review; and Hardcover remains decision input pending usable terms. A
model-generated restatement does not change a source's license or storage boundary.

That cleaning layer addresses false positives by preventing them from becoming corpus defaults; it
does not manufacture a negative fact. A resolver may route a suspect Hardcover relation to review
or abstain, but “standalone” still requires affirmative author/publisher evidence. Missing Open
Library, Wikidata, Inventaire, or BookBrainz data remains an observation only.

### Fantastic Fiction boundary

Fantastic Fiction is conflict/omission discovery and administrator corroboration only. Reverie may
retain only the fact that this corpus work is a member, the series name, the order value/type, the
page URL, and the observation time. It does not retain the site's series-size count and must not
ingest descriptions, covers, reviews, biographies, lists, or other site content. Fantastic Fiction
never promotes a singleton or overrides an
author/publisher source by itself. There is no supported public API in use, so the background worker
does not scrape it; automation requires written permission or a supported licensed feed.

Public accessibility is not blanket scraping authorization. In the Ninth Circuit, _hiQ v.
LinkedIn_ limits one CFAA theory for public pages, but contract, copyright/compilation, state-law,
technical-control, and non-U.S. database-right questions remain separate. Site terms and robots
rules are checked before any connector is enabled, and a technical refusal remains a refusal.

## Future / upcoming releases

There is **no reliable free feed of upcoming romance** — indie/KU release dates live as Amazon
pre-orders and author newsletters, and Goodreads (which did author-follow + new-release alerts)
closed its API. The viable model is **follow the authors you already own and check for their next
book** (`scripts/fetch_upcoming.mjs`).

| Source                   | Reliability /5    | Cost                         | How to get upcoming dates                                                                                                                    |
| ------------------------ | ----------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hardcover**            | 4                 | Free                         | **Active primary discovery.** GraphQL editions provide date, format, publisher, territory, ISBN, and parent work by author.                  |
| **Penguin Random House** | 3 (trad only)     | Free key (manual activation) | **Optional confirmation when `PRH_API_KEY` is configured.** `onsale` is authoritative for the PRH.US catalog only.                           |
| **Google Books**         | 3                 | Free                         | **Excluded from releases.** Merging/reranking provider results conflicts with its display contract; it remains available in explicit search. |
| **ISBNdb**               | 2.5               | Paid                         | Pre-pub ISBNs exist but it isn't a "what's coming" feed; KU ebooks without ISBNs never appear                                                |
| **Amazon pre-orders**    | data 5 / usable 1 | Gated                        | Where indie dates actually are, but the API is closed to new sign-ups                                                                        |
| **Manual + newsletters** | 5                 | Free                         | **Active reader entry.** Planner → Releases accepts title, author, and a flexible year/month/full date before Add.                           |

The shared 24-hour `releases_cache` amortizes provider calls across readers. The cached hit keeps
its provider, source URL, checked time, format, publisher, territory, and whether Hardcover can
identify it as a new work or later edition. Personal `books.pub_*` remains the reader's flexible
date; cached provider provenance is not copied into private book data.

## ISBNdb retirement implementation

ISBNdb is no longer a planned source. Its live enrichment adapter and raw-response normalizers
are removed by the retirement patch. Legacy configuration cannot re-enable it. Enrichment and the
owner-run corpus backfill share a new cache namespace so historical mixed-source records are not
reused; historical provenance types and stored records are preserved. This is a code change, not a
claim of deployment, cancelled billing, or completed retention cleanup. See the
[exit audit and owner handoff](../tasks/isbndb-retirement.md).
