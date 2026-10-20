# Book-data source and coverage audit

Observed October 20, 2026. This is an implementation/coverage audit, not provider permission,
field certification, or approval to change intake. Shared metadata serves the reader app first.

## Current baseline

The owner/admin SELECT-only projection in `scripts/corpus-scoped-inventory.sql` separates work
scalar presence from registered-edition fields. Its strict offline aggregate companion is run with
`node scripts/corpus-scoped-inventory.mjs PRIVATE_INPUT.json PRIVATE_SUMMARY.json`.
This is a separate input contract from `corpus:completion:plan`; do not feed it to the v1 planner.
It accepts no titles, source literals, personal values, or reader identifiers; reader linkage is
one boolean. Outputs are create-only aggregates, not acquisition tasks or correction payloads.

The read-only live snapshot found **1,423 works, 451 reader-linked works and 31,270 registered
editions**. There are 101 missing work descriptions, including **23 reader-linked descriptions**;
one identity concern and seven deferred reviews remain. Series states include 28 review, 71 unknown
and 205 unresolved. These counts are a dated baseline, not an acceptance result.

Edition coverage is materially different: 59 works have no registered edition, 31,150 editions have
unknown format and **30,927 editions are reference-only** (none of the measured details present).
Unknown format leaves missing pages unknown; audiobook pages are not applicable. There are only
21 definite page gaps among editions whose known format makes pages applicable. Do not schedule
31,270 blanket completion tasks or use work scalar values to certify those editions.

Production has no edition-credit storage column yet: all 31,270 edition credit states are
**not observed**, not empty or complete. Structured work contributors exist on 1,422 works but
remain unverified; one work has none. Eighty-two saved metadata assessments are current; this
assesses their existing review scope, not every field. Per-field semantic support and cover-use
qualification remain unknown in this baseline.

Private aggregate receipt: `~/.codex/private/catalog-evidence-workflow-2026-10-20/scoped-baseline.json`.
The first full-row request failed with a closed connector transport. The revised query precomputes
identity groups instead of expanding all peers for every work; the aggregate projection succeeded.
No database writes, provider acquisition, model calls or shared-stack operations occurred.

## Where source policy is lost

| Boundary                                        | Implemented behavior                                                                                                                      | Required next action                                                                                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/functions/enrich/index.ts` adapters   | Independently checks source identity; exact ISBN and work fallback guards exist. Successful records are flattened before merging.         | Preserve source record locator, fact scope, contributor roles and unresolved responsibility text through the review boundary. An admitted book is not proof of every fact. |
| Core and Edge merge implementations             | Fixed scalar precedence, longest description, author/category/ISBN union; provenance normally retains provider and time.                  | Compare field support and disagreements in shadow. Do not promote a longer synopsis or a unioned name list into reviewed truth. Keep Deno/core parity checks.              |
| Enrichment cache                                | Admission v2, identity keys, freshness/completeness and failed-source guards exist.                                                       | Bind eventual evidence/policy versions to cached decisions. Current cache eligibility is not source-use qualification or field certification.                              |
| `apps/web/src/lib/enrich.ts` and consumers      | Exact requested ISBN gates durable edition facts; Add search, library/corpus enrichment and discovery details still use this legacy path. | Migrate only after reviewed-handoff and frozen-comparison gates. Do not silently replace Add/scanning/import behavior.                                                     |
| `intakeSourceQualification` and handoff preview | Code-owned operation findings apply to review tooling, separately for catalog/export/model input.                                         | Audit each legacy consumer against the same field/operation matrix; do not assume the new registry already controls production enrichment.                                 |
| Saved metadata and edition-credit writers       | Explicit administrator review, target checks and audit history; credit source-use receipt is scoped to literal credits and identity.      | Reuse these reviewed writers. A credit receipt cannot authorize synopsis, cover retention, export, model input or a provider adapter.                                      |

## Qualification matrix and bounded decisions

The code-owned findings in `packages/core/src/intakeSourceQualification.ts` are dated October 18,
2026, and remain review-only. This audit does not upgrade them:

| Source / field class                          | Lookup and transient review                                  | Cache                                                    | Durable facts / export / Luna input                                     |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Open Library structured bibliography          | Conditional, human-facing use limits                         | Documented caching guidance, not a blanket content grant | Unverified for this application's field/use scope                       |
| Hardcover structured bibliography and credits | Conditional, with upstream/user-data limits                  | Unverified                                               | Unverified; training restrictions do not establish inference permission |
| PRH structured edition metadata               | Keyed lookup conditional; transient review unverified        | Unverified                                               | Unverified; API access alone does not establish these uses              |
| Provider or website synopsis                  | Qualify the particular text and display use separately       | No inherited permission from identifier caching          | Independently qualify retention, redistribution and model input         |
| Cover image or uploaded page                  | Identity observation and image usage are separate checks     | No inherited metadata permission                         | Cover/OCR output does not establish permission or bibliographic truth   |
| Manually reviewed first-party edition credits | Existing receipt may establish its specific literal-fact use | No provider-wide upgrade                                 | Other fields and operations remain separate                             |

Qualification should identify applicable public terms or specific permission, the exact fields,
operations, attribution, retention conditions and review date. Unresolved model input must not block
an independently qualified catalog correction. This is not a conclusion that existing use is unlawful.

Official starting references are [Open Library use guidance](https://openlibrary.org/developers/api),
[Open Library licensing](https://openlibrary.org/developers/licensing),
[PRH API documentation](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api), and
the [pinned official Hardcover guide](https://github.com/hardcoverapp/hardcover-docs/blob/c965e65dfdc60bd26a9377ade3f8132f48467dee/src/content/docs/api/Getting-Started.mdx).
For corpus-scale Open Library acquisition, qualify its bulk/dump or partnership route rather than
issuing hundreds of lookup requests. Google remains explicit search only; ISBNdb remains retired.

## Next completion order

1. Resolve the identity concern and saved holds through existing review controls; missing values
   do not release a hold or certify standalone status.
2. Review verified non-LLM evidence for the 23 reader-linked descriptions, preserving current values.
3. Select reader-relevant exact editions and examine their actual gaps, not all reference-only rows.
4. Use Luna only for explicitly completed residual research with eligible evidence and reconciled
   budget. Source rank, citation matching and model agreement never replace semantic review.

Before repeating the baseline, use a read-only transaction, a bounded statement timeout and a
private result destination. Check registry/review schema availability first. An unavailable registry
or undeployed credit column is not a zero-count finding. The new inventory has no network, source
acquisition, save capability or pricing authority.
