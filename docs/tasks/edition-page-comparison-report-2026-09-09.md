# Exact-edition pages: useful diagnostics, not ready for automatic filling

## Decision

Keep Google detail and Open Library as trial-only evidence paths. Do not promote this page-count
join to automatic enrichment. The frozen run produced three review candidates: two agreed with
the publisher reference and one differed. The registered no-mismatch gate failed.

The APIs were reachable with the current configuration. The remaining problem is candidate
quality and identity resolution, not authentication or quota availability. This does not establish
which provider record or identity rule caused the mismatch: case-level responses were deliberately
not retained. It also does not establish that publisher metadata is infallible.

ISBNdb stays dropped. This pilot is not a new paid-source comparison and provides no reason to
reopen that subscription. Preserve reader values and explicit review rather than buying another
source or using an LLM to guess the missing number.

## Frozen execution

- [Plan](edition-page-comparison-plan-2026-09-09.md) and [lock](edition-page-comparison-lock-2026-09-09.json) committed at `1354ec8265fe05cf3ac153ce7aeed791c12bb684` before acquisition.
- Runtime: PR #508, merge commit `901afebc02d5f45bf4edd61624b62afaf3263126`; unchanged during this run.
- Frame: 16 editions, 13 works, 14 numeric page references, two audio references with no applicable page count.
- Canonical frame SHA-256: `b52f82baba4e40ac4358b4dc00a582ae2473a69998d70024a1876271a89edbab`.
- Started 2026-09-09 23:01:17 UTC; completed 23:02:07 UTC. Acquisition wall time 50.148 seconds, including pacing.
- One attempt; exclusive start marker retained. No resume, retry, replacement or post-result frame changes.
- [Complete aggregate output](edition-page-comparison-results-2026-09-09.json). No provider payloads, provider identifiers or case-level observations persisted.

## Results

| Outcome                               | Google detail path | Open Library exact-edition path |
| ------------------------------------- | -----------------: | ------------------------------: |
| Identity admitted                     |                 10 |                               3 |
| Identity review required              |                  4 |                               9 |
| Not found                             |                  2 |                               4 |
| HTTP requests                         |        26 / 32 cap |                     42 / 80 cap |
| Transport time, excluding pacing      |            6.493 s |                         8.609 s |
| Authentication/quota/network failures |                  0 |                               0 |

Google used 16 searches and ten detail requests. Open Library's 42 HTTP requests include 12
edition redirects, 26 successful responses and four not-found responses. Provider matches mean
identity admission, not a correct page count or independent corroboration.

| Joint packet state        | Editions |
| ------------------------- | -------: |
| Identity review           |       10 |
| Page conflict             |        1 |
| Single-provider candidate |        2 |
| Cross-provider agreement  |        1 |
| Source missing            |        2 |
| Total                     |       16 |

Three review candidates were emitted: two reference agreements, one reference difference and no
unscored candidate. That is 2/14 (14.3%) correct review-candidate yield across the numeric-reference
gaps, and 2/3 conditional agreement among emitted candidates. The latter is not a population
accuracy estimate. The two audio cases cannot be separately assigned to packet states from the
aggregate artifact; zero unscored candidates is not proof that audio detection succeeded.

The admitted Google observations contain three agreements and one difference; admitted Open
Library observations contain one agreement and one difference. These counts overlap by case and
cannot be summed into work coverage. Joint identity-review or unavailable states suppress both
sources' observations. Consequently, 4/16 and 2/16 are not standalone provider page-availability
estimates. The conflict state is retained, not silently resolved by source priority.

No automatic fills, production writes or application model calls occurred. No paid-source API was
called. The run consumed the request counts above; this is not an audited billing statement. The
50-second paced batch is not a proposed interactive search latency or a production latency forecast.

## What this changes

Successful Google access does not imply reliable automatic edition metadata. Exact ISBN plus a
strict title/author gate still yielded a reference mismatch among review candidates. Nor did the
joint approach provide enough correct yield here to justify shipping it as an automatic repair.

Next, add synthetic-test-backed, aggregate-only diagnostic counters for identity rejection
reasons, endpoint selection, candidate source and edition-format certainty. They must not persist
case identifiers or text. This can distinguish overly strict subtitle/contributor handling from
genuine edition ambiguity in a future run without weakening admission blindly.

Do not change the frozen frame or replay this completed comparison to measure an improved system.
Any subsequent live evaluation needs a new reviewed frame and registration. Keep a separate
publisher-verification step for disputed page counts; an LLM can summarize supplied evidence for
review, but should not manufacture a page count or turn correlated feeds into independent votes.
This pilot does not assess series-membership resolution, search-to-detail uplift, multilingual
coverage, production rights or whole-catalog recall.

## Verification and scope

The two PDF reference blocks were visually inspected before freezing; the PDF skill prevented
reliance on interleaved catalog text. Repository-search checks verified the live runner boundaries
and historical exclusions. The selected frame has no detected title, full-author or ISBN overlap
with the located exclusion frames; the plan records the unlocated older-frame limitation.

Fresh local trial tests: 391 passed. Full workspace tests, typecheck, lint and build passed.
The build's local Supabase URL warning is expected from committed development configuration;
this artifact was not deployed. This branch changes documentation only, so the AGENTS.md
full-browser-run exemption applies; it does not claim a new browser run. No application, core,
Supabase, private production checkout, shared local database, billing or production changes.
