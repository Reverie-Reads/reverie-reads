# Next intake source and spending safeguards

October 17, 2026 planning record, updated October 18. Owner direction: improve accurate, complete book intake and shared metadata,
using non-LLM evidence first and `gpt-6-luna` for residual research, within a $50 total Luna ceiling.
This report records a read-only source and local spending review. It does not qualify sources,
enable acquisition, change writers, or establish readiness to switch Add, scanning or imports.

## October 18 implementation status

The planned durable budget boundary and opt-in publisher edition adapter are now implemented.
The private ledger was initialized from the reconciled receipt at $20.73931475, leaving
$29.26068525 of the $50 total ceiling. This pass made no Luna calls. Current verified model pricing
and token bounds are still required before paid execution; historical assumptions were not reused.
See [the executable budget contract](intake-budget.md).

A first frozen publisher comparison exposed a live response-envelope mismatch. It remains a failed,
consumed receipt. After a separate bounded development probe, regressions and independent review,
a second unseen frozen comparison observed PRH matching five of six positive identities, with
10 of 12 selected edition facts agreeing, two unobserved, and no false identity matches. Duplicate
contributor tuples keep the remaining publisher identity under review. See the
[dated comparison and limitations](intake-publisher-comparison-2026-10-18.md).

The next slice adds distinct duplicate/person-conflict diagnostics and a dated, operation-specific
[source qualification review](intake-source-qualification-2026-10-18.md). Qualification remains
incomplete: applicable API reuse terms and claim-level lineage still need evidence. Duplicate
credits are withheld without silent merging. The [new frozen contributor comparison](intake-credit-qualification-comparison-2026-10-18.md)
retains the resulting source-specific coverage and unresolved failures. Next, resolve those source-use holds and test the
explicit reviewed handoff against source-qualified evidence. Preserve exact ISBN
and full-creator checks. No source is qualified for automatic promotion, and Add/scanning/import
writers remain unchanged. The sections below retain the original research and acceptance rationale;
the adapter and durable-ledger implementation steps are now complete.

## Evidence already available

The saved October 16 completion report records 52 description fills without additional paid calls;
42 used direct author/publisher pages. Its saved verification snapshot contains 1,404 works,
82 missing descriptions and two reader-linked missing descriptions. These are historical local
receipts, not a refreshed inventory. Reconcile current fingerprints and review holds before using
them to schedule work. Blank work-level pages, publisher or language are not counts of missing
facts for a selected edition.

Reuse eligible, independently reviewed evidence before making new requests. Keep every accepted
fact bound to its work or edition, supporting source, observation time and target revision.
Source agreement is not independence when records share an upstream origin. Existing values,
unresolved conflicts, personal library data and reading history remain protected.

## Smallest useful source slice

Add a **review-only exact-ISBN Penguin Random House adapter** to the shadow tooling. This extends
an existing source and transport rather than adding a general catalog vendor. The recent frozen
comparison already demonstrates the need for publisher edition pages and contributor credits.

PRH documents an ISBN-specific title resource with pages, format, language and related contributors.
Its contributor relationship distinguishes author, editor, translator, introduction and other roles.
However, the documented mapping supports at most five people per ISBN; a returned roster cannot
certify completeness. Its work-level contributor endpoint combines relationships from constituent
ISBNs, so it cannot certify credits on the selected edition.
See the official [Title resource](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Title),
[Contributor role](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Contributor_role)
and [Works and ISBNs](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Works_and_ISBNs)
documentation inspected during this review. Documentation describes the API contract; no fresh
authenticated PRH acquisition was performed.

Implementation should:

- Reuse the fixed-host, sanitized-key transport patterns in
  `packages/series-source-trial/src/authority/prh-qualification.mjs` and the existing release adapter.
  Fetch the exact title and its title-scoped contributors, preserving domain/territory.
- Preserve literal contributor codes, labels, order, edition basis and unknown roles. Do not reuse
  `prhAuthorNames()` as identity admission: its fallback returns all contributors when no primary
  author is identified. Do not infer authorship from the endpoint name or flatten the display string.
- Emit ordinary intake observations with exact ISBN/title/creator checks, explicit partial-roster
  qualification, source lineage and review-only usage. Preserve source failures and field conflicts.
- Exclude series classification from this slice. Existing PRH collection/grouping results do not
  establish bibliographic series membership. Dates remain territory-specific edition observations.
- Keep descriptions and covers outside the first adapter slice. API availability does not establish
  retention, display, redistribution or model-input permission. Resolve applicable source-use terms
  separately before durable use or promotion; retain the existing manual-review boundary.

Acceptance needs synthetic tests for wrong ISBN, same-title wrong creator, editor/translator-as-author,
missing and conflicting role codes, duplicate credits, partial rosters, work-versus-edition credits,
territory/date conflicts, provider failure and unchanged personal data. Then freeze a genuinely unseen
paired comparison before acquisition. Report wrong-book and wrong-edition matches, credit agreement,
missing observations, conflicts and review burden separately. Consumed frames cannot become a new
qualification set merely by rerunning them.

## Corpus acquisition and later options

Open Library's current [API policy](https://openlibrary.org/developers/api) favors low-volume human
lookups and explicitly discourages hundreds of individual-book calls. Keep bounded Add/scanning
lookups; for corpus completion, first reuse eligible captures, then assess a
[monthly-dump](https://openlibrary.org/developers/dumps) index or supported partner access. A different
transport does not change source qualification or retention rules. No dump was downloaded here.

Luna remains a residual research and interpretation tool after documented non-LLM attempts.
Independently inspect original cited sources; a model cannot certify identity, lineage, rights or its
own assertions. Broader provider acquisition should wait for a measured gap that existing sources
cannot address.

Later, private reader-supplied title and copyright-page images could help obscure or ISBN-less
editions. Start with a deliberate private evidence-review flow: preserve the original capture,
separate OCR from verified transcription, show uncertainty and require exact edition confirmation.
A photograph or OCR output is not automatic shared-catalog proof, publication permission or a reason
to expose private reader information.

## Spending audit and required durable gate

The latest private October 16 completion budget ledger agrees with the cumulative October 15 Luna
results and summary at **$20.73931475 conservative tracked spend**:

| Component                          |         USD |
| ---------------------------------- | ----------: |
| Recorded request cost entries      | 18.43931475 |
| Retained uncertain-cost reserves   |  2.00000000 |
| Prior comparison reserve           |  0.30000000 |
| Total                              | 20.73931475 |
| Headroom under the new $50 ceiling | 29.26068525 |

The October 16 pass added $0. Continuation result totals are cumulative and must not be added
together. These local conservative receipts are not a refreshed provider invoice or an account-wide
usage audit. No additional paid requests were made for this review. Reconcile any later activity
before spending; the $50 ceiling is not an additional $50 allowance. Historical pricing assumptions
must be checked before another paid run.

The private completion runner reserves $0.50 per in-flight request, counts actual search calls and
token usage, and retains a full reservation when cost is unknown. Finalized failed requests are
excluded from ordinary resume. Its remaining weakness is crash durability: resume reads finalized
results, while progress is held in mutable checkpoints and per-case files. A crash after a request
is accepted but before finalization could allow replay and undercounting. Do not restart that runner
for new work merely by raising its old limit.

Before additional paid execution, implement a private durable request ledger with:

1. A single-writer lock across processes/worktrees and an atomic reservation before network activity.
   Bind each request to its target fingerprint, model, configuration and pricing version.
2. Exclusive request IDs and consumed-attempt markers. Record settlement separately; an uncertain
   request retains its reservation and cannot automatically replay or release that reservation.
3. A reconciled opening balance and explicit $50 ceiling. Refuse unknown usage, unverified pricing,
   configuration drift and reservations beyond available headroom.
4. Tests for simultaneous processes, crash after send, interrupted settlement, duplicate requests,
   exhausted budget and restart. Prove that uncertain attempts cannot be silently spent twice.

`packages/series-source-trial/src/authority/corpus-shadow-exa-budget.mjs` provides a useful atomic
temporary-file-and-rename pattern, but its promise lock is process-local; it is not cross-process
exclusion. Keep the new gate independent from catalog writers and record aggregate costs without
logging credentials or private identities.

The next implementation order is adapter correctness and browser stability, durable spending
protection, then the narrow PRH shadow slice. Live intake and unsupported facts remain under their
existing review controls throughout.
