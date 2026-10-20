# Book-data evidence workflow

The first delivery connects independently inspected evidence to narrow catalog corrections in the
existing `/catalog/metadata` workspace. Add, scanning, imports, provider acquisition and production
enrichment remain unchanged. This is a reviewed handoff, not an autonomous completion system.

## Current baseline and priorities

The October 20, 2026 read-only production aggregate found 1,423 works, 451 reader-linked works,
101 missing work descriptions (23 reader-linked), 31,270 registered editions and 59 works without
a registered edition. Of those editions, 30,927 are reference-only and 31,150 have unknown format.
There are 21 definite page gaps; unknown format leaves another 30,959 page observations unknown.
Production lacks deployed edition-credit storage, so contributor coverage is **not observed**.
Present fields and a reviewed edition flag do not establish field-level evidence support.

Use the additive `corpus:scoped-inventory` projection/summary for scoped measurements, retaining the
existing completion planner input contract. See [source audit](book-data-source-audit.md) for the
failed initial query, successful aggregate, source order and field/operation qualification gaps.
Private inputs, identifiers, attempt journals and source payloads never enter public reports.

Prioritize identity/deferred review holds, then the 23 reader-linked descriptions, then actual
selected-edition gaps. These are a captured baseline, not current live counters or an approved batch.

## Inspect, preview, confirm, recover

An administrator may inspect a bounded local `IntakeEvidenceRequest` in the page-session research
viewer. It validates/recomputes the review and shows candidate values, scopes, source references,
locators and holds. It neither fetches a source nor imports facts into a save draft. Packet
`eligible` flags, model claims, quotations and a matching fingerprint cannot authorize retention.

A separate `CatalogEvidenceDraft` records exactly one work description, selected-edition page count
or selected-edition date. The reviewer enters the original title/full authors, exact edition when
needed, source record and locator, their own support explanation, a correction note and an
inspected field-specific source-use basis. Descriptions need a `catalog_description` receipt;
edition facts need `catalog_edition_facts`. These attestations do not qualify an API adapter or
permit export, model input, images or unrelated prose. Restricted passages stay transient.

The draft freezes with its selected value, source-use reference, target fingerprint and random retry
UUID. Any edit discards approval and requires renewed inspection. Background refetches cannot rebase
it. Explicit approval calls `admin_apply_catalog_evidence`; there is no automatic mutation retry.
The server checks administrator membership under locks, the exact work/peer/edition/review revision,
source inspection and source-use freshness, exact full creator identity, ISBN and field scope.
Identity, initial-only/unknown contributor roles and deferred holds remain blocked. Reopening a
deferred review is a separate deliberate action. ISBN-less edition writes remain unavailable in
this first writer even though offline v2 research can identify a selected ISBN-less edition.

Descriptions reuse the existing narrow audited writer. Pages/dates update only the selected
`corpus_editions.details` field with per-field provenance. They preserve other edition fields,
the existing edition `reviewed` flag, work scalars, sibling editions, series and personal data.
Pages require an already-known paperback, hardcover or ebook format; audio/other/unknown formats
remain held. A date replaces its complete precision tuple, never retaining an unsupported day.
The existing edition registry audit records the narrow change; the evidence receipt commits in
the same transaction. Existing credit and series review actions retain their own boundaries.

Confirmed saves keep a visible receipt even if later reads fail. Uncertain saves lock edits and
discard. **Check evidence history** reads the exact original UUID independently of the last-20
history window. If it has not been confirmed, a deliberate identical retry uses the same UUID,
fingerprint and draft. The server returns an already applied identical result without new writes,
even after later catalog changes or source-use expiry. Changed drafts conflict. A missing receipt
does not prove the original request failed. Account changes discard the departed browser draft.

## Data and compatibility

`corpus_metadata_evidence_reviews` is collective administrator evidence history, with RLS and no
direct grants to anonymous, authenticated or service-role API clients. Only guarded administrator
read/apply RPCs expose it. It is excluded from reader backup/restore and the offline query cache;
profile deletion anonymizes attribution while preserving shared audit history. Work/edition
deletion is restricted while evidence references remain. There is no corpus backfill or personal
row migration. Older servers show an unavailable evidence action while existing controls remain.

The offline request v2 adds explicit full-name responsibility anchors and an explicit provider/record
locator for a selected ISBN-less edition. Legacy roleless names still mean creators only. Editor
anchors require whole-edition basis; creators and editor/other creator-role sets are compared
separately, preserving existing creators and ambiguous responsibility. Exact ISBN checks remain.
The resolution is still review-only and cannot be cast to a book or reviewed save payload.

New Luna tasks explain identity, edition and contributor questions after completed non-LLM research.
They always remain held. The shared $5 pilot bucket is part of the existing $50 total; current status
shows $20.739314750 burden and $29.260685250 remaining, with no unsettled requests. Pricing is not
configured, and this delivery makes **zero paid calls**. See [methodology](intake-luna-methodology.md).

## Verification and staged follow-up

Core, UI/API, SQL and browser regressions cover exact identities, role swaps, existing creator
protection, selected editions, date precision, private cache exclusions, source-use bounds, stale
targets, deferred holds, explicit selection and lost-response recovery. SQL compares protected
personal rows and reading history and verifies audit/idempotency and access boundaries.

A new private 20-work frame is prepared before acquisition, excluding prior exposed identities and
consumed acquisition frames. Its structural strata are ordinary ISBN cases, identifier gaps,
contributor ambiguity and competing editions; translation/anthology-specific coverage remains
unobserved where storage cannot establish it. Unreviewed references and unacquired sources are
explicitly retained. This is a comparison frame, **not evidence of model/source accuracy**. Bind final
candidate code separately before acquisition; do not rewrite the frozen cases or replay attempts.

Before any intake cutover: finish independent source references and operation qualification, run the
new comparison, validate publisher/language/format handoffs, test downstream edition-safe adoption,
and pass the full repository/SQL/CI/browser gates on the exact candidate. Later Add → scanning →
imports activation remains separately staged and reversible. No automatic catalog fill is enabled.
The owner deploys the public/private migration sequence only after merge and guarded verification;
the first production correction remains a separately inspected owner action.
